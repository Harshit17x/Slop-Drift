import * as THREE from 'three';
import { SURFACE } from '../config.js';
import { clamp } from '../core/math.js';

const MAX_PARTICLES = 1800;
const MAX_SPARKS = 480;
const MAX_SKID_QUADS = 2400;
const SKID_LIFE = 14; // seconds a tyre mark stays visible
const SKID_HALF_WIDTH = 0.12;
const GRAVITY = 9.81;

// Choose at the contact patch so a tyre on the verge throws different material from one on the road.
const TYRE_TRAIL = Object.freeze({
  [SURFACE.ASPHALT]: 'wisp', [SURFACE.CONCRETE]: 'wisp', [SURFACE.KERB]: 'wisp', [SURFACE.COBBLE]: 'wisp',
  [SURFACE.GRAVEL]: 'grit', [SURFACE.ROCK]: 'grit', [SURFACE.HARDPACK]: 'dust', [SURFACE.DIRT]: 'dust',
  [SURFACE.MUD]: 'mud', [SURFACE.GRASS]: 'grass', [SURFACE.SNOW]: 'snow', [SURFACE.WATER]: 'splash',
  [SURFACE.WOOD]: null,
});

// [r, g, b, alpha, size m, growth m/s, life s, gravity m/s², emissive, drag 1/s, fade-in fraction]
const STYLES = Object.freeze({
  // Tyre smoke: big, slow, lingering billows of burnt rubber.
  smoke: [0.78, 0.78, 0.78, 0.58, 0.9, 2.8, 2.8, -0.35, 0, 2.4, 0.1],
  // A thin, quick wisp for light slides and lock-ups.
  wisp: [0.78, 0.78, 0.78, 0.34, 0.5, 1.7, 1.4, -0.4, 0, 2.0, 0.1],
  mud: [0.22, 0.125, 0.055, 0.94, 0.13, 0.09, 0.52, 9.8, 0, 0.35, 0],
  dust: [0.62, 0.52, 0.4, 0.42, 0.55, 1.9, 1.4, 0.4, 0, 1.8, 0.08],
  grit: [0.57, 0.55, 0.51, 0.42, 0.55, 1.9, 1.4, 0.4, 0, 1.8, 0.08],
  grass: [0.36, 0.42, 0.24, 0.42, 0.35, 1.2, 0.7, 1.4, 0, 1.6, 0.05],
  snow: [0.95, 0.97, 1.0, 0.5, 0.4, 1.5, 0.8, 1.0, 0, 1.6, 0.05],
  nitroCore: [0.42, 0.73, 1, 0.98, 0.14, 0.12, 0.076, 0, 1, 0.5, 0],
  flame: [1.0, 0.5, 0.18, 0.9, 0.22, 0.7, 0.16, -1, 1, 1.6, 0],
  // Bright flash where metal meets metal or stone.
  flash: [1.0, 0.82, 0.5, 0.95, 0.9, 2.5, 0.09, 0, 1, 0, 0],
  splash: [0.75, 0.86, 0.95, 0.5, 0.4, 1.4, 0.6, 5, 0, 1.6, 0.05],
  // Grey-brown grit knocked off on a hard hit.
  debris: [0.6, 0.57, 0.52, 0.32, 0.5, 1.6, 1.1, 0.8, 0, 2.2, 0.05],
});

const particleVertex = /* glsl */ `
  attribute vec4 aColor;
  attribute float aSize;
  attribute float aSeed;
  varying vec4 vColor;
  varying float vSeed;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vSeed = aSeed;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// Smoke is a soft disc broken up by rotated value noise, so every puff has its own billowy shape
// and the cloud reads as volume rather than a stack of identical circles.
const particleFragment = /* glsl */ `
  varying vec4 vColor;
  varying float vSeed;
  uniform float uLight;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 >= 1.0) discard;
    float soft = 1.0 - r2;
    // Alpha of 2 or more marks an emissive particle (flame, flash) that ignores scene light.
    bool emissive = vColor.a > 1.5;
    float alpha = fract(vColor.a * 0.5) * 2.0;
    if (emissive) {
      gl_FragColor = vec4(vColor.rgb, alpha * soft * soft);
      return;
    }
    float a = vSeed * 6.2831;
    mat2 turn = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec2 q = turn * p * 2.1 + vSeed * 31.0;
    float n = noise(q) * 0.55 + noise(q * 2.13 + 7.0) * 0.3 + noise(q * 4.37 + 3.0) * 0.15;
    float puff = smoothstep(0.0, 0.85, soft * (0.45 + 1.1 * n));
    // Lit from above: the top of each puff is brighter, the underside and dense noise cores darker.
    float shade = mix(0.72, 1.06, 0.5 - 0.5 * p.y) * (0.82 + 0.3 * n);
    // Smoke scatters sky light, so it stays paler than the lit ground around it.
    gl_FragColor = vec4(vColor.rgb * uLight * shade, alpha * puff);
  }
