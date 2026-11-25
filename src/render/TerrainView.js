import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math.js';
import { createNoiseTexture, createTerrainMaterial, createTerrainUniforms } from './terrainMaterial.js';

const CHUNK_CELLS = 64; // grid cells per chunk side (128 m at 2 m cells)
const LOD_STEPS = [1, 2, 4, 8]; // grid cells between vertices at each level
const LOD_DISTANCES = [230, 510, 980]; // metres; beyond the last one the coarsest level is used
const BLOCK = 16; // nodes per side of the "contains road bed" lookup blocks
const COARSE = 4; // nodes per sample of the coarse occlusion and sun-shadow fields
const OPEN_GROUND = 0.86; // occlusion value stored for flat open ground

/**
 * Draws the baked terrain grid as chunked levels of detail.
 *
 * Every chunk is the same flat patch, instanced and displaced in the vertex shader from a height
 * texture, so changing a chunk's level of detail costs nothing: there is no per-chunk geometry to
 * build and no frame hitch. Level 0 reads the grid itself, so its vertices are exactly the nodes the
 * physics uses. Coarser levels read reduced copies in which vertices near a road take the lowest
 * road-bed height in their footprint, so distant terrain can never rise over a road.
 */
export class TerrainView {
  constructor({ world, quality = null }) {
    this.world = world;
    this.grid = world.grid;
    this.group = new THREE.Group();
    this.group.name = 'Terrain';
    this.lodScale = quality?.terrainLod ?? 1;
    this.chunksPerSide = Math.floor((this.grid.size - 1) / CHUNK_CELLS);
    this.chunkCount = this.chunksPerSide * this.chunksPerSide;
    this.chunkLod = new Int8Array(this.chunkCount).fill(-1);
    this.lastEvaluated = new THREE.Vector3(Infinity, Infinity, Infinity);
    this.frustum = new THREE.Frustum();
    this.viewProjection = new THREE.Matrix4();
    this.sunDirection = new THREE.Vector3(0, 0, 0);
    this.stats = { triangles: 0, chunks: [0, 0, 0, 0], bakeMs: 0 };

    const started = performance.now();
    this.bakeRoadMasks();
    this.bakeHeightLevels();
    this.bakeChunkBounds();
    this.bakeControlTexture();
    this.sunShadeData = new Uint8Array(this.coarseSize * this.coarseSize).fill(255);
    this.sunShadeTexture = byteTexture(this.sunShadeData, this.coarseSize, THREE.RedFormat, false);
    this.noiseTexture = createNoiseTexture(world.config.seed);

    const bankSpec = world.config.mountain.grassBank;
    const bankPlaza = bankSpec && world.plazas?.find((plaza) => plaza.id === bankSpec.plaza);
    this.uniforms = createTerrainUniforms({
      rainforest: Boolean(world.bridge),
      grassBank: bankPlaza ? { x: bankPlaza.x, z: bankPlaza.z, radius: bankSpec.radius } : null,
      control: this.controlTexture,
      noise: this.noiseTexture,
      sunShade: this.sunShadeTexture,
      grid: this.grid,
      mountain: world.config.mountain,
    });
    this.levels = LOD_STEPS.map((step, index) => this.createLevel(step, index));
    this.stats.bakeMs = performance.now() - started;
    this.setSun(new THREE.Vector3(-0.45, 0.75, 0.35));
  }

  // ------------------------------------------------------------------ baking

