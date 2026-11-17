import * as THREE from 'three';
import { smoothstep } from '../core/math.js';
import { MeshBuffer } from './road/MeshBuffer.js';
import { createAsphaltTexture, createGrainTexture, createChevronTexture, createLabelTexture, createCheckerTexture } from './road/textures.js';

// Everything you see of the road network: asphalt, shoulders and verges, painted lines, guardrails,
// reflector posts, corner chevrons, the summit plaza, and the gates of the active route.
// All static parts are merged or instanced, so the whole network is about a dozen draw calls.
//
// The cross-section mirrors the physics in Road.profileAt / World.sampleGround exactly:
// asphalt out to halfWidth, a flush gravel shoulder, then a verge falling to just above the carved bed.

const ASPHALT_TILE = 4; // metres per repeat of the asphalt texture (world-space, so overlapping roads match)
const GRAIN_TILE = 2.2;
const SURFACE_SINK = 0.004; // shoulders sit a hair below the asphalt edge they share
const VERGE_CLEARANCE = 0.02; // verge ends this far above the carved bed
const OVERLAP_SINK = 0.015; // a road passing over another surface is drawn just beneath it
const MARKING_LIFT = 0.012;
const RAIL_PROFILE = [
  [0, 0.4],
  [-0.075, 0.475],
  [-0.02, 0.55],
  [-0.075, 0.625],
  [0, 0.7],
]; // [offset toward the road, height above the road plane]
const TIGHT_CORNER = 1 / 45;

// Vertex colours, multiplied by the grain texture. Albedos are kept realistic (gravel ~0.3) so the
// roadside does not glare next to the darker asphalt and grass.
const GRAVEL = [0.38, 0.36, 0.33];
const VERGE = [0.17, 0.2, 0.1];
const SKIRT = [0.16, 0.14, 0.11];
const YELLOW = [0.93, 0.68, 0.08];
const WHITE = [0.9, 0.9, 0.87];

const location = {};
const frame = {};
const matrix = new THREE.Matrix4();
const basisX = new THREE.Vector3();
const basisY = new THREE.Vector3(0, 1, 0);
const basisZ = new THREE.Vector3();
const origin = new THREE.Vector3();

export class RoadView {
  /**
   * @param {object} options
   * @param {import('../world/World.js').World} options.world  A built world.
   * @param {object} [options.quality]  Entry of QUALITY_PRESETS; small props stop casting shadows when shadows are off.
   * @param {number} [options.anisotropy]  Texture anisotropy; pass renderer.capabilities.getMaxAnisotropy() when available.
   */
  constructor({ world, quality = null, anisotropy = 8 }) {
    const started = performance.now();
    this.world = world;
    this.config = world.config.road;
    this.group = new THREE.Group();
    this.group.name = 'RoadView';
    this.gates = new THREE.Group();
    this.gates.name = 'RouteGates';
    this.group.add(this.gates);
    this.castSmallShadows = !quality || quality.shadowMapSize > 0;
    this.night = false;
    this.disposables = [];
    this.gateDisposables = [];

    this.textures = {
      asphalt: this.track(createAsphaltTexture(anisotropy)),
      grain: this.track(createGrainTexture(anisotropy)),
      chevron: this.track(createChevronTexture(anisotropy)),
      checker: this.track(createCheckerTexture()),
    };
    this.reflectorMaterial = this.track(new THREE.MeshStandardMaterial({ color: 0xffa51f, emissive: 0xff8a10, emissiveIntensity: 0.25, roughness: 0.35 }));
    this.lightMaterial = this.track(new THREE.MeshStandardMaterial({ color: 0xc7ff52, emissive: 0xa6ff2a, emissiveIntensity: 0.9, roughness: 0.4 }));
    this.steelMaterial = this.track(new THREE.MeshStandardMaterial({ color: 0xb9c0c6, roughness: 0.42, metalness: 0.75, side: THREE.DoubleSide }));
    this.darkMaterial = this.track(new THREE.MeshStandardMaterial({ color: 0x23272c, roughness: 0.6, metalness: 0.5 }));

    this.buildSurfaces();
    this.buildMarkings();
    this.buildRails();
    this.buildDelineators();
    this.buildReflectors();
    this.buildChevrons();
    this.buildSummitMarker();

    this.stats = { buildMs: performance.now() - started, triangles: 0, drawCalls: 0 };
    this.group.traverse((node) => {
      if (!node.isMesh) return;
      const perInstance = node.geometry.index ? node.geometry.index.count / 3 : node.geometry.attributes.position.count / 3;
      this.stats.triangles += perInstance * (node.isInstancedMesh ? node.count : 1);
      this.stats.drawCalls += 1;
    });
  }

  track(resource) {
    this.disposables.push(resource);
    return resource;
  }