`;

// Sparks: camera-facing streaks stretched from the tail (where the spark was a moment ago) to the head,
// built in clip space so they are a fixed pixel width at any distance.
const sparkVertex = /* glsl */ `
  attribute vec3 aHead;
  attribute vec3 aTail;
  attribute vec2 aCorner;
  attribute float aHeat;
  uniform vec2 uResolution;
  uniform float uWidth;
  varying float vHeat;
  varying float vAlong;
  varying float vSide;
  void main() {
    vHeat = aHeat;
    vAlong = aCorner.y;
    vSide = aCorner.x;
    vec4 h = projectionMatrix * modelViewMatrix * vec4(aHead, 1.0);
    vec4 t = projectionMatrix * modelViewMatrix * vec4(aTail, 1.0);
    if (aHeat <= 0.0 || h.w < 0.05 || t.w < 0.05) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec2 hs = h.xy / h.w;
    vec2 ts = t.xy / t.w;
    vec2 dir = (hs - ts) * uResolution;
    float len = length(dir);
    dir = len > 1e-4 ? dir / len : vec2(1.0, 0.0);
    vec2 across = vec2(-dir.y, dir.x);
    bool head = aCorner.y > 0.5;
    vec4 base = head ? h : t;
    float width = uWidth * (head ? 1.0 : 0.45) * (0.6 + 0.4 * aHeat);
    vec2 offset = across * aCorner.x * width + (head ? dir * width : vec2(0.0));
    base.xy += offset / uResolution * 2.0 * base.w;
    gl_Position = base;
  }
`;

const sparkFragment = /* glsl */ `
  varying float vHeat;
  varying float vAlong;
  varying float vSide;
  void main() {
    // White-hot when fresh, cooling through yellow and orange to a dull red.
    vec3 hot = vec3(1.0, 0.96, 0.82);
    vec3 warm = vec3(1.0, 0.62, 0.16);
    vec3 cool = vec3(0.75, 0.16, 0.04);
    vec3 colour = vHeat > 0.55 ? mix(warm, hot, (vHeat - 0.55) / 0.45) : mix(cool, warm, vHeat / 0.55);
    float edge = 1.0 - vSide * vSide;
    float alpha = clamp(vHeat * 1.4, 0.0, 1.0) * (0.25 + 0.75 * vAlong) * edge;
    // Premultiplied: glows over dark ground, and still reads orange-yellow against a white wall.
    gl_FragColor = vec4(colour * (1.0 + vHeat) * alpha, alpha * 0.75);
  }
