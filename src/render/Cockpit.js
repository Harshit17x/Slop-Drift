import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// A stripped drift-car interior for the cockpit camera, in the car's chassis space
// (x right, y up, front toward -z; the driver sits on the left at x = -0.37).
// Static trim is merged into one mesh per material; the steering wheel, the driver's arms and hands,
// the shifter and the hydraulic handbrake move every frame, and the gauge cluster is a live canvas.

const DRIVER_X = -0.37;
export const COCKPIT_EYE = Object.freeze({ x: DRIVER_X, y: 1.03, z: 0.31 });

const WHEEL_RADIUS = 0.172;
const WHEEL_RATIO = 3.4; // steering-wheel turn per radian of road-wheel angle (display only)
const WHEEL_MAX = 2.7; // radians either way
const UPPER_ARM = 0.31;
const FOREARM = 0.31;

// Hands hold the rim at quarter to three; past these angles (clockwise from 12 o'clock, seen by the
// driver) a hand palms: it slides along the rim instead of following it round.
const GRIP = Object.freeze({
  left: { home: -Math.PI / 2, min: -2.85, max: -0.3 },
  right: { home: Math.PI / 2, min: 0.3, max: 2.85 },
});

// Gear lever knob offsets (x across, z along) in the H-gate, relative to neutral.
const GATE = Object.freeze({
  N: [0, 0], 1: [-0.042, -0.05], 2: [-0.042, 0.05], 3: [0, -0.05], 4: [0, 0.05], 5: [0.042, -0.05], 6: [0.042, 0.05], R: [0.084, 0.05],
});

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _perp = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _wristEnd = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

/** Extrude a side profile ([z, y] pairs) across x from x0 to x1. */
function extrudeAcross(points, x0, x1) {
  const shape = new THREE.Shape();
  points.forEach(([z, y], i) => (i === 0 ? shape.moveTo(-z, y) : shape.lineTo(-z, y)));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, curveSegments: 6 });
  geometry.rotateY(Math.PI / 2);
  geometry.translate(x0, 0, 0);
  return geometry;
}

/** A round tube from a to b. */
function tube(a, b, radius, segments = 10) {
  const direction = new THREE.Vector3().subVectors(b, a);
  const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), segments, 1, false);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, direction.normalize()));
  geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geometry;
}

