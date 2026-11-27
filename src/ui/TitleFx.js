// High-craft Three.js 3D car drifting showcase rendered behind the loading & title screen.
// Combines Preetham Sky sunset atmosphere + PMREM reflections, wet-asphalt micro-puddle shader,
// steel W-beam guardrails, multi-tier Deodar pines, craggy mountain ridges, active car/paint sync,
// GPU Effects smoke/sparks/skids, volumetric headlight beams, and UnrealBloomPass HDR post-processing.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ProceduralCar } from '../render/ProceduralCar.js';
import { createCarModel, loadCarModels } from '../render/ModelCar.js';
import { Effects } from '../render/Effects.js';
import { patchUnderglow, underglowFrame } from '../render/underglowLight.js';
import { createAsphaltTexture, createChevronTexture, createGrainTexture } from '../render/road/textures.js';
import { Noise2D } from '../world/noise.js';
import { PAINT_OPTIONS } from '../config.js';
import { frontWheelAngle } from '../vehicle/steering.js';

const MAX_DPR = 1.5;
const TRACK_RADIUS = 18.2;
const TRACK_HALF_WIDTH = 5.6;
const UP = new THREE.Vector3(0, 1, 0);

const MAP_PALETTES = {
  tokyo: {
    turbidity:3, rayleigh:.18, mie:.005, mieG:.78, elevation:-4, azimuth:217,
    exposure:.68, clouds:.18, cloudDensity:.4, fog:0x192237, fogDensity:.003,
    sun:0xb7cfff, hemiSky:0xa3b4da, hemiGround:0x2a2733, neon:0xff5b52, paint:0x6e7e9b, snowLevel:99
  },
  hollow: {
    turbidity:8, rayleigh:1.25, mie:.012, mieG:.78, elevation:7, azimuth:215,
    exposure:.61, clouds:.76, cloudDensity:.72, fog:0x526d78, fogDensity:.011,
    sun:0xbacbd0, hemiSky:0xa3bac0, hemiGround:0x283337, neon:0xb6cebd, paint:0xd7dcd7, snowLevel:99
  },
  mussoorie: {
    turbidity: 6.4,
    rayleigh: 3.1,
    mie: 0.0055,
    mieG: 0.85,
    elevation: 4.5,
    azimuth: 214,
    exposure: 0.64,
    clouds: 0.48,
    cloudDensity: 0.44,
    fog: 0x261d1c,
    fogDensity: 0.0058,
    sun: 0xff9b48,
    hemiSky: 0xdca8a0,
    hemiGround: 0x232d22,
    neon: 0xf2b01e,
    paint: 0xf0f2f5,
    snowLevel: 99,
  },
  alpine: {
    turbidity: 5.2,
    rayleigh: 2.6,
    mie: 0.005,
    mieG: 0.84,
    elevation: 5.5,
    azimuth: 212,
    exposure: 0.66,
    clouds: 0.42,
    cloudDensity: 0.38,
    fog: 0x1d2330,
    fogDensity: 0.0054,
    sun: 0xffb86a,
    hemiSky: 0xbad0ec,
    hemiGround: 0x232934,
    neon: 0x3fb4ff,
    paint: 0xf0f2f5,
    snowLevel: 12.5,
  },
  jungle: {
    turbidity: 7.4,
    rayleigh: 3.3,
    mie: 0.0065,
    mieG: 0.82,
    elevation: 4.0,
    azimuth: 218,
    exposure: 0.62,
    clouds: 0.56,
    cloudDensity: 0.52,
    fog: 0x1a2820,
    fogDensity: 0.0068,
    sun: 0xffad42,
    hemiSky: 0xb7d4b4,
    hemiGround: 0x18261a,
    neon: 0xb8ff47,
    paint: 0xf0f2f5,
    snowLevel: 99,
  },
};

const RAIL_PROFILE = [
  [0, 0.38],
  [-0.08, 0.46],
  [-0.02, 0.54],
  [-0.08, 0.62],
  [0, 0.70],
];