  /** Road-bed mask (exact footprint, for the coarse levels) and a soft road-proximity mask (for shading). */
  bakeRoadMasks() {
    const { size, cell, half } = this.grid;
    const road = this.world.config.road;
    this.bedMask = new Uint8Array(size * size);
    this.roadMask = new Uint8Array(size * size);
    this.blocksPerSide = Math.ceil(size / BLOCK);
    this.blockHasBed = new Uint8Array(this.blocksPerSide * this.blocksPerSide);

    const stamp = (x, z, bedHalf) => {
      const reach = bedHalf + 7;
      const minX = Math.max(0, Math.floor((x - reach + half) / cell));
      const maxX = Math.min(size - 1, Math.ceil((x + reach + half) / cell));
      const minZ = Math.max(0, Math.floor((z - reach + half) / cell));
      const maxZ = Math.min(size - 1, Math.ceil((z + reach + half) / cell));
      for (let iz = minZ; iz <= maxZ; iz += 1) {
        const dz = iz * cell - half - z;
        for (let ix = minX; ix <= maxX; ix += 1) {
          const dx = ix * cell - half - x;
          const distance = Math.sqrt(dx * dx + dz * dz);
          if (distance > reach) continue;
          const node = iz * size + ix;
          if (distance <= bedHalf + 0.6 && !this.bedMask[node]) {
            this.bedMask[node] = 1;
            this.blockHasBed[Math.floor(iz / BLOCK) * this.blocksPerSide + Math.floor(ix / BLOCK)] = 1;
          }
          const value = Math.round(255 * (1 - smoothstep(bedHalf - 2.2, bedHalf + 6, distance)));
          if (value > this.roadMask[node]) this.roadMask[node] = value;
        }
      }
    };
    for (const current of this.world.roads) {
      for (let i = 0; i < current.count; i += 1) stamp(current.px[i], current.pz[i], current.ribbonHalfAt(i) + road.bedMargin);
    }
    for (const plaza of this.world.plazas || (this.world.plaza ? [this.world.plaza] : [])) {
      // Cover the disc with stamps so the same code handles it.
      const bedRadius = plaza.radius + road.verge + road.bedMargin;
      for (let radius = 0; radius <= bedRadius - 6; radius += 5) {
        const steps = Math.max(1, Math.ceil((Math.PI * 2 * radius) / 5));
        for (let k = 0; k < steps; k += 1) {
          const angle = (k / steps) * Math.PI * 2;
          stamp(plaza.x + Math.cos(angle) * radius, plaza.z + Math.sin(angle) * radius, Math.min(8, bedRadius - radius));
        }
      }
    }
  }

  /** Reduced height fields for the coarse levels, lowered to the road bed wherever one is nearby. */
  bakeHeightLevels() {
    const { size, heights } = this.grid;
    this.heightLevels = LOD_STEPS.map((step) => {
      if (step === 1) return { data: heights, size };
      const levelSize = (size - 1) / step + 1;
      const data = new Float32Array(levelSize * levelSize);
      for (let j = 0; j < levelSize; j += 1) {
        const iz = j * step;
        for (let i = 0; i < levelSize; i += 1) {
          const ix = i * step;
          let height = heights[iz * size + ix];
          const minX = Math.max(0, ix - step);
          const maxX = Math.min(size - 1, ix + step);
          const minZ = Math.max(0, iz - step);
          const maxZ = Math.min(size - 1, iz + step);
          const blocks = this.blocksPerSide;
          const nearBed = this.blockHasBed[Math.floor(minZ / BLOCK) * blocks + Math.floor(minX / BLOCK)]
            || this.blockHasBed[Math.floor(minZ / BLOCK) * blocks + Math.floor(maxX / BLOCK)]
            || this.blockHasBed[Math.floor(maxZ / BLOCK) * blocks + Math.floor(minX / BLOCK)]
            || this.blockHasBed[Math.floor(maxZ / BLOCK) * blocks + Math.floor(maxX / BLOCK)];
          if (nearBed) {
            for (let z = minZ; z <= maxZ; z += 1) {
              const row = z * size;
              for (let x = minX; x <= maxX; x += 1) {
                if (this.bedMask[row + x] && heights[row + x] < height) height = heights[row + x];
              }
            }
          }
          data[j * levelSize + i] = height;
        }
      }
      return { data, size: levelSize };
    });
  }

