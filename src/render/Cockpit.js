import * as THREE from 'three';
import { rallyPart, textureRallySurface } from './RallyKit.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// A stripped drift-car interior for the cockpit camera, in the car's chassis space
// (x right, y up, front toward -z; the driver position is set by cabin style).
// Static trim is merged into one mesh per material; the steering wheel, the driver's arms and hands,
// the shifter and the hydraulic handbrake move every frame, and the gauge cluster is a live canvas.

const DRIVER_X = -0.37;
export const COCKPIT_EYE = Object.freeze({ x: DRIVER_X, y: 1.03, z: 0.31 });

const WHEEL_RADIUS = 0.172;
const GT_RIM = [[-.165,.067],[-.106,.103],[.106,.103],[.165,.067],[.171,0],[.145,-.078],
  [.098,-.099],[-.098,-.099],[-.145,-.078],[-.171,0]];
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

/**
 * Interior styles. The cabin is modelled once at rally-hatch size; `scale`, `y` and `z` fit it inside
 * another body (chassis space, chassis origin on the ground), the rest swaps parts and colours.
 * Interior layouts reference the 992 GT3 R and the Thar Roxx.
 */
export const STYLES = Object.freeze({
  drift: {
    scale: 1, y: 0, z: 0, eye: { x: DRIVER_X, y: 1.077, z: 0.24 }, headPitch: -0.096,
    dash: 0x1b1d20, trim: 0x26292d, headliner: 0x2b2d30, carpet: 0x121315, seat: 0x18191b, seatAccent: 0xc8321e,
    cage: 0xb8b9ae, cageLayout: 'full', strip: true, extinguisher: true, seatType: 'bucket',
    wheelType: 'dish', wheelStripe: 0xf2b01e, rim: 0x151515, spoke: 0xb7bcc2,
    shifter: 'sequential', handbrake: 'hydraulic', cluster: 'drift', aux: 'pod',
    sleeve: 0x1f3a2b, cuff: 0x14110d, glove: 0x141516, gloveAccent: 0xc8321e,
  },
  // 992 customer racer: single seat, full cage, multifunction wheel and paddle shift.
  gt: {
    scale: 0.91, y: 0.13, z: 0.07, eye: { x: DRIVER_X, y: 1.075, z: 0.29 }, headPitch: -0.08,
    dash: 0x34373a, trim: 0x414449, headliner: 0x363d40, carpet: 0x25292c, seat: 0x272a2c, seatAccent: 0xcc3925,
    cage: 0xc6cacc, cageLayout: 'full', strip: false, extinguisher: true, seatType: 'race',
    wheelType: 'gt', wheelStripe: null, rim: 0x252729, spoke: 0x3b3d40,
    shifter: 'paddles', handbrake: null, cluster: 'race', aux: null,
    sleeve: 0x18191b, cuff: 0x0d0d0d, glove: 0x121212, gloveAccent: 0xd5001c,
  },
  // A tall, upright black-and-beige dash with a grab handle in front of the passenger, twin 10.25-inch
  // screens (driver display and touchscreen), comfortable seats with separate headrests, an automatic
  // lever with the 4x4 lever beside it, a light roof lining, and a high seating position. No cage.
  suv: {
    scale: 1.12, y: 0.366, z: 0.09,
    eye: { x: 0.37, y: 1.098, z: 0.10 }, headPitch: -0.135,
    dash: 0x1a1a1a, dashInsert: 0xded6c4, trim: 0x4a4a4a, headliner: 0xd8d2c4, carpet: 0x1a1a1a, seat: 0xded6c4, seatAccent: 0x2a2a2a,
    cage: null, strip: false, extinguisher: false, seatType: 'suv', grabHandle: true, uprightDash: true,
    wheelType: 'suv', wheelStripe: null, rim: 0x1c1c1c, spoke: 0x3a3a3a,
    shifter: 'auto', handbrake: 'button', cluster: 'twin', aux: null, screen: 'suv',
    sleeve: 0x3b4a5c, cuff: 0x2b3746, glove: 0xc68a64, gloveAccent: 0x222222,
  },
});

/** The driver's eye in the car's chassis space for a style (the cockpit camera's position). */
export function cockpitEye(styleName) {
  const st = STYLES[styleName] || STYLES.drift;
  const eye = st.eye ?? COCKPIT_EYE;
  return { x: eye.x * st.scale, y: eye.y * st.scale + st.y, z: eye.z * st.scale + st.z, pitch: st.headPitch ?? -0.1 };
}

