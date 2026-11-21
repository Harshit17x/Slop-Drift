import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math.js';
import { Noise2D, createRandom } from '../world/noise.js';

// Forest and rocks. Everything is placed once, deterministically from the world seed, into square
// tiles of instanced meshes so the renderer can cull whole tiles. Each instance carries a rank;
// lowering quality simply draws fewer of the best-ranked instances, so nothing is regenerated.

const TREE_TILE = 384; // metres; big enough to keep draw calls low, small enough to cull usefully
const ROCK_TILE = 640;
const BASE_TREES = 11000; // drawn at quality.trees = 1
const MAX_TREE_SCALE = 1.4; // placement is prepared up to this quality multiplier
const BASE_ROCKS = 2400;
const TREE_SPACING = 7.5; // candidate grid, metres
const ROCK_SPACING = 11;
const FIELD_CELL = 16;
const FIELD_REACH = 330;
const OBSTACLE_RANGE = 60; // only scenery this close to a road can be hit at speed
const SHADOW_RANGE = 90;

const scratchLocation = {};
const scratchNormal = { nx: 0, ny: 1, nz: 0 };
const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchEuler = new THREE.Euler();
const scratchColor = new THREE.Color();

/** Merge simple geometries (position + normal) into one, painting each part with a colour ramp along Y. */
function mergeParts(parts) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const part of parts) {
    vertexCount += part.geometry.attributes.position.count;
    indexCount += part.geometry.index.count;
  }
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint16Array(indexCount);
  let vertexOffset = 0;
  let indexOffset = 0;
  const low = new THREE.Color();
  const high = new THREE.Color();
  for (const part of parts) {
    const geometry = part.geometry;
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    low.setHex(part.low);
    high.setHex(part.high);
    geometry.computeBoundingBox();
    const minY = geometry.boundingBox.min.y;
    const spanY = Math.max(1e-6, geometry.boundingBox.max.y - minY);
    for (let i = 0; i < position.count; i += 1) {
      const target = (vertexOffset + i) * 3;
      positions[target] = position.getX(i);
      positions[target + 1] = position.getY(i);
      positions[target + 2] = position.getZ(i);
      normals[target] = normal.getX(i);
      // Tilt foliage normals upward a little so the crown catches skylight like a soft mass.
      normals[target + 1] = normal.getY(i) + (part.lift || 0);
      normals[target + 2] = normal.getZ(i);
      const length = Math.hypot(normals[target], normals[target + 1], normals[target + 2]) || 1;
      normals[target] /= length;
      normals[target + 1] /= length;
      normals[target + 2] /= length;
      const t = (position.getY(i) - minY) / spanY;
      colors[target] = low.r + (high.r - low.r) * t;
      colors[target + 1] = low.g + (high.g - low.g) * t;
      colors[target + 2] = low.b + (high.b - low.b) * t;
    }
    const index = geometry.index;
    for (let i = 0; i < index.count; i += 1) indices[indexOffset + i] = index.getX(i) + vertexOffset;
    vertexOffset += position.count;
    indexOffset += index.count;
    geometry.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();
  return merged;
}

/** A conifer: a short trunk and stacked, overlapping cones. Origin at the base of the trunk. */
function buildConifer({ height, trunkHeight, trunkRadius, layers, baseRadius, topRadius, segments, dark, light }) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(trunkRadius * 0.6, trunkRadius, trunkHeight + height * 0.25, 5, 1, true);
  trunk.translate(0, (trunkHeight + height * 0.25) * 0.5, 0);
  parts.push({ geometry: trunk, low: 0x2e2118, high: 0x3d2c1f });
  const crown = height - trunkHeight;
  const layerHeight = (crown / layers) * 1.55; // layers overlap so no gaps show between them
  for (let i = 0; i < layers; i += 1) {
    const t = i / Math.max(1, layers - 1);
    const radius = baseRadius + (topRadius - baseRadius) * t;
    const base = trunkHeight + (crown - layerHeight) * (i / Math.max(1, layers - 1 || 1));
    const cone = new THREE.ConeGeometry(radius, layerHeight, segments, 1, false);
    cone.rotateY((i * Math.PI) / segments);
    cone.translate(0, base + layerHeight * 0.5, 0);
    parts.push({ geometry: cone, low: dark, high: light, lift: 0.35 });
  }
  return mergeParts(parts);
}