  bakeChunkBounds() {
    const { size, heights, cell, half } = this.grid;
    const n = this.chunksPerSide;
    this.chunkMinY = new Float32Array(this.chunkCount);
    this.chunkMaxY = new Float32Array(this.chunkCount);
    this.chunkCentreX = new Float32Array(this.chunkCount);
    this.chunkCentreZ = new Float32Array(this.chunkCount);
    this.chunkBounds = [];
    const coarseStep = LOD_STEPS.at(-1);
    const maxSkirt = 4 + coarseStep * cell * 2.5;
    for (let cz = 0; cz < n; cz += 1) {
      for (let cx = 0; cx < n; cx += 1) {
        let min = Infinity;
        let max = -Infinity;
        // Coarse road-bed samples can take their height from just outside the chunk.
        const endZ = Math.min(size - 1, (cz + 1) * CHUNK_CELLS + coarseStep);
        const endX = Math.min(size - 1, (cx + 1) * CHUNK_CELLS + coarseStep);
        for (let iz = Math.max(0, cz * CHUNK_CELLS - coarseStep); iz <= endZ; iz++) {
          for (let ix = Math.max(0, cx * CHUNK_CELLS - coarseStep); ix <= endX; ix++) {
            const h = heights[iz * size + ix];
            if (h < min) min = h;
            if (h > max) max = h;
          }
        }
        const chunk = cz * n + cx;
        this.chunkMinY[chunk] = min;
        this.chunkMaxY[chunk] = max;
        this.chunkCentreX[chunk] = (cx + 0.5) * CHUNK_CELLS * cell - half;
        this.chunkCentreZ[chunk] = (cz + 0.5) * CHUNK_CELLS * cell - half;
        const x = cx * CHUNK_CELLS * cell - half, z = cz * CHUNK_CELLS * cell - half;
        this.chunkBounds.push(new THREE.Box3(new THREE.Vector3(x, min - maxSkirt, z),
          new THREE.Vector3(x + CHUNK_CELLS * cell, max, z + CHUNK_CELLS * cell)));
      }
    }
  }

  /** RGBA texture at grid resolution: world normal (xz), occlusion, road proximity. */
  bakeControlTexture() {
    const { size, heights, cell } = this.grid;
    const coarseSize = (size - 1) / COARSE + 1;
    this.coarseSize = coarseSize;
    const coarseHeights = new Float32Array(coarseSize * coarseSize);
    for (let j = 0; j < coarseSize; j += 1) {
      for (let i = 0; i < coarseSize; i += 1) coarseHeights[j * coarseSize + i] = heights[j * COARSE * size + i * COARSE];
    }
    this.coarseHeights = coarseHeights;

    // How much of the sky the surrounding terrain hides, from eight horizon scans per coarse sample.
    const coarseCell = cell * COARSE;
    const skyHidden = new Float32Array(coarseSize * coarseSize);
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    const reaches = [2, 4, 8, 15, 27];
    for (let j = 0; j < coarseSize; j += 1) {
      for (let i = 0; i < coarseSize; i += 1) {
        const here = coarseHeights[j * coarseSize + i];
        let hidden = 0;
        for (let d = 0; d < 8; d += 1) {
          const dx = directions[d][0];
          const dz = directions[d][1];
          const unit = d < 4 ? coarseCell : coarseCell * 1.4142;
          let horizon = 0;
          for (let r = 0; r < reaches.length; r += 1) {
            const x = clamp(i + dx * reaches[r], 0, coarseSize - 1);
            const z = clamp(j + dz * reaches[r], 0, coarseSize - 1);
            const rise = (coarseHeights[z * coarseSize + x] - here) / (reaches[r] * unit);
            if (rise > horizon) horizon = rise;
          }
          hidden += horizon / Math.sqrt(1 + horizon * horizon);
        }
        skyHidden[j * coarseSize + i] = hidden / 8;
      }
    }

    const data = new Uint8Array(size * size * 4);
    const last = size - 1;
    for (let iz = 0; iz < size; iz += 1) {
      const up = iz > 0 ? iz - 1 : iz;
      const down = iz < last ? iz + 1 : iz;
      const farUp = Math.max(0, iz - 4);
      const farDown = Math.min(last, iz + 4);
      const cj = Math.min(coarseSize - 2, Math.floor(iz / COARSE));
      const fj = iz / COARSE - cj;
      for (let ix = 0; ix < size; ix += 1) {
        const left = ix > 0 ? ix - 1 : ix;
        const right = ix < last ? ix + 1 : ix;
        const node = iz * size + ix;
        const h = heights[node];
        const hl = heights[iz * size + left];
        const hr = heights[iz * size + right];
        const hu = heights[up * size + ix];
        const hd = heights[down * size + ix];
        const gx = (hr - hl) / ((right - left) * cell);
        const gz = (hd - hu) / ((down - up) * cell);
        const inverse = 1 / Math.sqrt(gx * gx + gz * gz + 1);

        // Local hollows (gullies, the foot of cuts) are darkened; crests are lifted a little.
        const hollowFine = (hl + hr + hu + hd) * 0.25 - h;
        const farLeft = Math.max(0, ix - 4);
        const farRight = Math.min(last, ix + 4);
        const hollowWide = (heights[iz * size + farLeft] + heights[iz * size + farRight] + heights[farUp * size + ix] + heights[farDown * size + ix]) * 0.25 - h;
        const ci = Math.min(coarseSize - 2, Math.floor(ix / COARSE));
        const fi = ix / COARSE - ci;
        const c = cj * coarseSize + ci;
        const sky = (skyHidden[c] * (1 - fi) + skyHidden[c + 1] * fi) * (1 - fj) + (skyHidden[c + coarseSize] * (1 - fi) + skyHidden[c + coarseSize + 1] * fi) * fj;
        const occlusion = clamp(OPEN_GROUND - 0.42 * Math.max(0, hollowFine) - 0.055 * clamp(hollowWide, -2.2, 7) - 0.62 * sky, 0.18, 1);

        const o = node * 4;
        data[o] = Math.round((-gx * inverse * 0.5 + 0.5) * 255);
        data[o + 1] = Math.round((-gz * inverse * 0.5 + 0.5) * 255);
        data[o + 2] = Math.round(occlusion * 255);
        data[o + 3] = this.roadMask[node];
      }
    }
    this.controlTexture = byteTexture(data, size, THREE.RGBAFormat, true);
    this.roadMask = null;
  }

