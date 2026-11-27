import * as THREE from 'three';

// Working car lights, fitted to whatever model the car uses. Behaviour follows UN ECE practice:
// - Rear position (tail) lamps run with the headlights at about 4-12 cd; stop lamps are much brighter
//   (category S1: 60-185 cd, roughly 5-15x the tail), plus a centre high-mounted stop lamp (S3).
// - Reversing lamps are white (R23, at least 80 cd) and light the ground behind the car.
// - Dipped beam (low) aims slightly down with a cut-off and reaches about 65-100 m; main beam (high)
//   has no cut-off and reaches well beyond 100 m. Halogen is warm (~3,200 K), LED cool white (~5,500 K+).
// Headlight modes: 0 off, 1 low (dipped), 2 high (main).

const HEAD = Object.freeze({
  halogen: 0xffe2b4,
  led: 0xf1f5ff,
});
// Per car: the lamp technology its era and class would carry.
const LAMP_TECH = Object.freeze({ hatch: 'halogen', tokyo: 'halogen', gt: 'led', thar: 'led', raijin: 'led' });

const LOW = Object.freeze({ intensity: 9000, distance: 110, angle: 34, penumbra: 0.62, drop: 0.75, reach: 34, spread: 0.7, lens: 2.6 });
const HIGH = Object.freeze({ intensity: 26000, distance: 240, angle: 20, penumbra: 0.4, drop: 0.15, reach: 70, spread: 0.25, lens: 3.6 });

// Lens emissive levels (relative brightness under bloom). Brake ~5x tail, as on the road.
const TAIL_OFF = 0.18;
const TAIL_ON = 0.95;
const BRAKE = 4.8;
const REVERSE = 3.2;

const point = new THREE.Vector3();

/**
 * Lamp positions from the vertices of every mesh drawn with one of `materials`, split front/rear and
 * left/right. Vertices, not mesh boxes: a procedural car merges both lamps (and its fog lamps) into one
 * mesh. Each cluster gives its mean x, its mean height (of the upper half when a fog lamp sits below
 * the main lamp) and its outermost face (5th percentile, so one stray vertex does not move it).
 */
function lampClusters(model, materials) {
  const clusters = new Map();
  model.updateMatrixWorld(true);
  const toModel = model.matrixWorld.clone().invert();
  const matrix = new THREE.Matrix4();
  model.traverse((node) => {
    if (!node.isMesh || !materials.has(node.material)) return;
    const positions = node.geometry.attributes.position;
    matrix.multiplyMatrices(toModel, node.matrixWorld);
    for (let i = 0; i < positions.count; i += 1) {
      point.fromBufferAttribute(positions, i).applyMatrix4(matrix);
      const key = `${point.z < 0 ? 'front' : 'rear'}:${point.x < 0 ? -1 : 1}`;
      if (!clusters.has(key)) clusters.set(key, { x: [], y: [], z: [] });
      const c = clusters.get(key);
      c.x.push(point.x);
      c.y.push(point.y);
      c.z.push(point.z);
    }
  });
  const anchors = new Map();
  for (const [key, c] of clusters) {
    const mean = (a) => a.reduce((sum, v) => sum + v, 0) / a.length;
    const ys = [...c.y].sort((a, b) => a - b);
    const zs = [...c.z].sort((a, b) => a - b);
    const front = key.startsWith('front');
    const z = zs[Math.round((front ? 0.05 : 0.95) * (zs.length - 1))];
    // A tall cluster holds a main lamp and a fog lamp below it: take the upper half.
    const y = ys[ys.length - 1] - ys[0] > 0.2 ? mean(ys.slice(Math.floor(ys.length / 2))) : mean(ys);
    anchors.set(key, new THREE.Vector3(mean(c.x), y, z));
  }
  return anchors;
}

/** A soft round glow for lamp halos. */
function haloTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
      const a = Math.max(0, 1 - d) ** 2.2;
      data.set([255, 255, 255, Math.round(a * 255)], (y * size + x) * 4);
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.needsUpdate = true;
  return tex;
}

/** Where a ray from behind (+Z) at (x, y) first meets the body, or null. */
function rearSurface(model, x, y, raycaster) {
  raycaster.set(new THREE.Vector3(x, y, 20), new THREE.Vector3(0, 0, -1));
  const meshes = [];
  model.traverse((node) => { if (node.isMesh && node.visible) meshes.push(node); });
  const hit = raycaster.intersectObjects(meshes, false)[0];
  return hit ? hit.point.z : null;
}

