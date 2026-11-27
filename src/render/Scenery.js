import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math.js';
import { Noise2D, createRandom } from '../world/noise.js';
import { ClipZones } from './ClipZones.js';

// Dense, frustum-culled mountain forest, rocky boulders, alpine shrubs, and 3D grass tufts.
// Nearby trees (<440m), grass, and alpine shrubs render with the web-optimized `alpine-foliage.webp`
// botanical atlas + trunks; distant trees swap smoothly to solid multi-tier conifer silhouettes for fast FPS.

const TREE_TILE = 384;
const ROCK_TILE = 640;
const GRASS_TILE = 128;

const BASE_TREES = 21000;
const MAX_TREE_SCALE = 1.4;
const BASE_ROCKS = 2800;
const BASE_GRASS = 32000;
const MAX_GRASS_SCALE = 1.4;
const BASE_SHRUBS = 7000;

const TREE_SPACING = 5.4;
const ROCK_SPACING = 10.5;
const GRASS_SPACING = 2.6;
const SHRUB_SPACING = 6.2;

const FIELD_CELL = 16;
const FIELD_REACH = 330;
const OBSTACLE_RANGE = 60;
const SHADOW_RANGE = 88;
const HERO_TREE_RANGE = 440;
const GRASS_CORRIDOR = 125;
const SHRUB_CORRIDOR = 150;

const HAS_BROWSER_TEX = typeof import.meta.url === 'string' && typeof Image !== 'undefined';
const ALPINE_FOLIAGE_URL = HAS_BROWSER_TEX ? new URL('../assets/maps/alpine-foliage.webp', import.meta.url).href : null;

const scratchLocation = {};
const scratchNormal = { nx: 0, ny: 1, nz: 0 };
const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchEuler = new THREE.Euler();
const scratchColor = new THREE.Color();

/** Merge simple indexed/non-indexed geometries into one, painting a vertical colour ramp along Y. */
function mergeParts(parts) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const part of parts) {
    vertexCount += part.geometry.attributes.position.count;
    indexCount += part.geometry.index ? part.geometry.index.count : part.geometry.attributes.position.count;
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
    if (index) {
      for (let i = 0; i < index.count; i += 1) indices[indexOffset + i] = index.getX(i) + vertexOffset;
      indexOffset += index.count;
    } else {
      for (let i = 0; i < position.count; i += 1) indices[indexOffset + i] = vertexOffset + i;
      indexOffset += position.count;
    }
    vertexOffset += position.count;
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

/** A solid multi-tier conifer used for distant ridge LOD (zero alpha-discard fillrate cost). */
function buildConifer({ height, trunkHeight, trunkRadius, layers, baseRadius, topRadius, segments, dark, light }) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(trunkRadius * 0.6, trunkRadius, trunkHeight + height * 0.25, 5, 1, true);
  trunk.translate(0, (trunkHeight + height * 0.25) * 0.5, 0);
  parts.push({ geometry: trunk, low: 0x2e2118, high: 0x3d2c1f });
  const crown = height - trunkHeight;
  const layerHeight = (crown / layers) * 1.55;
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

/** Dark bark trunk + slender inner pine shadow core for near-range atlas-textured trees. */
function buildHeroTrunk({ height, trunkRadius, coreRadius, coreBaseY }) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(trunkRadius * 0.22, trunkRadius, height * 0.92, 6, 1, false);
  trunk.translate(0, height * 0.46, 0);
  parts.push({ geometry: trunk, low: 0x2a1c13, high: 0x3e2b1d });
  const core = new THREE.ConeGeometry(coreRadius, (height - coreBaseY) * 0.9, 6, 1, false);
  core.translate(0, coreBaseY + (height - coreBaseY) * 0.45, 0);
  parts.push({ geometry: core, low: 0x0c1b12, high: 0x183422, lift: 0.25 });
  return mergeParts(parts);
}

/**
 * Photorealistic alpine conifer bough crown mapped cleanly to `alpine-foliage.webp`
 * (`quadrant 0` = cedar branch+cones top-left; `quadrant 1` = frosted silver fir bottom-left).
 */