  /** Soft shadow that the terrain casts on itself for a given sun direction, on the coarse field. */
  bakeSunShade(direction) {
    const size = this.coarseSize;
    const heights = this.coarseHeights;
    const data = this.sunShadeData;
    const horizontal = Math.hypot(direction.x, direction.z);
    if (direction.y <= 0.01 || horizontal < 1e-4) {
      data.fill(direction.y <= 0.01 ? 0 : 255);
      this.sunShadeTexture.needsUpdate = true;
      return;
    }
    const coarseCell = this.grid.cell * COARSE;
    const stride = 1.5; // coarse cells per march step
    const stepX = (direction.x / horizontal) * stride;
    const stepZ = (direction.z / horizontal) * stride;
    const stepY = (direction.y / horizontal) * stride * coarseCell;
    const maxHeight = this.grid.maxHeight;
    const softness = 9;
    const raw = new Float32Array(size * size);
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        let x = i;
        let z = j;
        let y = heights[j * size + i] + 1.5;
        let light = 1;
        for (let step = 1; step <= 90; step += 1) {
          x += stepX;
          z += stepZ;
          y += stepY;
          if (y > maxHeight || x < 0 || z < 0 || x > size - 1 || z > size - 1) break;
          const clearance = y - heights[Math.round(z) * size + Math.round(x)];
          if (clearance <= 0) {
            light = 0;
            break;
          }
          const partial = (softness * clearance) / (step * stride * coarseCell);
          if (partial < light) light = partial;
        }
        raw[j * size + i] = light;
      }
    }
    // One box blur pass softens the stair steps of the coarse march.
    for (let j = 0; j < size; j += 1) {
      for (let i = 0; i < size; i += 1) {
        let sum = 0;
        let count = 0;
        for (let dz = -1; dz <= 1; dz += 1) {
          const z = j + dz;
          if (z < 0 || z >= size) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const x = i + dx;
            if (x < 0 || x >= size) continue;
            sum += raw[z * size + x];
            count += 1;
          }
        }
        data[j * size + i] = Math.round((sum / count) * 255);
      }
    }
    this.sunShadeTexture.needsUpdate = true;
  }

  // ------------------------------------------------------------------ meshes

  createLevel(step, index) {
    const quads = CHUNK_CELLS / step;
    const side = quads + 1;
    const mainCount = side * side;
    const vertexCount = mainCount + side * 4;
    const positions = new Float32Array(vertexCount * 3);
    const skirt = new Float32Array(vertexCount);
    for (let iz = 0; iz < side; iz += 1) {
      for (let ix = 0; ix < side; ix += 1) {
        const v = (iz * side + ix) * 3;
        positions[v] = ix;
        positions[v + 2] = iz;
      }
    }
    const indices = [];
    for (let iz = 0; iz < quads; iz += 1) {
      for (let ix = 0; ix < quads; ix += 1) {
        const a = iz * side + ix;
        const b = a + 1;
        const c = a + side;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    // Skirts: a copy of each border row pushed down, hiding the gaps between neighbouring levels.
    let cursor = mainCount;
    const addSkirt = (edgeVertex, flip) => {
      const start = cursor;
      for (let i = 0; i < side; i += 1) {
        const source = edgeVertex(i) * 3;
        positions[cursor * 3] = positions[source];
        positions[cursor * 3 + 2] = positions[source + 2];
        skirt[cursor] = 1;
        cursor += 1;
      }
      for (let i = 0; i < quads; i += 1) {
        const e0 = edgeVertex(i);
        const e1 = edgeVertex(i + 1);
        const s0 = start + i;
        const s1 = start + i + 1;
        if (flip) indices.push(e0, s0, e1, e1, s0, s1);
        else indices.push(e0, e1, s0, e1, s1, s0);
      }
    };
    addSkirt((i) => i, false); // north edge (z = 0)
    addSkirt((i) => quads * side + i, true); // south edge
    addSkirt((i) => i * side, true); // west edge (x = 0)
    addSkirt((i) => i * side + quads, false); // east edge

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSkirt', new THREE.BufferAttribute(skirt, 1));
    const chunkAttribute = new THREE.InstancedBufferAttribute(new Float32Array(this.chunkCount * 2), 2);
    chunkAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aChunk', chunkAttribute);
    geometry.setIndex(vertexCount > 65535 ? new THREE.BufferAttribute(new Uint32Array(indices), 1) : new THREE.BufferAttribute(new Uint16Array(indices), 1));
    geometry.instanceCount = 0;
    // Positions are grid indices, not world coordinates, so give culling and sorting an honest bound.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 200, 0), this.grid.half * 2);
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-this.grid.half, -100, -this.grid.half), new THREE.Vector3(this.grid.half, 900, this.grid.half));

    const level = this.heightLevels[index];
    const heightMap = new THREE.DataTexture(level.data, level.size, level.size, THREE.RedFormat, THREE.FloatType);
    heightMap.magFilter = THREE.NearestFilter;
    heightMap.minFilter = THREE.NearestFilter;
    heightMap.generateMipmaps = false;
    heightMap.needsUpdate = true;

    const material = createTerrainMaterial(this.uniforms, {
      heightMap,
      lodStep: step,
      skirtDepth: index === 0 ? 3 : 4 + step * this.grid.cell * 2.5,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `TerrainLevel${index}`;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    this.group.add(mesh);
    return { step, mesh, geometry, material, heightMap, chunkAttribute, trianglesPerChunk: indices.length / 3 };
  }

  // ------------------------------------------------------------------ runtime

  updateLods(cameraPosition) {
    this.lastEvaluated.copy(cameraPosition);
    const halfChunk = CHUNK_CELLS * this.grid.cell * 0.5;
    const last = LOD_STEPS.length - 1;
    for (let chunk = 0; chunk < this.chunkCount; chunk += 1) {
      const dx = Math.max(0, Math.abs(cameraPosition.x - this.chunkCentreX[chunk]) - halfChunk);
      const dz = Math.max(0, Math.abs(cameraPosition.z - this.chunkCentreZ[chunk]) - halfChunk);
      const dy = cameraPosition.y > this.chunkMaxY[chunk] ? cameraPosition.y - this.chunkMaxY[chunk]
        : cameraPosition.y < this.chunkMinY[chunk] ? this.chunkMinY[chunk] - cameraPosition.y : 0;
      const distance = Math.sqrt(dx * dx + dz * dz + dy * dy) / this.lodScale;
      const previous = this.chunkLod[chunk];
      let lod = last;
      for (let k = 0; k < last; k += 1) {
        // Hysteresis: a chunk keeps its current level until it is clearly past the boundary.
        const boundary = LOD_DISTANCES[k] * (previous >= 0 && previous <= k ? 1.08 : 0.94);
        if (distance < boundary) {
          lod = k;
          break;
        }
      }
      this.chunkLod[chunk] = lod;
    }
  }

  /** Pass a camera for per-chunk culling, or a position for uncropped terrain previews. */
  update(view, force = false) {
    const camera = view.isCamera ? view : null;
    const position = camera ? camera.position : view;
    const moved = this.lastEvaluated.distanceToSquared(position) >= 16;
    if (moved || force) this.updateLods(position);
    else if (!camera && !this.usedCamera) return;
    this.usedCamera = !!camera;
    if (camera) {
      camera.updateWorldMatrix(true, false);
      this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.viewProjection, camera.coordinateSystem, camera.reversedDepth);
    }
    const counts = this.stats.chunks;
    counts.fill(0);
    for (let chunk = 0; chunk < this.chunkCount; chunk++) {
      if (camera && !this.frustum.intersectsBox(this.chunkBounds[chunk])) continue;
      const lod = this.chunkLod[chunk];
      const level = this.levels[lod];
      const slot = counts[lod] * 2;
      const x = (chunk % this.chunksPerSide) * CHUNK_CELLS;
      const z = Math.floor(chunk / this.chunksPerSide) * CHUNK_CELLS;
      const offsets = level.chunkAttribute.array;
      if (offsets[slot] !== x || offsets[slot + 1] !== z) {
        offsets[slot] = x;
        offsets[slot + 1] = z;
        level.offsetsChanged = true;
      }
      counts[lod] += 1;
    }
    let triangles = 0;
    for (let k = 0; k < this.levels.length; k += 1) {
      const level = this.levels[k];
      level.geometry.instanceCount = counts[k];
      level.mesh.visible = counts[k] > 0;
      if (level.offsetsChanged) {
        level.chunkAttribute.needsUpdate = true;
        level.offsetsChanged = false;
      }
      triangles += counts[k] * level.trianglesPerChunk;
    }
    this.stats.triangles = triangles;
  }

  setQuality(quality) {
    this.lodScale = quality?.terrainLod ?? 1;
    this.lastEvaluated.set(Infinity, Infinity, Infinity);
  }

  /**
   * Tell the terrain where the sun is so the mountain can shadow its own valleys. The colours are
   * accepted for API symmetry; lighting itself comes from the scene's lights.
   */
  setSun(direction, _sunColor = null, _ambientColor = null, strength = 0.8) {
    this.uniforms.uSunShadeStrength.value = strength;
    const normalized = direction.clone().normalize();
    if (this.sunDirection.lengthSq() > 0 && this.sunDirection.dot(normalized) > 0.99996) return;
    this.sunDirection.copy(normalized);
    this.bakeSunShade(normalized);
  }

  dispose() {
    for (const level of this.levels) {
      level.geometry.dispose();
      level.material.dispose();
      level.heightMap.dispose();
      this.group.remove(level.mesh);
    }
    this.controlTexture.dispose();
    this.sunShadeTexture.dispose();
    this.noiseTexture.dispose();
    this.group.parent?.remove(this.group);
  }
}

function byteTexture(data, size, format, mipmaps) {
  const texture = new THREE.DataTexture(data, size, size, format, THREE.UnsignedByteType);
  texture.unpackAlignment = 1;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.generateMipmaps = mipmaps;
  texture.needsUpdate = true;
  return texture;
}