export class CarLights {
  /**
   * @param {THREE.Object3D} model  The car model (ProceduralCar or ModelCar), at the origin, unrotated.
   * @param {string} carId
   */
  constructor(model, carId) {
    this.model = model;
    this.mode = 0;
    this.night = false;
    this.braking = 0;
    this.reversing = 0;
    this.disposables = [];
    const tech = LAMP_TECH[carId] || 'halogen';
    this.headColor = HEAD[tech];

    // Lamp materials the model already has.
    this.lenses = [...(model.lensMaterials || [])];
    if (!this.lenses.length && model.headlampMaterial) this.lenses.push(model.headlampMaterial);
    this.tails = [model.tailMaterial].filter(Boolean);
    this.reverses = [model.reverseLampMaterial].filter(Boolean);
    for (const m of this.lenses) m.userData.idleEmissive ??= m.emissiveIntensity;

    // Find the lamps on the body; fall back to the body's corners when a model has no lamp parts.
    const body = new THREE.Box3().setFromObject(model);
    const size = body.getSize(new THREE.Vector3());
    const heads = lampClusters(model, new Set(this.lenses));
    const tails = lampClusters(model, new Set(this.tails));
    const anchor = (clusters, end, side) => {
      const found = clusters.get(`${end}:${side}`);
      if (found) return found.clone();
      return new THREE.Vector3(side * size.x * 0.33, body.min.y + size.y * (end === 'front' ? 0.42 : 0.5),
        end === 'front' ? body.min.z : body.max.z);
    };
    this.front = [-1, 1].map((side) => anchor(heads, 'front', side));
    this.rear = [-1, 1].map((side) => anchor(tails, 'rear', side));

    // Headlights: one spot per lamp, re-aimed and re-shaped for low or high beam.
    this.beams = this.front.map((p, k) => {
      const light = new THREE.SpotLight(this.headColor, 0, LOW.distance, THREE.MathUtils.degToRad(LOW.angle), LOW.penumbra, 2);
      light.position.set(p.x, p.y, p.z - 0.05);
      light.userData.side = k === 0 ? -1 : 1;
      light.castShadow = false;
      model.add(light, light.target);
      return light;
    });

    // Red stop-lamp light and white reversing light thrown onto the road behind. Spots that start just
    // behind the bumper and point away, so they light the ground, not the car's own rear panel.
    const mid = this.rear[0].clone().add(this.rear[1]).multiplyScalar(0.5);
    this.tailGlow = new THREE.SpotLight(0xff1a10, 0, 9, THREE.MathUtils.degToRad(62), 0.9, 2);
    this.tailGlow.position.set(mid.x, mid.y, mid.z + 0.25);
    this.tailGlow.target.position.set(mid.x, -0.4, mid.z + 4);
    this.reverseLight = new THREE.SpotLight(0xf4f6ff, 0, 16, THREE.MathUtils.degToRad(60), 0.8, 2);
    this.reverseLight.position.set(mid.x, mid.y - 0.15, mid.z + 0.25);
    this.reverseLight.target.position.set(mid.x, -0.6, mid.z + 9);
    model.add(this.tailGlow, this.tailGlow.target, this.reverseLight, this.reverseLight.target);

    // Glow halos: lamps read as bright even without bloom (Low and Medium quality have none).
    const halo = this.own(haloTexture());
    const sprite = (color, x, y, z, size) => {
      const material = this.own(new THREE.SpriteMaterial({ map: halo, color, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false }));
      const s = new THREE.Sprite(material);
      s.scale.setScalar(size);
      this.attach(s, x, y, z);
      return s;
    };
    this.halos = {
      head: this.front.map((p) => sprite(this.headColor, p.x, p.y, p.z - 0.06, 0.9)),
      tail: this.rear.map((p) => sprite(0xff1a12, p.x, p.y, p.z + 0.06, 0.75)),
      reverse: this.rear.map((p) => sprite(0xf4f6ff, p.x * 0.6, p.y - 0.1, p.z + 0.06, 0.5)),
    };

    const raycaster = new THREE.Raycaster();
    // Reversing lamps on models that have no reversing-lamp parts: two small white lenses inboard of the tails.
    if (!this.hasMeshWith(this.reverses)) {
      const lens = this.own(new THREE.MeshStandardMaterial({ color: 0x8c8f94, emissive: 0xf4f6ff, emissiveIntensity: 0, roughness: 0.15 }));
      const geometry = this.own(new THREE.PlaneGeometry(0.13, 0.05));
      for (const p of this.rear) {
        const x = p.x * 0.6;
        const y = p.y - 0.1;
        const z = rearSurface(model, x, y, raycaster);
        if (z === null) continue;
        const mesh = new THREE.Mesh(geometry, lens);
        this.attach(mesh, x, y, z + 0.006);
      }
      this.reverses = [lens];
    }
    // Centre high-mounted stop lamp, on the body high on the tail, where a ray from behind meets it.
    const highY = mid.y + (body.max.y - mid.y) * 0.6;
    const highZ = rearSurface(model, 0, highY, raycaster);
    this.highStop = this.own(new THREE.MeshStandardMaterial({ color: 0x3a0606, emissive: 0xff1410, emissiveIntensity: 0, roughness: 0.2 }));
    if (highZ !== null) {
      const bar = new THREE.Mesh(this.own(new THREE.PlaneGeometry(Math.min(0.5, size.x * 0.28), 0.035)), this.highStop);
      this.attach(bar, 0, highY, highZ + 0.008);
      this.halos.high = [sprite(0xff1a12, 0, highY, highZ + 0.05, 0.6)];
    }
    this.aim(LOW);
    this.apply();
  }