export class Cockpit extends THREE.Group {
  /**
   * @param {object} options
   * @param {THREE.Material} [options.paint]  The car's body paint, for the bonnet seen through the glass.
   * @param {THREE.Material} [options.stripe] The livery stripe material.
   * @param {string} [options.style]          A key of STYLES.
   */
  constructor({ paint = null, stripe = null, style = 'drift' } = {}) {
    super();
    this.name = 'DriftCockpit';
    this.styleName = STYLES[style] ? style : 'drift';
    this.style = STYLES[this.styleName];
    this.scale.setScalar(this.style.scale);
    this.position.set(0, this.style.y, this.style.z);
    this.paddleFlick = 0;
    this.visible = false;
    this.materials = [];
    this.textures = [];
    this.statics = new Map();
    this.paint = paint;
    this.stripe = stripe;
    this.wheelTurn = 0;
    this.gripAngles = { left: GRIP.left.home, right: GRIP.right.home };
    this.shiftTimer = 0;
    this.shiftDirection = 1;
    this.handbrakeBlend = 0;
    this.leverPull = 0;
    this.gaugeClock = 0;
    this.auxClock = 0;
    this.lastGear = 'N';
    this.shownRpm = 0;
    this.build();
    if (this.styleName === 'drift') {
      this.valveIndicator = this.mat({ color: 0x3580a8, emissive: 0x54cfff, emissiveIntensity: 0.15 });
      this.mesh(new THREE.CircleGeometry(0.008, 12).translate(0.107, 0.644, -0.275), this.valveIndicator);
      this.stageKit = rallyPart('StageCabin', this.materials);
      if (this.stageKit) this.add(this.stageKit);
    }
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

  boxGeo(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, radius = 0) {
    const geometry = radius > 0 ? new RoundedBoxGeometry(w, h, d, 2, radius) : new THREE.BoxGeometry(w, h, d);
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
    const st = this.style;
    const driverX = (st.eye ?? COCKPIT_EYE).x;
    const dash = this.mat({ color: st.dash, roughness: 0.88, metalness: 0.05 });
    const trim = this.mat({ color: st.trim, roughness: 0.7, metalness: st.cageLayout === 'rear' ? 0.35 : 0.1 });
    const headliner = this.mat({ color: st.headliner, roughness: 0.95 });
    const carpet = this.mat({ color: st.carpet, roughness: 1 });
    const cage = this.mat({ color: st.cage ?? 0x2e8b5e, roughness: st.cageLayout === 'rear' ? 0.5 : 0.42, metalness: 0.35 });
    const pad = this.mat({ color: 0x0f1011, roughness: 0.9 });
    const metal = this.mat({ color: 0xb7bcc2, roughness: 0.25, metalness: 0.9 });
    const suede = this.mat({ color: st.rim, roughness: st.wheelType === 'suv' ? 0.6 : 0.97 });
    const spokeMetal = this.mat({ color: st.spoke, roughness: 0.35, metalness: 0.8 });
    const seat = this.mat({ color: st.seat, roughness: st.seatType === 'suv' ? 0.7 : 0.92 });
    const seatShell = this.mat({ color: st.seatType === 'suv' ? 0x1a1a1a : st.seat, roughness: 0.6, metalness: st.cageLayout === 'rear' ? 0.3 : 0 });
    const red = this.mat({ color: st.seatAccent, roughness: 0.45, metalness: 0.2 });
    const marigold = this.mat({ color: st.wheelStripe ?? 0xf2b01e, roughness: 0.5 });
    const glove = this.mat({ color: st.glove, roughness: 0.8 });
    const gloveAccent = this.mat({ color: st.gloveAccent, roughness: 0.6 });
    const sleeve = this.mat({ color: st.sleeve, roughness: 0.85 });
    const sleeveCuff = this.mat({ color: st.cuff, roughness: 0.9 });
    const mirrorGlass = this.mat({ color: 0x2a3036, roughness: 0.1, metalness: 0.6 });
    const insert = this.mat({ color: st.dashInsert ?? st.dash, roughness: 0.75 });
    if (this.styleName === 'drift' || this.styleName === 'gt') {
      for (const material of [dash, suede, seat, sleeve, glove]) textureRallySurface(material, 'Flock');
      for (const material of [trim, seatShell]) textureRallySurface(material, 'Carbon');
      textureRallySurface(metal, 'Steel');
      textureRallySurface(red, 'Webbing');
    }
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
    if (this.paint) for (const x of [-0.35, 0.22]) this.add_(this.boxGeo(0.62, 0.012, 0.018, x, 0.83, -0.84, 0, 0.08, 0.04), pad);

    // ---- dashboard: cowl under the glass, a flat top, a lip and a face that drops toward the floor
    const dashProfile = st.uprightDash
      ? [[-0.84, 0.82], [-0.62, 0.87], [-0.43, 0.875], [-0.4, 0.86], [-0.39, 0.6], [-0.44, 0.42], [-0.86, 0.42]]
      : [[-0.84, 0.82], [-0.6, 0.875], [-0.42, 0.88], [-0.37, 0.86], [-0.345, 0.78], [-0.34, 0.6], [-0.42, 0.42], [-0.86, 0.42]];
    this.add_(extrudeAcross(dashProfile, -0.76, 0.76), dash);
    if (st.dashInsert) {
      // Beige band across the dash face, the two-tone that marks this cabin.
      this.add_(this.boxGeo(1.5, 0.126, 0.025, 0, 0.79, -0.388, 0, 0, 0, 0.01), insert);
    }
    if (st.cluster === 'drift') {
      // Instrument binnacle: a hood over the cluster in front of the driver.
      this.add_(this.boxGeo(0.42, 0.016, 0.17, driverX, 0.955, -0.46, -0.16), dash);
      for (const side of [-1, 1]) this.add_(this.boxGeo(0.016, 0.085, 0.16, driverX + side * 0.205, 0.915, -0.46, -0.16), dash);
      this.add_(this.boxGeo(0.42, 0.09, 0.02, driverX, 0.905, -0.535, -0.16), dash);
    }
    if (st.grabHandle) {
      // Padded passenger grip stands clear of the ivory fascia on two satin mounts.
      for (const x of [-0.54, -0.22]) {
        this.add_(tube(V(x, 0.78, -0.39), V(x, 0.77, -0.32), 0.019, 10), metal);
      }
      this.add_(tube(V(-0.555, 0.77, -0.32), V(-0.205, 0.77, -0.32), 0.022, 12), suede);
      for (const [start, end] of [[-0.63, -0.17], [0.18, 0.62]]) {
        this.add_(this.boxGeo(end - start, 0.005, 0.005, (start + end) / 2, 0.847, -0.374), metal);
        for (let x = start; x < end; x += 0.021) {
          this.add_(this.boxGeo(0.011, 0.002, 0.002, x, 0.833, -0.374), trim);
        }
      }
      // Four recessed air outlets. The central pair sit below the touchscreen.
      for (const [x, y] of [[-0.68, 0.795], [-0.07, 0.728], [0.07, 0.728], [0.68, 0.795]]) {
        const z = Math.abs(x) < 0.1 ? -0.293 : -0.371;
        this.add_(new THREE.CircleGeometry(0.043, 20).translate(x, y, z), pad);
        this.add_(new THREE.TorusGeometry(0.043, 0.005, 6, 20).translate(x, y, z + 0.003), metal);
        for (const dy of [-0.017, 0, 0.017]) {
          this.add_(this.boxGeo(0.068, 0.004, 0.011, x, y + dy, z + 0.006, -0.24), trim);
        }
      }
      for (const x of [-0.08, 0.08]) {
        this.add_(new THREE.CylinderGeometry(0.022, 0.022, 0.023, 16)
          .rotateX(Math.PI / 2).translate(x, 0.60, -0.293), metal);
        this.add_(this.boxGeo(0.004, 0.01, 0.003, x, 0.608, -0.28), pad);
      }
    }
    // Steering column shroud.
    this.add_(tube(V(driverX, 0.7, -0.42), V(driverX, st.uprightDash ? 0.71 : 0.735, -0.25), 0.045, 12), trim);
    // Centre stack, switch panel with a red ignition button and toggles.
    this.add_(this.boxGeo(0.28, 0.32, 0.06, 0.0, 0.6, -0.33, 0, 0, 0, st.uprightDash ? 0.024 : 0), trim);
    this.add_(this.boxGeo(0.22, 0.05, 0.012, 0.0, 0.53, -0.297), pad);
    for (let i = 0; i < 4; i += 1) this.add_(this.boxGeo(0.014, 0.03, 0.02, -0.07 + i * 0.03, 0.47, -0.293), metal);
    const button = new THREE.CylinderGeometry(0.018, 0.018, 0.02, 14);
    button.rotateX(Math.PI / 2);
    button.translate(0.08, 0.47, -0.292);
    this.add_(button, st.shifter === 'sequential' ? red : pad);
    if (st.screen) this.buildScreen(st.screen, pad);
    // Rear-view mirror.
    const mirrorLift = st.uprightDash ? 0.074 : 0;
    this.add_(this.boxGeo(0.2, 0.058, 0.022, 0.0, 1.17 + mirrorLift, -0.26, -0.12), pad);
    this.add_(this.boxGeo(0.184, 0.044, 0.004, 0.0, 1.168 + mirrorLift, -0.247, -0.12), mirrorGlass);
    this.add_(tube(V(0, 1.2 + mirrorLift, -0.25), V(0, 1.24 + mirrorLift, -0.2), 0.008, 6), pad);

    // ---- pillars, header, roof lining, doors
    for (const side of [-1, 1]) {
      // The ROXX shell already carries both windscreen pillars at their true rake.
      if (!st.uprightDash || this.paint) {
        this.add_(tube(V(side * 0.75, 0.83, -0.79), V(side * 0.635, 1.245, -0.15), 0.038, 8), trim);
      }
      this.add_(this.boxGeo(0.06, 0.45, 0.07, side * 0.7, 1.05, 0.34), trim); // B-pillar
      // Door card below the window line, a pull strap, the window ledge.
      this.add_(this.boxGeo(0.03, 0.58, 1.16, side * 0.765, 0.55, -0.18), dash);
      this.add_(this.boxGeo(0.07, 0.035, 1.16, side * 0.745, 0.845, -0.18), trim);
      this.add_(this.boxGeo(0.02, 0.025, 0.2, side * 0.735, 0.68, -0.05), red);
      if (st.uprightDash) {
        this.add_(this.boxGeo(0.033, 0.145, 0.72, side * 0.735, 0.64, -0.055), insert);
        this.add_(this.boxGeo(0.085, 0.045, 0.43, side * 0.702, 0.615, 0.045), suede);
        this.add_(this.boxGeo(0.026, 0.02, 0.11, side * 0.71, 0.73, -0.22), metal);
      }
      // Rear quarter behind the B-pillar.
      this.add_(this.boxGeo(0.04, 0.8, 0.7, side * 0.75, 0.7, 0.72), dash);
    }
    const ceilingLift = st.uprightDash ? 0.106 : 0;
    this.add_(this.boxGeo(1.28, 0.05, 0.06, 0, 1.235 + ceilingLift, -0.15), trim);
    this.add_(this.boxGeo(1.3, 0.02, 1.2, 0, 1.252 + ceilingLift, 0.45), headliner);
    this.add_(this.boxGeo(1.56, 0.03, 1.8, 0, 0.13, -0.05), carpet);
    if (this.styleName === 'drift') {
      // The stripped load bay continues underneath the nitrous cradle to the inner tailgate.
      this.add_(this.boxGeo(1.56, 0.055, 1.27, 0, 0.255, 1.385), carpet);
      this.add_(this.boxGeo(1.61, 0.64, 0.07, 0, 0.59, 1.996), dash);
      this.add_(this.boxGeo(1.55, 0.045, 0.31, 0, 0.92, 1.865), trim);
      this.add_(this.boxGeo(1.28, 0.036, 0.72, 0, 1.303, 1.095), headliner);
      for (const side of [-1, 1]) {
        this.add_(this.boxGeo(0.052, 0.65, 1.07, side * 0.775, 0.59, 1.45), dash);
        this.add_(tube(V(side * 0.62, 1.30, 1.40), V(side * 0.73, 0.922, 1.96), 0.046), trim);
      }
    }
    // Transmission tunnel and console.
    this.add_(this.boxGeo(0.24, 0.3, 0.75, 0.0, 0.33, 0.02), dash);
    this.add_(this.boxGeo(0.22, 0.02, 0.4, 0.0, 0.49, -0.05), trim);

    // ---- passenger seat: a bucket with harness, or an SUV seat with a separate headrest
    if (st.seatType === 'suv') {
      for (const sx of [-driverX, driverX]) {
        this.add_(this.boxGeo(0.5, 0.14, 0.5, sx, 0.38, 0.2, 0, 0, 0, 0.045), seat);
        this.add_(this.boxGeo(0.5, 0.62, 0.12, sx, 0.74, 0.5, -0.14, 0, 0, 0.047), seat);
        for (const side of [-1, 1]) {
          this.add_(this.boxGeo(0.06, 0.5, 0.14, sx + side * 0.25, 0.72, 0.48, -0.14), seatShell);
          this.add_(this.boxGeo(0.06, 0.1, 0.46, sx + side * 0.25, 0.44, 0.2), seatShell);
          this.add_(tube(V(sx + side * 0.07, 1.04, 0.58), V(sx + side * 0.07, 1.1, 0.6), 0.007, 6), metal); // headrest posts
        }
        this.add_(this.boxGeo(0.3, 0.17, 0.1, sx, 1.18, 0.62, -0.1, 0, 0, 0.038), seat);
        for (let row = 0; row < 5; row++) {
          const y = 0.57 + 0.071 * row;
          this.add_(this.boxGeo(0.32, 0.006, 0.009, sx, y, 0.438 + (y - 0.74) * 0.14, -0.14), insert);
        }
      }
      this.add_(this.boxGeo(1.23, 0.14, 0.43, 0, 0.39, 1.02), seat);
      this.add_(this.boxGeo(1.23, 0.53, 0.13, 0, 0.68, 1.24, -0.1), seat);
    } else {
      const sx = st.seatType === 'race' ? driverX : 0.38;
      if (st.seatType === 'race') {
        for (const side of [-1, 1]) {
          this.add_(this.boxGeo(0.073, 0.16, 0.18, sx + side * 0.153, 1.088, 0.51, -0.13, 0, 0, 0.024), seat);
          this.add_(this.boxGeo(0.052, 0.045, 0.32, sx + side * 0.12, 0.424, 0.25, 0, side * 0.33), red);
        }
        const legend = canvasTexture(512, 288);
        const ctx = legend.context;
        ctx.fillStyle = '#182025';
        ctx.fillRect(0, 0, 512, 288);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#c1cdca';
        ctx.font = 'bold 22px Arial, sans-serif';
        for (const [i, name] of ['START','PUMP','IGN','RAIN','LIGHT','FAN','AUX','RESET'].entries()) {
          ctx.fillText(name, 63 + (i % 4)*128, 89 + Math.floor(i/4)*122);
        }
        this.textures.push(legend.texture);
        this.mesh(new THREE.PlaneGeometry(.208,.118).translate(0,.674,-.298),
          this.mat({ map: legend.texture, roughness: .72 }));
        // Removable electronics tray in the passenger footwell and the backlit switch bank.
        this.add_(this.boxGeo(0.33, 0.085, 0.26, 0.39, 0.23, -0.22, 0, 0, 0, 0.014), trim);
        for (let i = 0; i < 8; i++) {
          this.add_(this.boxGeo(0.019, 0.012, 0.19, 0.278 + i * 0.032, 0.279, -0.22), metal);
          const x = -0.078 + (i % 4) * 0.052, y = 0.645 + Math.floor(i / 4) * 0.05;
          this.add_(new THREE.CylinderGeometry(0.015, 0.016, 0.014, 12).rotateX(Math.PI / 2).translate(x, y, -0.29), i % 3 === 0 ? red : marigold);
        }
      }
      this.add_(this.boxGeo(0.46, 0.1, 0.48, sx, 0.36, 0.22), seat);
      this.add_(this.boxGeo(0.46, 0.72, 0.1, sx, 0.78, 0.5, -0.16), seatShell);
      for (const side of [-1, 1]) {
        this.add_(this.boxGeo(0.07, 0.62, 0.16, sx + side * 0.24, 0.74, 0.47, -0.16), seatShell);
        this.add_(this.boxGeo(0.07, 0.12, 0.44, sx + side * 0.24, 0.43, 0.22), seatShell);
        this.add_(this.boxGeo(0.05, 0.7, 0.008, sx + side * 0.09, 0.78, 0.44, -0.16), red);
      }
      this.add_(this.boxGeo(0.12, 0.04, 0.012, sx, 0.94, 0.43, -0.16), seat); // head slot
    }
    if (st.extinguisher) {
      const extinguisher = new THREE.CylinderGeometry(0.045, 0.045, 0.36, 14);
      extinguisher.rotateZ(Math.PI / 2);
      extinguisher.translate(0.3, 0.2, -0.28);
      this.add_(extinguisher, red);
      this.add_(this.boxGeo(0.06, 0.1, 0.1, 0.3, 0.2, -0.28), cage);
    }

    // ---- roll cage: a full cage padded where a helmet could meet it, or just the hoop behind the seats
    const r = st.cageLayout === 'rear' ? 0.028 : 0.022;
    if (st.cageLayout === 'rear') {
      for (const side of [-1, 1]) this.add_(tube(V(side * 0.6, 0.16, 0.64), V(side * 0.56, 1.215, 0.6), r), cage);
      this.add_(tube(V(-0.56, 1.215, 0.6), V(0.56, 1.215, 0.6), r), cage);
      this.add_(tube(V(-0.56, 1.215, 0.6), V(0.6, 0.2, 0.62), r), cage);
      this.add_(tube(V(-0.6, 0.62, 0.62), V(0.6, 0.62, 0.62), r * 0.9), cage); // harness bar
    }
    for (const side of st.cageLayout === 'full' ? [-1, 1] : []) {
      const footA = V(side * 0.68, 0.16, -0.66);
      const dashA = V(side * 0.69, 0.84, -0.7);
      const topA = V(side * 0.58, st.cluster === 'race' ? 1.245 : 1.205, -0.12);
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
    if (st.cageLayout === 'full') {
      const railHeight = st.cluster === 'race' ? 1.245 : 1.205;
      this.add_(tube(V(-0.58, railHeight, -0.12), V(0.58, railHeight, -0.12), r), cage); // front hoop top
      this.add_(tube(V(-0.56, 1.215, 0.6), V(0.56, 1.215, 0.6), r), cage); // main hoop top
      this.add_(tube(V(-0.56, 1.215, 0.6), V(0.62, 0.2, 0.62), r), cage); // main hoop diagonal
      this.add_(tube(V(-0.69, 0.84, -0.7), V(0.69, 0.84, -0.7), r * 0.9), cage); // dash bar (just under the cowl)
      this.add_(tube(V(-0.6, 1.21, 0.0), V(-0.6, 1.21, 0.4), r + 0.012), pad); // padding above the driver
    }

    // ---- sun strip across the top of the windscreen
    const strip = st.strip ? canvasTexture(1024, 96) : null;
    if (strip) {
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
    if (strip) {
      this.textures.push(strip.texture);
      const stripMaterial = this.mat({ map: strip.texture, transparent: true, opacity: 0.94 }, true);
      const stripPlane = new THREE.PlaneGeometry(1.2, 0.055);
      // Lie along the inside of the glass (rising toward the rear), facing down and back at the driver.
      stripPlane.rotateX(Math.atan2(0.8 - 0.13, 1.27 - 0.82));
      stripPlane.translate(0, 1.228, -0.168);
      this.mesh(stripPlane, stripMaterial);
    }

    // ---- steering wheel: mount (tilt) -> spin (turns with the steering)
    this.wheelMount = new THREE.Group();
    this.wheelMount.position.set(driverX, st.uprightDash ? 0.71 : 0.745, -0.2);
    this.wheelMount.rotation.x = -0.42;
    this.add(this.wheelMount);
    this.wheel = new THREE.Group();
    this.wheelMount.add(this.wheel);
    const dish = st.wheelType === 'dish' ? 0.06 : 0.025;
    if (st.wheelType === 'gt') {
      // Flattened upper/lower rim, thumb grips and carbon multifunction face.
      const rim = GT_RIM;
      for (let i = 0; i < rim.length; i++) {
        const [x,y] = rim[i], [nx,ny] = rim[(i+1) % rim.length];
        this.mesh(tube(V(x,y,0), V(nx,ny,0), 0.016, 10), suede, this.wheel);
      }
      this.mesh(this.boxGeo(.245,.122,.026,0,0,-.016,0,0,0,.022), trim, this.wheel);
      const face = canvasTexture(768, 384);
      const ctx = face.context;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f1f3ec';
      ctx.font = 'bold 21px Arial, sans-serif';
      for (const [i, label] of ['RAD','PIT','ACK','MAP','TC','FLS'].entries()) {
        const x = [67,139,211,557,629,701][i];
        ctx.fillText(label, x, 143);
      }
      ctx.font = 'bold 26px Arial, sans-serif';
      ctx.fillText('ABS', 118, 209);
      ctx.fillText('TC', 650, 209);
      ctx.fillStyle = '#338b87';
      ctx.fillRect(306, 212, 156, 4);
      ctx.fillStyle = '#e2e5dd';
      ctx.font = 'italic bold 37px Arial, sans-serif';
      ctx.fillText('GT3 R', 384, 186);
      this.textures.push(face.texture);
      this.mesh(new THREE.PlaneGeometry(.245,.122).translate(0,0,.001),
        this.mat({ map: face.texture, transparent: true, depthWrite: false }, true), this.wheel);
      for (const side of [-1,1]) {
        for (let i = 0; i < 3; i++) {
          const cap = new THREE.CylinderGeometry(.009,.011,.011,12).rotateX(Math.PI/2);
          this.mesh(cap.translate(side*(.055+.023*i),.030,.004), [marigold,red,metal][i], this.wheel);
        }
      }
    } else {
      this.mesh(new THREE.TorusGeometry(WHEEL_RADIUS, st.wheelType === 'suv' ? 0.017 : 0.019, 10, 40), suede, this.wheel, { cast: true });
      // Three spokes run back from the rim to the hub: deep-dished on the drift wheel, nearly flat otherwise.
      for (const angle of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
        const from = V(Math.sin(angle) * (WHEEL_RADIUS - 0.01), Math.cos(angle) * (WHEEL_RADIUS - 0.01), 0);
        const to = V(Math.sin(angle) * 0.04, Math.cos(angle) * 0.04, -dish);
        if (st.wheelType === 'dish') this.mesh(tube(from, to, 0.012, 8), metal, this.wheel);
        else this.mesh(this.boxGeo(0.045, from.distanceTo(to), 0.016, 0, 0, 0).applyQuaternion(_q1.setFromUnitVectors(Y_AXIS, _v1.subVectors(from, to).normalize())).translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2), spokeMetal, this.wheel);
      }
      if (st.wheelType === 'suv') {
        for (const side of [-1, 1]) {
          this.mesh(this.boxGeo(0.071, 0.039, 0.016, side * 0.104, 0.002, 0.009, 0, 0, side * 0.12), metal, this.wheel);
          this.mesh(this.boxGeo(0.058, 0.028, 0.01, side * 0.104, 0.004, 0.02), pad, this.wheel);
        }
      }
      const hubRadius = st.wheelType === 'suv' ? 0.068 : 0.05;
      const hub = new THREE.CylinderGeometry(hubRadius, hubRadius + 0.004, 0.035, 20);
      hub.rotateX(Math.PI / 2);
      hub.translate(0, 0, -dish - 0.005);
      this.mesh(hub, suede, this.wheel);
      const horn = new THREE.CylinderGeometry(0.02, 0.02, 0.012, 18);
      horn.rotateX(Math.PI / 2);
      horn.translate(0, 0, -dish + 0.015);
      this.mesh(horn, st.wheelType === 'dish' ? red : spokeMetal, this.wheel);
    }
    if (st.wheelType === 'gt') {
      // Two rotary dials on the spokes (damper and drive mode), and shift paddles behind the rim.
      for (const [x, colour] of [[-0.085, red], [0.085, marigold]]) {
        const dial = new THREE.CylinderGeometry(0.014, 0.014, 0.014, 14);
        dial.rotateX(Math.PI / 2);
        dial.translate(x, -0.028, 0.006);
        this.mesh(dial, colour, this.wheel);
        this.mesh(this.boxGeo(.003,.009,.002,x,-.023,.014), pad, this.wheel);
      }
      this.paddles = [];
      for (const side of [-1, 1]) {
        const paddle = new THREE.Group();
        paddle.position.set(side * 0.12, 0.05, -0.05);
        this.wheel.add(paddle);
        this.mesh(this.boxGeo(0.07, 0.11, 0.008, side * 0.03, 0, 0), metal, paddle);
        this.paddles.push(paddle);
      }
    }
    // Top-dead-centre stripe.
    if (st.wheelStripe) this.mesh(this.boxGeo(0.022, 0.044, 0.044, 0, WHEEL_RADIUS, 0), marigold, this.wheel);

    // ---- gear selector and hydraulic handbrake on the tunnel
    this.shifter = new THREE.Group();
    this.shifter.position.set(-0.02, 0.5, -0.14);
    this.add(this.shifter);
    const boot = new THREE.CylinderGeometry(0.02, 0.06, 0.07, 12);
    boot.translate(0, 0.035, 0);
    if (st.shifter !== 'paddles') this.add_(boot.clone().translate(-0.02, 0.5, -0.14), pad);
    this.shiftStick = new THREE.Group();
    this.shifter.add(this.shiftStick);
    if (st.shifter === 'sequential') {
      this.mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.25, 8).translate(0, 0.125, 0), metal, this.shiftStick);
      this.mesh(new THREE.SphereGeometry(0.03, 16, 12).translate(0, 0.265, 0), metal, this.shiftStick);
    } else if (st.shifter === 'auto') {
      // Automatic lever with a chrome button, and the short 4x4 lever beside it.
      this.mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.16, 10).translate(0, 0.08, 0), pad, this.shiftStick);
      this.mesh(this.boxGeo(0.045, 0.09, 0.06, 0, 0.19, 0), trim, this.shiftStick);
      this.mesh(this.boxGeo(0.012, 0.02, 0.02, -0.025, 0.21, 0), metal, this.shiftStick);
      this.add_(new THREE.CylinderGeometry(0.009, 0.011, 0.12, 8).translate(0.07, 0.56, -0.08), pad);
      this.add_(new THREE.SphereGeometry(0.022, 12, 10).translate(0.07, 0.625, -0.08), trim);
    }
    this.knobLocal = V(0, 0.265, 0);

    this.handbrake = new THREE.Group();
    this.handbrake.position.set(0.1, 0.5, -0.1);
    this.add(this.handbrake);
    this.handbrakeLever = new THREE.Group();
    this.handbrake.add(this.handbrakeLever);
    if (st.handbrake === 'hydraulic') {
      this.add_(this.boxGeo(0.05, 0.06, 0.12, 0.1, 0.52, -0.1), metal);
      this.mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.34, 8).translate(0, 0.17, 0), metal, this.handbrakeLever);
      this.mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.1, 10).translate(0, 0.3, 0), pad, this.handbrakeLever);
      this.mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.01, 10).translate(0, 0.355, 0), marigold, this.handbrakeLever);
    } else if (st.handbrake === 'button') {
      // Electronic parking brake: a small switch on the console.
      this.add_(this.boxGeo(0.03, 0.012, 0.04, -0.07, 0.505, 0.02), metal);
    }
    this.handbrakeLever.rotation.x = -0.32; // leans back toward the driver
    this.leverTopLocal = V(0, 0.31, 0);

    // ---- gauges: the main cluster (tacho, speed, gear, shift lights) and a three-dial pod
    this.cluster = canvasTexture(512, 208);
    this.textures.push(this.cluster.texture);
    const clusterMaterial = this.mat({ map: this.cluster.texture, toneMapped: false }, true);
    if (st.cluster === 'race') {
      // 10.3-inch diagonal in finished chassis space.
      this.add_(this.boxGeo(.281,.135,.030,driverX,.918,-.383,-.20,0,0,.011), trim);
      this.mesh(new THREE.PlaneGeometry(.262,.119).rotateX(-.20).translate(driverX,.918,-.364), clusterMaterial);
    } else if (st.cluster === 'twin') {
      // Low-set digital cluster immediately behind the wheel.
      const screen = new THREE.PlaneGeometry(0.3, 0.122);
      screen.rotateX(-0.2);
      screen.translate(driverX, 0.864, -0.347);
      this.mesh(screen, clusterMaterial);
      this.add_(this.boxGeo(0.32, 0.14, 0.03, driverX, 0.864, -0.365, -0.2, 0, 0, 0.011), pad);
    } else {
      const clusterPlane = new THREE.PlaneGeometry(0.38, 0.154);
      clusterPlane.rotateX(-0.42);
      clusterPlane.translate(driverX, 0.893, -0.468);
      this.mesh(clusterPlane, clusterMaterial);
    }

    if (st.aux === 'pod') {
      this.aux = canvasTexture(384, 128);
      this.textures.push(this.aux.texture);
      const auxMaterial = this.mat({ map: this.aux.texture, toneMapped: false }, true);
      const auxPlane = new THREE.PlaneGeometry(0.27, 0.09);
      auxPlane.rotateX(-0.12);
      auxPlane.rotateY(-0.3);
      auxPlane.translate(0.0, 0.715, -0.296);
      this.mesh(auxPlane, auxMaterial);
      this.add_(this.boxGeo(0.3, 0.115, 0.02, 0.0, 0.715, -0.305, -0.12, -0.3), pad);
    } else if (st.aux === 'clock') {
      // The stopwatch on top of the dash, facing the driver.
      this.aux = canvasTexture(128, 128);
      this.textures.push(this.aux.texture);
      const face = new THREE.CircleGeometry(0.038, 28);
      face.rotateX(-0.35);
      face.translate(0, 0.925, -0.46);
      this.mesh(face, this.mat({ map: this.aux.texture, toneMapped: false }, true));
      const pod = new THREE.CylinderGeometry(0.045, 0.048, 0.05, 28);
      pod.rotateX(Math.PI / 2 - 0.35);
      pod.translate(0, 0.918, -0.48);
      this.add_(pod, dash);
    } else {
      this.aux = null;
    }

    // ---- the driver's arms and gloved hands
    this.shoulders = { left: V(driverX - 0.21, 0.84, 0.46), right: V(driverX + 0.21, 0.84, 0.46) };
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

  /** The centre touchscreen: drawn once (a map and a music tile), it does not change while driving. */
  buildScreen(kind, bezel) {
    const { canvas, context: c, texture } = canvasTexture(512, 288);
    this.textures.push(texture);
    const W = canvas.width;
    const H = canvas.height;
    c.fillStyle = '#0d1114';
    c.fillRect(0, 0, W, H);
    // Map: a few roads on a dark grid, the route in colour, a position arrow.
    c.strokeStyle = '#1b242b';
    c.lineWidth = 1;
    for (let x = 0; x < W * 0.64; x += 24) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = 0; y < H; y += 24) { c.beginPath(); c.moveTo(0, y); c.lineTo(W * 0.64, y); c.stroke(); }
    c.strokeStyle = '#3a464f';
    c.lineWidth = 6;
    c.beginPath(); c.moveTo(20, 240); c.bezierCurveTo(120, 200, 90, 90, 200, 70); c.lineTo(310, 40); c.stroke();
    c.strokeStyle = kind === 'gt' ? '#d5001c' : '#ff7a00';
    c.lineWidth = 5;
    c.beginPath(); c.moveTo(20, 240); c.bezierCurveTo(120, 200, 90, 90, 200, 70); c.stroke();
    c.fillStyle = '#f4f1e8';
    c.beginPath(); c.moveTo(120, 170); c.lineTo(132, 140); c.lineTo(144, 170); c.lineTo(132, 162); c.closePath(); c.fill();
    // Right column: music and climate tiles.
    c.fillStyle = '#161c21';
    c.fillRect(W * 0.66, 12, W * 0.32, H * 0.46);
    c.fillRect(W * 0.66, H * 0.52, W * 0.32, H * 0.44);
    c.fillStyle = kind === 'gt' ? '#8a8f94' : '#c9b99a';
    c.font = '600 22px Khand, system-ui, sans-serif';
    c.fillText('RADIO', W * 0.69, 44);
    c.fillText('22.0°', W * 0.69, H * 0.62);
    c.fillStyle = '#f4f1e8';
    c.font = '600 28px Teko, Khand, system-ui, sans-serif';
    c.fillText('Pahadi FM', W * 0.69, 84);
    c.fillText('AUTO', W * 0.69, H * 0.78);
    texture.needsUpdate = true;
    const material = this.mat({ map: texture, toneMapped: false }, true);
    const plane = new THREE.PlaneGeometry(kind === 'gt' ? 0.24 : 0.25, kind === 'gt' ? 0.135 : 0.14);
    if (kind === 'gt') {
      // Upright between the vents, tilted slightly toward the driver.
      plane.rotateX(-0.1);
      plane.rotateY(-0.12);
      plane.translate(0, 0.755, -0.358);
      this.add_(this.boxGeo(0.26, 0.15, 0.02, 0, 0.755, -0.37, -0.1, -0.12), bezel);
    } else {
      // Face the centre display toward the right-hand seat.
      plane.rotateX(-0.2);
      plane.rotateY(0.12);
      plane.translate(0, 0.874, -0.339);
      this.add_(this.boxGeo(0.27, 0.16, 0.03, 0, 0.874, -0.357, -0.2, 0.12, 0, 0.012), bezel);
    }
    this.mesh(plane, material);
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
    if (this.valveIndicator) this.valveIndicator.emissiveIntensity = state.boosting ? 3.5 : 0.15;
    const gear = state.gear ?? 'N';
    if (state.shifted || gear !== this.lastGear) {
      if (gear !== this.lastGear) {
        this.shiftDirection = Number(gear) < Number(this.lastGear) ? -1 : 1;
        this.shiftTimer = 0.42;
      }
      this.lastGear = gear;
    }
    const shiftProgress = 1 - this.shiftTimer / 0.42;
    if (this.style.shifter === 'sequential') {
      this.shiftStick.rotation.x = -0.12 + this.shiftDirection * 0.29 * Math.sin(shiftProgress * Math.PI);
    } else {
      this.shiftStick.rotation.x = gear === 'R' ? -0.18 : gear === 'N' ? -0.08 : 0.06;
    }
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);

    // ---- hydraulic handbrake: hand and lever follow the input
    const wantHandbrake = state.handbrake ? 1 : 0;
    this.handbrakeBlend += (wantHandbrake - this.handbrakeBlend) * (1 - Math.exp(-14 * dt));
    this.leverPull += (wantHandbrake - this.leverPull) * (1 - Math.exp(-(wantHandbrake ? 22 : 10) * dt));
    this.handbrakeLever.rotation.x = -0.32 + 0.45 * this.leverPull;

    // Right hand: 0 = on the wheel, 1 = on the gear knob or the handbrake.
    // Paddles and automatics are shifted from the wheel; only a gear stick or a lever needs the right hand.
    const shiftReach = this.shiftTimer > 0 && this.style.shifter === 'sequential' ? Math.sin(Math.min(1, shiftProgress) * Math.PI) ** 0.5 : 0;
    const onLever = Math.max(shiftReach, this.style.handbrake === 'hydraulic' ? this.handbrakeBlend : 0);
    if (this.paddles) {
      this.paddleFlick = this.shiftTimer > 0.3 ? 1 : Math.max(0, this.paddleFlick - dt * 8);
      this.paddles[0].rotation.x = this.shiftDirection < 0 ? -0.35 * this.paddleFlick : 0;
      this.paddles[1].rotation.x = this.shiftDirection > 0 ? -0.35 * this.paddleFlick : 0;
    }
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
    if (this.auxClock <= 0 && this.aux) {
      this.auxClock = 1 / 8;
      if (this.style.aux === 'clock') this.drawClock();
      else this.drawAux(state);
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
    let radius = WHEEL_RADIUS;
    if (this.style.wheelType === 'gt') {
      // Intersect the hand's ray with the rotated polygonal grip. Sliding hands
      // stay on the short top/bottom edges even at full steering lock.
      const localAngle = angle - this.wheelTurn;
      const dx = Math.sin(localAngle), dy = Math.cos(localAngle);
      for (let i = 0; i < GT_RIM.length; i++) {
        const [x,y] = GT_RIM[i], [nx,ny] = GT_RIM[(i+1) % GT_RIM.length];
        const ex = nx-x, ey = ny-y;
        const cross = dx*ey - dy*ex;
        if (Math.abs(cross) < 1e-8) continue;
        const t = (x*ey - y*ex) / cross, u = (x*dy - y*dx) / cross;
        if (t > 0 && u >= 0 && u <= 1) { radius = t; break; }
      }
    }
    outPos.set(s * radius, c * radius, 0.012).applyMatrix4(this.wheelMount.matrix);
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
    if (this.style.cluster === 'race') return this.drawRaceDisplay(state);
    if (this.style.cluster === 'twin') return this.drawTwinDisplay(state);
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

  drawRaceDisplay(state) {
    const { context: c, texture } = this.cluster;
    const rpm = Math.round(state.rpm || 0);
    const fraction = rpm / (state.rpmMax || 9250);
    const speed = Math.round(Math.abs(state.speedKmh ?? (state.speed || 0) * 3.6));
    c.fillStyle = '#101921';
    c.fillRect(0, 0, 512, 208);
    for (let i = 0; i < 16; i++) {
      c.fillStyle = fraction < .48 + i * .033 ? '#303a40' : i < 8 ? '#43dc93' : i < 12 ? '#ffd668' : '#ff5a46';
      c.fillRect(9 + i * 31, 8, 27, 15);
    }
    c.fillStyle = '#30424e';
    c.fillRect(183, 35, 2, 154);
    c.fillRect(332, 35, 2, 154);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = 'bold 23px sans-serif';
    c.fillStyle = '#8ec8cb';
    c.fillText('KM/H', 94, 62);
    c.fillText('RPM', 420, 62);
    c.font = 'bold 55px sans-serif';
    c.fillStyle = '#edf7f7';
    c.fillText(String(speed), 94, 125);
    c.font = 'bold 44px sans-serif';
    c.fillText(String(rpm), 420, 125);
    c.font = 'bold 132px sans-serif';
    c.fillStyle = fraction > .97 ? '#ffb15f' : '#ffffff';
    c.fillText(String(state.gear ?? 'N'), 258, 112);
    texture.needsUpdate = true;
  }

  /** Hill 4x4: a 10.25-inch driver display, tach left, speedo right, gear and 4x4 mode between. */
  drawTwinDisplay(state) {
    const { context: c, texture } = this.cluster;
    const W = 512;
    const H = 208;
    const rpmMax = state.rpmMax > 1000 ? state.rpmMax : 4600;
    const scaleMax = Math.ceil((rpmMax + 400) / 1000) * 1000;
    this.shownRpm += ((state.rpm || 0) - this.shownRpm) * 0.5;
    const rpm = Math.max(0, this.shownRpm);
    const kmh = Math.abs(state.speedKmh ?? (state.speed || 0) * 3.6);
    c.fillStyle = '#06090d';
    c.fillRect(0, 0, W, H);
    const ring = (cx, value, max, step, label, unit) => {
      const cy = 104;
      const r = 84;
      const a0 = Math.PI * 0.75;
      const a1 = Math.PI * 2.25;
      c.strokeStyle = '#1d2630'; c.lineWidth = 10;
      c.beginPath(); c.arc(cx, cy, r - 6, a0, a1); c.stroke();
      c.strokeStyle = '#ff7a00'; c.lineWidth = 10;
      c.beginPath(); c.arc(cx, cy, r - 6, a0, a0 + (a1 - a0) * Math.min(1, value / max)); c.stroke();
      c.font = '500 14px Khand, system-ui, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#c9ced3';
      for (let v = 0; v <= max; v += step) {
        const a = a0 + ((a1 - a0) * v) / max;
        c.fillText(String(label(v)), cx + Math.cos(a) * (r - 28), cy + Math.sin(a) * (r - 28));
      }
      c.fillStyle = '#f2ede2';
      c.font = '700 34px Teko, Khand, system-ui, sans-serif';
      c.fillText(unit === 'km/h' ? String(Math.round(value)) : (value / 1000).toFixed(1), cx, cy + 4);
      c.fillStyle = '#7d8790';
      c.font = '500 12px Khand, system-ui, sans-serif';
      c.fillText(unit, cx, cy + 30);
    };
    ring(96, rpm, scaleMax, 1000, (v) => v / 1000, 'x1000 rpm');
    ring(416, kmh, 200, 40, (v) => v, 'km/h');
    const gear = String(state.gear ?? 'N');
    c.textAlign = 'center';
    c.fillStyle = '#f2ede2';
    c.font = '700 44px Teko, Khand, system-ui, sans-serif';
    c.fillText(gear === 'R' || gear === 'N' ? gear : `D${gear}`, 256, 86);
    c.fillStyle = '#ff7a00';
    c.fillRect(226, 118, 60, 24);
    c.fillStyle = '#06090d';
    c.font = '700 18px Teko, Khand, system-ui, sans-serif';
    c.fillText('4H', 256, 131);
    c.fillStyle = '#7d8790';
    c.font = '500 13px Khand, system-ui, sans-serif';
    c.fillText(state.boosting ? 'BOOST' : '18°C', 256, 165);
    texture.needsUpdate = true;
  }

  /** The stopwatch on the dash: black face, white markers, a sweeping seconds hand. */
  drawClock() {
    const { context: c, texture } = this.aux;
    const cx = 64;
    const cy = 64;
    c.fillStyle = '#060606';
    c.fillRect(0, 0, 128, 128);
    c.strokeStyle = '#e8e8e8';
    for (let k = 0; k < 60; k += 1) {
      const a = (k / 60) * Math.PI * 2;
      const len = k % 5 === 0 ? 10 : 4;
      c.lineWidth = k % 5 === 0 ? 3 : 1;
      c.beginPath();
      c.moveTo(cx + Math.sin(a) * 58, cy - Math.cos(a) * 58);
      c.lineTo(cx + Math.sin(a) * (58 - len), cy - Math.cos(a) * (58 - len));
      c.stroke();
    }
    const now = new Date();
    const hand = (value, length, width, colour) => {
      const a = value * Math.PI * 2;
      c.strokeStyle = colour; c.lineWidth = width;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.sin(a) * length, cy - Math.cos(a) * length); c.stroke();
    };
    hand(((now.getHours() % 12) + now.getMinutes() / 60) / 12, 30, 4, '#e8e8e8');
    hand(now.getMinutes() / 60, 44, 3, '#e8e8e8');
    hand((now.getSeconds() + now.getMilliseconds() / 1000) / 60, 52, 1.5, '#e0002a');
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
    this.stageKit?.removeFromParent();
    this.traverse((node) => node.geometry?.dispose());
    this.materials.forEach((material) => material !== this.paint && material !== this.stripe && material.dispose());
    this.textures.forEach((texture) => texture.dispose());
  }
}