/** Formats elapsed seconds as 00:MM:SS.d for the live drift-cam badge. */
export function formatRecTime(seconds) {
  const tenths = Math.max(0, Math.floor((Number(seconds) || 0) * 10));
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  const d = tenths % 10;
  return `00:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
}

/** Deterministic circular-drift pose helper exported for unit testing. */
export function computeDriftPose(elapsed) {
  const t = Math.max(0, Number(elapsed) || 0);
  const orbit = t * 1.08;
  const radius = TRACK_RADIUS + Math.sin(t * 0.72) * 1.1;
  const slip = 0.62 + 0.14 * Math.sin(t * 1.15);
  const x = Math.cos(orbit) * radius;
  const z = -Math.sin(orbit) * radius;
  const heading = orbit + slip;
  const steer = -0.62 * (slip / 0.64);
  const roll = 0.056 + 0.016 * Math.sin(t * 1.15);
  const pitch = -0.02 * Math.sin(t * 2.3);
  const braking = Math.sin(t * 1.75) > 0.32;
  const flameBurst = Math.sin(t * 3.15) > 0.72;
  return { x, z, orbit, radius, slip, heading, steer, roll, pitch, braking, flameBurst };
}

function sunVec(azimuthDeg, elevDeg, target = new THREE.Vector3()) {
  const phi = THREE.MathUtils.degToRad(90 - elevDeg);
  const theta = THREE.MathUtils.degToRad(azimuthDeg);
  return target.setFromSphericalCoords(1, phi, theta);
}

/** Merge geometry parts with per-part vertical vertex-color gradients and upward foliage normal lift. */
function mergeTintedParts(parts) {
  let vCount = 0;
  let iCount = 0;
  for (const p of parts) {
    vCount += p.geometry.attributes.position.count;
    iCount += p.geometry.index.count;
  }
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const colors = new Float32Array(vCount * 3);
  const indices = new Uint16Array(iCount);
  let vOff = 0;
  let iOff = 0;
  const low = new THREE.Color();
  const high = new THREE.Color();

  for (const part of parts) {
    const g = part.geometry;
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    low.setHex(part.low);
    high.setHex(part.high);
    g.computeBoundingBox();
    const minY = g.boundingBox.min.y;
    const spanY = Math.max(1e-6, g.boundingBox.max.y - minY);
    for (let i = 0; i < pos.count; i += 1) {
      const dst = (vOff + i) * 3;
      positions[dst] = pos.getX(i);
      positions[dst + 1] = pos.getY(i);
      positions[dst + 2] = pos.getZ(i);
      normals[dst] = norm.getX(i);
      normals[dst + 1] = norm.getY(i) + (part.lift || 0);
      normals[dst + 2] = norm.getZ(i);
      const len = Math.hypot(normals[dst], normals[dst + 1], normals[dst + 2]) || 1;
      normals[dst] /= len;
      normals[dst + 1] /= len;
      normals[dst + 2] /= len;
      const f = (pos.getY(i) - minY) / spanY;
      colors[dst] = low.r + (high.r - low.r) * f;
      colors[dst + 1] = low.g + (high.g - low.g) * f;
      colors[dst + 2] = low.b + (high.b - low.b) * f;
    }
    const idx = g.index;
    for (let i = 0; i < idx.count; i += 1) indices[iOff + i] = idx.getX(i) + vOff;
    vOff += pos.count;
    iOff += idx.count;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();
  return merged;
}

/** Five-tier Himalayan Deodar conifer geometry patterned after Scenery.js. */
function buildDeodarGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.11, 0.20, 3.0, 6, 1, false);
  trunk.translate(0, 1.5, 0);
  parts.push({ geometry: trunk, low: 0x2a1d14, high: 0x3b281c });
  const layers = 4;
  for (let i = 0; i < layers; i += 1) {
    const t = i / (layers - 1);
    const radius = 2.05 + (0.65 - 2.05) * t;
    const h = 2.85;
    const y = 1.7 + 5.2 * t;
    const cone = new THREE.ConeGeometry(radius, h, 8, 1, false);
    cone.rotateY((i * Math.PI) / 8);
    cone.translate(0, y + h * 0.5, 0);
    parts.push({ geometry: cone, low: 0x102519, high: 0x264b33, lift: 0.38 });
  }
  return mergeTintedParts(parts);
}

/** Granite boulder with Noise2D facet displacement. */
function buildBoulderGeometry(seed = 41) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const noise = new Noise2D(seed);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const bump = 1 + 0.28 * noise.value(x * 1.8 + y * 2.1, z * 1.9 - y) + 0.14 * noise.value(x * 4.3, z * 4.1);
    pos.setXYZ(i, x * bump, y * bump * 0.68, z * bump);
  }
  g.computeVertexNormals();
  return g;
}

/** Procedural wet-groove asphalt roughnessMap so tarmac reflects dusk sun, glow, and taillights. */
function createWetAsphaltMap(anisotropy = 4, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const noise = new Noise2D(712);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      // Wet glossy tracks along the curve (u across road) with broken noise puddles
      const groove = Math.exp(-Math.pow((u - 0.38) / 0.18, 2)) + Math.exp(-Math.pow((u - 0.68) / 0.16, 2));
      const n = noise.value(u * 6, Math.sin(v * Math.PI * 2) * 3 + Math.cos(v * Math.PI * 2) * 3);
      const puddle = Math.max(0, Math.min(1, groove * 0.55 + n * 0.55));
      // Lower grayscale = smoother wet mirror (roughness * map in [0.16 .. 0.72])
      const roughByte = Math.round(188 - puddle * 145);
      const o = (y * size + x) * 4;
      img.data[o] = roughByte;
      img.data[o + 1] = roughByte;
      img.data[o + 2] = roughByte;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  return tex;
}

/** Curved road ribbon with clean radial/tangential UVs matching ASPHALT_TILE = 4m. */
function buildCurvedTrackGeometry(innerR, outerR, segments = 144, tileU = 1, tileV = 4) {
  const pos = [];
  const norm = [];
  const uv = [];
  const col = [];
  const idx = [];
  const lanes = 5;
  const ringTone = [0.85, 0.76, 0.94, 0.78, 0.85];
  const avgR = (innerR + outerR) * 0.5;
  const circ = Math.PI * 2 * avgR;

  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const vCoord = (i / segments) * (circ / tileV);
    for (let k = 0; k < lanes; k += 1) {
      const f = k / (lanes - 1);
      const r = innerR + (outerR - innerR) * f;
      pos.push(c * r, 0, -s * r);
      norm.push(0, 1, 0);
      uv.push(f * tileU, vCoord);
      const t = ringTone[k];
      col.push(t, t, t);
    }
  }
  for (let i = 0; i < segments; i += 1) {
    const a = i * lanes;
    const b = (i + 1) * lanes;
    for (let k = 0; k < lanes - 1; k += 1) {
      idx.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** Corrugated outer steel W-beam guardrail ring around `radius`. */
function buildGuardrailGeometry(radius, segments = 128) {
  const pos = [];
  const idx = [];
  const pts = RAIL_PROFILE.length;
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (let p = 0; p < pts; p += 1) {
      const r = radius + RAIL_PROFILE[p][0];
      pos.push(c * r, RAIL_PROFILE[p][1], -s * r);
    }
  }
  for (let i = 0; i < segments; i += 1) {
    const a = i * pts;
    const b = (i + 1) * pts;
    for (let p = 0; p < pts - 1; p += 1) {
      idx.push(a + p, b + p, b + p + 1, a + p, b + p + 1, a + p + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Craggy multi-octave mountain range ring with atmospheric valley-to-peak vertex colors. */
function buildMountainRingGeometry(innerR, outerR, maxHeight, segments = 96, seed = 19, snowLevel = 99) {
  const noise = new Noise2D(seed);
  const pos = [];
  const col = [];
  const idx = [];
  const valley = new THREE.Color(0x132018);
  const slope = new THREE.Color(0x2a2f2e);
  const peakCol = new THREE.Color(0x4b423c);
  const snowCol = new THREE.Color(0xc8c0b8);
  const tmp = new THREE.Color();

  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const ridge1 = Math.abs(noise.value(c * 2.4 + 1.1, s * 2.4 - 0.7));
    const ridge2 = Math.abs(noise.value(c * 5.8 - 3.0, s * 5.8 + 2.2)) * 0.45;
    const ridge3 = Math.abs(noise.value(c * 11.5, s * 11.5)) * 0.18;
    const h = Math.max(4.5, (ridge1 + ridge2 + ridge3) * maxHeight);

    // Base skirt vertex + mid ridge + summit ridge
    const midR = innerR + (outerR - innerR) * 0.45;
    const pts = [
      [innerR, -0.5, 0],
      [midR, h * 0.48, 0.5],
      [outerR, h, 1],
    ];
    for (const [r, y, t] of pts) {
      pos.push(c * r, y, -s * r);
      if (y > snowLevel) tmp.copy(peakCol).lerp(snowCol, Math.min(1, (y - snowLevel) / 7));
      else if (t < 0.5) tmp.copy(valley).lerp(slope, t * 2);
      else tmp.copy(slope).lerp(peakCol, (t - 0.5) * 2);
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  for (let i = 0; i < segments; i += 1) {
    const a = i * 3;
    const b = (i + 1) * 3;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
    idx.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Volumetric soft additive headlight cone beam attached to the drifting car. */
function buildBeamCone() {
  const g = new THREE.ConeGeometry(1.75, 11.5, 18, 1, true);
  g.translate(0, -5.75, 0);
  g.rotateX(Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(0xffefd0) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vDist;
      void main() {
        vUv = uv;
        vDist = clamp(-position.z / 11.5, 0.0, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vDist;
      void main() {
        float fade = pow(1.0 - vDist, 1.85) * smoothstep(0.0, 0.14, vDist);
        gl_FragColor = vec4(uColor, fade * 0.18);
      }
    `,
  });
  return { geometry: g, material: mat };
}