  addMesh(geometry, material, name, { cast = false, receive = true, parent = this.group } = {}) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.matrixAutoUpdate = false;
    parent.add(mesh);
    return mesh;
  }

  // ------------------------------------------------------------------ helpers

  /** Height of a road's banked plane at sample i, `lateral` metres right of the centreline. */
  planeY(road, i, lateral) {
    return road.py[i] + lateral * road.bank[i];
  }

  /**
   * Best surface class another road or the plaza offers at (x, z): 0 asphalt, 1 shoulder, 2 verge, 9 none.
   * `exceptRoad` is the road asking; with `lowerOnly` only roads listed before it (and the plaza) count.
   */
  coverClass(x, z, exceptRoad, lowerOnly = false) {
    let best = 9;
    const roads = this.world.roads;
    for (let r = 0; r < roads.length; r += 1) {
      if (r === exceptRoad || (lowerOnly && r > exceptRoad)) continue;
      const road = roads[r];
      if (!road.locate(x, z, location) || location.beyondEnd) continue;
      const a = location.distance;
      const surfaceClass = a <= location.halfWidth ? 0 : a <= location.halfWidth + road.shoulderEdge ? 1 : a <= location.halfWidth + road.vergeEdge ? 2 : 9;
      if (surfaceClass < best) best = surfaceClass;
    }
    const plaza = this.world.plaza;
    if (plaza && exceptRoad !== -1) {
      const distance = Math.hypot(x - plaza.x, z - plaza.z);
      if (distance <= plaza.radius) best = 0;
      else if (distance <= plaza.radius + this.config.verge && best > 2) best = 2;
    }
    return best;
  }

  /** Instance matrix for an upright object at (x, y, z) whose local +Z points along (zx, zz). */
  setUpright(target, index, x, y, z, zx, zz) {
    const length = Math.hypot(zx, zz) || 1;
    basisZ.set(zx / length, 0, zz / length);
    basisX.crossVectors(basisY, basisZ);
    matrix.makeBasis(basisX, basisY, basisZ);
    matrix.setPosition(x, y, z);
    target.setMatrixAt(index, matrix);
  }

  // ------------------------------------------------------------------ asphalt, shoulders, verges

  buildSurfaces() {
    const world = this.world;
    const asphalt = new MeshBuffer({ uvs: true, colors: true, normals: true });
    const soft = new MeshBuffer({ uvs: true, colors: true });
    const laneOffsets = [-1, -0.55, 0, 0.55, 1];
    const laneTone = [1, 0.9, 0.97, 0.9, 1];

    for (const road of world.roads) {
      const base = asphalt.vertexCount;
      for (let i = 0; i < road.count; i += 1) {
        const halfWidth = road.halfWidth[i];
        const gradX = road.grade[i] * road.tx[i] + road.bank[i] * road.rx[i];
        const gradZ = road.grade[i] * road.tz[i] + road.bank[i] * road.rz[i];
        const inverse = 1 / Math.sqrt(gradX * gradX + gradZ * gradZ + 1);
        // Rubber builds up on the driving lines, most of all through tight corners.
        const wear = 0.1 * smoothstep(1 / 70, 1 / 24, Math.abs(road.curvature[i]));
        for (let k = 0; k < 5; k += 1) {
          const lateral = laneOffsets[k] * halfWidth;
          const x = road.px[i] + road.rx[i] * lateral;
          const z = road.pz[i] + road.rz[i] * lateral;
          let y = this.planeY(road, i, lateral);
          if (this.coverClass(x, z, road.id, true) === 0) y -= OVERLAP_SINK;
          const tone = laneTone[k] - (k === 1 || k === 3 ? wear : 0);
          asphalt.vertex(x, y, z, x / ASPHALT_TILE, z / ASPHALT_TILE, tone, tone, tone, -gradX * inverse, inverse, -gradZ * inverse);
        }
      }
      for (let i = 0; i < road.segments; i += 1) {
        const a = base + i * 5;
        const b = base + ((i + 1) % road.count) * 5;
        for (let k = 0; k < 4; k += 1) asphalt.quad(a + k, a + k + 1, b + k + 1, b + k);
      }
      this.buildSoftEdges(road, soft);
    }
    this.buildPlazaSurfaces(asphalt, soft);

    const asphaltMaterial = this.track(new THREE.MeshStandardMaterial({ map: this.textures.asphalt, vertexColors: true, roughness: 0.84, metalness: 0 }));
    // Sample the same texture again at two much larger scales so the grain never reads as a repeating tile.
    asphaltMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', /* glsl */ `
        #ifdef USE_MAP
          vec3 fineGrain = texture2D( map, vMapUv ).rgb;
          float broadPatch = texture2D( map, vMapUv * 0.083 + vec2( 0.37, 0.11 ) ).g;
          float midPatch = texture2D( map, vMapUv.yx * 0.31 + vec2( 0.73, 0.29 ) ).g;
          diffuseColor.rgb *= fineGrain * ( 0.55 + 4.2 * broadPatch ) * ( 0.7 + 2.8 * midPatch );
        #endif
      `);
    };
    asphaltMaterial.customProgramCacheKey = () => 'road-asphalt-v1';
    this.asphaltMesh = this.addMesh(this.track(asphalt.build()), asphaltMaterial, 'RoadAsphalt');

    const softMaterial = this.track(new THREE.MeshStandardMaterial({ map: this.textures.grain, vertexColors: true, roughness: 1, metalness: 0 }));
    this.softMesh = this.addMesh(this.track(soft.build()), softMaterial, 'RoadShouldersAndVerges');
  }

  /** Gravel shoulder, verge and a short skirt below the verge edge, for both sides of one road. */
  buildSoftEdges(road, soft) {
    const config = this.config;
    const vergeDrop = config.vergeDrop - VERGE_CLEARANCE;
    for (const side of [-1, 1]) {
      const base = soft.vertexCount;
      for (let i = 0; i < road.count; i += 1) {
        const inner = road.halfWidth[i];
        const offsets = [inner, inner + config.shoulder, inner + config.shoulder + config.verge];
        const drops = [SURFACE_SINK, SURFACE_SINK, vergeDrop];
        const colors = [GRAVEL, GRAVEL, VERGE];
        for (let k = 0; k < 3; k += 1) {
          const lateral = side * offsets[k];
          const x = road.px[i] + road.rx[i] * lateral;
          const z = road.pz[i] + road.rz[i] * lateral;
          soft.vertex(x, this.planeY(road, i, lateral) - drops[k], z, x / GRAIN_TILE, z / GRAIN_TILE, colors[k][0], colors[k][1], colors[k][2]);
        }
        // Skirt: hides any sliver between the verge edge and the terrain, e.g. above a retaining wall.
        for (let k = 0; k < 2; k += 1) {
          const lateral = side * (offsets[2] + k * 0.4);
          const x = road.px[i] + road.rx[i] * lateral;
          const z = road.pz[i] + road.rz[i] * lateral;
          soft.vertex(x, this.planeY(road, i, side * offsets[2]) - vergeDrop - k * 1.4, z, x / GRAIN_TILE, z / GRAIN_TILE, SKIRT[0], SKIRT[1], SKIRT[2]);
        }
      }
      for (let i = 0; i < road.segments; i += 1) {
        const j = (i + 1) % road.count;
        const a = base + i * 5;
        const b = base + j * 5;
        const mid = (lateral) => {
          const ax = road.px[i] + road.rx[i] * lateral;
          const az = road.pz[i] + road.rz[i] * lateral;
          const bx = road.px[j] + road.rx[j] * lateral;
          const bz = road.pz[j] + road.rz[j] * lateral;
          return this.coverClass((ax + bx) * 0.5, (az + bz) * 0.5, road.id);
        };
        const inner = (road.halfWidth[i] + road.halfWidth[j]) * 0.5;
        // A strip is dropped where a better surface of another road (or the plaza) already covers that ground.
        const strips = [
          [0, 1, mid(side * (inner + config.shoulder * 0.5)) > 0],
          [1, 2, mid(side * (inner + config.shoulder + config.verge * 0.5)) > 1],
          [3, 4, mid(side * (inner + config.shoulder + config.verge)) > 1],
        ];
        for (const [near, far, visible] of strips) {
          if (!visible) continue;
          if (side > 0) soft.quad(a + near, a + far, b + far, b + near);
          else soft.quad(a + far, a + near, b + near, b + far);
        }
      }
    }
  }

  buildPlazaSurfaces(asphalt, soft) {
    const plaza = this.world.plaza;
    if (!plaza) return;
    const config = this.config;
    const steps = 96;
    const centre = asphalt.vertex(plaza.x, plaza.y, plaza.z, plaza.x / ASPHALT_TILE, plaza.z / ASPHALT_TILE, 0.97, 0.97, 0.97, 0, 1, 0);
    const ring = asphalt.vertexCount;
    const softBase = soft.vertexCount;
    const radii = [plaza.radius, plaza.radius + config.verge, plaza.radius + config.verge, plaza.radius + config.verge + 0.4];
    const drops = [SURFACE_SINK, config.vergeDrop - VERGE_CLEARANCE, config.vergeDrop - VERGE_CLEARANCE, config.vergeDrop - VERGE_CLEARANCE + 1.4];
    const colors = [GRAVEL, VERGE, SKIRT, SKIRT];
    for (let k = 0; k < steps; k += 1) {
      const angle = (k / steps) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const x = plaza.x + cos * plaza.radius;
      const z = plaza.z + sin * plaza.radius;
      asphalt.vertex(x, plaza.y, z, x / ASPHALT_TILE, z / ASPHALT_TILE, 1, 1, 1, 0, 1, 0);
      for (let n = 0; n < 4; n += 1) {
        const sx = plaza.x + cos * radii[n];
        const sz = plaza.z + sin * radii[n];
        soft.vertex(sx, plaza.y - drops[n], sz, sx / GRAIN_TILE, sz / GRAIN_TILE, colors[n][0], colors[n][1], colors[n][2]);
      }
    }
    for (let k = 0; k < steps; k += 1) {
      const next = (k + 1) % steps;
      asphalt.triangle(centre, ring + next, ring + k);
      const angle = ((k + 0.5) / steps) * Math.PI * 2;
      const mx = plaza.x + Math.cos(angle) * (plaza.radius + config.verge * 0.5);
      const mz = plaza.z + Math.sin(angle) * (plaza.radius + config.verge * 0.5);
      if (this.coverClass(mx, mz, -1) <= 1) continue; // the spur comes in here
      const a = softBase + k * 4;
      const b = softBase + next * 4;
      soft.quad(a, b, b + 1, a + 1);
      soft.quad(a + 2, b + 2, b + 3, a + 3);
    }
  }

  // ------------------------------------------------------------------ painted lines

  buildMarkings() {
    const world = this.world;
    const paint = new MeshBuffer({ colors: true, normals: true });
    const strip = (road, i, j, lateralI, lateralJ, width, color) => {
      const half = width * 0.5;
      const corner = (index, lateral) => {
        const x = road.px[index] + road.rx[index] * lateral;
        const z = road.pz[index] + road.rz[index] * lateral;
        return paint.vertex(x, this.planeY(road, index, lateral) + MARKING_LIFT, z, 0, 0, color[0], color[1], color[2], 0, 1, 0);
      };
      const a = corner(i, lateralI - half);
      const b = corner(i, lateralI + half);
      const c = corner(j, lateralJ + half);
      const d = corner(j, lateralJ - half);
      paint.quad(a, b, c, d);
    };

    for (const road of world.roads) {
      const count = road.count;
      // Solid double line wherever the road bends, dashes on the straights.
      const solid = new Uint8Array(count);
      for (let i = 0; i < count; i += 1) {
        if (Math.abs(road.curvature[i]) < 0.009) continue;
        for (let k = -7; k <= 7; k += 1) {
          const n = road.closed ? (i + k + count) % count : i + k;
          if (n >= 0 && n < count) solid[n] = 1;
        }
      }
      const centreClear = new Uint8Array(count);
      const edgeClear = [new Uint8Array(count), new Uint8Array(count)];
      for (let i = 0; i < count; i += 1) {
        centreClear[i] = this.coverClass(road.px[i], road.pz[i], road.id, true) === 0 ? 0 : 1;
        for (let s = 0; s < 2; s += 1) {
          const lateral = (s === 0 ? -1 : 1) * (road.halfWidth[i] + 0.5);
          edgeClear[s][i] = this.coverClass(road.px[i] + road.rx[i] * lateral, road.pz[i] + road.rz[i] * lateral, road.id) === 0 ? 0 : 1;
        }
      }
      for (let i = 0; i < road.segments; i += 1) {
        const j = (i + 1) % count;
        if (centreClear[i] && centreClear[j]) {
          if (solid[i] && solid[j]) {
            strip(road, i, j, -0.11, -0.11, 0.1, YELLOW);
            strip(road, i, j, 0.11, 0.11, 0.1, YELLOW);
          } else if (i % 6 < 2) {
            strip(road, i, j, 0, 0, 0.14, YELLOW);
          }
        }
        for (let s = 0; s < 2; s += 1) {
          if (!edgeClear[s][i] || !edgeClear[s][j]) continue;
          const sign = s === 0 ? -1 : 1;
          strip(road, i, j, sign * (road.halfWidth[i] - 0.24), sign * (road.halfWidth[j] - 0.24), 0.12, WHITE);
        }
      }
    }

    // A white ring just inside the edge of the plaza, open where the road comes in.
    const plaza = world.plaza;
    if (plaza) {
      const steps = 96;
      const inner = plaza.radius - 0.5;
      const outer = plaza.radius - 0.36;
      for (let k = 0; k < steps; k += 1) {
        const a0 = (k / steps) * Math.PI * 2;
        const a1 = ((k + 1) / steps) * Math.PI * 2;
        const mid = (a0 + a1) * 0.5;
        if (this.coverClass(plaza.x + Math.cos(mid) * plaza.radius, plaza.z + Math.sin(mid) * plaza.radius, -1) === 0) continue;
        const point = (angle, radius) => paint.vertex(plaza.x + Math.cos(angle) * radius, plaza.y + MARKING_LIFT, plaza.z + Math.sin(angle) * radius, 0, 0, WHITE[0], WHITE[1], WHITE[2], 0, 1, 0);
        paint.quad(point(a0, inner), point(a1, inner), point(a1, outer), point(a0, outer));
      }
    }

    const material = this.track(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.62, metalness: 0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
    }));
    this.markingMesh = this.addMesh(this.track(paint.build()), material, 'RoadMarkings');
  }

  // ------------------------------------------------------------------ guardrails

  buildRails() {
    const world = this.world;
    const config = this.config;
    const beams = new MeshBuffer();
    const postSpots = [];
    this.reflectorSpots = [];
    const points = RAIL_PROFILE.length;

    for (const road of world.roads) {
      const count = road.count;
      for (const side of [-1, 1]) {
        const flags = side < 0 ? road.railLeft : road.railRight;
        const isOn = (i) => {
          if (road.closed) return flags[(i + count) % count] === 1;
          return i >= 0 && i < count && flags[i] === 1;
        };
        const vertexOf = new Int32Array(count).fill(-1);
        const ensure = (i) => {
          if (vertexOf[i] >= 0) return vertexOf[i];
          const terminal = !isOn(i - 1) || !isOn(i + 1); // rail ends are turned down to the ground
          const lateral = side * (road.halfWidth[i] + config.shoulder + config.railOffset);
          const y = this.planeY(road, i, lateral);
          vertexOf[i] = beams.vertexCount;
          for (let p = 0; p < points; p += 1) {
            const offset = lateral + side * RAIL_PROFILE[p][0];
            beams.vertex(road.px[i] + road.rx[i] * offset, y + RAIL_PROFILE[p][1] * (terminal ? 0.3 : 1) - (terminal ? 0.1 : 0), road.pz[i] + road.rz[i] * offset);
          }
          if (!terminal && i % 2 === 0) postSpots.push(road.px[i] + road.rx[i] * (lateral + side * 0.05), y, road.pz[i] + road.rz[i] * (lateral + side * 0.05), road.tx[i], road.tz[i]);
          if (!terminal && i % 8 === 4) {
            const face = lateral - side * 0.095;
            this.reflectorSpots.push(road.px[i] + road.rx[i] * face, y + 0.55, road.pz[i] + road.rz[i] * face, road.tx[i], road.tz[i]);
          }
          return vertexOf[i];
        };
        for (let i = 0; i < road.segments; i += 1) {
          const j = (i + 1) % count;
          if (!flags[i] || !flags[j]) continue;
          const a = ensure(i);
          const b = ensure(j);
          for (let p = 0; p < points - 1; p += 1) beams.quad(a + p, b + p, b + p + 1, a + p + 1);
        }
      }
    }

    // Ring around the plaza, open where the spur arrives.
    const plaza = world.plaza;
    if (plaza) {
      const steps = 72;
      const radius = plaza.radius + config.railOffset;
      const open = [];
      for (let k = 0; k < steps; k += 1) {
        const angle = (k / steps) * Math.PI * 2;
        open.push(world.inPlazaEntry(plaza.x + Math.cos(angle) * radius, plaza.z + Math.sin(angle) * radius));
      }
      const base = beams.vertexCount;
      for (let k = 0; k < steps; k += 1) {
        const angle = (k / steps) * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const terminal = open[(k + 1) % steps] || open[(k - 1 + steps) % steps];
        for (let p = 0; p < points; p += 1) {
          const r = radius + RAIL_PROFILE[p][0];
          beams.vertex(plaza.x + cos * r, plaza.y + RAIL_PROFILE[p][1] * (terminal ? 0.3 : 1) - (terminal ? 0.1 : 0), plaza.z + sin * r);
        }
        if (!open[k] && !terminal && k % 2 === 0) postSpots.push(plaza.x + cos * (radius + 0.05), plaza.y, plaza.z + sin * (radius + 0.05), -sin, cos);
        if (!open[k] && !terminal && k % 4 === 1) this.reflectorSpots.push(plaza.x + cos * (radius - 0.095), plaza.y + 0.55, plaza.z + sin * (radius - 0.095), -sin, cos);
      }
      for (let k = 0; k < steps; k += 1) {
        const next = (k + 1) % steps;
        if (open[k] || open[next]) continue;
        const a = base + k * points;
        const b = base + next * points;
        for (let p = 0; p < points - 1; p += 1) beams.quad(a + p, b + p, b + p + 1, a + p + 1);
      }
    }

    this.railMesh = this.addMesh(this.track(beams.build()), this.steelMaterial, 'Guardrails', { cast: true });

    const postGeometry = this.track(new THREE.BoxGeometry(0.1, 0.86, 0.14));
    const postMaterial = this.track(new THREE.MeshStandardMaterial({ color: 0x8f979e, roughness: 0.55, metalness: 0.6 }));
    const posts = new THREE.InstancedMesh(postGeometry, postMaterial, postSpots.length / 5);
    for (let n = 0; n < posts.count; n += 1) {
      const o = n * 5;
      this.setUpright(posts, n, postSpots[o], postSpots[o + 1] + 0.28, postSpots[o + 2], postSpots[o + 3], postSpots[o + 4]);
    }
    this.finishInstances(posts, 'GuardrailPosts', this.castSmallShadows);
  }

  finishInstances(mesh, name, cast = false) {
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    return mesh;
  }

  // ------------------------------------------------------------------ reflector posts

  buildDelineators() {
    const world = this.world;
    const config = this.config;
    const spots = [];
    for (const road of world.roads) {
      for (const side of [-1, 1]) {
        const flags = side < 0 ? road.railLeft : road.railRight;
        for (let i = 6; i < road.count; i += 12) {
          if (flags[i]) continue;
          const lateral = side * (road.halfWidth[i] + config.shoulder + 0.3);
          const x = road.px[i] + road.rx[i] * lateral;
          const z = road.pz[i] + road.rz[i] * lateral;
          if (this.coverClass(x, z, road.id) <= 1) continue;
          const y = this.planeY(road, i, lateral);
          spots.push(x, y, z, road.tx[i], road.tz[i]);
          this.reflectorSpots.push(x, y + 0.78, z, road.rx[i], road.rz[i]);
        }
      }
    }
    // White blade with a dark band near the top; the reflector sits in the band.
    const blade = new MeshBuffer({ colors: true });
    blade.box(0, 0.42, 0, 0.055, 0, 0, 0, 0.56, 0, 0, 0, 0.018, 0.92, 0.92, 0.9);
    blade.box(0, 0.78, 0, 0.058, 0, 0, 0, 0.1, 0, 0, 0, 0.021, 0.08, 0.08, 0.09);
    const material = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
    const mesh = new THREE.InstancedMesh(this.track(blade.build()), material, spots.length / 5);
    for (let n = 0; n < mesh.count; n += 1) {
      const o = n * 5;
      this.setUpright(mesh, n, spots[o], spots[o + 1], spots[o + 2], spots[o + 3], spots[o + 4]);
    }
    this.finishInstances(mesh, 'Delineators', this.castSmallShadows);
  }

  buildReflectors() {
    const spots = this.reflectorSpots;
    const geometry = this.track(new THREE.BoxGeometry(0.05, 0.075, 0.1));
    const mesh = new THREE.InstancedMesh(geometry, this.reflectorMaterial, spots.length / 5);
    for (let n = 0; n < mesh.count; n += 1) {
      const o = n * 5;
      this.setUpright(mesh, n, spots[o], spots[o + 1], spots[o + 2], spots[o + 3], spots[o + 4]);
    }
    this.finishInstances(mesh, 'Reflectors');
    this.reflectorSpots = null;
  }

  // ------------------------------------------------------------------ corner chevrons

  buildChevrons() {
    const world = this.world;
    const config = this.config;
    // Boards alternate between the two directions of travel, each showing which way its traffic must turn.
    const spots = { right: [], left: [] };
    for (const road of world.roads) {
      let serial = 0;
      for (let i = 0; i < road.count; i += 3) {
        const curvature = road.curvature[i];
        if (Math.abs(curvature) < TIGHT_CORNER) continue;
        const side = curvature > 0 ? -1 : 1; // outside of the bend
        const lateral = side * (road.halfWidth[i] + config.shoulder + config.railOffset + 0.8);
        const x = road.px[i] + road.rx[i] * lateral;
        const z = road.pz[i] + road.rz[i] * lateral;
        if (this.coverClass(x, z, road.id) <= 1) continue;
        const travel = serial % 2 === 0 ? 1 : -1;
        serial += 1;
        // Face partly back along the approach and partly toward the inside of the bend.
        const nx = -side * road.rx[i] * 0.55 - travel * road.tx[i] * 0.83;
        const nz = -side * road.rz[i] * 0.55 - travel * road.tz[i] * 0.83;
        const turnsRight = curvature * travel > 0;
        (turnsRight ? spots.right : spots.left).push(x, this.planeY(road, i, lateral), z, nx, nz);
      }
    }
    const material = this.track(new THREE.MeshStandardMaterial({ map: this.textures.chevron, roughness: 0.55, metalness: 0.1 }));
    for (const kind of ['right', 'left']) {
      const list = spots[kind];
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(this.track(chevronGeometry(kind === 'left')), material, list.length / 5);
      for (let n = 0; n < mesh.count; n += 1) {
        const o = n * 5;
        this.setUpright(mesh, n, list[o], list[o + 1], list[o + 2], list[o + 3], list[o + 4]);
      }
      this.finishInstances(mesh, `Chevrons_${kind}`, this.castSmallShadows);
    }
  }

  // ------------------------------------------------------------------ summit

  buildSummitMarker() {
    const world = this.world;
    const plaza = world.plaza;
    if (!plaza) return;
    const spur = world.roads[world.roads.length - 1];
    const last = spur.count - 1;
    // Stand the marker on the far side of the plaza from the incoming road, facing arrivals.
    const ax = spur.tx[last];
    const az = spur.tz[last];
    const x = plaza.x + ax * (plaza.radius - 4.5);
    const z = plaza.z + az * (plaza.radius - 4.5);

    const stone = new MeshBuffer({ colors: true });
    // Plinth squared up to the approach so the sign on its front face reads straight on.
    stone.box(x, plaza.y + 0.6, z, az * 1.5, 0, -ax * 1.5, 0, 0.6, 0, ax * 1.5, 0, az * 1.5, 0.5, 0.5, 0.48);
    stone.box(x, plaza.y + 1.3, z, az * 1.0, 0, -ax * 1.0, 0, 0.1, 0, ax * 1.0, 0, az * 1.0, 0.58, 0.58, 0.56);
    const obelisk = new THREE.CylinderGeometry(0.12, 0.62, 5.2, 4, 1);
    obelisk.rotateY(Math.atan2(ax, az) + Math.PI / 4);
    obelisk.translate(x, plaza.y + 1.4 + 2.6, z);
    const stoneMaterial = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
    this.addMesh(this.track(stone.build()), stoneMaterial, 'SummitPlinth', { cast: true });
    const obeliskMaterial = this.track(new THREE.MeshStandardMaterial({ color: 0x9a9b97, roughness: 0.85, flatShading: true }));
    this.addMesh(this.track(obelisk), obeliskMaterial, 'SummitObelisk', { cast: true });

    const label = this.track(createLabelTexture(['SUMMIT', `${Math.round(plaza.y)} M`], { width: 512, height: 256 }));
    const signMaterial = this.track(new THREE.MeshStandardMaterial({ map: label, roughness: 0.6, emissive: 0xffffff, emissiveMap: label, emissiveIntensity: 0.12 }));
    const sign = new THREE.Mesh(this.track(new THREE.PlaneGeometry(2.0, 1.0)), signMaterial);
    sign.name = 'SummitSign';
    sign.position.set(x - ax * 1.52, plaza.y + 0.62, z - az * 1.52);
    sign.rotation.y = Math.atan2(-ax, -az);
    sign.castShadow = false;
    this.group.add(sign);
    this.summitSignMaterial = signMaterial;
  }

  // ------------------------------------------------------------------ route gates

  /**
   * Show the start/finish gantry, start line and checkpoint gates of one route (an entry of world.routes),
   * or nothing when `route` is null.
   */
  setRoute(route) {
    this.clearGates();
    if (!route) return;
    const road = this.world.roads[route.roadId];
    const sameLine = route.closed || Math.abs(route.finishS - route.startS) < 1;
    this.addGantry(road, route.startS, route.direction, sameLine ? ['START  ·  FINISH'] : ['START']);
    if (!sameLine) this.addGantry(road, route.finishS, route.direction, ['FINISH']);

    const gates = route.checkpoints || [];
    if (!gates.length) return;
    const pylonGeometry = this.trackGate(new THREE.BoxGeometry(0.26, 3.1, 0.26));
    const capGeometry = this.trackGate(new THREE.BoxGeometry(0.34, 0.5, 0.34));
    const pylons = new THREE.InstancedMesh(pylonGeometry, this.darkMaterial, gates.length * 2);
    const caps = new THREE.InstancedMesh(capGeometry, this.lightMaterial, gates.length * 2);
    gates.forEach((s, index) => {
      road.frameAt(s, frame);
      const flat = Math.hypot(frame.rx, frame.rz) || 1;
      for (let k = 0; k < 2; k += 1) {
        const lateral = (k === 0 ? -1 : 1) * (frame.halfWidth + this.config.shoulder + this.config.railOffset + 0.7);
        const x = frame.x + (frame.rx / flat) * lateral;
        const z = frame.z + (frame.rz / flat) * lateral;
        const y = frame.y + lateral * frame.bank;
        this.setUpright(pylons, index * 2 + k, x, y + 1.25, z, frame.tx, frame.tz);
        this.setUpright(caps, index * 2 + k, x, y + 3.05, z, frame.tx, frame.tz);
      }
    });
    for (const mesh of [pylons, caps]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = mesh === pylons && this.castSmallShadows;
      mesh.receiveShadow = true;
      this.gates.add(mesh);
    }
  }

  trackGate(resource) {
    this.gateDisposables.push(resource);
    return resource;
  }

  addGantry(road, s, direction, lines) {
    road.frameAt(s, frame);
    const flat = Math.hypot(frame.rx, frame.rz) || 1;
    const rx = frame.rx / flat;
    const rz = frame.rz / flat;
    const tangentFlat = Math.hypot(frame.tx, frame.tz) || 1;
    const tx = frame.tx / tangentFlat;
    const tz = frame.tz / tangentFlat;
    const reach = frame.halfWidth + this.config.shoulder + this.config.railOffset + 0.9;
    const height = 5.6;
    const structure = new MeshBuffer();
    for (const side of [-1, 1]) {
      const x = frame.x + rx * side * reach;
      const z = frame.z + rz * side * reach;
      const y = frame.y + side * reach * frame.bank;
      structure.box(x, y + height * 0.5 - 0.4, z, rx * 0.16, 0, rz * 0.16, 0, height * 0.5 + 0.4, 0, tx * 0.16, 0, tz * 0.16);
    }
    structure.box(frame.x, frame.y + height, frame.z, rx * (reach + 0.3), 0, rz * (reach + 0.3), 0, 0.2, 0, tx * 0.2, 0, tz * 0.2);
    structure.box(frame.x, frame.y + height - 0.75, frame.z, rx * (reach + 0.1), 0, rz * (reach + 0.1), 0, 0.06, 0, tx * 0.08, 0, tz * 0.08);
    this.addMesh(this.trackGate(structure.build()), this.darkMaterial, 'Gantry', { cast: true, parent: this.gates });

    // Banner faces the cars coming toward it.
    const label = this.trackGate(createLabelTexture(lines, { width: 1024, height: 128 }));
    const bannerMaterial = this.trackGate(new THREE.MeshStandardMaterial({ map: label, emissive: 0xffffff, emissiveMap: label, emissiveIntensity: this.night ? 0.9 : 0.15, roughness: 0.6 }));
    const banner = new THREE.Mesh(this.trackGate(new THREE.PlaneGeometry(reach * 1.6, reach * 0.2)), bannerMaterial);
    banner.name = 'GantryBanner';
    banner.position.set(frame.x - tx * direction * 0.24, frame.y + height - 0.38 - reach * 0.02, frame.z - tz * direction * 0.24);
    banner.rotation.y = Math.atan2(-tx * direction, -tz * direction);
    banner.userData.banner = true;
    this.gates.add(banner);

    // Chequered line across the asphalt.
    const line = new MeshBuffer({ uvs: true, normals: true });
    const depth = 0.9;
    const corner = (lateral, along, u, v) => line.vertex(
      frame.x + rx * lateral + tx * along,
      frame.y + lateral * frame.bank + along * frame.grade + MARKING_LIFT + 0.006,
      frame.z + rz * lateral + tz * along,
      u, v, 1, 1, 1, frame.nx, frame.ny, frame.nz,
    );
    const half = frame.halfWidth - 0.4;
    line.quad(corner(-half, -depth, 0, 0), corner(half, -depth, 1, 0), corner(half, depth, 1, 1), corner(-half, depth, 0, 1));
    const lineMaterial = this.trackGate(new THREE.MeshStandardMaterial({
      map: this.textures.checker, roughness: 0.6, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -10,
    }));
    this.addMesh(this.trackGate(line.build()), lineMaterial, 'StartLine', { parent: this.gates });
  }

  clearGates() {
    while (this.gates.children.length) this.gates.remove(this.gates.children[0]);
    this.gateDisposables.forEach((resource) => resource.dispose());
    this.gateDisposables = [];
  }

  /** Brighten reflectors, gate lights and banners after dark. */
  setNight(isNight) {
    this.night = Boolean(isNight);
    this.reflectorMaterial.emissiveIntensity = this.night ? 1.8 : 0.25;
    this.lightMaterial.emissiveIntensity = this.night ? 2.4 : 0.9;
    if (this.summitSignMaterial) this.summitSignMaterial.emissiveIntensity = this.night ? 0.7 : 0.12;
    this.gates.traverse((node) => {
      if (node.userData.banner) node.material.emissiveIntensity = this.night ? 0.9 : 0.15;
    });
  }

  dispose() {
    this.clearGates();
    this.disposables.forEach((resource) => resource.dispose());
    this.disposables = [];
    this.group.removeFromParent();
  }
}

/** Chevron board: textured face toward +Z, a plain back box and two legs. `mirror` flips the arrows. */
function chevronGeometry(mirror) {
  const buffer = new MeshBuffer({ uvs: true });
  const dark = 0.01; // UV of the plain dark texel
  buffer.box(0, 1.3, -0.025, 0.56, 0, 0, 0, 0.31, 0, 0, 0, 0.022, 1, 1, 1, dark, dark);
  for (const side of [-1, 1]) buffer.box(side * 0.38, 0.45, -0.06, 0.03, 0, 0, 0, 0.75, 0, 0, 0, 0.03, 1, 1, 1, dark, dark);
  const u0 = mirror ? 1 : 0;
  const u1 = mirror ? 0 : 1;
  const a = buffer.vertex(-0.55, 1.0, 0, u0, 1);
  const b = buffer.vertex(0.55, 1.0, 0, u1, 1);
  const c = buffer.vertex(0.55, 1.6, 0, u1, 0);
  const d = buffer.vertex(-0.55, 1.6, 0, u0, 0);
  buffer.quad(a, b, c, d);
  return buffer.build();
}
