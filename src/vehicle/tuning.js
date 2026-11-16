// Vehicle tuning: one base car plus handling presets merged over it as plain data.
// Units are SI throughout: kg, m, N, N/m, N·s/m, N·m, rad (angles given in degrees are named *Deg).
// Chassis space: -Z forward, +X right, +Y up, origin on the ground under the car centre at rest.

export const BASE_TUNING = Object.freeze({
  mass: 1300,
  /** Centre of mass relative to the chassis origin (slightly forward of the wheelbase centre). */
  com: { x: 0, y: 0.45, z: -0.08 },
  /** Box used for the inertia tensor (m). inertiaScale multiplies the box values per axis. */
  inertiaBox: { width: 1.8, height: 1.15, length: 4.3 },
  inertiaScale: { x: 1.0, y: 1.0, z: 1.0 },

  geometry: {
    frontAxleZ: -1.28,
    rearAxleZ: 1.27,
    halfTrack: 0.78,
    wheelRadius: 0.34,
    /** Wheel-centre height above the chassis origin at static ride height. */
    wheelCenterY: 0.34,
  },

  suspension: {
    /** Suspension length (mount to wheel centre) at static ride height; travel is +/- around it. */
    staticLength: 0.26,
    travel: 0.12,
    // Per-wheel spring rates for ~2 Hz ride frequency with a 53/47 static split.
    springFront: 54000,
    springRear: 48000,
    // Damping ratios ~0.35 bump / ~0.7 rebound.
    bumpFront: 3000,
    reboundFront: 6000,
    bumpRear: 2700,
    reboundRear: 5400,
    maxForce: 60000,
    /** Bump stop engages in the last bumpStopLength of compression, progressive, plus beyond the limit. */
    bumpStopLength: 0.03,
    bumpStopStiffness: 600000,
    bumpStopDamping: 9000,
    antiRollFront: 26000,
    antiRollRear: 16000,
    /** 1/cos(angle between ground normal and ray) is capped at this. */
    maxInvCos: 10,
  },

  tire: {
    /** Peak friction coefficient on a grip=1 surface. */
    mu: 1.12,
    frontGrip: 1.0,
    rearGrip: 1.0,
    /** Slip angle at peak lateral force. */
    peakSlipDeg: 8,
    /** Lateral force when fully sliding, as a fraction of the peak. */
    slideRatio: 0.84,
    /** How fast the curve falls from the peak toward slideRatio (per peak-slip unit beyond the peak). */
    falloff: 1.3,
    /** Locked (handbraked / unassisted lock-up) wheels slide at this fraction of mu. */
    lockedFriction: 0.72,
    /** Contact speed band (m/s) blending velocity-cancel friction (below) into the slip curve (above). */
    lowSpeedBlend: [2, 4],
    /** Lateral force from the curve never exceeds this fraction of the force that would cancel the slip in one step. */
    cancelCap: 0.5,
    /** Height of the lateral force application point: 0 = at CoM height, 1 = at the contact patch. */
    rollInfluence: 0.4,
    /** 0..1: how much of the remaining grip the drive force may use beyond the lateral demand (0 = raw). */
    tractionControl: 0,
  },

  drivetrain: {
    idleRpm: 900,
    launchRpm: 3200,
    redlineRpm: 7200,
    limiterRpm: 7400,
    peakTorque: 285,
    /** [rpm, fraction of peak torque] */
    torqueCurve: [
      [0, 0.55], [1000, 0.62], [2000, 0.78], [3000, 0.9], [4000, 0.98], [4800, 1.0],
      [5600, 0.95], [6400, 0.86], [7200, 0.74], [7600, 0.5],
    ],
    gearRatios: [3.4, 2.25, 1.65, 1.3, 1.07, 0.9],
    reverseRatio: 3.3,
    finalDrive: 3.7,
    efficiency: 0.88,
    shiftTime: 0.14,
    upshiftRpm: 6900,
    /** Auto downshift threshold, from coasting (0 throttle) to full throttle. */
    downshiftRpmCoast: 1700,
    downshiftRpmPower: 3600,
    /** Engine braking torque (N·m) = base + perRpm * rpm, scaled by (1 - throttle). */
    engineBrakeBase: 8,
    engineBrakePerRpm: 0.0055,
    rpmSmoothing: 18,
  },

  brakes: {
    /** Total brake force at full pedal, before the friction limit. */
    maxForce: 17500,
    frontBias: 0.66,
    /** ABS keeps braking wheels at this fraction of the remaining friction. */
    absRatio: 0.86,
    /** Hill hold: below this speed with no input the brakes hold the car. */
    hillHoldSpeed: 0.5,
    hillHoldForce: 3500,
    /** Without ABS a wheel locks when its brake force exceeds this multiple of mu*N. */
    lockThreshold: 1.0,
    reverseSpeed: 0.6,
    reverseDelay: 0.2,
  },

  aero: {
    airDensity: 1.225,
    /** Cd * frontal area, m^2. */
    dragArea: 0.9,
    /** Downforce coefficient * area, m^2. */
    liftArea: 0.55,
    /** Fraction of downforce on the front axle. */
    downforceFront: 0.45,
  },

  steering: {
    maxLockDeg: 34,
    /** Lock falls as maxLock / (1 + speed / lockSpeedRef), never below minLockDeg. */
    lockSpeedRef: 18,
    minLockDeg: 6,
    /** Hard mechanical limit (assist can countersteer up to here). */
    mechanicalLockDeg: 42,
    /** When steering into a slide the lock grows by this fraction of the front axle's travel angle. */
    countersteerRange: 1.0,
    /** Normalised steering units per second toward a larger angle / back toward centre. */
    rate: 3.2,
    returnRate: 6.0,
  },

  assist: {
    /** Effective assist = max(player setting, assistFloor). */
    assistFloor: 0,
    /** Body slip band over which the assist fades in. */
    slipStartDeg: 6,
    slipFullDeg: 24,
    /** At assist 1 the front wheels are blended this far toward the direction of travel. */
    steerBlend: 0.8,
    /** How much driver steer still adds on top of the travel direction while assisted. */
    driverAuthority: 0.45,
    /** Yaw-rate damping (1/s) at assist 1 while sliding. */
    yawDamping: 2.0,
    minSpeed: 5,
  },

  body: {
    /** Chassis contact points in chassis space (relative to origin). */
    contactPoints: [
      [-0.8, 0.17, -1.95], [0.8, 0.17, -1.95], [-0.8, 0.17, 1.9], [0.8, 0.17, 1.9],
      [0, 0.3, -2.2], [0, 0.32, 2.15],
      [-0.88, 0.55, 0], [0.88, 0.55, 0],
      [-0.68, 1.32, -0.75], [0.68, 1.32, -0.75], [-0.68, 1.32, 0.85], [0.68, 1.32, 0.85],
    ],
    contactStiffness: 300000,
    contactDamping: 16000,
    contactFriction: 0.55,
    contactMaxForce: 250000,
    /** Spheres tested against barriers and obstacles: [x, y, z, radius]. */
    collisionSpheres: [
      [-0.62, 0.55, -1.75, 0.3], [0.62, 0.55, -1.75, 0.3],
      [-0.62, 0.55, 1.75, 0.3], [0.62, 0.55, 1.75, 0.3],
      [-0.62, 0.55, 0, 0.3], [0.62, 0.55, 0, 0.3],
    ],
    obstacleCentreRadius: 0.95,
    restitution: 0.2,
    wallFriction: 0.3,
  },

  limits: {
    maxAngularSpeed: 12,
  },

  water: {
    drag: 2.5,
    buoyancy: 0.6,
  },
});