function canvasTexture(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { canvas, context: canvas.getContext('2d'), texture };
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Cockpit extends THREE.Group {
  /**
   * @param {object} options
   * @param {THREE.Material} [options.paint]  The car's body paint, for the bonnet seen through the glass.
   * @param {THREE.Material} [options.stripe] The livery stripe material.
   */
  constructor({ paint = null, stripe = null } = {}) {
    super();
    this.name = 'DriftCockpit';
    this.visible = false;
    this.materials = [];
    this.textures = [];
    this.statics = new Map();
    this.paint = paint;
    this.stripe = stripe;
    this.wheelTurn = 0;
    this.gripAngles = { left: GRIP.left.home, right: GRIP.right.home };
    this.shiftTimer = 0;
    this.handbrakeBlend = 0;
    this.leverPull = 0;
    this.knob = new THREE.Vector2();
    this.gaugeClock = 0;
    this.auxClock = 0;
    this.lastGear = 'N';
    this.shownRpm = 0;
    this.build();
  }

  mat(parameters, basic = false) {
    const material = basic ? new THREE.MeshBasicMaterial(parameters) : new THREE.MeshStandardMaterial(parameters);
    this.materials.push(material);
    return material;
  }

  /** Queue a static geometry for merging. */
  add_(geometry, material) {
    if (!this.statics.has(material)) this.statics.set(material, []);
    this.statics.get(material).push(geometry);
  }

  boxGeo(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
    const geometry = new THREE.BoxGeometry(w, h, d);
    if (rx || ry || rz) geometry.rotateX(rx).rotateY(ry).rotateZ(rz);
    geometry.translate(x, y, z);
    return geometry;
  }

  mesh(geometry, material, parent = this, { cast = false } = {}) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  build() {
    const dash = this.mat({ color: 0x1b1d20, roughness: 0.88, metalness: 0.05 });
    const trim = this.mat({ color: 0x26292d, roughness: 0.7, metalness: 0.1 });
    const headliner = this.mat({ color: 0x2b2d30, roughness: 0.95 });
    const carpet = this.mat({ color: 0x121315, roughness: 1 });
    const cage = this.mat({ color: 0x2e8b5e, roughness: 0.42, metalness: 0.35 });
    const pad = this.mat({ color: 0x0f1011, roughness: 0.9 });
    const metal = this.mat({ color: 0xb7bcc2, roughness: 0.25, metalness: 0.9 });
    const suede = this.mat({ color: 0x151515, roughness: 0.97 });
    const seat = this.mat({ color: 0x18191b, roughness: 0.92 });
    const red = this.mat({ color: 0xc8321e, roughness: 0.45, metalness: 0.2 });
    const marigold = this.mat({ color: 0xf2b01e, roughness: 0.5 });
    const glove = this.mat({ color: 0x141516, roughness: 0.8 });
    const gloveAccent = this.mat({ color: 0xc8321e, roughness: 0.6 });
    const sleeve = this.mat({ color: 0x1f3a2b, roughness: 0.85 });
    const sleeveCuff = this.mat({ color: 0x14110d, roughness: 0.9 });
    const mirrorGlass = this.mat({ color: 0x2a3036, roughness: 0.1, metalness: 0.6 });
    this.cageMaterial = cage;

    // ---- bonnet seen through the windscreen (body paint), wipers at its base
    if (this.paint) {
      const bonnet = new THREE.BoxGeometry(1.62, 0.02, 1.3);
      bonnet.rotateX(-Math.atan2(0.82 - 0.67, 2.08 - 0.8));
      bonnet.translate(0, 0.745, -1.44);
      this.add_(bonnet, this.paint);
    }
    if (this.stripe) {
      for (const x of [-0.17, 0.17]) {
        const stripe = new THREE.BoxGeometry(0.16, 0.022, 1.2);
        stripe.rotateX(-Math.atan2(0.82 - 0.67, 2.08 - 0.8));
        stripe.translate(x, 0.752, -1.46);
        this.add_(stripe, this.stripe);
      }
    }
    for (const x of [-0.35, 0.22]) this.add_(this.boxGeo(0.62, 0.012, 0.018, x, 0.83, -0.84, 0, 0.08, 0.04), pad);

    // ---- dashboard: cowl under the glass, a flat top, a lip and a face that drops toward the floor
    const dashProfile = [[-0.84, 0.82], [-0.6, 0.875], [-0.42, 0.88], [-0.37, 0.86], [-0.345, 0.78], [-0.34, 0.6], [-0.42, 0.42], [-0.86, 0.42]];
    this.add_(extrudeAcross(dashProfile, -0.76, 0.76), dash);
    // Instrument binnacle: a hood over the cluster in front of the driver.
    this.add_(this.boxGeo(0.42, 0.016, 0.17, DRIVER_X, 0.955, -0.46, -0.16), dash);
    for (const side of [-1, 1]) this.add_(this.boxGeo(0.016, 0.085, 0.16, DRIVER_X + side * 0.205, 0.915, -0.46, -0.16), dash);
    this.add_(this.boxGeo(0.42, 0.09, 0.02, DRIVER_X, 0.905, -0.535, -0.16), dash);
    // Steering column shroud.
    this.add_(tube(V(DRIVER_X, 0.7, -0.42), V(DRIVER_X, 0.735, -0.25), 0.045, 12), trim);
    // Centre stack, switch panel with a red ignition button and toggles.
    this.add_(this.boxGeo(0.28, 0.32, 0.06, 0.0, 0.6, -0.33), trim);
    this.add_(this.boxGeo(0.22, 0.05, 0.012, 0.0, 0.53, -0.297), pad);
    for (let i = 0; i < 4; i += 1) this.add_(this.boxGeo(0.014, 0.03, 0.02, -0.07 + i * 0.03, 0.47, -0.293), metal);
    const button = new THREE.CylinderGeometry(0.018, 0.018, 0.02, 14);
    button.rotateX(Math.PI / 2);
    button.translate(0.08, 0.47, -0.292);
    this.add_(button, red);
    // Rear-view mirror.
    this.add_(this.boxGeo(0.2, 0.058, 0.022, 0.0, 1.17, -0.26, -0.12), pad);
    this.add_(this.boxGeo(0.184, 0.044, 0.004, 0.0, 1.168, -0.247, -0.12), mirrorGlass);
    this.add_(tube(V(0, 1.2, -0.25), V(0, 1.24, -0.2), 0.008, 6), pad);

    // ---- pillars, header, roof lining, doors
    for (const side of [-1, 1]) {
      this.add_(tube(V(side * 0.75, 0.83, -0.79), V(side * 0.635, 1.245, -0.15), 0.038, 8), trim);
      this.add_(this.boxGeo(0.06, 0.45, 0.07, side * 0.7, 1.05, 0.34), trim); // B-pillar
      // Door card below the window line, a pull strap, the window ledge.
      this.add_(this.boxGeo(0.03, 0.58, 1.16, side * 0.765, 0.55, -0.18), dash);
      this.add_(this.boxGeo(0.07, 0.035, 1.16, side * 0.745, 0.845, -0.18), trim);
      this.add_(this.boxGeo(0.02, 0.025, 0.2, side * 0.735, 0.68, -0.05), red);
      // Rear quarter behind the B-pillar.
      this.add_(this.boxGeo(0.04, 0.8, 0.7, side * 0.75, 0.7, 0.72), dash);
    }
    this.add_(this.boxGeo(1.28, 0.05, 0.06, 0, 1.235, -0.15), trim); // header
    this.add_(this.boxGeo(1.3, 0.02, 1.2, 0, 1.252, 0.45), headliner);
    this.add_(this.boxGeo(1.56, 0.03, 1.8, 0, 0.13, -0.05), carpet);
    // Transmission tunnel and console.
    this.add_(this.boxGeo(0.24, 0.3, 0.75, 0.0, 0.33, 0.02), dash);
    this.add_(this.boxGeo(0.22, 0.02, 0.4, 0.0, 0.49, -0.05), trim);

    // ---- passenger bucket seat with harness, fire extinguisher
    const sx = 0.38;
    this.add_(this.boxGeo(0.46, 0.1, 0.48, sx, 0.36, 0.22), seat);
    this.add_(this.boxGeo(0.46, 0.72, 0.1, sx, 0.78, 0.5, -0.16), seat);
    for (const side of [-1, 1]) {
      this.add_(this.boxGeo(0.07, 0.62, 0.16, sx + side * 0.24, 0.74, 0.47, -0.16), seat);
      this.add_(this.boxGeo(0.07, 0.12, 0.44, sx + side * 0.24, 0.43, 0.22), seat);
      this.add_(this.boxGeo(0.05, 0.7, 0.008, sx + side * 0.09, 0.78, 0.44, -0.16), red);
    }
    this.add_(this.boxGeo(0.12, 0.04, 0.012, sx, 0.94, 0.43, -0.16), seat); // head slot
    const extinguisher = new THREE.CylinderGeometry(0.045, 0.045, 0.36, 14);
    extinguisher.rotateZ(Math.PI / 2);
    extinguisher.translate(0.3, 0.2, -0.28);
    this.add_(extinguisher, red);
    this.add_(this.boxGeo(0.06, 0.1, 0.1, 0.3, 0.2, -0.28), cage);

    // ---- roll cage (green, padded where a helmet could meet it)
    const r = 0.022;
    for (const side of [-1, 1]) {
      const footA = V(side * 0.68, 0.16, -0.66);
      const dashA = V(side * 0.69, 0.84, -0.7);
      const topA = V(side * 0.58, 1.205, -0.12);
      const topB = V(side * 0.56, 1.215, 0.6);
      const footB = V(side * 0.64, 0.16, 0.64);
      this.add_(tube(footA, dashA, r), cage);
      this.add_(tube(dashA, topA, r), cage);
      this.add_(tube(topA, topB, r), cage);
      this.add_(tube(topB, footB, r), cage);
      // Door bars: a horizontal and a diagonal.
      this.add_(tube(V(side * 0.7, 0.52, -0.66), V(side * 0.68, 0.6, 0.62), r), cage);
      this.add_(tube(V(side * 0.69, 0.2, -0.6), V(side * 0.67, 0.78, 0.6), r), cage);
    }
    this.add_(tube(V(-0.58, 1.205, -0.12), V(0.58, 1.205, -0.12), r), cage); // front hoop top
    this.add_(tube(V(-0.56, 1.215, 0.6), V(0.56, 1.215, 0.6), r), cage); // main hoop top
    this.add_(tube(V(-0.56, 1.215, 0.6), V(0.62, 0.2, 0.62), r), cage); // main hoop diagonal
    this.add_(tube(V(-0.69, 0.84, -0.7), V(0.69, 0.84, -0.7), r * 0.9), cage); // dash bar (just under the cowl)
    this.add_(tube(V(-0.6, 1.21, 0.0), V(-0.6, 1.21, 0.4), r + 0.012), pad); // padding above the driver

    // ---- sun strip across the top of the windscreen
    const strip = canvasTexture(1024, 96);
    {
      const c = strip.context;
      c.fillStyle = '#14110d';
      c.fillRect(0, 0, 1024, 96);
      c.fillStyle = '#f4f1e8';
      c.font = '700 64px Teko, Khand, system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('SLOP  DRIFT', 512, 52);
      c.fillStyle = '#f2b01e';
      c.fillRect(0, 88, 1024, 8);
    }
    this.textures.push(strip.texture);
    const stripMaterial = this.mat({ map: strip.texture, transparent: true, opacity: 0.94 }, true);
    const stripPlane = new THREE.PlaneGeometry(1.2, 0.055);
    // Lie along the inside of the glass (rising toward the rear), facing down and back at the driver.
    stripPlane.rotateX(Math.atan2(0.8 - 0.13, 1.27 - 0.82));
    stripPlane.translate(0, 1.228, -0.168);
    this.mesh(stripPlane, stripMaterial);

    // ---- steering wheel: mount (tilt) -> spin (turns with the steering)
    this.wheelMount = new THREE.Group();
    this.wheelMount.position.set(DRIVER_X, 0.745, -0.2);
    this.wheelMount.rotation.x = -0.42;
    this.add(this.wheelMount);
    this.wheel = new THREE.Group();
    this.wheelMount.add(this.wheel);
    this.mesh(new THREE.TorusGeometry(WHEEL_RADIUS, 0.019, 10, 40), suede, this.wheel, { cast: true });
    // Deep dish: three spokes run back from the rim to a hub set 6 cm toward the dash.
    for (const angle of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const from = V(Math.sin(angle) * (WHEEL_RADIUS - 0.01), Math.cos(angle) * (WHEEL_RADIUS - 0.01), 0);
      const to = V(Math.sin(angle) * 0.04, Math.cos(angle) * 0.04, -0.06);
      this.mesh(tube(from, to, 0.012, 8), metal, this.wheel);
    }
    const hub = new THREE.CylinderGeometry(0.048, 0.052, 0.035, 18);
    hub.rotateX(Math.PI / 2);
    hub.translate(0, 0, -0.065);
    this.mesh(hub, suede, this.wheel);
    const horn = new THREE.CylinderGeometry(0.02, 0.02, 0.012, 18);
    horn.rotateX(Math.PI / 2);
    horn.translate(0, 0, -0.045);
    this.mesh(horn, red, this.wheel);
    // Top-dead-centre stripe.
    this.mesh(this.boxGeo(0.022, 0.044, 0.044, 0, WHEEL_RADIUS, 0), marigold, this.wheel);

    // ---- gear lever (H-pattern) and hydraulic handbrake on the tunnel
    this.shifter = new THREE.Group();
    this.shifter.position.set(-0.02, 0.5, -0.14);
    this.add(this.shifter);
    const boot = new THREE.CylinderGeometry(0.02, 0.06, 0.07, 12);
    boot.translate(0, 0.035, 0);
    this.add_(boot.clone().translate(-0.02, 0.5, -0.14), pad);
    this.shiftStick = new THREE.Group();
    this.shifter.add(this.shiftStick);
    this.mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.25, 8).translate(0, 0.125, 0), metal, this.shiftStick);
    this.mesh(new THREE.SphereGeometry(0.03, 16, 12).translate(0, 0.265, 0), metal, this.shiftStick);
    this.knobLocal = V(0, 0.265, 0);

    this.handbrake = new THREE.Group();
    this.handbrake.position.set(0.1, 0.5, -0.1);
    this.add(this.handbrake);
    this.add_(this.boxGeo(0.05, 0.06, 0.12, 0.1, 0.52, -0.1), metal);
    this.handbrakeLever = new THREE.Group();
    this.handbrake.add(this.handbrakeLever);
    this.mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.34, 8).translate(0, 0.17, 0), metal, this.handbrakeLever);
    this.mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.1, 10).translate(0, 0.3, 0), pad, this.handbrakeLever);
    this.mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.01, 10).translate(0, 0.355, 0), marigold, this.handbrakeLever);
    this.handbrakeLever.rotation.x = -0.32; // leans back toward the driver
    this.leverTopLocal = V(0, 0.31, 0);

    // ---- gauges: the main cluster (tacho, speed, gear, shift lights) and a three-dial pod
    this.cluster = canvasTexture(512, 208);
    this.textures.push(this.cluster.texture);
    const clusterMaterial = this.mat({ map: this.cluster.texture, toneMapped: false }, true);
    const clusterPlane = new THREE.PlaneGeometry(0.38, 0.154);
    clusterPlane.rotateX(-0.42);
    clusterPlane.translate(DRIVER_X, 0.893, -0.468);
    this.mesh(clusterPlane, clusterMaterial);

    this.aux = canvasTexture(384, 128);
    this.textures.push(this.aux.texture);
    const auxMaterial = this.mat({ map: this.aux.texture, toneMapped: false }, true);
    const auxPlane = new THREE.PlaneGeometry(0.27, 0.09);
    auxPlane.rotateX(-0.12);
    auxPlane.rotateY(-0.3);
    auxPlane.translate(0.0, 0.715, -0.296);
    this.mesh(auxPlane, auxMaterial);
    this.add_(this.boxGeo(0.3, 0.115, 0.02, 0.0, 0.715, -0.305, -0.12, -0.3), pad);

    // ---- the driver's arms and gloved hands
    this.shoulders = { left: V(DRIVER_X - 0.21, 0.84, 0.46), right: V(DRIVER_X + 0.21, 0.84, 0.46) };
    this.poles = { left: V(-0.7, -0.7, 0.1).normalize(), right: V(0.7, -0.7, 0.1).normalize() };
    this.arms = {};
    for (const side of ['left', 'right']) {
      const upper = this.mesh(new THREE.CylinderGeometry(0.046, 0.052, 1, 12).translate(0, 0.5, 0), sleeve, this);
      const fore = this.mesh(new THREE.CylinderGeometry(0.036, 0.044, 1, 12).translate(0, 0.5, 0), sleeve, this);
      const elbow = this.mesh(new THREE.SphereGeometry(0.047, 12, 10), sleeve, this);
      const cuff = this.mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.05, 12), sleeveCuff, this);
      const hand = new THREE.Group();
      this.add(hand);
      // A gloved fist around the rim: knuckles along the rim, palm under, thumb over, a red strap.
      this.mesh(new THREE.CapsuleGeometry(0.03, 0.06, 6, 12), glove, hand, { cast: true });
      this.mesh(new THREE.BoxGeometry(0.05, 0.075, 0.045).translate(0, 0, 0.022), glove, hand);
      this.mesh(new THREE.CapsuleGeometry(0.013, 0.035, 4, 8).rotateZ(0.9).translate(side === 'left' ? 0.025 : -0.025, 0.03, -0.02), glove, hand);
      this.mesh(new THREE.BoxGeometry(0.056, 0.007, 0.047).translate(0, -0.04, 0.024), gloveAccent, hand);
      this.arms[side] = { upper, fore, elbow, cuff, hand };
    }

    this.mergeStatics();
  }

  mergeStatics() {
    for (const [material, geometries] of this.statics) {
      const prepared = geometries.map((g) => {
        const ng = g.index ? g.toNonIndexed() : g;
        for (const name of Object.keys(ng.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') ng.deleteAttribute(name);
        if (!ng.attributes.uv) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
        return ng;
      });
      const merged = mergeGeometries(prepared, false);
      geometries.forEach((g) => g.dispose());
      if (merged) this.mesh(merged, material, this, { cast: material !== this.paint });
    }
    this.statics.clear();
  }

  /**
   * Animate from the vehicle state.
   * @param {import('../core/contracts.js').VehicleState} state
   * @param {number} dt
   */
  update(state, dt) {
    if (!this.visible) return;
    dt = Math.min(0.1, Math.max(0, dt || 0));

    // ---- steering wheel and palming hands
    const target = Math.max(-WHEEL_MAX, Math.min(WHEEL_MAX, (state.steerAngle || 0) * WHEEL_RATIO));
    const previous = this.wheelTurn;
    this.wheelTurn = target;
    const delta = this.wheelTurn - previous;
    this.wheel.rotation.z = -this.wheelTurn; // clockwise as seen by the driver is negative about z
    const turnRate = dt > 0 ? Math.abs(delta) / dt : 0;
    const relax = (1 - Math.exp(-2.5 * dt)) * Math.max(0, 1 - turnRate / 1.5);
    for (const side of ['left', 'right']) {
      const grip = GRIP[side];
      let a = this.gripAngles[side] + delta; // hands ride round with the wheel...
      a = Math.min(grip.max, Math.max(grip.min, a)); // ...and palm once they reach the end of their reach
      a += (grip.home - a) * relax; // and re-settle at quarter to three when the wheel is steady
      this.gripAngles[side] = a;
    }

    // ---- gear lever: the knob moves through the gate; the right hand goes to it on a shift
    const gear = state.gear ?? 'N';
    if (state.shifted || gear !== this.lastGear) {
      if (gear !== this.lastGear) this.shiftTimer = 0.42;
      this.lastGear = gear;
    }
    const [gx, gz] = GATE[gear] || GATE.N;
    const shiftProgress = this.shiftTimer > 0 ? 1 - this.shiftTimer / 0.42 : 1;
    const throwBlend = this.shiftTimer > 0 ? Math.min(1, Math.max(0, (shiftProgress - 0.18) / 0.2)) : 1;
    const follow = 1 - Math.exp(-(this.shiftTimer > 0 ? 30 : 12) * dt);
    this.knob.x += (gx * throwBlend + this.knob.x * (1 - throwBlend) - this.knob.x) * follow;
    this.knob.y += (gz * throwBlend + this.knob.y * (1 - throwBlend) - this.knob.y) * follow;
    this.shiftStick.rotation.z = -Math.atan2(this.knob.x, 0.265);
    this.shiftStick.rotation.x = Math.atan2(this.knob.y, 0.265);
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);

    // ---- hydraulic handbrake: hand and lever follow the input
    const wantHandbrake = state.handbrake ? 1 : 0;
    this.handbrakeBlend += (wantHandbrake - this.handbrakeBlend) * (1 - Math.exp(-14 * dt));
    this.leverPull += (wantHandbrake - this.leverPull) * (1 - Math.exp(-(wantHandbrake ? 22 : 10) * dt));
    this.handbrakeLever.rotation.x = -0.32 + 0.45 * this.leverPull;

    // Right hand: 0 = on the wheel, 1 = on the gear knob or the handbrake.
    const shiftReach = this.shiftTimer > 0 ? Math.sin(Math.min(1, shiftProgress) * Math.PI) ** 0.5 : 0;
    const onLever = Math.max(shiftReach, this.handbrakeBlend);
    const leverTarget = this.handbrakeBlend > shiftReach ? 'handbrake' : 'shifter';

    this.updateWheelMatrices();
    for (const side of ['left', 'right']) {
      const handPos = _v1;
      const handQuat = _q1;
      this.rimPose(this.gripAngles[side], handPos, handQuat);
      if (side === 'right' && onLever > 0.001) {
        const leverPos = _v2;
        if (leverTarget === 'handbrake') this.handbrakeLever.localToWorld(leverPos.copy(this.leverTopLocal));
        else this.shiftStick.localToWorld(leverPos.copy(this.knobLocal).add(_v3.set(0, 0.012, 0)));
        this.worldToLocal(leverPos);
        // Arc over the console on the way.
        const lift = Math.sin(onLever * Math.PI) * 0.05;
        handPos.lerp(leverPos, onLever);
        handPos.y += lift;
        _q2.setFromUnitVectors(Y_AXIS, X_AXIS); // a fist across the knob or grip
        handQuat.slerp(_q2, onLever);
      }
      this.poseArm(side, handPos, handQuat);
    }

    // ---- gauges
    this.gaugeClock -= dt;
    if (this.gaugeClock <= 0) {
      this.gaugeClock = 1 / 30;
      this.drawCluster(state);
    }
    this.auxClock -= dt;
    if (this.auxClock <= 0) {
      this.auxClock = 1 / 8;
      this.drawAux(state);
    }
  }

  updateWheelMatrices() {
    this.updateMatrix();
    this.wheelMount.updateMatrix();
    this.wheel.updateMatrix();
    this.shifter.updateMatrix();
    this.shiftStick.updateMatrix();
    this.handbrake.updateMatrix();
    this.handbrakeLever.updateMatrix();
    this.updateMatrixWorld(true);
  }

  /** Position and orientation (cockpit space) of a fist gripping the rim at `angle` clockwise from 12. */
  rimPose(angle, outPos, outQuat) {
    const s = Math.sin(angle);
    const c = Math.cos(angle);
    // In the mount frame (not spun): point on the rim and the rim tangent there.
    outPos.set(s * WHEEL_RADIUS, c * WHEEL_RADIUS, 0.012).applyMatrix4(this.wheelMount.matrix);
    _v3.set(c, -s, 0).applyQuaternion(this.wheelMount.quaternion);
    outQuat.setFromUnitVectors(Y_AXIS, _v3.normalize());
    // Turn the fist so the back of the hand faces the driver, knuckles outward.
    _q2.setFromAxisAngle(Y_AXIS, angle < 0 ? -0.4 : 0.4);
    outQuat.multiply(_q2);
  }

  /** Place the hand and solve shoulder-elbow-wrist with a two-bone IK bent outward and down. */
  poseArm(side, handPos, handQuat) {
    const arm = this.arms[side];
    arm.hand.position.copy(handPos);
    arm.hand.quaternion.copy(handQuat);
    // Wrist: just behind the fist, toward the driver.
    const wrist = _v2.set(0, 0, 0.055).applyQuaternion(handQuat).add(handPos);
    wrist.z = Math.max(wrist.z, handPos.z + 0.03);
    const shoulder = this.shoulders[side];
    const toWrist = _v3.subVectors(wrist, shoulder);
    let d = toWrist.length();
    const reach = (UPPER_ARM + FOREARM) * 0.999;
    if (d > reach) d = reach;
    const dir = toWrist.normalize();
    const a = (UPPER_ARM * UPPER_ARM - FOREARM * FOREARM + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, UPPER_ARM * UPPER_ARM - a * a));
    const pole = this.poles[side];
    const perp = _perp.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbow = _elbow.copy(shoulder).addScaledVector(dir, a).addScaledVector(perp, h);
    const wristEnd = _wristEnd.copy(shoulder).addScaledVector(dir, d);
    this.limb(arm.upper, shoulder, elbow);
    this.limb(arm.fore, elbow, wristEnd);
    arm.elbow.position.copy(elbow);
    arm.cuff.position.copy(wristEnd);
    arm.cuff.quaternion.setFromUnitVectors(Y_AXIS, _v1.subVectors(wristEnd, elbow).normalize());
  }

  limb(mesh, from, to) {
    const length = from.distanceTo(to);
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(Y_AXIS, _v1.subVectors(to, from).normalize());
    mesh.scale.set(1, Math.max(0.001, length), 1);
  }

  drawCluster(state) {
    const { context: c, texture } = this.cluster;
    const W = 512;
    const H = 208;
    const rpmMax = state.rpmMax > 1000 ? state.rpmMax : 7200;
    const scaleMax = Math.ceil((rpmMax + 800) / 1000) * 1000;
    this.shownRpm += ((state.rpm || 0) - this.shownRpm) * 0.6;
    const rpm = Math.max(0, this.shownRpm);
    c.fillStyle = '#07090a';
    c.fillRect(0, 0, W, H);

    // Shift lights across the top: green, amber, red; all flash at the limiter.
    const lights = 10;
    const startRpm = rpmMax * 0.62;
    const limiter = rpm >= rpmMax * 0.97;
    const flash = limiter && Math.floor(performance.now() / 70) % 2 === 0;
    for (let i = 0; i < lights; i += 1) {
      const on = limiter ? flash : rpm >= startRpm + ((rpmMax * 0.95 - startRpm) * i) / (lights - 1);
      const colour = i < 4 ? '#2fd36b' : i < 7 ? '#f2b01e' : '#ff3b2a';
      c.fillStyle = on ? colour : '#1a1d1f';
      c.beginPath();
      c.arc(56 + i * 44, 16, 9, 0, Math.PI * 2);
      c.fill();
    }

    // Tachometer arc, centre-left.
    const cx = 170;
    const cy = 128;
    const radius = 74;
    const a0 = Math.PI * 0.8;
    const a1 = Math.PI * 2.2;
    const angleFor = (value) => a0 + ((a1 - a0) * value) / scaleMax;
    c.lineWidth = 7;
    c.strokeStyle = '#2a2f33';
    c.beginPath();
    c.arc(cx, cy, radius, a0, a1);
    c.stroke();
    c.strokeStyle = '#c8321e';
    c.beginPath();
    c.arc(cx, cy, radius, angleFor(rpmMax * 0.92), a1);
    c.stroke();
    c.font = '600 18px Teko, Khand, system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let k = 0; k <= scaleMax / 1000; k += 1) {
      const a = angleFor(k * 1000);
      const red = k * 1000 >= rpmMax * 0.92;
      c.strokeStyle = red ? '#ff5a45' : '#e9ece8';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * (radius - 4), cy + Math.sin(a) * (radius - 4));
      c.lineTo(cx + Math.cos(a) * (radius - 16), cy + Math.sin(a) * (radius - 16));
      c.stroke();
      c.fillStyle = red ? '#ff5a45' : '#e9ece8';
      c.fillText(String(k), cx + Math.cos(a) * (radius - 30), cy + Math.sin(a) * (radius - 30));
    }
    const needle = angleFor(Math.min(scaleMax, rpm));
    c.strokeStyle = '#ff6a1f';
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(cx - Math.cos(needle) * 12, cy - Math.sin(needle) * 12);
    c.lineTo(cx + Math.cos(needle) * (radius - 8), cy + Math.sin(needle) * (radius - 8));
    c.stroke();
    c.fillStyle = '#1b1d20';
    c.beginPath();
    c.arc(cx, cy, 13, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#9fb0a8';
    c.font = '500 13px Khand, system-ui, sans-serif';
    c.fillText('x1000 r/min', cx, cy + 34);

    // Gear, big, in the middle of the dial.
    const gear = state.gear ?? 'N';
    c.fillStyle = gear === 'R' ? '#ff5a45' : '#f4f1e8';
    c.font = '700 44px Teko, Khand, system-ui, sans-serif';
    c.fillText(String(gear), cx, cy - 2);

    // Digital speed and a boost bar on the right.
    const kmh = Math.round(Math.abs(state.speedKmh ?? (state.speed || 0) * 3.6));
    c.textAlign = 'right';
    c.fillStyle = '#f4f1e8';
    c.font = '700 92px Teko, Khand, system-ui, sans-serif';
    c.fillText(String(kmh), 470, 112);
    c.font = '600 20px Khand, system-ui, sans-serif';
    c.fillStyle = '#9fb0a8';
    c.fillText('KM/H', 470, 162);
    c.textAlign = 'left';
    c.fillStyle = '#9fb0a8';
    c.fillText(state.boosting ? 'N2O' : '', 290, 162);
    // Thin frame.
    c.strokeStyle = '#2a2f33';
    c.lineWidth = 3;
    c.strokeRect(1.5, 1.5, W - 3, H - 3);
    texture.needsUpdate = true;
  }

  drawAux(state) {
    const { context: c, texture } = this.aux;
    c.fillStyle = '#07090a';
    c.fillRect(0, 0, 384, 128);
    const rpmMax = state.rpmMax > 1000 ? state.rpmMax : 7200;
    const rpmN = Math.min(1, Math.max(0, (state.rpm || 0) / rpmMax));
    const throttle = Math.min(1, Math.max(0, state.throttle || 0));
    const dials = [
      { label: 'OIL', value: 0.25 + 0.6 * rpmN },
      { label: 'WATER', value: 0.55 + 0.05 * rpmN },
      { label: 'BOOST', value: Math.min(1, 0.08 + throttle * rpmN * 1.1 + (state.boosting ? 0.2 : 0)) },
    ];
    dials.forEach((dial, i) => {
      const cx = 64 + i * 128;
      const cy = 66;
      const r = 48;
      c.fillStyle = '#0c1410';
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#3a4a41';
      c.lineWidth = 3;
      c.stroke();
      const a0 = Math.PI * 0.75;
      const a1 = Math.PI * 2.25;
      c.strokeStyle = '#46e08a';
      c.lineWidth = 2;
      for (let k = 0; k <= 8; k += 1) {
        const a = a0 + ((a1 - a0) * k) / 8;
        c.beginPath();
        c.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
        c.lineTo(cx + Math.cos(a) * (r - 11), cy + Math.sin(a) * (r - 11));
        c.stroke();
      }
      const a = a0 + (a1 - a0) * dial.value;
      c.strokeStyle = '#ff6a1f';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(cx, cy);
      c.lineTo(cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10));
      c.stroke();
      c.fillStyle = '#46e08a';
      c.font = '600 15px Khand, system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(dial.label, cx, cy + 26);
    });
    texture.needsUpdate = true;
  }

  dispose() {
    this.traverse((node) => node.geometry?.dispose());
    this.materials.forEach((material) => material !== this.paint && material !== this.stripe && material.dispose());
    this.textures.forEach((texture) => texture.dispose());
  }
}
