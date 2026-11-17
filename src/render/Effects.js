import * as THREE from 'three';
import { SURFACE } from '../config.js';
import { clamp } from '../core/math.js';

const MAX_PARTICLES = 700;
const MAX_SKID_QUADS = 2400;
const SKID_LIFE = 14; // seconds a tyre mark stays visible
const SKID_HALF_WIDTH = 0.12;

// [r, g, b, alpha, size m, growth m/s, life s, gravity m/s², additive]
const STYLES = Object.freeze({
  smoke: [0.86, 0.87, 0.9, 0.34, 0.5, 1.9, 1.1, -0.5, 0],
  dust: [0.62, 0.52, 0.4, 0.4, 0.45, 1.6, 0.9, 0.6, 0],
  grass: [0.36, 0.42, 0.24, 0.42, 0.35, 1.2, 0.7, 1.4, 0],
  snow: [0.95, 0.97, 1.0, 0.5, 0.4, 1.5, 0.8, 1.0, 0],
  spark: [1.0, 0.72, 0.3, 1.0, 0.07, 0, 0.35, 7, 1],
  flame: [1.0, 0.5, 0.18, 0.9, 0.22, 0.7, 0.16, -1, 1],
  splash: [0.75, 0.86, 0.95, 0.5, 0.4, 1.4, 0.6, 5, 0],
});

const particleVertex = /* glsl */ `
  attribute vec4 aColor;
  attribute float aSize;
  varying vec4 vColor;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const particleFragment = /* glsl */ `
  varying vec4 vColor;
  uniform vec3 uLight;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float falloff = 1.0 - dot(p, p);
    if (falloff <= 0.0) discard;
    // Alpha of 2 or more marks an emissive particle (sparks, flame) that ignores scene light.
    vec3 colour = vColor.a > 1.5 ? vColor.rgb : vColor.rgb * uLight;
    float alpha = fract(vColor.a * 0.5) * 2.0;
    gl_FragColor = vec4(colour, alpha * falloff * falloff);
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