export class TitleFx {
  /** @param {{ canvas?: HTMLCanvasElement | null, timerEl?: HTMLElement | null, mapId?: string, carId?: string }} [opts] */
  constructor({ canvas = null, timerEl = null, mapId = 'mussoorie', carId = 'hatch' } = {}) {
    this.canvas = canvas;
    this.timerEl = timerEl;
    this.mapId = mapId;
    this.carId = carId;
    this.cosmetics = {};
    this.running = false;
    this.built = false;
    this.disposed = false;
    this.webglFailed = false;
    this.activeModelId = null;
    this.rafId = null;
    this.elapsed = 0;
    this.lastTime = 0;
    this.lastStamp = -1;
    this.wheelSpinAngle = { front: 0, rear: 0 };
    this.disposables = [];

    // Pre-allocated scratch vectors (zero per-frame allocations)
    this._quat = new THREE.Quaternion();
    this._pos = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._vel = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();
    this._camDesired = new THREE.Vector3();
    this._wPos = new THREE.Vector3();
    this._wheelScratch = [
      { contactPoint: new THREE.Vector3(), contactNormal: UP },
      { contactPoint: new THREE.Vector3(), contactNormal: UP },
    ];

    this.onResize = () => this.resize();
    this.tick = (now) => this.frame(now);
  }

  setMap(mapId) {
    this.mapId = mapId || 'mussoorie';
    if (!this.built) return;
    this.applyMapAtmosphere();
  }

  /** Download the shown car's model (only that one, so the title screen doesn't hold up the game load), then swap it in. */
  loadModel() {
    const carId = this.carId;
    loadCarModels([carId]).then(() => {
      if (!this.disposed && this.built && this.carId === carId && this.activeModelId !== carId) this.spawnCarMesh();
    });
  }

