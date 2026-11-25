import * as THREE from 'three';

// Crash damage for the player's car: dents pressed into the body where it hit, parts knocked off onto
// the road (bumper covers, splitters, mirrors, lens and glass shards, paint chips), and per-zone damage
// that the driving model reads (steering pull, lost power, engine smoke).
//
// Crush follows real barrier tests: it grows about linearly with impact speed above ~8 km/h
// (2.2 m/s); a 50 km/h hit crushes roughly 0.5-0.6 m. Debris keeps most of the car's own velocity
// plus a small kick off the wall, tumbles, bounces low, slides and settles flat.

const CRUSH_START = 2.2; // m/s of closing speed before panels start to dent
const CRUSH_PER_MPS = 0.045; // metres of crush per m/s above that
const MAX_CRUSH = 0.55; // per hit
const MAX_TOTAL = 0.6; // per vertex, all hits together
const HIT_COOLDOWN = 0.12;
const DEBRIS_LIFE = 30; // seconds a piece stays on the road
const GRAVITY = 9.81;

/** Debris kinds: size (x, y, z metres), mass feel, how they move. */
const KINDS = {
  panel: { size: [1.05, 0.05, 0.24], max: 6, restitution: 0.18, slide: 1.6, spin: 5 },
  mirror: { size: [0.2, 0.11, 0.09], max: 6, restitution: 0.3, slide: 3.5, spin: 14 },
  chip: { size: [0.15, 0.012, 0.1], max: 90, restitution: 0.25, slide: 4.5, spin: 18 },
  plastic: { size: [0.24, 0.022, 0.09], max: 70, restitution: 0.22, slide: 3.2, spin: 14 },
  glass: { size: [0.05, 0.006, 0.04], max: 160, restitution: 0.35, slide: 6, spin: 24 },
  lensFront: { size: [0.07, 0.009, 0.05], max: 60, restitution: 0.3, slide: 5, spin: 20 },
  lensRear: { size: [0.07, 0.009, 0.05], max: 60, restitution: 0.3, slide: 5, spin: 20 },
};

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _local = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qFlat = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _ground = { normal: { x: 0, y: 1, z: 0 } };

const smooth = (t) => t * t * (3 - 2 * t);
// Position hash in [0, 1): vertices that share a position (UV seams) move together, so dents don't tear.
const hash = (x, y, z, k) => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + k * 19.3) * 43758.5453; return h - Math.floor(h); };
const rand = (a, b) => a + Math.random() * (b - a);