export function buildHeroBoughs({ height, trunkHeight, layers, baseRadius, topRadius, branchesPerRing = 4, quadrant = 0 }) {
  const pos = [];
  const uv = [];
  const norm = [];
  const col = [];
  const idx = [];

  const pushTriQuad = (pA, pB, pC, pD, uvA, uvB, uvC, uvD, nVec, tint) => {
    const base = pos.length / 3;
    const pts = [pA, pB, pC, pD];
    const uvs = [uvA, uvB, uvC, uvD];
    for (let k = 0; k < 4; k += 1) {
      pos.push(pts[k][0], pts[k][1], pts[k][2]);
      uv.push(uvs[k][0], uvs[k][1]);
      norm.push(nVec[0], nVec[1], nVec[2]);
      const g = tint[k];
      col.push(g, g, g);
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  };

  // UV diamond anchors inside safe quadrant boundaries
  const uvsCedar = [
    [0.035, 0.62], // stem left
    [0.125, 0.53], // stem right
    [0.095, 0.89], // wide left needle spray
    [0.395, 0.59], // wide right needle spray
  ];
  const uvsFir = [
    [0.045, 0.16],
    [0.16, 0.045],
    [0.055, 0.45],
    [0.455, 0.06],
  ];
  const uvTipCedar = [0.465, 0.965];
  const uvTipFir = [0.46, 0.455];
  const baseUv = quadrant === 0 ? uvsCedar : uvsFir;
  const tipUv = quadrant === 0 ? uvTipCedar : uvTipFir;

  const spanY = height - trunkHeight - 1.0;
  for (let tier = 0; tier < layers; tier += 1) {
    const t = tier / Math.max(1, layers - 1);
    const y0 = trunkHeight + spanY * t;
    const reach = (baseRadius + (topRadius - baseRadius) * t) * 1.15;
    const droop = 0.62 * (1 - t * 0.45);
    const halfW = reach * 0.52;
    const ringCount = tier === layers - 1 ? 3 : branchesPerRing;
    for (let b = 0; b < ringCount; b += 1) {
      const ang = (b / ringCount) * Math.PI * 2 + tier * 0.85;
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      const px = -dz;
      const pz = dx;
      const pStemL = [dx * 0.08 - px * (halfW * 0.35), y0 + 0.18, dz * 0.08 - pz * (halfW * 0.35)];
      const pStemR = [dx * 0.08 + px * (halfW * 0.35), y0 + 0.18, dz * 0.08 + pz * (halfW * 0.35)];
      const pMidL = [dx * (reach * 0.55) - px * halfW, y0 - droop * 0.32 + 0.24, dz * (reach * 0.55) - pz * halfW];
      const pMidR = [dx * (reach * 0.55) + px * halfW, y0 - droop * 0.32 - 0.12, dz * (reach * 0.55) + pz * halfW];
      const pTip = [dx * reach, y0 - droop, dz * reach];

      // Upward-biased normal for soft volumetric canopy shading
      const nVec = [dx * 0.28, 0.92, dz * 0.28];
      pushTriQuad(pStemL, pStemR, pMidL, pMidR, baseUv[0], baseUv[1], baseUv[2], baseUv[3], nVec, [0.58, 0.58, 0.95, 0.95]);
      // Tapered outer tip triangle cleanly completing the branch silhouette
      const base = pos.length / 3;
      const tipPts = [pMidL, pMidR, pTip];
      const tipUvs = [baseUv[2], baseUv[3], tipUv];
      const tipShade = [0.95, 0.95, 1.05];
      for (let k = 0; k < 3; k += 1) {
        pos.push(tipPts[k][0], tipPts[k][1], tipPts[k][2]);
        uv.push(tipUvs[k][0], tipUvs[k][1]);
        norm.push(nVec[0], nVec[1], nVec[2]);
        col.push(tipShade[k], tipShade[k], tipShade[k]);
      }
      idx.push(base, base + 1, base + 2);
    }
  }

  // Two crossed vertical crown tip spire cards at top
  const spireBase = height - 2.3;
  const spireTop = height + 0.25;
  for (let c = 0; c < 2; c += 1) {
    const a = c * (Math.PI * 0.5) + 0.4;
    const px = Math.cos(a) * 0.95;
    const pz = Math.sin(a) * 0.95;
    pushTriQuad(
      [-px, spireBase, -pz], [px, spireBase, pz],
      [-px * 0.45, spireTop, -pz * 0.45], [px * 0.45, spireTop, pz * 0.45],
      [0.52, 0.56], [0.98, 0.56], [0.58, 0.96], [0.92, 0.96],
      [0, 0.96, 0],
      [0.75, 0.75, 1.05, 1.05],
    );
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Star rosette of crossed grass tuft cards mapped to `alpine-foliage.webp` top-right grass clump. */
export function buildTexturedGrassGeometry() {
  const pos = [];
  const uv = [];
  const norm = [];
  const col = [];
  const idx = [];
  for (let blade = 0; blade < 3; blade += 1) {
    const a = (blade * Math.PI) / 3 + 0.2;
    const ux = Math.cos(a) * 0.52;
    const uz = Math.sin(a) * 0.52;
    const curveX = -Math.sin(a) * 0.14;
    const curveZ = Math.cos(a) * 0.14;
    const first = pos.length / 3;
    const hVals = [0, 0.34, 0.68];
    const vUvs = [0.555, 0.76, 0.96];
    for (let j = 0; j < 3; j += 1) {
      const bend = j === 1 ? 0.5 : j === 2 ? 1.0 : 0;
      const gShade = 0.64 + j * 0.22;
      for (const w of [-1, 1]) {
        pos.push(ux * w + curveX * bend, hVals[j], uz * w + curveZ * bend);
        uv.push(w < 0 ? 0.52 : 0.98, vUvs[j]);
        norm.push(w * ux * 0.3, 0.92, w * uz * 0.3);
        col.push(gShade, gShade, gShade);
      }
    }
    idx.push(first, first + 1, first + 2, first + 1, first + 3, first + 2);
    idx.push(first + 2, first + 3, first + 4, first + 3, first + 5, first + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Star rosette shrub bush mapped to `alpine-foliage.webp` bottom-right juniper quadrant. */
export function buildTexturedShrubGeometry() {
  const pos = [];
  const uv = [];
  const norm = [];
  const col = [];
  const idx = [];
  for (let card = 0; card < 3; card += 1) {
    const a = (card * Math.PI) / 3;
    const ux = Math.cos(a) * 0.62;
    const uz = Math.sin(a) * 0.62;
    const archX = -Math.sin(a) * 0.16;
    const archZ = Math.cos(a) * 0.16;
    const base = pos.length / 3;
    const pts = [
      [-ux, 0.0, -uz, 0.52, 0.055, 0.66],
      [ux, 0.0, uz, 0.98, 0.055, 0.66],
      [-ux + archX, 0.88, -uz + archZ, 0.52, 0.445, 1.05],
      [ux + archX, 0.88, uz + archZ, 0.98, 0.445, 1.05],
    ];
    for (const [x, y, z, u, v, gVal] of pts) {
      pos.push(x, y, z);
      uv.push(u, v);
      norm.push(x * 0.25, 0.90, z * 0.25);
      col.push(gVal, gVal, gVal);
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Headless geometric fallback grass clump when no browser image decoder is present. */
function buildGrassClumpFallback() {
  const blades = 7;
  const pos = [];
  const norm = [];
  const col = [];
  const idx = [];
  const rootCol = new THREE.Color(0x162b10);
  const midCol = new THREE.Color(0x3a5f1f);
  const tipCol = new THREE.Color(0x7c9c38);
  const tmp = new THREE.Color();

  for (let b = 0; b < blades; b += 1) {
    const ang = (b / blades) * Math.PI * 2 + (b % 2) * 0.35;
    const dist = b < 4 ? 0.08 : 0.24;
    const ox = Math.cos(ang) * dist;
    const oz = Math.sin(ang) * dist;
    const h = 0.34 + ((b * 7) % 5) * 0.06;
    const lean = 0.16 + ((b * 3) % 4) * 0.06;
    const halfW = 0.055;
    const px = -Math.sin(ang) * halfW;
    const pz = Math.cos(ang) * halfW;
    const lx = Math.cos(ang) * lean;
    const lz = Math.sin(ang) * lean;
    const base = b * 5;
    const pts = [
      [ox - px, 0, oz - pz, 0],
      [ox + px, 0, oz + pz, 0],
      [ox + lx * 0.4 - px * 0.55, h * 0.55, oz + lz * 0.4 - pz * 0.55, 0.55],
      [ox + lx * 0.4 + px * 0.55, h * 0.55, oz + lz * 0.4 + pz * 0.55, 0.55],
      [ox + lx, h, oz + lz, 1],
    ];
    for (const [x, y, z, t] of pts) {
      pos.push(x, y, z);
      norm.push(lx * 0.35, 0.92, lz * 0.35);
      if (t < 0.5) tmp.copy(rootCol).lerp(midCol, t * 2);
      else tmp.copy(midCol).lerp(tipCol, (t - 0.5) * 2);
      col.push(tmp.r, tmp.g, tmp.b);
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Headless fallback shrub geometry. */
function buildShrubFallback() {
  const parts = [];
  const lobes = [
    { x: 0, y: 0.28, z: 0, r: 0.48, dark: 0x162b14, light: 0x3b6324 },
    { x: 0.28, y: 0.20, z: 0.16, r: 0.36, dark: 0x183015, light: 0x4b7029 },
    { x: -0.25, y: 0.22, z: -0.18, r: 0.38, dark: 0x1e2c15, light: 0x58712c },
  ];
  for (const lobe of lobes) {
    const g = new THREE.SphereGeometry(lobe.r, 6, 4);
    g.scale(1.18, 0.72, 1.05);
    g.translate(lobe.x, lobe.y, lobe.z);
    parts.push({ geometry: g, low: lobe.dark, high: lobe.light, lift: 0.45 });
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
    const bump = 1 + 0.26 * noise.value(x * 1.7 + y * 2.3, z * 1.9 - y * 1.1) + 0.12 * noise.value(x * 4.1 - 7, z * 4.3 + y * 3.7);
    position.setXYZ(i, x * bump, y * bump * 0.72, z * bump);
  }
  source.computeVertexNormals();
  const count = position.count;
  const colors = new Float32Array(count * 3);
  const normal = source.attributes.normal;
  for (let i = 0; i < count; i += 1) {
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
    this.clips = (world.roads || []).filter((road) => road.curvature).map((road) => new ClipZones(road));
    for (const clips of this.clips) this.group.add(clips.mesh);
    this.windTime = { value: 0 };
    this.grassCamPos = { value: new THREE.Vector3() };
    this.grassFade = { value: new THREE.Vector2(130, 195) };
    this.clock = typeof performance !== 'undefined' ? performance.now() : 0;
    this.tiles = [];
    this.treeScale = 1;
    this.drawDistance = 2200;
    this.grassDrawDistance = 195;
    this.shrubDrawDistance = 320;
    this.heroTreeDistance = HERO_TREE_RANGE;
    this.frustum = new THREE.Frustum();
    this.viewProjection = new THREE.Matrix4();
    this.stats = { trees: 0, rocks: 0, grass: 0, shrubs: 0, obstacles: 0, placementMs: 0, meshes: 0 };

    const seed = world.config.seed;
    const useAtlas = Boolean(ALPINE_FOLIAGE_URL);
    if (useAtlas) {
      this.foliageTex = new THREE.TextureLoader().load(ALPINE_FOLIAGE_URL);
      this.foliageTex.colorSpace = THREE.SRGBColorSpace;
      this.foliageTex.anisotropy = 4;
    } else {
      this.foliageTex = null;
    }

    // Solid conifers used on far ridge tiles (> HERO_TREE_RANGE) cleanly with zero alpha discard cost
    this.treeGeometries = [
      buildConifer({ height: 15.0, trunkHeight: 1.4, trunkRadius: 0.36, layers: 5, baseRadius: 2.75, topRadius: 0.95, segments: 7, dark: 0x132c1b, light: 0x3b6938 }),
      buildConifer({ height: 11.4, trunkHeight: 1.9, trunkRadius: 0.38, layers: 4, baseRadius: 3.15, topRadius: 1.35, segments: 7, dark: 0x173723, light: 0x4c7b42 }),
      buildConifer({ height: 9.8, trunkHeight: 2.3, trunkRadius: 0.34, layers: 3, baseRadius: 2.95, topRadius: 1.45, segments: 7, dark: 0x243f1c, light: 0x778935 }),
      buildConifer({ height: 6.8, trunkHeight: 1.2, trunkRadius: 0.28, layers: 3, baseRadius: 2.35, topRadius: 1.05, segments: 6, dark: 0x19341e, light: 0x4a7439 }),
    ];

    // Near-range photorealistic trunks + atlas bough cards
    this.heroTrunkGeometries = useAtlas ? [
      buildHeroTrunk({ height: 15.0, trunkRadius: 0.34, coreRadius: 1.35, coreBaseY: 2.2 }),
      buildHeroTrunk({ height: 11.4, trunkRadius: 0.36, coreRadius: 1.55, coreBaseY: 2.0 }),
      buildHeroTrunk({ height: 9.8, trunkRadius: 0.32, coreRadius: 1.4, coreBaseY: 2.3 }),
      buildHeroTrunk({ height: 6.8, trunkRadius: 0.26, coreRadius: 1.1, coreBaseY: 1.4 }),
    ] : [];

    this.heroBoughGeometries = useAtlas ? [
      buildHeroBoughs({ height: 15.0, trunkHeight: 1.6, layers: 5, baseRadius: 2.9, topRadius: 1.0, branchesPerRing: 4, quadrant: 0 }),
      buildHeroBoughs({ height: 11.4, trunkHeight: 1.8, layers: 4, baseRadius: 3.2, topRadius: 1.3, branchesPerRing: 4, quadrant: 1 }),
      buildHeroBoughs({ height: 9.8, trunkHeight: 2.1, layers: 4, baseRadius: 3.0, topRadius: 1.35, branchesPerRing: 4, quadrant: 0 }),
      buildHeroBoughs({ height: 6.8, trunkHeight: 1.2, layers: 3, baseRadius: 2.4, topRadius: 1.05, branchesPerRing: 4, quadrant: 1 }),
    ] : [];

    this.rockGeometry = buildRock(seed + 307);
    this.grassGeometry = useAtlas ? buildTexturedGrassGeometry() : buildGrassClumpFallback();
    this.shrubGeometry = useAtlas ? buildTexturedShrubGeometry() : buildShrubFallback();

    const applyTreeWind = (shader) => {
      shader.uniforms.uWindTime = this.windTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float swayPhase = instanceMatrix[3].x * 0.071 + instanceMatrix[3].z * 0.053;
            float swayHeight = max(0.0, position.y) * 0.085;
            float swayAmount = swayHeight * swayHeight * 0.16;
            transformed.x += sin(uWindTime * 1.1 + swayPhase) * swayAmount;
            transformed.z += cos(uWindTime * 0.83 + swayPhase * 1.7) * swayAmount * 0.7;
          #endif`);
    };

    const isMussoorie = this.world?.config?.map === 'mussoorie';
    this.treeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, envMapIntensity: 0.55 });
    this.treeMaterial.onBeforeCompile = applyTreeWind;
    this.treeMaterial.customProgramCacheKey = () => 'scenery-tree-sway-v1';

    this.foliageMaterial = new THREE.MeshStandardMaterial({
      color: isMussoorie ? 0xeaf5e2 : 0xffffff,
      map: this.foliageTex,
      alphaTest: 0.34,
      side: THREE.DoubleSide,
      vertexColors: true,
      roughness: 0.86,
      metalness: 0,
      envMapIntensity: 0.52,
    });
    this.foliageMaterial.onBeforeCompile = applyTreeWind;
    this.foliageMaterial.customProgramCacheKey = () => 'scenery-foliage-sway-v1';

    this.grassMaterial = new THREE.MeshStandardMaterial({
      color: isMussoorie ? 0xe6f2dc : 0xffffff,
      map: this.foliageTex,
      alphaTest: useAtlas ? 0.36 : 0,
      vertexColors: true,
      roughness: 0.86,
      metalness: 0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.45,
    });
    this.grassMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = this.windTime;
      shader.uniforms.uGrassCamPos = this.grassCamPos;
      shader.uniforms.uGrassFade = this.grassFade;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWindTime;\nuniform vec3 uGrassCamPos;\nuniform vec2 uGrassFade;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 gRoot = instanceMatrix[3].xyz;
            float gDist = length(uGrassCamPos - gRoot);
            float gScale = 1.0 - smoothstep(uGrassFade.x, uGrassFade.y, gDist);
            transformed *= gScale;
            float gTip = clamp(position.y * 1.7, 0.0, 1.0);
            float gPhase = gRoot.x * 0.18 + gRoot.z * 0.14;
            transformed.x += sin(uWindTime * 2.2 + gPhase) * 0.08 * gTip * gScale;
            transformed.z += cos(uWindTime * 1.7 + gPhase * 1.3) * 0.06 * gTip * gScale;
          #endif`);
    };
    this.grassMaterial.customProgramCacheKey = () => 'scenery-grass-wind-v2';

    this.rockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0, flatShading: true, envMapIntensity: 0.5 });

    this.place();
    this.setQuality(quality);
  }

  /** Choose every tree, rock, grass clump, and alpine shrub position and build tiled instanced meshes. */
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
        if (Math.hypot(x - plazas[p].x, z - plazas[p].z) < plazas[p].radius + roadConfig.verge + roadConfig.bedMargin + margin) return false;
      }
      if (world.isReserved?.(x, z, margin)) return false;
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
        const jitterX = treeRandom();
        const jitterZ = treeRandom();
        const chance = treeRandom();
        const variety = treeRandom();
        const x = -span + (gx + 0.1 + jitterX * 0.8) * TREE_SPACING;
        const z = -span + (gz + 0.1 + jitterZ * 0.8) * TREE_SPACING;
        if (x * x + z * z > maxRadius * maxRadius) continue;
        const y = grid.heightAt(x, z);
        if (y < world.waterLevel + 0.7 || y > mountain.treeLine + 12) continue;
        const distanceToRoad = field.sample(x, z);
        const clumping = 0.14 + 0.86 * smoothstep(-0.24, 0.26, clump.fbm(x / 165, z / 165, 3));
        const nearRoad = 1 - 0.56 * smoothstep(95, 360, distanceToRoad);
        const altitude = 1 - smoothstep(mountain.treeLine - 115, mountain.treeLine + 12, y);
        const density = clumping * nearRoad * Math.max(0.18, altitude);
        if (chance >= density) continue;
        grid.normalAt(x, z, scratchNormal);
        if (scratchNormal.ny < 0.72) continue;
        if (!clearOfRoads(x, z, distanceToRoad, 4.2)) continue;
        const shade = tint.fbm(x / 60, z / 60, 2);
        let species = 0;
        if (y > mountain.treeLine - 55) species = variety < 0.65 ? 3 : 2;
        else if (variety > 0.84) species = 2;
        else if (variety > 0.48 + 0.18 * shade) species = 1;
        else if (variety < 0.12) species = 3;

        trees.push({
          x, y, z,
          rank: chance / density,
          road: distanceToRoad,
          species,
          scale: (0.72 + 0.72 * ((variety * 7.31) % 1)) * (0.64 + 0.36 * altitude),
          stretch: 0.9 + 0.32 * ((variety * 13.7) % 1),
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
        if (scratchNormal.ny < 0.56) continue;
        const steep = smoothstep(0.9, 0.68, scratchNormal.ny);
        const high = smoothstep(mountain.treeLine - 70, mountain.treeLine + 60, y);
        const density = 0.04 + 0.45 * steep + 0.25 * high;
        if (chance >= density) continue;
        const distanceToRoad = field.sample(x, z);
        if (!clearOfRoads(x, z, distanceToRoad, 3.2)) continue;
        const size = 0.45 + 2.35 * Math.pow((variety * 5.77) % 1, 2.3);
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

    // ---- 3D grass clumps (road-corridor focused)
    const grassRandom = createRandom(config.seed + 173);
    const grass = [];
    const grassColumns = Math.floor((span * 2) / GRASS_SPACING);
    const snowLimit = mountain.snowLine - 14;
    for (let gz = 0; gz < grassColumns; gz += 1) {
      for (let gx = 0; gx < grassColumns; gx += 1) {
        const jx = grassRandom();
        const jz = grassRandom();
        const chance = grassRandom();
        const varv = grassRandom();
        const x = -span + (gx + 0.1 + jx * 0.8) * GRASS_SPACING;
        const z = -span + (gz + 0.1 + jz * 0.8) * GRASS_SPACING;
        if (x * x + z * z > maxRadius * maxRadius) continue;
        const distanceToRoad = field.sample(x, z);
        if (distanceToRoad > GRASS_CORRIDOR) continue;
        const y = grid.heightAt(x, z);
        if (y < world.waterLevel + 0.6 || y > snowLimit) continue;
        const patch = 0.25 + 0.75 * smoothstep(-0.2, 0.3, clump.fbm(x / 55, z / 55, 2));
        const band = 1 - smoothstep(26, GRASS_CORRIDOR, distanceToRoad);
        const density = patch * (0.14 + 0.86 * band);
        if (chance >= density) continue;
        grid.normalAt(x, z, scratchNormal);
        if (scratchNormal.ny < 0.72) continue;
        if (!clearOfRoads(x, z, distanceToRoad, 0.8)) continue;
        const altTint = smoothstep(mountain.treeLine - 80, mountain.treeLine + 40, y);
        grass.push({
          x, y, z,
          rank: (distanceToRoad * 0.015 + chance / density),
          scale: 0.82 + 0.68 * ((varv * 9.17) % 1),
          stretch: 0.82 + 0.5 * ((varv * 15.3) % 1),
          yaw: varv * Math.PI * 2,
          tint: 0.84 + 0.3 * ((varv * 21.7) % 1),
          warm: Math.min(1, altTint * 0.65 + 0.35 * ((varv * 5.9) % 1)),
        });
      }
    }
    grass.sort((a, b) => a.rank - b.rank);
    grass.length = Math.min(grass.length, Math.round(BASE_GRASS * MAX_GRASS_SCALE));

    // ---- hardy alpine juniper & heather shrubs
    const shrubRandom = createRandom(config.seed + 199);
    const shrubs = [];
    const shrubColumns = Math.floor((span * 2) / SHRUB_SPACING);
    for (let gz = 0; gz < shrubColumns; gz += 1) {
      for (let gx = 0; gx < shrubColumns; gx += 1) {
        const jx = shrubRandom();
        const jz = shrubRandom();
        const chance = shrubRandom();
        const varv = shrubRandom();
        const x = -span + (gx + jx) * SHRUB_SPACING;
        const z = -span + (gz + jz) * SHRUB_SPACING;
        if (x * x + z * z > maxRadius * maxRadius) continue;
        const distanceToRoad = field.sample(x, z);
        if (distanceToRoad > SHRUB_CORRIDOR) continue;
        const y = grid.heightAt(x, z);
        if (y < world.waterLevel + 0.6 || y > snowLimit + 6) continue;
        const cluster = 0.18 + 0.82 * smoothstep(-0.25, 0.3, clump.fbm(x / 70, z / 70, 2));
        const density = cluster * (0.28 + 0.55 * (1 - smoothstep(40, SHRUB_CORRIDOR, distanceToRoad)));
        if (chance >= density) continue;
        grid.normalAt(x, z, scratchNormal);
        if (scratchNormal.ny < 0.64) continue;
        if (!clearOfRoads(x, z, distanceToRoad, 1.8)) continue;
        shrubs.push({
          x, y, z,
          rank: chance / density,
          scale: 0.78 + 0.85 * ((varv * 8.13) % 1),
          yaw: varv * Math.PI * 2,
          tint: 0.82 + 0.32 * ((varv * 17.7) % 1),
          warm: 0.5 + 0.5 * tint.fbm(x / 50, z / 50, 2),
        });
      }
    }
    shrubs.sort((a, b) => a.rank - b.rank);
    shrubs.length = Math.min(shrubs.length, Math.round(BASE_SHRUBS * MAX_TREE_SCALE));

    this.trees = trees;
    this.rocks = rocks;
    this.grass = grass;
    this.shrubs = shrubs;
    this.buildTiles();
    this.stats.placementMs = (typeof performance !== 'undefined' ? performance.now() : 0) - started;
  }

  buildTiles() {
    const half = this.world.grid.half;
    const tiles = new Map();
    const hasHero = this.heroBoughGeometries.length > 0;

    const tileFor = (x, z, size, layer) => {
      const tx = Math.floor((x + half) / size);
      const tz = Math.floor((z + half) / size);
      const key = layer * 65536 + tx * 256 + tz;
      let tile = tiles.get(key);
      if (!tile) {
        tile = {
          layer,
          centerX: (tx + 0.5) * size - half,
          centerZ: (tz + 0.5) * size - half,
          reach: size * 0.75 + 24,
          yMin: Infinity,
          yMax: -Infinity,
          lists: layer === 0 ? [[], [], [], []] : [[]],
          meshes: [],
          heroMeshes: [],
          sphere: new THREE.Sphere(),
        };
        tiles.set(key, tile);
      }
      return tile;
    };

    const pushTileItem = (tile, bucketIdx, item, order) => {
      tile.lists[bucketIdx].push({ item, order });
      if (item.y < tile.yMin) tile.yMin = item.y;
      if (item.y > tile.yMax) tile.yMax = item.y;
    };

    this.trees.forEach((tree, order) => pushTileItem(tileFor(tree.x, tree.z, TREE_TILE, 0), tree.species, tree, order));
    this.rocks.forEach((rock, order) => pushTileItem(tileFor(rock.x, rock.z, ROCK_TILE, 1), 0, rock, order));
    this.shrubs.forEach((shrub, order) => pushTileItem(tileFor(shrub.x, shrub.z, GRASS_TILE, 2), 0, shrub, order));
    this.grass.forEach((tuft, order) => pushTileItem(tileFor(tuft.x, tuft.z, GRASS_TILE, 3), 0, tuft, order));

    tiles.forEach((tile) => {
      const midY = Number.isFinite(tile.yMin) ? (tile.yMin + tile.yMax) * 0.5 : 0;
      const halfY = Number.isFinite(tile.yMin) ? (tile.yMax - tile.yMin) * 0.5 + 20 : 40;
      tile.sphere.set(
        new THREE.Vector3(tile.centerX, midY, tile.centerZ),
        Math.hypot(tile.reach, halfY),
      );

      tile.lists.forEach((list, kind) => {
        if (!list.length) return;
        const orders = new Uint32Array(list.length);
        const matrices = new Float32Array(list.length * 16);
        const colors = new Float32Array(list.length * 3);

        for (let i = 0; i < list.length; i += 1) {
          const { item, order } = list[i];
          orders[i] = order;
          if (tile.layer === 1) {
            scratchPosition.set(item.x, item.y - item.size * 0.22, item.z);
            scratchEuler.set(item.tilt * 0.5, item.yaw, item.tilt * 0.35);
            scratchScale.set(item.size * item.wide, item.size, item.size * (1.75 - item.wide));
            const grey = 0.33 * item.tint;
            scratchColor.setRGB(grey * 1.02, grey, grey * 0.94).lerp(new THREE.Color(0.82, 0.85, 0.9), item.snow * 0.55);
          } else if (tile.layer === 3) {
            scratchPosition.set(item.x, item.y - 0.04, item.z);
            scratchEuler.set(0, item.yaw, 0);
            scratchScale.set(item.scale, item.scale * item.stretch, item.scale);
            scratchColor.setRGB(0.88 + 0.26 * item.warm, 1.0, 0.86 - 0.18 * item.warm).multiplyScalar(item.tint);
          } else if (tile.layer === 2) {
            scratchPosition.set(item.x, item.y - 0.06, item.z);
            scratchEuler.set(0, item.yaw, 0);
            scratchScale.setScalar(item.scale);
            scratchColor.setRGB(0.9 + 0.24 * item.warm, 1.0, 0.88 - 0.16 * item.warm).multiplyScalar(item.tint);
          } else {
            scratchPosition.set(item.x, item.y - 0.25, item.z);
            scratchEuler.set(0, item.yaw, 0);
            scratchScale.set(item.scale, item.scale * item.stretch, item.scale);
            scratchColor.setRGB(0.86 + 0.3 * item.warm, 1, 0.9 - 0.25 * item.warm).multiplyScalar(item.tint);
          }
          scratchQuaternion.setFromEuler(scratchEuler);
          scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
          scratchMatrix.toArray(matrices, i * 16);
          colors[i * 3] = scratchColor.r;
          colors[i * 3 + 1] = scratchColor.g;
          colors[i * 3 + 2] = scratchColor.b;
        }

        const makeMesh = (geom, mat, name, destArray) => {
          const mesh = new THREE.InstancedMesh(geom, mat, list.length);
          mesh.name = name;
          mesh.instanceMatrix.array.set(matrices);
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) {
            mesh.instanceColor.array.set(colors);
            mesh.instanceColor.needsUpdate = true;
          }
          mesh.computeBoundingSphere();
          mesh.computeBoundingBox();
          mesh.receiveShadow = true;
          mesh.castShadow = false;
          mesh.matrixAutoUpdate = false;
          mesh.frustumCulled = false;
          mesh.userData = { orders, layer: tile.layer, capacity: list.length };
          destArray.push(mesh);
          this.group.add(mesh);
          return mesh;
        };

        if (tile.layer === 0) {
          makeMesh(this.treeGeometries[kind], this.treeMaterial, `SceneryTrees${kind}`, tile.meshes);
          if (hasHero) {
            const trunk = makeMesh(this.heroTrunkGeometries[kind], this.treeMaterial, `SceneryTrunks${kind}`, tile.heroMeshes);
            trunk.visible = false;
            const bough = makeMesh(this.heroBoughGeometries[kind], this.foliageMaterial, `SceneryBoughs${kind}`, tile.heroMeshes);
            bough.visible = false;
          }
        } else if (tile.layer === 1) {
          makeMesh(this.rockGeometry, this.rockMaterial, 'SceneryRocks', tile.meshes);
        } else if (tile.layer === 2) {
          makeMesh(this.shrubGeometry, this.foliageTex ? this.foliageMaterial : this.treeMaterial, 'SceneryShrubs', tile.meshes);
        } else {
          makeMesh(this.grassGeometry, this.grassMaterial, 'SceneryGrass', tile.meshes);
        }
      });
      tile.lists = null;
      this.tiles.push(tile);
    });
    this.stats.meshes = this.group.children.length;
  }

  setQuality(quality) {
    this.shadowsEnabled = quality ? quality.shadowMapSize > 0 : true;
    if (this.foliageTex) {
      const aniso = Math.min(8, Math.max(1, Number(quality?.anisotropy || 4)));
      if (this.foliageTex.anisotropy !== aniso) {
        this.foliageTex.anisotropy = aniso;
        this.foliageTex.needsUpdate = true;
      }
    }
    const scale = clamp(quality?.trees ?? 1, 0.1, MAX_TREE_SCALE);
    this.treeScale = scale;
    const treeLimit = Math.min(this.trees.length, Math.round(BASE_TREES * scale));
    const rockLimit = Math.min(this.rocks.length, Math.round(BASE_ROCKS * clamp(scale, 0.5, 1.2)));
    const shrubLimit = Math.min(this.shrubs.length, Math.round(BASE_SHRUBS * scale));
    const grassLimit = Math.min(this.grass.length, Math.round(BASE_GRASS * clamp(scale, 0.25, MAX_GRASS_SCALE)));

    this.drawDistance = scale < 0.5 ? 1150 : scale < 0.9 ? 1680 : 2250;
    this.heroTreeDistance = scale < 0.5 ? 240 : scale < 0.9 ? 360 : HERO_TREE_RANGE;
    this.shrubDrawDistance = scale < 0.5 ? 180 : scale < 0.9 ? 260 : 340;
    this.grassDrawDistance = scale < 0.5 ? 115 : scale < 0.9 ? 155 : scale > 1.1 ? 235 : 195;
    this.grassFade.value.set(this.grassDrawDistance * 0.65, this.grassDrawDistance);

    const limits = [treeLimit, rockLimit, shrubLimit, grassLimit];
    for (const tile of this.tiles) {
      for (const list of [tile.meshes, tile.heroMeshes]) {
        for (const mesh of list) {
          const { orders, layer } = mesh.userData;
          const limit = limits[layer] ?? 0;
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
    }

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
    this.stats.shrubs = shrubLimit;
    this.stats.grass = grassLimit;
    this.stats.obstacles = obstacles.length / 3;
  }

  /**
   * Per-frame: advance wind sway, frustum-cull tiles, swap foreground trees to textured atlas
   * boughs near the road/camera, and keep dense grass & shadows tightly scoped for steady FPS.
   */
  /** Drift through a glowing apex: { name, bonus } once per pass (Game.updateRunning). */
  clipZone(state, drift) {
    let paid = null;
    for (const clips of this.clips) paid = clips.check(state, drift) || paid;
    return paid;
  }

  update(view, _dt = 0, _isNight = false, _carPos = null, cameraOpt = null) {
    for (const clips of this.clips) clips.update(_dt);
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    this.windTime.value += Math.min(0.1, (now - this.clock) / 1000);
    this.clock = now;
    if (!view) return;

    const camera = view.isCamera ? view : (cameraOpt?.isCamera ? cameraOpt : null);
    const cameraPosition = view.isCamera ? view.position : view;
    if (!cameraPosition) return;
    this.grassCamPos.value.copy(cameraPosition);

    if (camera) {
      camera.updateWorldMatrix(true, false);
      this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.viewProjection, camera.coordinateSystem, camera.reversedDepth);
    }

    for (let i = 0; i < this.tiles.length; i += 1) {
      const tile = this.tiles[i];
      const maxDist = tile.layer === 3 ? this.grassDrawDistance
        : tile.layer === 2 ? this.shrubDrawDistance : this.drawDistance;
      const distance = Math.hypot(tile.centerX - cameraPosition.x, tile.centerZ - cameraPosition.z);
      const inRange = distance - tile.reach < maxDist;
      const inFrustum = !inRange || !camera || this.frustum.intersectsSphere(tile.sphere);
      const visible = inRange && inFrustum;
      const shadows = this.shadowsEnabled && visible && tile.layer < 2 && distance - tile.reach < SHADOW_RANGE;
      const useHero = tile.layer === 0 && tile.heroMeshes.length > 0 && visible && distance - tile.reach < this.heroTreeDistance;

      for (let m = 0; m < tile.meshes.length; m += 1) {
        const mesh = tile.meshes[m];
        mesh.visible = visible && !useHero && mesh.count > 0;
        mesh.castShadow = !useHero && shadows;
      }
      for (let m = 0; m < tile.heroMeshes.length; m += 1) {
        const mesh = tile.heroMeshes[m];
        mesh.visible = useHero && mesh.count > 0;
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
      for (const mesh of tile.heroMeshes) {
        this.group.remove(mesh);
        mesh.dispose();
      }
    }
    this.tiles = [];
    this.treeGeometries.forEach((geometry) => geometry.dispose());
    this.heroTrunkGeometries.forEach((geometry) => geometry.dispose());
    this.heroBoughGeometries.forEach((geometry) => geometry.dispose());
    this.rockGeometry.dispose();
    this.grassGeometry.dispose();
    this.shrubGeometry.dispose();
    this.foliageTex?.dispose();
    this.treeMaterial.dispose();
    this.foliageMaterial.dispose();
    this.grassMaterial.dispose();
    this.rockMaterial.dispose();
    this.group.parent?.remove(this.group);
    this.world.setObstacles?.([]);
  }
}