`;

const skidVertex = /* glsl */ `
  attribute float aBirth;
  attribute float aStrength;
  varying float vAlpha;
  uniform float uTime;
  uniform float uLife;
  #include <fog_pars_vertex>
  void main() {
    float age = (uTime - aBirth) / uLife;
    vAlpha = aStrength * clamp(1.0 - age * age, 0.0, 1.0);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const skidFragment = /* glsl */ `
  varying float vAlpha;
  uniform vec3 uColor;
  #include <fog_pars_fragment>
  void main() {
    if (vAlpha <= 0.003) discard;
    gl_FragColor = vec4(uColor, vAlpha);
    #include <fog_fragment>
  }
`;

const scratch = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const drawSize = new THREE.Vector2();

/**
 * Tyre smoke, dust, sparks, nitro flame and skid marks. Three draw calls in total: one point cloud
 * (smoke, dust, flame), one streak mesh (sparks) and one ribbon mesh (skid marks), all fed from
 * fixed-size ring buffers so nothing is allocated while driving.
 */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'Effects';
    scene.add(this.group);
    this.intensity = 1;
    this.time = 0;

    // --- particles
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 4);
    this.sizes = new Float32Array(MAX_PARTICLES);
    this.seeds = new Float32Array(MAX_PARTICLES);
    this.velocities = new Float32Array(MAX_PARTICLES * 3);
    this.life = new Float32Array(MAX_PARTICLES);
    this.maxLife = new Float32Array(MAX_PARTICLES);
    this.growth = new Float32Array(MAX_PARTICLES);
    this.gravity = new Float32Array(MAX_PARTICLES);
    this.drag = new Float32Array(MAX_PARTICLES);
    this.fadeIn = new Float32Array(MAX_PARTICLES);
    this.baseAlpha = new Float32Array(MAX_PARTICLES);
    this.additive = new Uint8Array(MAX_PARTICLES);
    this.cursor = 0;
    this.particlesAlive = 0;
    this.maxParticles = MAX_PARTICLES;
    for (let i = 0; i < MAX_PARTICLES; i += 1) this.seeds[i] = Math.random();
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    particleGeometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    particleGeometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    particleGeometry.setAttribute('aSeed', new THREE.BufferAttribute(this.seeds, 1));
    this.particleMaterial = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uLight: { value: 1 } },
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: false,
    });
    this.particles = new THREE.Points(particleGeometry, this.particleMaterial);
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 3;
    this.group.add(this.particles);

    // --- sparks: 4 vertices per spark, each carrying the spark's head and tail
    this.sparkPos = new Float32Array(MAX_SPARKS * 3);
    this.sparkVel = new Float32Array(MAX_SPARKS * 3);
    this.sparkLife = new Float32Array(MAX_SPARKS);
    this.sparkMaxLife = new Float32Array(MAX_SPARKS);
    this.sparkFloor = new Float32Array(MAX_SPARKS);
    this.sparkHead = new Float32Array(MAX_SPARKS * 4 * 3);
    this.sparkTail = new Float32Array(MAX_SPARKS * 4 * 3);
    this.sparkHeat = new Float32Array(MAX_SPARKS * 4);
    const corners = new Float32Array(MAX_SPARKS * 4 * 2);
    const sparkIndex = new Uint32Array(MAX_SPARKS * 6);
    for (let k = 0; k < MAX_SPARKS; k += 1) {
      corners.set([-1, 0, 1, 0, -1, 1, 1, 1], k * 8);
      const v = k * 4;
      sparkIndex.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], k * 6);
    }
    const sparkGeometry = new THREE.BufferGeometry();
    // three needs a position attribute to know the vertex count; the shader uses aHead/aTail.
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 4 * 3), 3));
    sparkGeometry.setAttribute('aHead', new THREE.BufferAttribute(this.sparkHead, 3).setUsage(THREE.DynamicDrawUsage));
    sparkGeometry.setAttribute('aTail', new THREE.BufferAttribute(this.sparkTail, 3).setUsage(THREE.DynamicDrawUsage));
    sparkGeometry.setAttribute('aHeat', new THREE.BufferAttribute(this.sparkHeat, 1).setUsage(THREE.DynamicDrawUsage));
    sparkGeometry.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
    sparkGeometry.setIndex(new THREE.BufferAttribute(sparkIndex, 1));
    this.sparkMaterial = new THREE.ShaderMaterial({
      uniforms: { uResolution: { value: new THREE.Vector2(1280, 720) }, uWidth: { value: 1.6 } },
      vertexShader: sparkVertex,
      fragmentShader: sparkFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      // The streak is built in screen space, so its winding is always the same: never cull it.
      side: THREE.DoubleSide,
    });
    this.sparks = new THREE.Mesh(sparkGeometry, this.sparkMaterial);
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 4;
    this.sparks.onBeforeRender = (renderer) => {
      renderer.getDrawingBufferSize(drawSize);
      this.sparkMaterial.uniforms.uResolution.value.copy(drawSize);
      this.sparkMaterial.uniforms.uWidth.value = Math.max(1.2, drawSize.y / 520);
    };
    this.group.add(this.sparks);
    this.sparkCursor = 0;
    this.sparkClock = 0;
    this.nitroClock = 0;
    this.exhaustTips = [[-0.42, 0.33, 2.185], [0.42, 0.33, 2.185]];
    this.sparksAlive = 0;

    // --- skid marks: a ring buffer of quads
    this.skidPositions = new Float32Array(MAX_SKID_QUADS * 4 * 3);
    this.skidBirth = new Float32Array(MAX_SKID_QUADS * 4).fill(-1000);
    this.skidStrength = new Float32Array(MAX_SKID_QUADS * 4);
    const indices = new Uint32Array(MAX_SKID_QUADS * 6);
    for (let q = 0; q < MAX_SKID_QUADS; q += 1) {
      const v = q * 4;
      indices.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], q * 6);
    }
    const skidGeometry = new THREE.BufferGeometry();
    skidGeometry.setAttribute('position', new THREE.BufferAttribute(this.skidPositions, 3).setUsage(THREE.DynamicDrawUsage));
    skidGeometry.setAttribute('aBirth', new THREE.BufferAttribute(this.skidBirth, 1).setUsage(THREE.DynamicDrawUsage));
    skidGeometry.setAttribute('aStrength', new THREE.BufferAttribute(this.skidStrength, 1).setUsage(THREE.DynamicDrawUsage));
    skidGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.skidMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uTime: { value: 0 }, uLife: { value: SKID_LIFE }, uColor: { value: new THREE.Color(0x0c0d0f) } },
      ]),
      vertexShader: skidVertex,
      fragmentShader: skidFragment,
      transparent: true,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.skids = new THREE.Mesh(skidGeometry, this.skidMaterial);
    this.skids.frustumCulled = false;
    this.skids.renderOrder = 2;
    this.group.add(this.skids);
    this.skidCursor = 0;
    this.skidDirty = false;
    // Per wheel: the previous pair of edge points, so consecutive quads join into a ribbon.
    this.trails = [0, 1, 2, 3].map(() => ({ active: false, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0 }));
    this.emitClock = new Float32Array(4);
    // Tread temperature, 0..1: rubber has to heat up before it smokes, and keeps smoking briefly after.
    this.tyreHeat = new Float32Array(4);
  }

  /** @param {{effects:number}} quality */
  setQuality(quality) {
    const scale = clamp(Number(quality?.effects ?? 1), 0.3, 1.5);
    this.intensity = scale;
    this.maxParticles = Math.max(240, Math.round(MAX_PARTICLES * clamp(scale, 0.35, 1)));
    this.cursor %= this.maxParticles;
  }

  /** Scene light level so smoke is not glowing white at night. */
  setLight(color) {
    const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
    this.particleMaterial.uniforms.uLight.value = clamp(luminance * 1.35 + 0.08, 0.08, 1);
  }

  setViewport(height, fovDegrees) {
    // Converts a world-space diameter into point size in pixels.
    this.particleMaterial.uniforms.uScale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2));
  }

  spawn(kind, x, y, z, vx, vy, vz, scale = 1) {
    const style = STYLES[kind];
    if (!style) return;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.maxParticles;
    if (this.life[i] <= 0) this.particlesAlive += 1;
    const jitter = 0.7 + Math.random() * 0.6;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.velocities[i * 3] = vx + (Math.random() - 0.5) * 1.2;
    this.velocities[i * 3 + 1] = vy + Math.random() * 0.8;
    this.velocities[i * 3 + 2] = vz + (Math.random() - 0.5) * 1.2;
    this.colors[i * 4] = style[0];
    this.colors[i * 4 + 1] = style[1];
    this.colors[i * 4 + 2] = style[2];
    this.colors[i * 4 + 3] = 0;
    this.baseAlpha[i] = Math.min(0.98, style[3] * jitter);
    this.sizes[i] = style[4] * scale * jitter;
    this.growth[i] = style[5] * scale;
    this.maxLife[i] = style[6] * jitter;
    this.life[i] = this.maxLife[i];
    this.gravity[i] = style[7];
    this.additive[i] = style[8];
    this.drag[i] = style[9];
    this.fadeIn[i] = style[10];
    this.seeds[i] = Math.random();
    this.seedsDirty = true;
  }

  burst(kind, x, y, z, count, speed) {
    for (let n = 0; n < count; n += 1) {
      const angle = Math.random() * Math.PI * 2;
      this.spawn(kind, x, y, z, Math.cos(angle) * speed, Math.random() * speed, Math.sin(angle) * speed);
    }
  }

  /** One spark at (x, y, z) flying with (vx, vy, vz); it bounces on `floor` and cools over its life. */
  spark(x, y, z, vx, vy, vz, floor) {
    const k = this.sparkCursor;
    this.sparkCursor = (this.sparkCursor + 1) % MAX_SPARKS;
    if (this.sparkLife[k] <= 0) this.sparksAlive += 1;
    this.sparkPos[k * 3] = x;
    this.sparkPos[k * 3 + 1] = y;
    this.sparkPos[k * 3 + 2] = z;
    this.sparkVel[k * 3] = vx;
    this.sparkVel[k * 3 + 1] = vy;
    this.sparkVel[k * 3 + 2] = vz;
    this.sparkMaxLife[k] = 0.35 + Math.random() * 0.65;
    this.sparkLife[k] = this.sparkMaxLife[k];
    this.sparkFloor[k] = floor;
  }

  /**
   * A shower of sparks from a body contact. The car's motion along the wall carries them forward;
   * the wall throws them back out and up.
   */
  sparkShower(state, count, energy) {
    const p = state.impactPoint;
    const n = state.impactNormal;
    if (!p || !n) return;
    const v = state.velocity;
    // Velocity along the wall (tangent): what grinding metal sprays in.
    const vn = v.x * n.x + v.z * n.z;
    const tx = v.x - n.x * vn;
    const tz = v.z - n.z * vn;
    const floor = this.groundUnder(state);
    for (let c = 0; c < count; c += 1) {
      const carry = 0.35 + Math.random() * 0.6;
      const out = (0.6 + Math.random() * 2.4) * energy;
      const up = (0.4 + Math.random() * 2.6) * energy;
      const spread = 1.8 * energy;
      this.spark(
        p.x + n.x * 0.05, Math.max(floor + 0.08, p.y - 0.15), p.z + n.z * 0.05,
        tx * carry + n.x * out + (Math.random() - 0.5) * spread,
        up,
        tz * carry + n.z * out + (Math.random() - 0.5) * spread,
        floor,
      );
    }
  }

  groundUnder(state) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < 4; i += 1) {
      const w = state.wheels[i];
      if (w?.contact) {
        sum += w.contactPoint.y;
        count += 1;
      }
    }
    return count > 0 ? sum / count : state.position.y - 0.5;
  }

  addSkid(index, wheel, forward, strength) {
    const trail = this.trails[index];
    const point = wheel.contactPoint;
    const normal = wheel.contactNormal;
    // Across-track direction = normal x forward, so the mark has the tyre's width whatever the heading.
    scratch.set(normal.x, normal.y, normal.z).cross(forward).normalize().multiplyScalar(SKID_HALF_WIDTH);
    const lift = 0.025;
    const lx = point.x - scratch.x + normal.x * lift;
    const ly = point.y - scratch.y + normal.y * lift;
    const lz = point.z - scratch.z + normal.z * lift;
    const rx = point.x + scratch.x + normal.x * lift;
    const ry = point.y + scratch.y + normal.y * lift;
    const rz = point.z + scratch.z + normal.z * lift;
    if (trail.active) {
      const moved = Math.hypot(lx - trail.lx, lz - trail.lz);
      if (moved < 0.18) return; // wait until the wheel has travelled far enough for a new quad
      if (moved < 4) {
        const q = this.skidCursor;
        this.skidCursor = (this.skidCursor + 1) % MAX_SKID_QUADS;
        const p = q * 12;
        const positions = this.skidPositions;
        positions[p] = trail.lx; positions[p + 1] = trail.ly; positions[p + 2] = trail.lz;
        positions[p + 3] = trail.rx; positions[p + 4] = trail.ry; positions[p + 5] = trail.rz;
        positions[p + 6] = lx; positions[p + 7] = ly; positions[p + 8] = lz;
        positions[p + 9] = rx; positions[p + 10] = ry; positions[p + 11] = rz;
        for (let k = 0; k < 4; k += 1) {
          this.skidBirth[q * 4 + k] = this.time;
          this.skidStrength[q * 4 + k] = strength;
        }
        this.skidDirty = true;
      }
    }
    trail.active = true;
    trail.lx = lx; trail.ly = ly; trail.lz = lz;
    trail.rx = rx; trail.ry = ry; trail.rz = rz;
  }

  /**
   * Emit from the car's current state. Call once per frame while driving.
   * @param {number} dt
   * @param {import('../core/contracts.js').VehicleState} state
   */
  emit(dt, state) {
    const speed = state.speed;
    const velocity = state.velocity;
    const right = state.right;
    // How sideways the car is travelling. A drift keeps the tyres' grip demand only just past the limit,
    // so slip alone under-reports it; the body slip angle says how hard the rubber is being dragged.
    const slideDeg = Math.abs(state.slipAngle || 0) * 57.3;
    const slide = clamp((slideDeg - 7) / 18, 0, 1.4) * clamp((speed - 4) / 6, 0, 1);
    for (let i = 0; i < 4; i += 1) {
      const wheel = state.wheels[i];
      const trail = this.trails[i];
      const rear = i >= 2;
      const material = TYRE_TRAIL[wheel.surface];
      const rubber = material === 'wisp';
      if (wheel.contact && material && state.landing > 2.5) {
        const p = wheel.contactPoint;
        this.burst(material, p.x, p.y + 0.15, p.z, Math.min(4, Math.round(state.landing * 0.5 * this.intensity)), 2.2);
      }
      // Burnouts smoke at walking pace; marks and dust need the car to be moving.
      const spinning = wheel.contact && wheel.slip > 1.25 && rubber;
      const overRaw = wheel.contact ? Math.max(wheel.slip - 1, rubber ? slide * (rear ? 1 : 0.35) : 0) : 0;
      // Sliding heats the tread fast; it cools over about a second.
      const heat = this.tyreHeat[i] = clamp(this.tyreHeat[i] + (overRaw > 0.05 ? overRaw * 2.6 : -1.1) * dt, 0, 1);
      if (!wheel.contact || (speed < 2.5 && !(spinning && speed > 0.3))) {
        trail.active = false;
        continue;
      }
      const point = wheel.contactPoint;
      const over = overRaw;
      let kind = material;
      let rate = 0; // particles per second
      let mark = 0;
      let scale = 1;
      if (rubber) {
        kind = null;
        if (over > 0.02) {
          // A proper slide (drift, burnout, handbrake) pours out thick smoke from the rear tyres;
          // a light scrub or a locked front wheel only wisps.
          const heavy = over > 0.25 && (rear || over > 0.6);
          kind = heavy ? 'smoke' : 'wisp';
          const strength = clamp(over * 1.4, 0.15, 1.4);
          // Smoke is vaporised rubber: it scales with how hard the tyre is pressed down (load) and
          // only pours once the tread is hot.
          const loadK = clamp((wheel.load || 3200) / 3200, 0.45, 1.6);
          rate = (heavy ? 44 : 14) * strength * (rear ? 1 : 0.55) * loadK * (0.25 + 0.75 * heat);
          scale = 0.85 + clamp(speed / 30, 0, 0.7) + (heavy ? clamp(over - 0.5, 0, 0.6) : 0);
          mark = speed > 2.5 ? clamp(0.25 + over * 0.7, 0, 0.75) : 0;
        }
      } else if (kind === 'mud') {
        rate = clamp(speed + over * 14, 4, 38);
        mark = 0.28 + clamp(over, 0, 1) * 0.3;
      } else if (!kind) {
        trail.active = false;
        continue;
      } else if (kind === 'splash') {
        rate = 30 * clamp(speed / 15, 0.2, 1);
      } else {
        rate = 16 * clamp(speed / 22, 0.1, 1) * (1 + clamp(over, 0, 1.5));
        mark = 0.16 + clamp(over, 0, 1) * 0.2;
      }
      if (mark > 0) this.addSkid(i, wheel, state.forward, mark);
      else trail.active = false;
      if (!kind) continue;
      this.emitClock[i] += rate * this.intensity * dt;
      // Thrown out of the side of the tyre away from the car, carried a little by its motion.
      const side = i % 2 === 0 ? -1 : 1;
      // Tread speed: a spinning tyre peels the hot rubber off the back of the contact patch and
      // carries part of it up round the back of the wheel before throwing it off.
      const roll = Math.sign(wheel.spinSpeed || 1);
      const tread = Math.min(60, Math.abs(wheel.spinSpeed || 0) * 0.34);
      const fwd = state.forward;
      while (this.emitClock[i] >= 1) {
        this.emitClock[i] -= 1;
        const smoky = kind === 'smoke' || kind === 'wisp';
        if (smoky) {
          const wrap = Math.random() < 0.4; // round the back of the tyre rather than straight off the road
          const back = (wrap ? 0.32 : 0.18) * roll;
          const fling = tread * (wrap ? 0.05 : 0.1);
          this.spawn(kind,
            point.x - fwd.x * back + right.x * side * 0.1, point.y + (wrap ? 0.34 : 0.1), point.z - fwd.z * back + right.z * side * 0.1,
            velocity.x * 0.12 - fwd.x * roll * fling + right.x * side * 0.6,
            0.3 + tread * (wrap ? 0.06 : 0.025),
            velocity.z * 0.12 - fwd.z * roll * fling + right.z * side * 0.6,
            scale * (wrap ? 0.8 : 1));
          continue;
        }
        const carry = smoky ? 0.12 : 0.25;
        const kick = kind === 'mud' ? 1.6 + Math.random() * 1.5 : smoky ? 0.9 : 0;
        this.spawn(kind,
          point.x + right.x * side * 0.12, point.y + 0.15, point.z + right.z * side * 0.12,
          velocity.x * carry + right.x * side * kick, kind === 'mud' ? 1.8 + Math.random() * 2 : smoky ? 0.35 : 0.5, velocity.z * carry + right.z * side * kick,
          scale);
      }
    }

    // Sparks: a shower on every hard hit, and a steady stream while the body grinds along a wall.
    const impact = state.impact || 0;
    const scrape = state.scrape || 0;
    if (impact > 1.8) {
      const energy = clamp(0.55 + impact / 12, 0.6, 1.8);
      const count = Math.round(clamp(impact * 4, 8, 70) * this.intensity);
      this.sparkShower(state, count, energy);
      const p = state.impactPoint;
      this.spawn('flash', p.x, p.y, p.z, 0, 0, 0, clamp(impact / 8, 0.5, 1.6));
      if (impact > 6) {
        const grit = Math.round(clamp(impact * 0.8, 3, 14) * this.intensity);
        for (let g = 0; g < grit; g += 1) {
          this.spawn('debris', p.x, p.y, p.z, state.impactNormal.x * 2 + velocity.x * 0.2, 0.6, state.impactNormal.z * 2 + velocity.z * 0.2, 0.9);
        }
      }
    }
    if (scrape > 1.2) {
      this.sparkClock += clamp(scrape * 9, 0, 260) * this.intensity * dt;
      const n = Math.floor(this.sparkClock);
      if (n > 0) {
        this.sparkClock -= n;
        this.sparkShower(state, n, clamp(0.45 + scrape / 25, 0.45, 1.2));
      }
    } else {
      this.sparkClock = 0;
    }

    if (state.boosting) {
      // Time-based emission anchored at the car's tailpipe / exhaust openings.
      this.nitroClock += Math.min(dt, 0.1) * 58 * this.intensity;
      const pulses = Math.floor(this.nitroClock);
      this.nitroClock -= pulses;
      for (let i = 0; i < pulses; i++) {
        for (let p = 0; p < this.exhaustTips.length; p += 1) {
          const tip = this.exhaustTips[p];
          scratch.set(tip[0], tip[1], tip[2]).applyQuaternion(state.quaternion).add(state.position);
          scratchB.copy(state.forward).multiplyScalar(-12).add(velocity);
          this.spawn('nitroCore', scratch.x, scratch.y, scratch.z, scratchB.x, scratchB.y, scratchB.z, 1);
          scratch.addScaledVector(state.forward, -0.24);
          scratchB.addScaledVector(state.forward, -3 - Math.random() * 3);
          this.spawn('flame', scratch.x, scratch.y, scratch.z, scratchB.x, scratchB.y, scratchB.z, 0.82);
        }
      }
    } else {
      this.nitroClock = 0;
    }
  }

  /** Set car-specific local tailpipe/exhaust coordinates for nitro jets. */
  setExhaustTips(tips) {
    this.exhaustTips = Array.isArray(tips) && tips.length
      ? tips
      : [[-0.42, 0.33, 2.185], [0.42, 0.33, 2.185]];
  }

  /** Advance particles and fade skid marks. Call every frame, including while paused menus render. */
  update(dt) {
    this.time += dt;
    if (this.particlesAlive > 0) {
      const { positions, velocities, colors, sizes, life } = this;
      let alive = 0;
      for (let i = 0; i < MAX_PARTICLES; i += 1) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) {
          colors[i * 4 + 3] = 0;
          sizes[i] = 0;
          continue;
        }
        alive += 1;
        const v = i * 3;
        velocities[v + 1] -= this.gravity[i] * dt;
        const drag = 1 - Math.min(0.9, dt * this.drag[i]);
        velocities[v] *= drag;
        velocities[v + 1] *= 1 - Math.min(0.9, dt * this.drag[i] * 0.5);
        velocities[v + 2] *= drag;
        positions[v] += velocities[v] * dt;
        positions[v + 1] += velocities[v + 1] * dt;
        positions[v + 2] += velocities[v + 2] * dt;
        // Billows spread fast at first, then slow as they thin out.
        const age = 1 - life[i] / this.maxLife[i];
        sizes[i] += this.growth[i] * dt * (1.4 - age);
        const fadeIn = this.fadeIn[i] > 0 ? Math.min(1, age / this.fadeIn[i]) : 1;
        const fadeOut = Math.pow(1 - age, 1.4);
        // Alpha is packed with a flag: values in [2, 3) are emissive, [0, 1) are lit.
        colors[i * 4 + 3] = Math.min(0.99, this.baseAlpha[i] * fadeIn * fadeOut) + (this.additive[i] ? 2 : 0);
      }
      this.particlesAlive = alive;
      const geometry = this.particles.geometry;
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aColor.needsUpdate = true;
      geometry.attributes.aSize.needsUpdate = true;
      if (this.seedsDirty) {
        geometry.attributes.aSeed.needsUpdate = true;
        this.seedsDirty = false;
      }
    }

    this.updateSparks(dt);

    this.skidMaterial.uniforms.uTime.value = this.time;
    if (this.skidDirty) {
      const skidGeometry = this.skids.geometry;
      skidGeometry.attributes.position.needsUpdate = true;
      skidGeometry.attributes.aBirth.needsUpdate = true;
      skidGeometry.attributes.aStrength.needsUpdate = true;
      this.skidDirty = false;
    }
  }

  updateSparks(dt) {
    if (this.sparksAlive === 0) return;
    const { sparkPos: pos, sparkVel: vel, sparkLife: life, sparkHead: head, sparkTail: tail, sparkHeat: heat } = this;
    let alive = 0;
    const drag = 1 - Math.min(0.5, dt * 0.9);
    for (let k = 0; k < MAX_SPARKS; k += 1) {
      const h = k * 4;
      if (life[k] <= 0) {
        if (heat[h] !== 0) heat[h] = heat[h + 1] = heat[h + 2] = heat[h + 3] = 0;
        continue;
      }
      alive += 1;
      life[k] -= dt;
      const p = k * 3;
      vel[p + 1] -= GRAVITY * dt;
      vel[p] *= drag;
      vel[p + 2] *= drag;
      pos[p] += vel[p] * dt;
      pos[p + 1] += vel[p + 1] * dt;
      pos[p + 2] += vel[p + 2] * dt;
      // Bounce off the road, losing most of the energy and some heat.
      if (pos[p + 1] < this.sparkFloor[k] && vel[p + 1] < 0) {
        pos[p + 1] = this.sparkFloor[k];
        vel[p + 1] *= -0.32;
        vel[p] *= 0.62;
        vel[p + 2] *= 0.62;
        life[k] *= 0.8;
      }
      const t = Math.max(0, life[k] / this.sparkMaxLife[k]);
      // Streak length follows speed: a fresh spark is a long white line, a slow one a short ember.
      const streak = 0.028 + 0.012 * t;
      const hx = pos[p];
      const hy = pos[p + 1];
      const hz = pos[p + 2];
      const tx = hx - vel[p] * streak;
      const ty = hy - vel[p + 1] * streak;
      const tz = hz - vel[p + 2] * streak;
      for (let c = 0; c < 4; c += 1) {
        const o = (h + c) * 3;
        head[o] = hx; head[o + 1] = hy; head[o + 2] = hz;
        tail[o] = tx; tail[o + 1] = ty; tail[o + 2] = tz;
        heat[h + c] = life[k] > 0 ? Math.max(0.001, t) : 0;
      }
    }
    if (alive > 0 || this.sparksAlive > 0) {
      const g = this.sparks.geometry;
      g.attributes.aHead.needsUpdate = true;
      g.attributes.aTail.needsUpdate = true;
      g.attributes.aHeat.needsUpdate = true;
    }
    this.sparksAlive = alive;
  }

  /** Remove everything (new run). */
  clear() {
    if (this.particlesAlive > 0) {
      this.life.fill(0);
      this.sizes.fill(0);
      this.particles.geometry.attributes.aSize.needsUpdate = true;
      this.particlesAlive = 0;
    }
    if (this.sparksAlive > 0) {
      this.sparkLife.fill(0);
      this.sparkHeat.fill(0);
      this.sparks.geometry.attributes.aHeat.needsUpdate = true;
      this.sparksAlive = 0;
    }
    this.skidBirth.fill(-1000);
    this.skidDirty = true;
    this.sparkClock = 0;
    this.nitroClock = 0;
    for (const trail of this.trails) trail.active = false;
  }

  dispose() {
    this.particles.geometry.dispose();
    this.particleMaterial.dispose();
    this.sparks.geometry.dispose();
    this.sparkMaterial.dispose();
    this.skids.geometry.dispose();
    this.skidMaterial.dispose();
    this.scene.remove(this.group);
  }
}