/** A lumpy boulder with flat facets. Radius roughly 1, flattened, origin at its centre. */
function buildRock(seed) {
  const source = new THREE.IcosahedronGeometry(1, 1);
  const noise = new Noise2D(seed);
  const position = source.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    // Displacement depends only on the direction, so shared corners stay welded.
    const bump = 1 + 0.26 * noise.value(x * 1.7 + y * 2.3, z * 1.9 - y * 1.1) + 0.12 * noise.value(x * 4.1 - 7, z * 4.3 + y * 3.7);
    position.setXYZ(i, x * bump, y * bump * 0.72, z * bump);
  }
  source.computeVertexNormals();
  const count = position.count;
  const colors = new Float32Array(count * 3);
  const normal = source.attributes.normal;
  for (let i = 0; i < count; i += 1) {
    // Lighter on top faces, darker underneath: cheap baked ambient shading.
    const shade = 0.62 + 0.38 * clamp(normal.getY(i) * 0.5 + 0.5, 0, 1);
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  source.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  source.deleteAttribute('uv');
  source.computeBoundingSphere();
  return source;
}

/** Coarse grid of distance to the nearest road, good to FIELD_REACH metres. */
function buildRoadDistanceField(world) {
  const half = world.grid.half;
  const size = Math.ceil((half * 2) / FIELD_CELL) + 1;
  const data = new Float32Array(size * size).fill(FIELD_REACH);
  const reach = Math.ceil(FIELD_REACH / FIELD_CELL);
  for (const road of world.roads) {
    const stride = Math.max(1, Math.round(8 / road.spacing));
    for (let i = 0; i < road.count; i += stride) {
      const x = road.px[i];
      const z = road.pz[i];
      const cx = Math.round((x + half) / FIELD_CELL);
      const cz = Math.round((z + half) / FIELD_CELL);
      for (let iz = Math.max(0, cz - reach); iz <= Math.min(size - 1, cz + reach); iz += 1) {
        const dz = iz * FIELD_CELL - half - z;
        for (let ix = Math.max(0, cx - reach); ix <= Math.min(size - 1, cx + reach); ix += 1) {
          const dx = ix * FIELD_CELL - half - x;
          const distance = Math.sqrt(dx * dx + dz * dz);
          const node = iz * size + ix;
          if (distance < data[node]) data[node] = distance;
        }
      }
    }
  }
  return {
    sample(x, z) {
      const gx = clamp((x + half) / FIELD_CELL, 0, size - 1.001);
      const gz = clamp((z + half) / FIELD_CELL, 0, size - 1.001);
      const ix = gx | 0;
      const iz = gz | 0;
      const fx = gx - ix;
      const fz = gz - iz;
      const node = iz * size + ix;
      const top = data[node] + (data[node + 1] - data[node]) * fx;
      const bottom = data[node + size] + (data[node + size + 1] - data[node + size]) * fx;
      return top + (bottom - top) * fz;
    },
  };
}

export class Scenery {
  /**
   * @param {object} options
   * @param {import('../world/World.js').World} options.world  A built world.
   * @param {object} [options.quality]  Entry of QUALITY_PRESETS; `trees` scales the instance counts.
   */
  constructor({ world, quality = null }) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'Scenery';
    this.windTime = { value: 0 };
    this.clock = typeof performance !== 'undefined' ? performance.now() : 0;
    this.tiles = [];
    this.treeScale = 1;
    this.drawDistance = Infinity;
    this.stats = { trees: 0, rocks: 0, obstacles: 0, placementMs: 0, meshes: 0 };

    const seed = world.config.seed;
    this.treeGeometries = [
      // Tall narrow spruce.
      buildConifer({ height: 13.5, trunkHeight: 1.3, trunkRadius: 0.36, layers: 4, baseRadius: 2.7, topRadius: 1.05, segments: 7, dark: 0x16301f, light: 0x3d6a3a }),
      // Shorter, broader fir with more trunk showing.
      buildConifer({ height: 10.5, trunkHeight: 2.3, trunkRadius: 0.4, layers: 3, baseRadius: 3.3, topRadius: 1.5, segments: 7, dark: 0x1c3a22, light: 0x4f7b3d }),
    ];
    this.rockGeometry = buildRock(seed + 307);