  /** Parent a lamp to the body shell (it rolls and pitches with the suspension) at a model-space point. */
  attach(mesh, x, y, z) {
    const parent = this.model.chassis || this.model;
    this.model.updateMatrixWorld(true);
    mesh.position.copy(parent.worldToLocal(new THREE.Vector3(x, y, z)));
    parent.add(mesh);
  }

  own(item) {
    this.disposables.push(item);
    return item;
  }

  hasMeshWith(materials) {
    const set = new Set(materials);
    let found = false;
    this.model.traverse((node) => { if (node.isMesh && set.has(node.material)) found = true; });
    return found;
  }

  aim(beam) {
    for (const light of this.beams) {
      const side = light.userData.side;
      light.angle = THREE.MathUtils.degToRad(beam.angle);
      light.penumbra = beam.penumbra;
      light.distance = beam.distance;
      // Dipped beam: a little down and out to the kerb side; main beam: level and parallel.
      light.target.position.set(light.position.x + side * beam.spread, light.position.y - beam.drop, light.position.z - beam.reach);
    }
  }

  /** 0 off, 1 low (dipped), 2 high (main). */
  setHeadlights(mode) {
    this.mode = Math.max(0, Math.min(2, Number(mode) || 0));
    if (this.mode) this.aim(this.mode === 2 ? HIGH : LOW);
    this.apply();
  }

  /** Next mode for the lamp switch: off, low, high, off. */
  cycle() {
    this.setHeadlights((this.mode + 1) % 3);
    return this.mode;
  }

  /**
   * @param {{braking:boolean, reversing:boolean, night:boolean}} state
   * @param {number} dt
   */
  update({ braking, reversing, night }, dt) {
    // LED lamps snap on; incandescent filaments take ~0.1-0.2 s. A short ease keeps flicker out.
    const rate = 1 - Math.exp(-dt * 40);
    this.braking += ((braking ? 1 : 0) - this.braking) * rate;
    this.reversing += ((reversing ? 1 : 0) - this.reversing) * rate;
    this.night = night;
    this.apply();
  }

  apply() {
    const on = this.mode > 0;
    const beam = this.mode === 2 ? HIGH : LOW;
    for (const light of this.beams) light.intensity = on ? beam.intensity : 0;
    for (const m of this.lenses) m.emissiveIntensity = on ? beam.lens : (m.userData.idleEmissive ?? 0.15);
    // Tail lamps light with the headlights (or at night); the brake lamps add on top.
    const tail = on || this.night ? TAIL_ON : TAIL_OFF;
    const level = tail + (BRAKE - tail) * this.braking;
    for (const m of this.tails) m.emissiveIntensity = level;
    this.highStop.emissiveIntensity = BRAKE * 1.1 * this.braking;
    for (const m of this.reverses) m.emissiveIntensity = REVERSE * this.reversing;
    // Light thrown on the road: stop lamps ~100 cd, reversing lamps ~150 cd (tails are too weak to matter).
    this.tailGlow.intensity = 100 * this.braking;
    this.reverseLight.intensity = 150 * this.reversing;
    // Halos: faint around running tails, bright on the brake (about 5x), white on reverse and headlamps.
    const taillit = on || this.night ? 0.18 : 0;
    for (const s of this.halos.tail) s.material.opacity = taillit + (0.95 - taillit) * this.braking;
    for (const s of this.halos.high || []) s.material.opacity = 0.9 * this.braking;
    for (const s of this.halos.reverse) s.material.opacity = 0.85 * this.reversing;
    for (const s of this.halos.head) {
      s.material.opacity = on ? (this.mode === 2 ? 0.95 : 0.6) : 0;
      s.scale.setScalar(this.mode === 2 ? 1.25 : 0.9);
    }
  }

  dispose() {
    for (const item of this.disposables) item.dispose?.();
  }
}