  setCar(carId, cosmetics = null) {
    const nextCar = carId || 'hatch';
    if (cosmetics) this.cosmetics = cosmetics;
    const carChanged = nextCar !== this.carId;
    this.carId = nextCar;
    if (!this.built) return;
    if (carChanged || this.activeModelId !== nextCar) {
      this.spawnCarMesh();
      if (this.activeModelId !== nextCar) this.loadModel();
    } else {
      this.applyCosmetics();
    }
  }

  applyMapAtmosphere() {
    const p = MAP_PALETTES[this.mapId] || MAP_PALETTES.mussoorie;
    if (this.scene?.fog) {
      this.scene.fog.color.setHex(p.fog);
      this.scene.fog.density = p.fogDensity;
    }
    if (this.renderer) this.renderer.toneMappingExposure = p.exposure;
    if (this.sun) {
      this.sun.color.setHex(p.sun);
      sunVec(p.azimuth, p.elevation + 2.5, this._sunDir);
    }
    if (this.hemi) {
      this.hemi.color.setHex(p.hemiSky);
      this.hemi.groundColor.setHex(p.hemiGround);
    }
    if (this.sky?.material?.uniforms) {
      const u = this.sky.material.uniforms;
      u.turbidity.value = p.turbidity;
      u.rayleigh.value = p.rayleigh;
      u.mieCoefficient.value = p.mie;
      u.mieDirectionalG.value = p.mieG;
      if (u.cloudCoverage) u.cloudCoverage.value = p.clouds;
      if (u.cloudDensity) u.cloudDensity.value = p.cloudDensity;
      sunVec(p.azimuth, p.elevation, u.sunPosition.value);
      this.bakeSkyEnv();
    }
    this.applyCosmetics();
  }