    this.treeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, envMapIntensity: 0.55 });
    this.treeMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = this.windTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            // Sway grows with the square of height; each tree gets its own phase from where it stands.
            float swayPhase = instanceMatrix[3].x * 0.071 + instanceMatrix[3].z * 0.053;
            float swayHeight = max(0.0, position.y) * 0.085;
            float swayAmount = swayHeight * swayHeight * 0.16;
            transformed.x += sin(uWindTime * 1.1 + swayPhase) * swayAmount;
            transformed.z += cos(uWindTime * 0.83 + swayPhase * 1.7) * swayAmount * 0.7;
          #endif`);
    };
    this.treeMaterial.customProgramCacheKey = () => 'scenery-tree-sway-v1';
    this.rockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0, flatShading: true, envMapIntensity: 0.5 });

    this.place();
    this.setQuality(quality);
  }

  /** Choose every tree and rock position (for the highest quality) and build the tile meshes. */
  place() {
    const started = typeof performance !== 'undefined' ? performance.now() : 0;
    const world = this.world;
    const config = world.config;
    const mountain = config.mountain;
    const roadConfig = config.road;
    const grid = world.grid;
    const field = buildRoadDistanceField(world);
    const clump = new Noise2D(config.seed + 211);
    const tint = new Noise2D(config.seed + 223);
    const bedClear = roadConfig.shoulder + roadConfig.verge + roadConfig.bedMargin;
    const plazas = world.plazas || (world.plaza ? [world.plaza] : []);
    const span = grid.half - 24;
    const maxRadius = grid.half - 12;

    const clearOfRoads = (x, z, distanceToRoad, margin) => {
      for (let p = 0; p < plazas.length; p += 1) {
        if (Math.hypot(x - plazas[p].x, z - plazas[p].z) < plazas[p].radius + roadConfig.verge + roadConfig.bedMargin + 6) return false;
      }
      if (world.isReserved?.(x, z, margin)) return false; // buildings of an authored map
      if (distanceToRoad > 44) return true;
      for (let r = 0; r < world.roads.length; r += 1) {
        if (world.roads[r].locate(x, z, scratchLocation) && scratchLocation.distance < scratchLocation.halfWidth + bedClear + margin) return false;
      }
      return true;
    };

    // ---- trees
    const treeRandom = createRandom(config.seed + 101);
    const trees = [];
    const treeColumns = Math.floor((span * 2) / TREE_SPACING);
    for (let gz = 0; gz < treeColumns; gz += 1) {
      for (let gx = 0; gx < treeColumns; gx += 1) {
        // Always draw the same number of randoms per cell so the layout never depends on rejections.
        const jitterX = treeRandom();
        const jitterZ = treeRandom();
        const chance = treeRandom();
        const variety = treeRandom();
        const x = -span + (gx + 0.1 + jitterX * 0.8) * TREE_SPACING;
        const z = -span + (gz + 0.1 + jitterZ * 0.8) * TREE_SPACING;
        if (x * x + z * z > maxRadius * maxRadius) continue;
        const y = grid.heightAt(x, z);
        if (y < world.waterLevel + 0.7 || y > mountain.treeLine) continue;
        const distanceToRoad = field.sample(x, z);
        const clumping = 0.08 + 0.92 * smoothstep(-0.22, 0.28, clump.fbm(x / 170, z / 170, 3));
        // Dense where the player actually drives, thinner on far slopes that are only ever seen from a distance.
        const nearRoad = 1 - 0.7 * smoothstep(70, 300, distanceToRoad);
        const altitude = 1 - smoothstep(mountain.treeLine - 120, mountain.treeLine, y);
        const density = clumping * nearRoad * altitude;
        if (chance >= density) continue;
        grid.normalAt(x, z, scratchNormal);
        if (scratchNormal.ny < 0.82) continue; // steeper than ~35 degrees, which also excludes road cuts and embankments
        if (!clearOfRoads(x, z, distanceToRoad, 5)) continue;
        const shade = tint.fbm(x / 60, z / 60, 2);
        trees.push({
          x, y, z,
          rank: chance / density,
          road: distanceToRoad,
          species: variety < 0.58 + 0.25 * shade ? 0 : 1,
          // Smaller toward the tree line.
          scale: (0.72 + 0.7 * ((variety * 7.31) % 1)) * (0.62 + 0.38 * altitude),
          stretch: 0.9 + 0.3 * ((variety * 13.7) % 1),
          yaw: variety * 39.7,
          tint: 0.82 + 0.3 * ((variety * 23.3) % 1) + 0.12 * shade,
          warm: 0.5 + 0.5 * shade,
        });
      }
    }
    trees.sort((a, b) => a.rank - b.rank);
    trees.length = Math.min(trees.length, Math.round(BASE_TREES * MAX_TREE_SCALE));

    // ---- rocks
    const rockRandom = createRandom(config.seed + 131);
    const rocks = [];
    const rockColumns = Math.floor((span * 2) / ROCK_SPACING);
    for (let gz = 0; gz < rockColumns; gz += 1) {
      for (let gx = 0; gx < rockColumns; gx += 1) {
        const jitterX = rockRandom();
        const jitterZ = rockRandom();
        const chance = rockRandom();
        const variety = rockRandom();
        const x = -span + (gx + jitterX) * ROCK_SPACING;
        const z = -span + (gz + jitterZ) * ROCK_SPACING;
        if (x * x + z * z > maxRadius * maxRadius) continue;
        const y = grid.heightAt(x, z);
        if (y < world.waterLevel + 0.3) continue;
        grid.normalAt(x, z, scratchNormal);
        if (scratchNormal.ny < 0.58) continue; // nothing rests on faces steeper than ~55 degrees
        const steep = smoothstep(0.9, 0.7, scratchNormal.ny);
        const high = smoothstep(mountain.treeLine - 60, mountain.treeLine + 60, y);
        const density = 0.03 + 0.42 * steep + 0.22 * high;
        if (chance >= density) continue;
        const distanceToRoad = field.sample(x, z);
        if (!clearOfRoads(x, z, distanceToRoad, 3.5)) continue;
        const size = 0.45 + 2.3 * Math.pow((variety * 5.77) % 1, 2.4);
        rocks.push({
          x, y, z, size,
          rank: chance / density,
          road: distanceToRoad,
          yaw: variety * 51.3,
          tilt: ((variety * 17.9) % 1) - 0.5,
          wide: 0.75 + 0.6 * ((variety * 29.1) % 1),
          tint: 0.7 + 0.35 * ((variety * 11.3) % 1),
          snow: smoothstep(mountain.snowLine - 10, mountain.snowLine + 40, y),
        });
      }
    }
    rocks.sort((a, b) => a.rank - b.rank);
    rocks.length = Math.min(rocks.length, Math.round(BASE_ROCKS * 1.2));

    this.trees = trees;
    this.rocks = rocks;
    this.buildTiles();
    this.stats.placementMs = (typeof performance !== 'undefined' ? performance.now() : 0) - started;
  }

  buildTiles() {
    const half = this.world.grid.half;
    const tiles = new Map();
    const tileFor = (x, z, size, layer) => {
      const tx = Math.floor((x + half) / size);
      const tz = Math.floor((z + half) / size);
      const key = layer * 4096 + tx * 64 + tz;
      let tile = tiles.get(key);
      if (!tile) {
        tile = { centerX: (tx + 0.5) * size - half, centerZ: (tz + 0.5) * size - half, reach: size * 0.7072, lists: [[], [], []], meshes: [] };
        tiles.set(key, tile);
      }
      return tile;
    };
    // Items arrive sorted by rank, so every per-tile list is too; `order` is the global rank position.
    this.trees.forEach((tree, order) => tileFor(tree.x, tree.z, TREE_TILE, 0).lists[tree.species].push({ item: tree, order }));
    this.rocks.forEach((rock, order) => tileFor(rock.x, rock.z, ROCK_TILE, 1).lists[2].push({ item: rock, order }));

    tiles.forEach((tile) => {
      tile.lists.forEach((list, kind) => {
        if (!list.length) return;
        const isRock = kind === 2;
        const mesh = new THREE.InstancedMesh(isRock ? this.rockGeometry : this.treeGeometries[kind], isRock ? this.rockMaterial : this.treeMaterial, list.length);
        mesh.name = isRock ? 'SceneryRocks' : `SceneryTrees${kind}`;
        const orders = new Uint32Array(list.length);
        for (let i = 0; i < list.length; i += 1) {
          const { item, order } = list[i];
          orders[i] = order;
          if (isRock) {
            scratchPosition.set(item.x, item.y - item.size * 0.22, item.z);
            scratchEuler.set(item.tilt * 0.5, item.yaw, item.tilt * 0.35);
            scratchScale.set(item.size * item.wide, item.size, item.size * (1.75 - item.wide));
            const grey = 0.33 * item.tint;
            scratchColor.setRGB(grey * 1.02, grey, grey * 0.94).lerp(new THREE.Color(0.82, 0.85, 0.9), item.snow * 0.55);
          } else {
            scratchPosition.set(item.x, item.y - 0.25, item.z);
            scratchEuler.set(0, item.yaw, 0);
            scratchScale.set(item.scale, item.scale * item.stretch, item.scale);
            // Tint between a cool blue-green and a warmer yellow-green so the forest is not one flat colour.
            scratchColor.setRGB(0.86 + 0.3 * item.warm, 1, 0.9 - 0.25 * item.warm).multiplyScalar(item.tint);
          }
          scratchQuaternion.setFromEuler(scratchEuler);
          scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
          mesh.setMatrixAt(i, scratchMatrix);
          mesh.setColorAt(i, scratchColor);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.computeBoundingBox();
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.matrixAutoUpdate = false;
        mesh.userData = { orders, isRock, capacity: list.length };
        tile.meshes.push(mesh);
        this.group.add(mesh);
      });
      tile.lists = null;
      this.tiles.push(tile);
    });
    this.stats.meshes = this.group.children.length;
  }

  setQuality(quality) {
    const scale = clamp(quality?.trees ?? 1, 0.1, MAX_TREE_SCALE);
    this.treeScale = scale;
    const treeLimit = Math.min(this.trees.length, Math.round(BASE_TREES * scale));
    const rockLimit = Math.min(this.rocks.length, Math.round(BASE_ROCKS * clamp(scale, 0.5, 1.2)));
    // Low settings also stop drawing far tiles; at full quality the haze does that job.
    this.drawDistance = scale < 0.5 ? 1300 : scale < 0.9 ? 1900 : Infinity;

    for (const tile of this.tiles) {
      for (const mesh of tile.meshes) {
        const { orders, isRock } = mesh.userData;
        const limit = isRock ? rockLimit : treeLimit;
        // `orders` ascends, so the visible instances are a prefix.
        let low = 0;
        let high = orders.length;
        while (low < high) {
          const mid = (low + high) >> 1;
          if (orders[mid] < limit) low = mid + 1;
          else high = mid;
        }
        mesh.count = low;
      }
    }

    // Only what is drawn is solid, and only near roads.
    const obstacles = [];
    for (let i = 0; i < treeLimit; i += 1) {
      const tree = this.trees[i];
      if (tree.road < OBSTACLE_RANGE) obstacles.push(tree.x, tree.z, 0.34 * tree.scale + 0.08);
    }
    for (let i = 0; i < rockLimit; i += 1) {
      const rock = this.rocks[i];
      if (rock.road < OBSTACLE_RANGE && rock.size >= 1.05) obstacles.push(rock.x, rock.z, rock.size * 0.8);
    }
    this.world.setObstacles?.(obstacles);
    this.stats.trees = treeLimit;
    this.stats.rocks = rockLimit;
    this.stats.obstacles = obstacles.length / 3;
  }

  /** Per-frame: advance the wind, cast shadows only from tiles near the camera, hide tiles past the draw distance. */
  update(cameraPosition) {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    this.windTime.value += Math.min(0.1, (now - this.clock) / 1000);
    this.clock = now;
    if (!cameraPosition) return;
    for (const tile of this.tiles) {
      const distance = Math.hypot(tile.centerX - cameraPosition.x, tile.centerZ - cameraPosition.z);
      const visible = distance - tile.reach < this.drawDistance;
      const shadows = distance - tile.reach < SHADOW_RANGE;
      for (const mesh of tile.meshes) {
        mesh.visible = visible && mesh.count > 0;
        mesh.castShadow = shadows;
      }
    }
  }

  dispose() {
    for (const tile of this.tiles) {
      for (const mesh of tile.meshes) {
        this.group.remove(mesh);
        mesh.dispose();
      }
    }
    this.tiles = [];
    this.treeGeometries.forEach((geometry) => geometry.dispose());
    this.rockGeometry.dispose();
    this.treeMaterial.dispose();
    this.rockMaterial.dispose();
    this.group.parent?.remove(this.group);
    this.world.setObstacles?.([]);
  }
}