class DebrisField {
  constructor(scene, world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'CrashDebris';
    scene.add(this.group);
    this.paint = new THREE.MeshStandardMaterial({ color: 0xd62828, metalness: 0.35, roughness: 0.35 });
    const materials = {
      panel: this.paint,
      mirror: this.paint,
      chip: this.paint,
      plastic: new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.8 }),
      glass: new THREE.MeshStandardMaterial({ color: 0xbcd6e6, metalness: 0.6, roughness: 0.08, transparent: true, opacity: 0.7 }),
      lensFront: new THREE.MeshStandardMaterial({ color: 0xf4f1e4, emissive: 0x6b5f3a, roughness: 0.15, transparent: true, opacity: 0.85 }),
      lensRear: new THREE.MeshStandardMaterial({ color: 0xa3121a, emissive: 0x4a0508, roughness: 0.2, transparent: true, opacity: 0.9 }),
    };
    this.materials = Object.values(materials);
    this.pools = {};
    for (const [kind, spec] of Object.entries(KINDS)) {
      const geometry = new THREE.BoxGeometry(...spec.size);
      const mesh = new THREE.InstancedMesh(geometry, materials[kind], spec.max);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = kind === 'panel' || kind === 'mirror';
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.pools[kind] = { spec, mesh, items: [], cursor: 0 };
    }
  }

  setPaint(color) {
    this.paint.color.copy(color);
  }

  /** Throw one piece from `pos` with velocity `vel` (world space). */
  spawn(kind, pos, vel) {
    const pool = this.pools[kind];
    const { spec } = pool;
    let item;
    if (pool.items.length < spec.max) {
      item = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), spin: new THREE.Vector3(), life: 0, resting: false };
      pool.items.push(item);
    } else {
      item = pool.items[pool.cursor];
      pool.cursor = (pool.cursor + 1) % spec.max;
    }
    item.pos.copy(pos);
    item.vel.copy(vel);
    item.quat.setFromEuler(_e.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28)));
    item.spin.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(spec.spin);
    item.life = DEBRIS_LIFE * rand(0.85, 1.1);
    item.resting = false;
    item.half = spec.size[1] * 0.5;
    pool.mesh.count = pool.items.length;
  }

  update(dt) {
    for (const pool of Object.values(this.pools)) {
      const { spec, mesh, items } = pool;
      if (!items.length) continue;
      let dirty = false;
      for (let i = 0; i < items.length; i += 1) {
        const it = items[i];
        if (it.life <= 0) continue;
        it.life -= dt;
        dirty = true;
        if (!it.resting) {
          it.vel.y -= GRAVITY * dt;
          it.pos.addScaledVector(it.vel, dt);
          _q.setFromEuler(_e.set(it.spin.x * dt, it.spin.y * dt, it.spin.z * dt));
          it.quat.multiply(_q);
          this.world.sampleGround(it.pos.x, it.pos.z, _ground);
          const floor = _ground.y + it.half;
          if (it.pos.y < floor) {
            it.pos.y = floor;
            if (it.vel.y < 0) it.vel.y = -it.vel.y * spec.restitution;
            // Sliding friction on the road, and the tumble dies on each touch.
            const h = Math.hypot(it.vel.x, it.vel.z);
            if (h > 1e-4) {
              const k = Math.max(0, 1 - (spec.slide * dt) / h);
              it.vel.x *= k;
              it.vel.z *= k;
            }
            it.spin.multiplyScalar(Math.max(0, 1 - 6 * dt));
            // Lie flat once it has nearly stopped, keeping its heading.
            if (h < 0.35 && Math.abs(it.vel.y) < 0.6) {
              _e.setFromQuaternion(it.quat, 'YXZ');
              _qFlat.setFromEuler(_e.set(0, _e.y, 0, 'YXZ'));
              it.quat.slerp(_qFlat, Math.min(1, dt * 8));
              if (h < 0.05 && it.quat.angleTo(_qFlat) < 0.02) {
                it.quat.copy(_qFlat);
                it.vel.set(0, 0, 0);
                it.resting = true;
              }
            }
          }
        }
        // The last second it shrinks away.
        const fade = Math.min(1, Math.max(0, it.life));
        _s.setScalar(fade);
        mesh.setMatrixAt(i, _m.compose(it.pos, it.quat, _s));
      }
      if (dirty) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  clear() {
    for (const pool of Object.values(this.pools)) {
      pool.items.length = 0;
      pool.cursor = 0;
      pool.mesh.count = 0;
    }
  }

  dispose() {
    this.group.parent?.remove(this.group);
    for (const pool of Object.values(this.pools)) pool.mesh.geometry.dispose();
    for (const material of new Set(this.materials)) material.dispose();
  }
}

export class CarDamage {
  /**
   * @param {{scene: THREE.Scene, world: {sampleGround: Function}, effects?: object}} options
   */
  constructor({ scene, world, effects = null }) {
    this.effects = effects;
    this.debris = new DebrisField(scene, world);
    this.car = null;
    this.meshes = [];
    this.cooldown = 0;
    this.smokeClock = 0;
    this.zones = { front: 0, rear: 0, left: 0, right: 0 };
    this.lost = new Set();
  }

  /** Follow a (new) car visual. Damage carries over only within one car. */
  attach(carVisual) {
    this.repair();
    this.car = carVisual;
    this.meshes = [];
    const skip = new Set();
    carVisual.cockpit?.traverse((o) => skip.add(o));
    carVisual.model.chassis.traverse((o) => {
      if (o.isMesh && !skip.has(o) && o.geometry?.attributes?.position) this.meshes.push({ mesh: o, original: null, offsets: null });
    });
  }

  /** 0 (pristine) .. 1 (wrecked), for the HUD or audio. */
  get level() {
    const z = this.zones;
    return Math.min(1, Math.max(z.front, z.rear, z.left, z.right));
  }

  /** Drive multiplier: a crushed nose (radiator, intake) costs up to 30 % power. */
  get powerFactor() {
    return 1 - 0.3 * this.zones.front;
  }

  /** Bent front suspension pulls the steering toward the damaged side (-1 .. 1 steer units). */
  get steerPull() {
    return (this.zones.left - this.zones.right) * 0.07 * Math.min(1, this.zones.front + 0.4);
  }

  /** Per frame, after the physics step. */
  update(dt, state) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (state && state.impact > CRUSH_START + 1.3 && this.cooldown === 0) this.hit(state);
    this.debris.update(dt);
    // A badly crushed nose steams: grey wisps from under the bonnet.
    if (state && this.effects && this.zones.front > 0.55 && this.car) {
      this.smokeClock += dt * 14 * (this.zones.front - 0.45);
      while (this.smokeClock >= 1) {
        this.smokeClock -= 1;
        _v.set(rand(-0.35, 0.35), 0.85, -1.45).applyQuaternion(state.quaternion).add(state.position);
        this.effects.spawn('wisp', _v.x, _v.y, _v.z, state.velocity.x * 0.6, 0.9, state.velocity.z * 0.6, 0.7);
      }
    }
  }

  /** Dent the body and shed parts for this frame's impact. */
  hit(state) {
    const car = this.car;
    if (!car) return;
    this.cooldown = HIT_COOLDOWN;
    const speed = state.impact;
    const p = state.impactPoint;
    _n.set(state.impactNormal.x, 0, state.impactNormal.z);
    if (_n.lengthSq() < 1e-6) return;
    _n.normalize();
    const crush = Math.min(MAX_CRUSH, CRUSH_PER_MPS * (speed - CRUSH_START));
    if (crush <= 0) return;

    // Where on the car: the hit point in car space.
    const model = car.model;
    model.updateWorldMatrix(true, true);
    _local.set(p.x, p.y, p.z).applyMatrix4(_inv.copy(model.matrixWorld).invert());
    const zone = _local.z < -1.0 ? 'front' : _local.z > 1.0 ? 'rear' : _local.x < 0 ? 'left' : 'right';
    const severity = Math.min(1, (speed - CRUSH_START) / 16);
    this.zones[zone] = Math.min(1, this.zones[zone] + severity * 0.55);
    // A corner hit also bends that side.
    if (zone === 'front' || zone === 'rear') {
      const side = _local.x < -0.4 ? 'left' : _local.x > 0.4 ? 'right' : null;
      if (side) this.zones[side] = Math.min(1, this.zones[side] + severity * 0.25);
    }

    this.hits = (this.hits || 0) + 1;
    this.dent(p, _n, crush, 0.42 + speed * 0.025);
    this.shed(state, zone, speed);
  }

  /** Push body vertices near `point` along `dir` (world space), with a smooth falloff and crumple noise. */
  dent(point, dir, depth, radius) {
    for (const entry of this.meshes) {
      const mesh = entry.mesh;
      const geometry = mesh.geometry;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      mesh.getWorldScale(_s);
      const scale = (Math.abs(_s.x) + Math.abs(_s.y) + Math.abs(_s.z)) / 3 || 1;
      _inv.copy(mesh.matrixWorld).invert();
      _local.set(point.x, point.y, point.z).applyMatrix4(_inv);
      const bs = geometry.boundingSphere;
      const rLocal = radius / scale;
      if (_local.distanceTo(bs.center) > bs.radius + rLocal) continue;
      // Own a copy of shared geometry before changing it; keep the original for repair.
      if (!entry.original) {
        entry.original = geometry;
        mesh.geometry = geometry.clone();
        entry.offsets = new Float32Array(mesh.geometry.attributes.position.count);
      }
      const pos = mesh.geometry.attributes.position;
      _v.copy(dir).transformDirection(_inv);
      const push = depth / scale;
      let moved = false;
      for (let i = 0; i < pos.count; i += 1) {
        const dx = pos.getX(i) - _local.x;
        const dy = pos.getY(i) - _local.y;
        const dz = pos.getZ(i) - _local.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d >= rLocal) continue;
        const room = MAX_TOTAL / scale - entry.offsets[i];
        if (room <= 0) continue;
        const f = smooth(1 - d / rLocal);
        // Crumple: panels fold unevenly rather than pressing in like a stamp.
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const qx = Math.round(x * 400) / 400;
        const qy = Math.round(y * 400) / 400;
        const qz = Math.round(z * 400) / 400;
        const amount = Math.min(room, push * f * f * (0.7 + hash(qx, qy, qz, this.hits) * 0.3));
        const wob = amount * 0.18;
        pos.setXYZ(i,
          x + _v.x * amount + (hash(qx, qy, qz, 1) - 0.5) * wob,
          y + _v.y * amount + (hash(qx, qy, qz, 2) - 0.5) * wob - amount * 0.12,
          z + _v.z * amount + (hash(qx, qy, qz, 3) - 0.5) * wob);
        entry.offsets[i] += amount;
        moved = true;
      }
      if (moved) {
        pos.needsUpdate = true;
        mesh.geometry.computeBoundingSphere();
      }
    }
  }

  /** Knock parts off: bumper / splitter on a big nose or tail hit, mirrors on the sides, shards always. */
  shed(state, zone, speed) {
    const debris = this.debris;
    debris.setPaint(this.car.model.color || new THREE.Color(0xd62828));
    const p = state.impactPoint;
    const v = state.velocity;
    const n = state.impactNormal;
    const throwPiece = (kind, keep, kick, lift) => {
      _v.set(p.x + rand(-0.2, 0.2), p.y + rand(0, 0.25), p.z + rand(-0.2, 0.2));
      _s.set(
        v.x * keep + n.x * kick * rand(0.4, 1) + rand(-1, 1) * kick * 0.5,
        rand(0.4, 1) * lift,
        v.z * keep + n.z * kick * rand(0.4, 1) + rand(-1, 1) * kick * 0.5,
      );
      debris.spawn(kind, _v, _s);
    };
    const energy = Math.min(1.5, (speed - CRUSH_START) / 10);
    // Shards and chips on every real hit: lens on the nose/tail, glass and paint on the sides.
    const shards = Math.round(4 + energy * 16);
    const lens = zone === 'front' ? 'lensFront' : zone === 'rear' ? 'lensRear' : null;
    for (let i = 0; i < shards; i += 1) {
      const r = Math.random();
      const kind = lens && r < 0.45 ? lens : r < 0.7 ? 'chip' : r < 0.85 ? 'plastic' : 'glass';
      throwPiece(kind, rand(0.55, 0.85), 2.5 + energy * 3, 1.5 + energy * 3);
    }
    // Bumper cover first, then the splitter / diffuser, each once per car until repaired.
    if ((zone === 'front' || zone === 'rear') && this.zones[zone] > 0.35) {
      const parts = zone === 'front' ? ['frontBumper', 'splitter'] : ['rearBumper', 'diffuser'];
      for (const part of parts) {
        if (this.lost.has(part)) continue;
        this.lost.add(part);
        throwPiece(part === 'splitter' || part === 'diffuser' ? 'plastic' : 'panel', rand(0.6, 0.8), 2 + energy * 2, 1 + energy * 2);
        for (let i = 0; i < 6; i += 1) throwPiece('plastic', rand(0.6, 0.85), 2 + energy * 2, 1 + energy * 2);
        break;
      }
    }
    if ((zone === 'left' || zone === 'right') && speed > 6 && !this.lost.has(`mirror-${zone}`)) {
      this.lost.add(`mirror-${zone}`);
      throwPiece('mirror', rand(0.6, 0.85), 3 + energy * 2, 2 + energy * 2);
      for (let i = 0; i < 8; i += 1) throwPiece('glass', rand(0.6, 0.85), 3, 2);
    }
  }

  /** Undo every dent and forget the damage (respawn, new run, car change). Debris on the road stays. */
  repair() {
    for (const entry of this.meshes) {
      if (!entry.original) continue;
      entry.mesh.geometry.dispose();
      entry.mesh.geometry = entry.original;
      entry.original = null;
      entry.offsets = null;
    }
    this.zones.front = this.zones.rear = this.zones.left = this.zones.right = 0;
    this.lost.clear();
    this.smokeClock = 0;
  }

  /** New run: also sweep the road. */
  reset() {
    this.repair();
    this.debris.clear();
  }

  dispose() {
    this.repair();
    this.debris.dispose();
  }
}