  bakeSkyEnv() {
    if (!this.renderer || !this.sky || !this.scene) return;
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const envScene = new THREE.Scene();
      const probeSky = new Sky();
      probeSky.scale.setScalar(1000);
      const src = this.sky.material.uniforms;
      const dst = probeSky.material.uniforms;
      dst.turbidity.value = src.turbidity.value;
      dst.rayleigh.value = src.rayleigh.value;
      dst.mieCoefficient.value = src.mieCoefficient.value;
      dst.mieDirectionalG.value = src.mieDirectionalG.value;
      dst.sunPosition.value.copy(src.sunPosition.value);
      if (dst.showSunDisc) dst.showSunDisc.value = 0;
      if (dst.cloudCoverage) dst.cloudCoverage.value = 0;
      envScene.add(probeSky);
      const rt = pmrem.fromScene(envScene, 0.04);
      this.envRT?.dispose?.();
      this.envRT = rt;
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = 1.2;
      probeSky.geometry.dispose();
      probeSky.material.dispose();
      pmrem.dispose();
    } catch {
      // Optional env reflections; scene lights still illuminate the car cleanly.
    }
  }

  applyCosmetics() {
    if (!this.car) return;
    const p = MAP_PALETTES[this.mapId] || MAP_PALETTES.mussoorie;
    const paint = this.cosmetics?.paint || PAINT_OPTIONS.find((o) => o.id === 'ember') || { color: p.paint, metalness: 0.44, roughness: 0.14, clearcoat: 0.96 };
    this.car.setPaint(paint);
    this.car.setRimColor(this.cosmetics?.rimColor ?? 0xf2b01e);
    const neonCol = this.cosmetics?.neon?.color !== undefined ? this.cosmetics.neon : { color: p.neon };
    this.car.setUnderglow(neonCol?.color ? neonCol : { color: p.neon });
    this.car.setUnderglowLevel(0.95);
    this.car.setHeadlamps?.(true);
  }

  spawnCarMesh() {
    if (!this.scene) return;
    const prev = this.car;
    if (prev) {
      this.scene.remove(prev);
      for (const h of this.headlights || []) h.dispose?.();
      prev.dispose();
    }
    this.headlights = [];
    this.brakeDiscs = [];

    const p = MAP_PALETTES[this.mapId] || MAP_PALETTES.mussoorie;
    const car = createCarModel(this.carId, { color: p.paint, number: this.cosmetics?.number || '27' });
    this.activeModelId = car.carDef ? this.carId : 'hatch';
    car.castShadow = true;

    // Headlight SpotLights + volumetric light beam cones
    for (const side of [-1, 1]) {
      const spot = new THREE.SpotLight(0xfff0d2, 220, 48, THREE.MathUtils.degToRad(26), 0.65, 1.4);
      spot.position.set(side * 0.62, 0.68, -2.05);
      spot.target.position.set(side * 1.1, 0.1, -26);
      spot.castShadow = false;
      car.add(spot, spot.target);
      this.headlights.push(spot);

      if (this.beamAsset) {
        const cone = new THREE.Mesh(this.beamAsset.geometry, this.beamAsset.material);
        cone.position.set(side * 0.62, 0.65, -2.02);
        cone.rotation.x = -0.05;
        car.add(cone);
      }
    }

    // Glowing rear brake rotor rings behind wheels (subtle bloom accent under heavy braking)
    if (this.rotorAsset) {
      for (const key of ['rearLeft', 'rearRight']) {
        const pivot = car.wheelPivots.get(key);
        if (!pivot) continue;
        const disc = new THREE.Mesh(this.rotorAsset.geometry, this.rotorAsset.material);
        disc.position.set(key === 'rearLeft' ? 0.05 : -0.05, 0, 0);
        disc.rotation.y = Math.PI / 2;
        pivot.add(disc);
        this.brakeDiscs.push(disc);
      }
    }

    this.scene.add(car);
    this.car = car;
    this.applyCosmetics();

    const rl = car.wheelPivots.get('rearLeft')?.position || new THREE.Vector3(-0.78, 0.34, 1.28);
    const rr = car.wheelPivots.get('rearRight')?.position || new THREE.Vector3(0.78, 0.34, 1.28);
    this.rearOffsets = [rl.clone(), rr.clone()];
  }

  initScene() {
    if (this.built) return true;
    if (this.webglFailed || typeof document === 'undefined' || !this.canvas) return false;
    this.disposed = false;
    const p = MAP_PALETTES[this.mapId] || MAP_PALETTES.mussoorie;
    this._sunDir = sunVec(p.azimuth, p.elevation + 2.5, new THREE.Vector3());

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch {
      this.webglFailed = true;
      return false;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = p.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in r180: three swaps it on the first frame and recompiles every shader
    this.renderer = renderer;
    const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 4);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(p.fog, p.fogDensity);
    this.scene = scene;

    // Preetham Sky dome with dusk clouds
    this.sky = new Sky();
    this.sky.scale.setScalar(1000);
    this.sky.frustumCulled = false;
    this.sky.material.depthTest = false;
    this.sky.renderOrder = -1000;
    scene.add(this.sky);
    this.disposables.push(this.sky.geometry, this.sky.material);

    // Lighting
    this.hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, 1.25);
    scene.add(this.hemi);

    const sun = new THREE.DirectionalLight(p.sun, 4.8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 4;
    sun.shadow.camera.far = 110;
    const sc = 24;
    sun.shadow.camera.left = -sc;
    sun.shadow.camera.right = sc;
    sun.shadow.camera.top = sc;
    sun.shadow.camera.bottom = -sc;
    sun.shadow.bias = -0.0004;
    scene.add(sun, sun.target);
    this.sun = sun;

    const coolRim = new THREE.DirectionalLight(0x6ba2d4, 1.45);
    coolRim.position.set(28, 16, 30);
    scene.add(coolRim);

    // Mountain Ridges (near forested valley ring + distant dusk snowy peaks)
    const ridgeNearGeo = buildMountainRingGeometry(64, 98, 22, 96, 17, 99);
    const ridgeNearMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, flatShading: true });
    scene.add(new THREE.Mesh(ridgeNearGeo, ridgeNearMat));
    this.disposables.push(ridgeNearGeo, ridgeNearMat);

    const ridgeFarGeo = buildMountainRingGeometry(102, 168, 44, 112, 53, p.snowLevel);
    const ridgeFarMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
    scene.add(new THREE.Mesh(ridgeFarGeo, ridgeFarMat));
    this.disposables.push(ridgeFarGeo, ridgeFarMat);

    // Textured valley floor + gravel shoulder + wet asphalt hairpin curve
    const grainTex = createGrainTexture(maxAniso);
    grainTex.repeat.set(24, 24);
    const asphaltTex = createAsphaltTexture(maxAniso);
    const wetMap = createWetAsphaltMap(maxAniso);
    const chevronTex = createChevronTexture(maxAniso);
    this.disposables.push(grainTex, asphaltTex, wetMap, chevronTex);

    const groundGeo = new THREE.CircleGeometry(140, 48);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = patchUnderglow(new THREE.MeshStandardMaterial({
      color: 0x1a261c,
      map: grainTex,
      roughness: 0.95,
    }));
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);
    this.disposables.push(groundGeo, groundMat);

    const shoulderGeo = buildCurvedTrackGeometry(TRACK_RADIUS - TRACK_HALF_WIDTH - 2.6, TRACK_RADIUS + TRACK_HALF_WIDTH + 2.8, 144, 2, 3);
    const shoulderMat = patchUnderglow(new THREE.MeshStandardMaterial({
      color: 0x524c42,
      map: grainTex,
      vertexColors: true,
      roughness: 0.96,
    }));
    const shoulder = new THREE.Mesh(shoulderGeo, shoulderMat);
    shoulder.position.y = -0.012;
    shoulder.receiveShadow = true;
    scene.add(shoulder);
    this.disposables.push(shoulderGeo, shoulderMat);

    const roadGeo = buildCurvedTrackGeometry(TRACK_RADIUS - TRACK_HALF_WIDTH, TRACK_RADIUS + TRACK_HALF_WIDTH, 144, 1.5, 4);
    const roadMat = patchUnderglow(new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: asphaltTex,
      roughnessMap: wetMap,
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.22,
      envMapIntensity: 1.55,
    }));
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.receiveShadow = true;
    scene.add(road);
    this.disposables.push(roadGeo, roadMat);

    // Outer Steel W-beam guardrail + I-posts + Marigold center dashes + Rumble curbs + Chevrons + Reflectors + Boulders
    const railR = TRACK_RADIUS + TRACK_HALF_WIDTH + 0.55;
    const railGeo = buildGuardrailGeometry(railR, 128);
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xbec5cc, metalness: 0.82, roughness: 0.32, side: THREE.DoubleSide });
    const railMesh = new THREE.Mesh(railGeo, steelMat);
    railMesh.castShadow = true;
    railMesh.receiveShadow = true;
    scene.add(railMesh);
    this.disposables.push(railGeo, steelMat);

    const dummy = new THREE.Object3D();

    const postGeo = new THREE.BoxGeometry(0.09, 0.82, 0.13);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x707780, metalness: 0.65, roughness: 0.45 });
    const postCount = 64;
    const posts = new THREE.InstancedMesh(postGeo, postMat, postCount);
    for (let i = 0; i < postCount; i += 1) {
      const a = (i / postCount) * Math.PI * 2;
      dummy.position.set(Math.cos(a) * (railR + 0.05), 0.36, -Math.sin(a) * (railR + 0.05));
      dummy.rotation.set(0, a, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      posts.setMatrixAt(i, dummy.matrix);
    }
    posts.instanceMatrix.needsUpdate = true;
    scene.add(posts);
    this.disposables.push(postGeo, postMat);

    const dashCount = 48;
    const dashGeo = new THREE.PlaneGeometry(0.22, 1.35);
    dashGeo.rotateX(-Math.PI / 2);
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xf2b01e });
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashCount);
    for (let i = 0; i < dashCount; i += 1) {
      const a = (i / dashCount) * Math.PI * 2;
      dummy.position.set(Math.cos(a) * TRACK_RADIUS, 0.015, -Math.sin(a) * TRACK_RADIUS);
      dummy.rotation.set(0, a, 0);
      dummy.updateMatrix();
      dashes.setMatrixAt(i, dummy.matrix);
    }
    dashes.instanceMatrix.needsUpdate = true;
    scene.add(dashes);
    this.disposables.push(dashGeo, dashMat);

    const studCount = 48;
    const studGeo = new THREE.BoxGeometry(0.14, 0.05, 0.14);
    const studMat = new THREE.MeshStandardMaterial({ color: 0xffb830, emissive: 0xff8c10, emissiveIntensity: 2.6, roughness: 0.25 });
    const studs = new THREE.InstancedMesh(studGeo, studMat, studCount);
    for (let i = 0; i < studCount; i += 1) {
      const a = ((i + 0.5) / studCount) * Math.PI * 2;
      const r = TRACK_RADIUS + TRACK_HALF_WIDTH - 0.35;
      dummy.position.set(Math.cos(a) * r, 0.025, -Math.sin(a) * r);
      dummy.rotation.set(0, a, 0);
      dummy.updateMatrix();
      studs.setMatrixAt(i, dummy.matrix);
    }
    studs.instanceMatrix.needsUpdate = true;
    scene.add(studs);
    this.disposables.push(studGeo, studMat);

    const curbCount = 128;
    const curbGeo = new THREE.BoxGeometry(0.58, 0.12, 1.44);
    const curbMat = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.04 });
    const curbs = new THREE.InstancedMesh(curbGeo, curbMat, curbCount);
    const chalkCol = new THREE.Color(0xede6d3);
    const redCol = new THREE.Color(0xc8321e);
    for (let i = 0; i < 64; i += 1) {
      const a = (i / 64) * Math.PI * 2;
      const col = i % 2 === 0 ? redCol : chalkCol;
      for (let side = 0; side < 2; side += 1) {
        const r = side === 0 ? TRACK_RADIUS - TRACK_HALF_WIDTH - 0.14 : TRACK_RADIUS + TRACK_HALF_WIDTH + 0.14;
        dummy.position.set(Math.cos(a) * r, 0.035, -Math.sin(a) * r);
        dummy.rotation.set(0, a, 0);
        dummy.updateMatrix();
        const idx = i * 2 + side;
        curbs.setMatrixAt(idx, dummy.matrix);
        curbs.setColorAt(idx, col);
      }
    }
    curbs.instanceMatrix.needsUpdate = true;
    if (curbs.instanceColor) curbs.instanceColor.needsUpdate = true;
    scene.add(curbs);
    this.disposables.push(curbGeo, curbMat);

    const signCount = 24;
    const signGeo = new THREE.BoxGeometry(0.10, 0.78, 1.65);
    const signMat = new THREE.MeshStandardMaterial({
      map: chevronTex,
      emissive: 0xffffff,
      emissiveMap: chevronTex,
      emissiveIntensity: 0.65,
      roughness: 0.4,
    });
    const signs = new THREE.InstancedMesh(signGeo, signMat, signCount);
    for (let i = 0; i < signCount; i += 1) {
      const a = (i / signCount) * Math.PI * 2;
      dummy.position.set(Math.cos(a) * (railR + 0.65), 1.05, -Math.sin(a) * (railR + 0.65));
      dummy.rotation.set(0, a, 0);
      dummy.updateMatrix();
      signs.setMatrixAt(i, dummy.matrix);
    }
    signs.instanceMatrix.needsUpdate = true;
    scene.add(signs);
    this.disposables.push(signGeo, signMat);

    // Multi-tier Deodar Pine Forest
    const pineGeo = buildDeodarGeometry();
    const pineMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.65 });
    const treeCount = 76;
    const pines = new THREE.InstancedMesh(pineGeo, pineMat, treeCount);
    for (let i = 0; i < treeCount; i += 1) {
      const a = i * 2.399963;
      const outer = i >= 12;
      const r = outer ? (TRACK_RADIUS + TRACK_HALF_WIDTH + 6.5 + ((i * 19) % 42)) : (2.2 + ((i * 5.7) % 6.2));
      const scTree = outer ? (0.82 + ((i * 13) % 7) * 0.16) : (0.65 + (i % 4) * 0.15);
      dummy.position.set(Math.cos(a) * r, -0.05, -Math.sin(a) * r);
      dummy.rotation.set(0, a * 1.7, 0);
      dummy.scale.setScalar(scTree);
      dummy.updateMatrix();
      pines.setMatrixAt(i, dummy.matrix);
    }
    pines.instanceMatrix.needsUpdate = true;
    scene.add(pines);
    this.disposables.push(pineGeo, pineMat);

    // Granite Roadside Boulders
    const rockGeo = buildBoulderGeometry(91);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4b4842, roughness: 0.96, flatShading: true });
    const rockCount = 26;
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
    for (let i = 0; i < rockCount; i += 1) {
      const a = (i / rockCount) * Math.PI * 2 + 0.17;
      const r = railR + 2.8 + (i % 5) * 1.4;
      dummy.position.set(Math.cos(a) * r, 0.25, -Math.sin(a) * r);
      dummy.rotation.set(i * 0.5, i * 1.3, 0);
      dummy.scale.set(1.1 + (i % 3) * 0.55, 0.7 + (i % 2) * 0.4, 0.9 + (i % 4) * 0.4);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    }
    rocks.instanceMatrix.needsUpdate = true;
    scene.add(rocks);
    this.disposables.push(rockGeo, rockMat);

    // Shared beam + glowing brake rotor geometries for car spawns
    this.beamAsset = buildBeamCone();
    this.disposables.push(this.beamAsset.geometry, this.beamAsset.material);

    const rotorGeo = new THREE.RingGeometry(0.11, 0.20, 20);
    const rotorMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.4, 0.82, 0.22),
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.rotorAsset = { geometry: rotorGeo, material: rotorMat };
    this.disposables.push(rotorGeo, rotorMat);

    // Car & GPU Effects
    this.effects = new Effects(scene);
    this.effects.setLight(new THREE.Color(0xd2b89f));
    this.spawnCarMesh();

    // Camera + Bloom Post-Processing Pipeline
    this.camera = new THREE.PerspectiveCamera(44, 16 / 9, 0.3, 280);
    try {
      this.composer = new EffectComposer(renderer);
      this.renderPass = new RenderPass(scene, this.camera);
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1280, 720), 0.48, 0.48, 0.92);
      this.outputPass = new OutputPass();
      this.composer.addPass(this.renderPass);
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(this.outputPass);
    } catch {
      this.composer = null;
    }

    this.built = true;
    this.applyMapAtmosphere();
    this.resize();

    this.loadModel();

    return true;
  }

  resize() {
    if (!this.built || !this.canvas || !this.renderer || !this.camera) return;
    const w = this.canvas.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1280);
    const h = this.canvas.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 720);
    if (!w || !h) return;
    const rawDpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    const dpr = Math.min(MAX_DPR, rawDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(w, h);
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.effects?.setViewport(h * dpr, this.camera.fov);
  }

  start() {
    if (this.running) return;
    if (!this.initScene() || typeof requestAnimationFrame !== 'function') return;
    this.running = true;
    this.lastTime = 0;
    this.canvas?.classList.add('is-on');
    if (typeof window !== 'undefined') window.addEventListener('resize', this.onResize, { passive: true });
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    if (this.rafId != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    if (typeof window !== 'undefined') window.removeEventListener('resize', this.onResize);
    this.canvas?.classList.remove('is-on');
  }

  /** Stops the animation loop and disposes WebGL resources cleanly. */
  destroy() {
    this.stop();
    this.disposed = true;
    if (!this.built) return;
    this.built = false;
    this.effects?.dispose();
    if (this.car) {
      this.scene?.remove(this.car);
      for (const h of this.headlights || []) h.dispose?.();
      this.car.dispose();
    }
    this.envRT?.dispose?.();
    this.envRT = null;
    for (const item of this.disposables) item?.dispose?.();
    this.disposables.length = 0;
    this.bloomPass?.dispose?.();
    this.outputPass?.dispose?.();
    this.composer?.dispose?.();
    this.renderer?.dispose();
    this.composer = null;
    this.bloomPass = null;
    this.outputPass = null;
    this.renderer = null;
    this.scene = null;
    this.car = null;
    this.effects = null;
    this.camera = null;
  }

  stepCar(dt) {
    const pose = computeDriftPose(this.elapsed);
    const { car, effects } = this;
    this._pos.set(pose.x, 0, pose.z);
    this._quat.setFromAxisAngle(UP, pose.heading);
    car.position.copy(this._pos);
    car.quaternion.copy(this._quat);

    car.setSteering(pose.steer);
    car.setBraking(pose.braking);
    car.setBodyDynamics?.({ roll: pose.roll, pitch: pose.pitch, squat: -0.01 });

    // Spin wheels reliably on both ProceduralCar & ModelCar
    this.wheelSpinAngle.front += dt * 52;
    this.wheelSpinAngle.rear += dt * 88;
    const frontSteerL = -frontWheelAngle(pose.steer, -0.78, 2.55);
    const frontSteerR = -frontWheelAngle(pose.steer, 0.78, 2.55);
    car.wheelPivots.get('frontLeft').rotation.y = frontSteerL;
    car.wheelPivots.get('frontRight').rotation.y = frontSteerR;
    car.wheels.get('frontLeft').rotation.x = -this.wheelSpinAngle.front;
    car.wheels.get('frontRight').rotation.x = -this.wheelSpinAngle.front;
    car.wheels.get('rearLeft').rotation.x = -this.wheelSpinAngle.rear;
    car.wheels.get('rearRight').rotation.x = -this.wheelSpinAngle.rear;

    // Pulse tail lamps & brake rotor heat softly for HDR bloom
    if (car.tailMaterial) {
      car.tailMaterial.emissiveIntensity = pose.braking ? 3.8 : 1.35;
    }
    if (this.rotorAsset) {
      const targetGlow = pose.braking ? 0.85 : 0.22;
      this.rotorAsset.material.opacity += (targetGlow - this.rotorAsset.material.opacity) * Math.min(1, dt * 8);
    }
    car.updateUnderglow?.(dt, 1);

    const vx = -Math.sin(pose.orbit) * 19.6;
    const vz = -Math.cos(pose.orbit) * 19.6;
    this._fwd.set(0, 0, -1).applyQuaternion(this._quat);
    this._right.set(1, 0, 0).applyQuaternion(this._quat);

    // Rich billowing smoke, orange drift sparks & persistent dual skid marks
    for (let i = 0; i < 2; i += 1) {
      this._wPos.copy(this.rearOffsets[i]).applyQuaternion(this._quat).add(this._pos);
      this._wPos.y = 0.025;
      this._wheelScratch[i].contactPoint.copy(this._wPos);
      effects.addSkid(i + 2, this._wheelScratch[i], this._fwd, 0.92);

      if (Math.random() < 0.84) {
        effects.spawn(
          'smoke',
          this._wPos.x + (Math.random() - 0.5) * 0.25,
          0.18,
          this._wPos.z + (Math.random() - 0.5) * 0.25,
          -vx * 0.14 + this._right.x * 1.6,
          0.75 + Math.random() * 0.95,
          -vz * 0.14 + this._right.z * 1.6,
          1.45,
        );
      }
      if (Math.random() < 0.36) {
        effects.spark(
          this._wPos.x,
          0.16,
          this._wPos.z,
          -vx * 0.4 + (Math.random() - 0.5) * 5.2,
          1.8 + Math.random() * 3.0,
          -vz * 0.4 + (Math.random() - 0.5) * 5.2,
          0.03,
        );
      }
    }

    if (pose.flameBurst) {
      for (const sideX of [-0.62, 0.62]) {
        this._wPos.set(sideX, 0.42, 2.28).applyQuaternion(this._quat).add(this._pos);
        effects.spawn(
          'flame',
          this._wPos.x,
          this._wPos.y,
          this._wPos.z,
          -this._fwd.x * 7.2 + vx * 0.2,
          0.25,
          -this._fwd.z * 7.2 + vz * 0.2,
          0.95,
        );
      }
    }

    if (this.sun && this._sunDir) {
      this.sun.target.position.copy(this._pos);
      this.sun.position.copy(this._pos).addScaledVector(this._sunDir, 60);
      this.sun.target.updateMatrixWorld();
    }

    return pose;
  }

  stepCamera(dt, pose) {
    // Low aggressive 3/4 rear-side chase framing: opens full car silhouette & guardrail curve on the
    // right showcase half, completely clear of the left-hand buttons & yellow hazard banner.
    const camAngle = pose.orbit - 0.41;
    const camRadius = pose.radius + 4.85 + Math.sin(this.elapsed * 0.45) * 0.4;
    const camHeight = 1.32 + Math.sin(this.elapsed * 0.55) * 0.22;
    this._camDesired.set(
      Math.cos(camAngle) * camRadius,
      camHeight,
      -Math.sin(camAngle) * camRadius,
    );
    const snap = this.elapsed < 0.06;
    if (snap) this._camPos.copy(this._camDesired);
    else this._camPos.lerp(this._camDesired, 1 - Math.exp(-9 * dt));

    this._camLook.set(pose.x + this._fwd.x * 1.75, 0.72, pose.z + this._fwd.z * 1.75);
    const rightVec = this._vel.subVectors(this._camLook, this._camPos).normalize().cross(UP).normalize();
    this._camLook.addScaledVector(rightVec, -2.55);

    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._camLook);
    this.camera.rotateZ(-0.048);
  }

  frame(now) {
    if (!this.running || !this.built) return;
    const dt = this.lastTime > 0 ? Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000)) : 1 / 60;
    this.lastTime = now;
    this.elapsed += dt;

    const pose = this.stepCar(dt);
    this.stepCamera(dt, pose);
    this.effects.update(dt);

    underglowFrame.begin();
    underglowFrame.push(this.car);
    underglowFrame.end();

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);

    if (this.timerEl) {
      const tenth = Math.floor(this.elapsed * 10);
      if (tenth !== this.lastStamp) {
        this.lastStamp = tenth;
        this.timerEl.textContent = formatRecTime(this.elapsed);
      }
    }

    this.rafId = requestAnimationFrame(this.tick);
  }
}