/** Presets are partial objects deep-merged over BASE_TUNING. No branches in the physics. */
export const HANDLING = Object.freeze({
  Arcade: {
    tire: { mu: 1.28, peakSlipDeg: 9, slideRatio: 0.9, falloff: 0.9, lockedFriction: 0.78, rollInfluence: 0.3, tractionControl: 0.6 },
    steering: { rate: 4.5, returnRate: 8, lockSpeedRef: 20 },
    assist: { assistFloor: 0.45, yawDamping: 2.8, steerBlend: 0.85 },
    suspension: { antiRollFront: 30000, antiRollRear: 18000 },
  },
  Balanced: {},
  Sim: {
    tire: { mu: 1.08, peakSlipDeg: 7, slideRatio: 0.78, falloff: 2.0, lockedFriction: 0.68, rollInfluence: 0.55 },
    steering: { rate: 2.8, returnRate: 5 },
    assist: { assistFloor: 0, yawDamping: 1.2, steerBlend: 0.7 },
    suspension: { antiRollFront: 24000, antiRollRear: 17000 },
  },
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, over) {
  const out = {};
  for (const key of Object.keys(base)) {
    const b = base[key];
    out[key] = isPlainObject(b) ? deepMerge(b, {}) : Array.isArray(b) ? b.map((v) => (Array.isArray(v) ? v.slice() : v)) : b;
  }
  if (!over) return out;
  for (const key of Object.keys(over)) {
    const o = over[key];
    out[key] = isPlainObject(o) && isPlainObject(out[key]) ? deepMerge(out[key], o) : Array.isArray(o) ? o.slice() : o;
  }
  return out;
}

/** Full tuning object for a preset name (unknown names fall back to 'Balanced'). */
export function resolveTuning(name = 'Balanced', overrides = null) {
  const preset = HANDLING[name] || HANDLING.Balanced;
  const merged = deepMerge(BASE_TUNING, preset);
  return overrides ? deepMerge(merged, overrides) : merged;
}