/**
 * Tyre smoke, dust, sparks, nitro flame and skid marks. Two draw calls in total: one point cloud
 * and one ribbon mesh, both fed from fixed-size ring buffers so nothing is allocated while driving.
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
    this.count = MAX_PARTICLES;
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 4);
    this.sizes = new Float32Array(MAX_PARTICLES);
    this.velocities = new Float32Array(MAX_PARTICLES * 3);
    this.life = new Float32Array(MAX_PARTICLES);
    this.maxLife = new Float32Array(MAX_PARTICLES);
    this.growth = new Float32Array(MAX_PARTICLES);
    this.gravity = new Float32Array(MAX_PARTICLES);
    this.baseAlpha = new Float32Array(MAX_PARTICLES);
    this.additive = new Uint8Array(MAX_PARTICLES);
    this.cursor = 0;
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    particleGeometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    particleGeometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.particleMaterial = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uLight: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: false,
    });
    this.particles = new THREE.Points(particleGeometry, this.particleMaterial);
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 3;
    this.group.add(this.particles);

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
  }

  /** @param {{effects:number}} quality */
  setQuality(quality) {
    this.intensity = clamp(Number(quality?.effects ?? 1), 0.3, 1.5);
  }

  /** Scene light level so smoke is not glowing white at night. */
  setLight(color) {
    this.particleMaterial.uniforms.uLight.value.copy(color);
  }

  setViewport(height, fovDegrees) {
    // Converts a world-space diameter into point size in pixels.
    this.particleMaterial.uniforms.uScale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2));
  }

  spawn(kind, x, y, z, vx, vy, vz, scale = 1) {
    const style = STYLES[kind];
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
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
    this.baseAlpha[i] = Math.min(0.98, style[3] * jitter);
    this.sizes[i] = style[4] * scale * jitter;
    this.growth[i] = style[5] * scale;
    this.maxLife[i] = style[6] * jitter;
    this.life[i] = this.maxLife[i];
    this.gravity[i] = style[7];
    this.additive[i] = style[8];
  }

  burst(kind, x, y, z, count, speed) {
    for (let n = 0; n < count; n += 1) {
      const angle = Math.random() * Math.PI * 2;
      this.spawn(kind, x, y, z, Math.cos(angle) * speed, Math.random() * speed, Math.sin(angle) * speed);
    }
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
    for (let i = 0; i < 4; i += 1) {
      const wheel = state.wheels[i];
      const trail = this.trails[i];
      if (!wheel.contact || speed < 2.5) {
        trail.active = false;
        continue;
      }
      const point = wheel.contactPoint;
      const over = wheel.slip - 1;
      let kind = null;
      let rate = 0; // particles per second
      let mark = 0;
      if (wheel.surface === SURFACE.ASPHALT) {
        if (over > 0.02) {
          kind = 'smoke';
          rate = 26 * clamp(over * 1.6, 0.15, 1.3);
          mark = clamp(0.25 + over * 0.7, 0, 0.75);
        }
      } else if (wheel.surface === SURFACE.WATER) {
        kind = 'splash';
        rate = 30 * clamp(speed / 15, 0.2, 1);
      } else {
        kind = wheel.surface === SURFACE.SNOW ? 'snow' : wheel.surface === SURFACE.GRASS ? 'grass' : 'dust';
        rate = 16 * clamp(speed / 22, 0.1, 1) * (1 + clamp(over, 0, 1.5));
        mark = 0.16 + clamp(over, 0, 1) * 0.2;
      }
      if (mark > 0) this.addSkid(i, wheel, state.forward, mark);
      else trail.active = false;
      if (!kind) continue;
      this.emitClock[i] += rate * this.intensity * dt;
      while (this.emitClock[i] >= 1) {
        this.emitClock[i] -= 1;
        // Thrown backward relative to the car, carried along a little by its motion.
        this.spawn(kind, point.x, point.y + 0.12, point.z, velocity.x * 0.25, 0.5, velocity.z * 0.25, 0.8 + clamp(speed / 40, 0, 0.8));
      }
    }

    if (state.impact > 2.5) {
      scratch.copy(state.up).multiplyScalar(0.45).add(state.position);
      this.burst('spark', scratch.x, scratch.y, scratch.z, Math.min(26, Math.round(state.impact * 2.2 * this.intensity)), 2 + state.impact * 0.35);
    }
    if (state.landing > 2.5) {
      this.burst(state.surface === SURFACE.ASPHALT ? 'smoke' : 'dust', state.position.x, state.position.y + 0.15, state.position.z, Math.min(18, Math.round(state.landing * 2 * this.intensity)), 2.2);
    }
    if (state.boosting) {
      for (const side of [-0.68, 0.68]) {
        scratch.set(side, 0.5, 2.5).applyQuaternion(state.quaternion).add(state.position);
        scratchB.copy(state.forward).multiplyScalar(-7).add(velocity);
        this.spawn('flame', scratch.x, scratch.y, scratch.z, scratchB.x, scratchB.y, scratchB.z, 1);
      }
    }
  }

  /** Advance particles and fade skid marks. Call every frame, including while paused menus render. */
  update(dt) {
    this.time += dt;
    const { positions, velocities, colors, sizes, life } = this;
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        colors[i * 4 + 3] = 0;
        sizes[i] = 0;
        continue;
      }
      const v = i * 3;
      velocities[v + 1] -= this.gravity[i] * dt;
      const drag = 1 - Math.min(0.9, dt * 1.6);
      velocities[v] *= drag;
      velocities[v + 2] *= drag;
      positions[v] += velocities[v] * dt;
      positions[v + 1] += velocities[v + 1] * dt;
      positions[v + 2] += velocities[v + 2] * dt;
      sizes[i] += this.growth[i] * dt;
      const fade = life[i] / this.maxLife[i];
      // Alpha is packed with a flag: values in [2, 3) are emissive, [0, 1) are lit.
      colors[i * 4 + 3] = this.baseAlpha[i] * fade + (this.additive[i] ? 2 : 0);
    }
    const geometry = this.particles.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aColor.needsUpdate = true;
    geometry.attributes.aSize.needsUpdate = true;

    this.skidMaterial.uniforms.uTime.value = this.time;
    if (this.skidDirty) {
      const skidGeometry = this.skids.geometry;
      skidGeometry.attributes.position.needsUpdate = true;
      skidGeometry.attributes.aBirth.needsUpdate = true;
      skidGeometry.attributes.aStrength.needsUpdate = true;
      this.skidDirty = false;
    }
  }

  /** Remove everything (new run). */
  clear() {
    this.life.fill(0);
    this.sizes.fill(0);
    this.skidBirth.fill(-1000);
    this.skidDirty = true;
    for (const trail of this.trails) trail.active = false;
  }

  dispose() {
    this.particles.geometry.dispose();
    this.particleMaterial.dispose();
    this.skids.geometry.dispose();
    this.skidMaterial.dispose();
    this.scene.remove(this.group);
  }
}
