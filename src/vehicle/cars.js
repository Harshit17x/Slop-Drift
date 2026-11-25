// The cars a driver can pick in the garage. Each one is the shared physics with its own tuning
// overrides (deep-merged over the handling preset), a body (procedural, or a GLB built by
// tools/blender/cars/), and an interior style for the cockpit camera (see Cockpit.js STYLES).
// Wheel positions and radii come from tools/blender/cars/split_export.py's printout.

import { SURFACE } from '../config.js';
import { BASE_TUNING } from './tuning.js';

const HAS_URL = typeof import.meta.url === 'string';
const scalePoints = (points, sx, sy, sz) => points.map(([x, y, z, ...rest]) => [x * sx, y * sy, z * sz, ...rest]);

export const CARS = Object.freeze([
  Object.freeze({
    id: 'hatch',
    label: 'Rally Hatch',
    titleLines: Object.freeze(['RALLY', 'HATCH']),
    blurb: 'Turbo gravel hatch with all-wheel drive',
    classCode: 'B185',
    classRank: 185,
    classBand: 'b',
    origin: 'IND',
    category: 'GRAVEL RALLY',
    drivetrain: 'AWD',
    gearboxLabel: '5-SPD SEQ',
    thumbnail: HAS_URL ? new URL('../assets/ui/car-hatch.webp', import.meta.url).href : null,
    ratings: Object.freeze({ acceleration: 6.8, topSpeed: 7.1, handling: 7.4, control: 9.2 }),
    specs: Object.freeze({
      massKg: 1280,
      peakTorqueNm: 395,
      redlineRpm: 6900,
      gears: 5,
      layoutLabel: 'AWD · Turbo Four',
      aeroLabel: 'Rally Roof Wing',
      nitro: true,
    }),
    model: null,
    cockpit: 'drift',
    // A built drift car with a nitrous bottle. The road cars have none, as in real life.
    nitro: true,
    // Rally2-style 1.6 turbo inline-four (even 180 deg firing, 2nd-order note) through a tubular manifold:
    // hard, gravelly rasp; anti-lag keeps the turbo lit off throttle (bangs, compressor-surge flutter);
    // straight-cut sequential whine; a small dry nitrous shot.
    sound: {
      fires: 2, tone: 1.1, intake: 1.3, intakeFreq: [700, 2400], drive: 1.25, body: 0.9, crackle: 1.2, cracklePitch: 0.85,
      turbo: 1, turboFreq: [2600, 7800], spoolRpm: [2400, 4200], spoolLag: 0.3, antiLag: 1, bov: 'flutter', whoosh: 0.8,
      whine: { level: 1, teeth: 24, perMps: 21 }, n2o: { hiss: 0.8, roar: 1.35, wet: false },
      synth: { firing: [0, 180, 360, 540], stagger: [0, 5, -4, 7], amps: [1, 0.93, 0.98, 0.9], highStagger: 0.6, pulse: [0.035, 0.024],
        level: 0.8, sample: 0.65, exhaust: [180, 1.1, 4], lowpass: [900, 9000], drive: 0.9, rough: 0.45, jitter: 9 },
    },
    // Fictional gravel stage setup, informed by Rally2 five-speed AWD cars.
    tuning: {
      geometry: { halfTrack: 0.843, wheelCenterY: 0.366, wheelRadius: 0.366 },
      mass: 1280, com: { y: 0.48, z: -0.12 },
      drivetrain: {
        awd: true, axleTorqueBias: 2.4, frontDriveShare: 0.5, peakTorque: 395,
        idleRpm: 1050, launchRpm: 3100, redlineRpm: 6900, limiterRpm: 7100,
        upshiftRpm: 6550, downshiftRpmPower: 3400, engineBrakeBase: 13,
        gearRatios: [3.15, 2.27, 1.76, 1.40, 1.14], finalDrive: 4.08, shiftTime: 0.095,
        torqueCurve: [[0,0.3],[1300,0.43],[2300,0.78],[3200,1],[4100,0.98],[5400,0.88],[6500,0.74],[7100,0.56]],
      },
      suspension: { staticLength: 0.29, travel: 0.145, springFront: 45800, springRear: 40800,
        bumpFront: 2870, reboundFront: 4900, bumpRear: 2660, reboundRear: 4540,
        // Gravel set-up: MacPherson struts both ends (roll centres ~90/120 mm), soft bars for traction,
        // ~1.8 deg/g of roll and 57 % front lateral load transfer (stable but rotates on the brakes).
        rollCentreFront: 0.09, rollCentreRear: 0.12, antiRollFront: 9700, antiRollRear: 1600,
        damperKnee: 0.16 },
      tire: { gravelPeakDeg: 12.5, gravelSlideRatio: 0.91 },
      brakes: { frontBias: 0.61 }, steering: { mechanicalLockDeg: 43 },
    },
  }),
  Object.freeze({
    id: 'gt',
    label: 'Track GT3',
    titleLines: Object.freeze(['TRACK', 'GT3']),
    blurb: 'Rear-engine endurance racer · 4.2 L flat-six',
    classCode: 'S312',
    classRank: 312,
    classBand: 's',
    origin: 'GER',
    category: 'GT3 ENDURANCE',
    drivetrain: 'RWD',
    gearboxLabel: '6-SPD SEQ',
    thumbnail: HAS_URL ? new URL('../assets/ui/car-gt.webp', import.meta.url).href : null,
    ratings: Object.freeze({ acceleration: 9.4, topSpeed: 9.6, handling: 9.5, control: 7.2 }),
    specs: Object.freeze({
      massKg: 1250, peakTorqueNm: 525, redlineRpm: 9250, gears: 6,
      layoutLabel: 'RWD · Flat-six', aeroLabel: 'Swan-neck wing', nitro: false,
    }),
    model: HAS_URL ? new URL('../assets/cars/gt3r.glb', import.meta.url).href : null,
    finish: {
      GT_Body: {
        role: 'paint',
        lens: true,
        paintMode: 'maskedBody',
        color: 0xffffff,
        metalness: 1,
        roughness: 1,
        defaultMetalness: 0.38,
        defaultRoughness: 0.16,
        clearcoat: 0.92,
        clearcoatRoughness: 0.05,
        aoMapIntensity: 0.55,
        envMapIntensity: 1.35,
        emissive: 0xfff5e4,
        emissiveIntensity: 0.95,
      },
      GT3R_Glazing: { color: 0x709099, metalness: 0.24, roughness: 0.11, clearcoat: 0.85,
        clearcoatRoughness: 0.065, envMapIntensity: 0.9, transparent: true, opacity: 0.46 },
      GT3R_LightGuide: { role: 'lens', color: 0xe5efff, emissive: 0xe3edff, emissiveIntensity: 0.8, roughness: 0.18, metalness: 0.24 },
      GT3R_Bronze: { role: 'rim', color: 0xb78a55, metalness: 0.77, roughness: 0.34 },
    },
    lamps: { tail: [[0, 0.64, 2.28, 1.24, 0.022]] },
    cockpit: 'gt',
    // Flat-six: 3 firing pulses per revolution (rpm / 20 Hz), dry and metallic, intake howl above 6,000 rpm.
    // Firing 1-6-2-4-3-5 alternates banks every 120 deg; the small bank-to-bank difference adds the 1.5-order
    // rasp under the 3rd-order wail. Naturally aspirated open race exhaust: sharp pulses, crisp high-pitched
    // overrun crackle, no turbo, no nitrous; straight-cut sequential transaxle whine, quick ignition-cut shifts.
    sound: {
      fires: 3, tone: 1.15, intake: 2.4, intakeFreq: [1100, 3200], drive: 0.8, body: 0.5, crackle: 0.6, cracklePitch: 1.25,
      shiftCut: 0.06, whine: { level: 0.8, teeth: 27, perMps: 24 },
      synth: { firing: [0, 120, 240, 360, 480, 600], stagger: [0, 9, 0, 9, 0, 9], amps: [1, 0.84, 1, 0.84, 1, 0.84], highStagger: 0.5,
        pulse: [0.018, 0.011], level: 1.3, sample: 0.5, exhaust: [1700, 1.3, 5], lowpass: [1400, 13000], drive: 0.25, rough: 0.2, jitter: 5 },
    },
    // 2023 Porsche 911 GT3 R technical data: 2507 mm wheelbase, staggered slicks,
    // 4.2 L, up to 416 kW, six-speed sequential and mechanical rear differential.
    // https://newsroom.porsche.com/en/2022/motorsports/porsche-911-gt3-r-generation-992-customer-racing-car-premiere-29201.html
    // Race weight depends on BoP. Torque map, axle loads, gearing, tyre curves,
    // dampers and aero coefficients below are simulation setup estimates.
    tuning: {
      mass: 1250, com: { y: 0.40, z: 0.22 },
      inertiaBox: { width: 2.04, height: 1.24, length: 4.619 },
      geometry: { frontAxleZ: -1.2535, rearAxleZ: 1.2535, halfTrack: 0.87, frontHalfTrack: 0.86,
        wheelRadius: 0.355, frontWheelRadius: 0.34, wheelCenterY: 0.355 },
      suspension: {
        staticLength: 0.21, travel: 0.071, springFront: 95000, springRear: 138000,
        bumpFront: 5400, reboundFront: 8100, bumpRear: 7700, reboundRear: 11300,
        maxForce: 90000,
        // Double wishbones both ends with low roll centres (~30/60 mm). Bars sized for ~0.5 deg/g of
        // roll and 47 % front lateral load transfer (a touch ahead of the 41 % weight: stable on power).
        // Race dampers digress early (knee ~80 mm/s) to ride the kerbs.
        rollCentreFront: 0.03, rollCentreRear: 0.06, antiRollFront: 36100, antiRollRear: 14300,
        damperKnee: 0.08,
      },
      steering: { maxLockDeg: 29, mechanicalLockDeg: 34, rate: 3.8, returnRate: 6.2 },
      // Slick mu at the static corner load; load sensitivity takes ~6 % off it at the limit.
      tire: { mu: 1.6, frontGrip: 1, rearGrip: 1.025, peakSlipDeg: 6.6, slideRatio: 0.83,
        falloff: 1.45, tractionControl: 0.45, gravelPeakDeg: 10, gravelSlideRatio: 0.76, loadSensitivity: 0.1,
        surfaceGrip: { [SURFACE.GRAVEL]: 0.76, [SURFACE.GRASS]: 0.64, [SURFACE.DIRT]: 0.78,
          [SURFACE.MUD]: 0.63, [SURFACE.SNOW]: 0.52, [SURFACE.HARDPACK]: 0.86, [SURFACE.WATER]: 0.57 } },
      drivetrain: {
        frontDriveShare: 0, axleTorqueBias: 2.5, peakTorque: 525,
        idleRpm: 1400, launchRpm: 4950, redlineRpm: 9250, limiterRpm: 9250, upshiftRpm: 9060,
        downshiftRpmCoast: 3000, downshiftRpmPower: 5300,
        torqueCurve: [[0,0.42],[2000,0.62],[3800,0.79],[5000,0.92],[6400,1],
          [7500,0.97],[8000,0.935],[8600,0.879],[9000,0.83],[9250,0.785]],
        gearRatios: [3.15, 2.22, 1.72, 1.40, 1.19, 1.02], finalDrive: 4.10, shiftTime: 0.065,
      },
      brakes: { maxForce: 24800, frontBias: 0.584, absRatio: 0.95 },
      aero: { dragArea: 1.08, liftArea: 2.7, downforceFront: 0.42 },
      body: {
        contactPoints: scalePoints(BASE_TUNING.body.contactPoints, 1.10, 0.92, 1.05),
        collisionSpheres: scalePoints(BASE_TUNING.body.collisionSpheres, 1.13, 0.94, 1.13),
      },
    },
  }),
  Object.freeze({
    id: 'thar',
    label: 'Hill 4x4',
    titleLines: Object.freeze(['HILL', '4X4']),
    blurb: 'Four-wheel drive, tall springs: made for mud',
    classCode: 'C164',
    classRank: 164,
    classBand: 'c',
    origin: 'IND',
    category: '4X4 TRAIL',
    drivetrain: 'AWD',
    gearboxLabel: '6-SPD AT',
    thumbnail: HAS_URL ? new URL('../assets/ui/car-thar.webp', import.meta.url).href : null,
    ratings: Object.freeze({ acceleration: 5.8, topSpeed: 5.4, handling: 6.5, control: 9.1 }),
    specs: Object.freeze({
      massKg: 1950,
      peakTorqueNm: 400,
      redlineRpm: 4500,
      gears: 6,
      layoutLabel: '4WD · Long Travel',
      aeroLabel: '235 mm Clearance',
      nitro: false,
    }),
    model: HAS_URL ? new URL('../assets/cars/thar.glb', import.meta.url).href : null,
    credit: '"Mahindra - Thar Roxx" by ansari_studios (sketchfab.com/ansari_studios), CC BY 4.0, reduced and re-rigged',
    srgbFactors: true,
    // Rebuilt canonical PBR slots + BVH raytraced vertex AO (COLOR_0) + procedural molded micro-grain.
    finish: {
      Thar_Paint: { role: 'paint', paintMode: 'solid', color: 0xffffff, metalness: 0.34, roughness: 0.20, clearcoat: 0.85, clearcoatRoughness: 0.06, envMapIntensity: 1.25, vertexAoStrength: 0.48, flake: 0.18, blend: 0.65 },
      Thar_Roof: { color: 0x16181c, metalness: 0.05, roughness: 0.66, clearcoat: 0.10, clearcoatRoughness: 0.45, envMapIntensity: 0.85, vertexAoStrength: 0.55, grainStrength: 0.08 },
      Thar_Cladding: { color: 0x16181b, metalness: 0.04, roughness: 0.82, envMapIntensity: 0.70, vertexAoStrength: 0.52, grainStrength: 0.09 },
      Thar_Tire_Rubber: { color: 0x141619, metalness: 0.0, roughness: 0.88, envMapIntensity: 0.55, vertexAoStrength: 0.55, grainStrength: 0.11 },
      Thar_Trim_Dark: { color: 0x0f1114, metalness: 0.12, roughness: 0.38, clearcoat: 0.25, clearcoatRoughness: 0.22, envMapIntensity: 0.95, vertexAoStrength: 0.48 },
      Thar_Bumper_Metal: { color: 0x26292e, metalness: 0.42, roughness: 0.46, envMapIntensity: 1.05, vertexAoStrength: 0.52, grainStrength: 0.05 },
      Thar_Trim_Steel: { color: 0x2f333a, metalness: 0.48, roughness: 0.42, envMapIntensity: 1.05, vertexAoStrength: 0.45 },
      Thar_Plate: { color: 0xf0ede3, metalness: 0.05, roughness: 0.48, envMapIntensity: 0.80, vertexAoStrength: 0.20 },
      Thar_Chrome: { color: 0xd8dde4, metalness: 0.96, roughness: 0.12, clearcoat: 0.40, envMapIntensity: 1.45, vertexAoStrength: 0.30 },
      Thar_Alloy_Accent: { color: 0x8a909a, metalness: 0.88, roughness: 0.26, envMapIntensity: 1.25, vertexAoStrength: 0.35 },
      Thar_Rim_Alloy: { role: 'rim', color: 0xcfd4dc, metalness: 0.90, roughness: 0.18, clearcoat: 0.42, clearcoatRoughness: 0.10, envMapIntensity: 1.35, vertexAoStrength: 0.35 },
      Thar_Rim_Gunmetal: { color: 0x2a2e34, metalness: 0.78, roughness: 0.34, envMapIntensity: 1.15, vertexAoStrength: 0.42 },
      Thar_Rim_Ring: { color: 0x16181c, metalness: 0.25, roughness: 0.44, envMapIntensity: 0.90, vertexAoStrength: 0.45 },
      Thar_Step_Silver: { color: 0xbac0c8, metalness: 0.85, roughness: 0.28, envMapIntensity: 1.25, vertexAoStrength: 0.40 },
      Thar_Brake_Disc: { color: 0x626872, metalness: 0.92, roughness: 0.28, envMapIntensity: 1.30, vertexAoStrength: 0.35 },
      Thar_Brake_Caliper: { color: 0xb81216, metalness: 0.35, roughness: 0.34, clearcoat: 0.55, clearcoatRoughness: 0.15, envMapIntensity: 1.10, vertexAoStrength: 0.30 },
      Thar_Tail_Lamp: { role: 'tail', color: 0x6e080c, emissive: 0xff1418, emissiveIntensity: 0.55, roughness: 0.20, clearcoat: 0.75, clearcoatRoughness: 0.08, vertexAoStrength: 0.10 },
      Thar_Signal_Amber: { color: 0xd4760a, emissive: 0xff8c12, emissiveIntensity: 0.35, roughness: 0.24, clearcoat: 0.60, vertexAoStrength: 0.10 },
      Thar_Headlamp_DRL: { role: 'lens', color: 0xf4f8ff, emissive: 0xfff5dc, emissiveIntensity: 0.85, roughness: 0.12, clearcoat: 0.80, envMapIntensity: 1.20, vertexAoStrength: 0.08 },
      Thar_Headlamp_Lens: { color: 0xdce6f0, metalness: 0.15, roughness: 0.04, clearcoat: 1.0, clearcoatRoughness: 0.03, envMapIntensity: 1.40, transparent: true, opacity: 0.22, vertexAoStrength: 0.0 },
      Thar_Cabin_Ivory: { color: 0xded6c4, roughness: 0.73, metalness: 0 },
      Thar_Glass_Dark: { color: 0x0b1016, metalness: 0.12, roughness: 0.03, clearcoat: 1.0, clearcoatRoughness: 0.02, envMapIntensity: 1.50, transparent: true, opacity: 0.36, vertexAoStrength: 0.0 },
    },
    cockpit: 'suv',
    // Diesel four: 2 pulses per revolution (rpm / 30 Hz), dark, injector clatter, turbo whistle, no pops.
    // Turbine + particulate filter round the pulses into a low, booming grumble with irregular combustion;
    // turbo lag to ~1,750 rpm, a soft wastegate chuff on lift; smooth torque-converter shifts (no dog clunk).
    sound: {
      fires: 2, tone: 0.5, intake: 0.4, intakeFreq: [400, 900], drive: 0.6, body: 1.4, crackle: 0, clatter: 1,
      turbo: 1, turboFreq: [2200, 7000], spoolRpm: [1300, 2600], spoolLag: 0.7, bov: 'chuff', whoosh: 0.5, clunk: 0.12, shiftCut: 0.05,
      synth: { firing: [0, 180, 360, 540], stagger: [0, 3, 0, 4], amps: [1, 0.95, 1, 0.92], pulse: [0.05, 0.04],
        level: 0.9, sample: 0.45, exhaust: [85, 1, 4], lowpass: [400, 2400], drive: 0.3, rough: 0.7, jitter: 12 },
    },
    // Sources: Autocar India / CarWale / Mahindra (2,850 mm wheelbase, 226-235 mm ground clearance,
    // 2.2 mHawk diesel 400 Nm @ 1,750-2,750 and 130 kW @ 3,500, 6-speed torque-converter automatic,
    // 255/60 R19, double wishbone front, Penta-link live axle with Watts linkage rear, frequency-dependent
    // MTV-CL dampers). Estimates: 1,950 kg 4x4 AT, 54/46 split, ~1.4 Hz front / 1.6 Hz rear ride, damping
    // ~0.35 bump / 0.55 rebound, ~200 mm of wheel travel, soft anti-roll bars, gear ratios.
    tuning: {
      mass: 1950,
      com: { y: 0.78, z: -0.12 }, // 54 % front
      inertiaBox: { width: 2.0, height: 1.9, length: 4.4 },
      geometry: { frontAxleZ: -1.473, rearAxleZ: 1.473, halfTrack: 0.795, wheelRadius: 0.415, wheelCenterY: 0.415 },
      suspension: {
        staticLength: 0.34, travel: 0.11, springFront: 40700, springRear: 45300,
        bumpFront: 3240, reboundFront: 5100, bumpRear: 3150, reboundRear: 4950,
        // Wishbone front roll centre ~120 mm; the live axle's Watts linkage puts the rear one near hub
        // height (~420 mm). The rear coils sit ~1.1 m apart on the axle, inside the 1.59 m track, so
        // they resist roll like (1.1/1.59)^2 of wheel-mounted springs: a negative "bar" expresses that.
        // Result ~4.8 deg/g of body roll and 60 % front load transfer (safe, understeering SUV).
        rollCentreFront: 0.12, rollCentreRear: 0.42, antiRollFront: 19100, antiRollRear: -11000,
        damperKnee: 0.2,
      },
      // Highway-terrain tyres: about 0.8 g on dry tarmac, forgiving past the limit.
      // Tall sidewalls: more load-sensitive than a sports tyre.
      tire: { mu: 0.98, peakSlipDeg: 10, slideRatio: 0.88, falloff: 1.0, loadSensitivity: 0.16 },
      drivetrain: {
        awd: true, peakTorque: 400, idleRpm: 800, launchRpm: 1300, redlineRpm: 4500, limiterRpm: 4800, upshiftRpm: 4100,
        downshiftRpmCoast: 1100, downshiftRpmPower: 2200,
        // Turbo lag: little boost below ~1,500 rpm, full torque from 1,750.
        torqueCurve: [[0, 0.32], [800, 0.36], [1250, 0.52], [1500, 0.75], [1750, 1], [2750, 1], [3500, 0.88], [4000, 0.72], [4500, 0.55], [4800, 0.3]],
        gearRatios: [4.7, 2.9, 1.8, 1.2, 0.85, 0.65], finalDrive: 4.1, shiftTime: 0.22,
        engineBrakeBase: 14,
      },
      brakes: { maxForce: 17000 },
      aero: { dragArea: 1.5, liftArea: 0 },
      body: {
        // Underbody, rocker panels and roof corners in the exported model's metre frame.
        contactPoints: [
          [-0.81, 0.30, -1.98], [0.81, 0.30, -1.98], [-0.83, 0.32, 2.10], [0.83, 0.32, 2.10],
          [0, 0.29, -2.04], [0, 0.5, 2.32], [-0.96, 0.34, 0], [0.96, 0.34, 0],
          [-0.72, 1.9, -0.22], [0.72, 1.9, -0.22], [-0.74, 1.91, 1.90], [0.74, 1.91, 1.90],
        ],
        collisionSpheres: [
          [-0.68, 0.55, -1.82, 0.30], [0.68, 0.55, -1.82, 0.30],
          [-0.68, 0.58, 1.96, 0.30], [0.68, 0.58, 1.96, 0.30],
          [-0.68, 0.54, 0, 0.30], [0.68, 0.54, 0, 0.30],
          [0, 1.08, 2.18, 0.31], // tailgate-mounted spare
        ],
      },
    },
  }),
  Object.freeze({
    id: 'tokyo',
    label: 'Tokyo Sedan',
    titleLines: Object.freeze(['TOKYO', 'DRIFT']),
    blurb: 'Widebody AWD rally-drift sedan with burnt-ti twin cannons',
    classCode: 'A255',
    classRank: 255,
    classBand: 'a',
    origin: 'JPN',
    category: 'TOKYO RALLY DRIFT',
    drivetrain: 'AWD',
    gearboxLabel: '6-SPD SEQ',
    thumbnail: HAS_URL ? new URL('../assets/ui/car-tokyo.webp', import.meta.url).href : null,
    ratings: Object.freeze({ acceleration: 8.6, topSpeed: 8.4, handling: 9.1, control: 8.3 }),
    specs: Object.freeze({
      massKg: 1320,
      peakTorqueNm: 510,
      redlineRpm: 8000,
      gears: 6,
      layoutLabel: 'AWD · Twin-Scroll',
      aeroLabel: 'Carbon GT Wing',
      nitro: true,
    }),
    model: HAS_URL ? new URL('../assets/cars/tokyo.glb', import.meta.url).href : null,
    finish: {
      Tokyo_Paint: {
        role: 'paint',
        paintMode: 'solid',
        color: 0xffffff,
        metalness: 0.42,
        roughness: 0.17,
        clearcoat: 0.94,
        clearcoatRoughness: 0.05,
        envMapIntensity: 1.35,
        flake: 0.22,
        blend: 0.68,
      },
      Tokyo_Livery: { role: 'paint', paintMode: 'solid', color: 0xffffff, metalness: 0.28, roughness: 0.22, clearcoat: 0.72, envMapIntensity: 1.15, flake: 0.16, blend: 0.56 },
      Tokyo_Carbon: { metalness: 0.16, roughness: 0.34, clearcoat: 0.48, envMapIntensity: 1.05 },
      Tokyo_DarkTrim: { color: 0x16181c, metalness: 0.06, roughness: 0.72, envMapIntensity: 0.72 },
      Tokyo_Metal: { color: 0xc2c8d0, metalness: 0.88, roughness: 0.22, envMapIntensity: 1.35 },
      Tokyo_Exhaust_Tip: { metalness: 0.94, roughness: 0.16, clearcoat: 0.35, envMapIntensity: 1.55 },
      Tokyo_Exhaust_Bore: { color: 0x0c090a, metalness: 0.05, roughness: 0.95 },
      Tokyo_AccentRed: { color: 0xc81612, metalness: 0.18, roughness: 0.34, clearcoat: 0.45 },
      Tokyo_Rim: { role: 'rim', color: 0xb88636, metalness: 0.86, roughness: 0.24, clearcoat: 0.35, clearcoatRoughness: 0.12, envMapIntensity: 1.3 },
      Tokyo_Disc: { color: 0x626770, metalness: 0.88, roughness: 0.32, envMapIntensity: 1.2 },
      Tokyo_Tyre: { color: 0x141619, metalness: 0.0, roughness: 0.86, envMapIntensity: 0.55 },
      Tokyo_Glass: { color: 0x263c48, metalness: 0.16, roughness: 0.06, clearcoat: 0.95, clearcoatRoughness: 0.04, envMapIntensity: 1.35, transparent: true, opacity: 0.40 },
      Tokyo_Headlamp_Lens: { role: 'lens', color: 0xf4f8ff, emissive: 0xfff5dc, emissiveIntensity: 0.9, roughness: 0.12, clearcoat: 0.85, envMapIntensity: 1.2 },
      Tokyo_Fog_Lens: { role: 'lens', color: 0xfff0cc, emissive: 0xffdf94, emissiveIntensity: 0.85, roughness: 0.14, clearcoat: 0.8, envMapIntensity: 1.15 },
      Tokyo_Tail_Lamp: { role: 'tail', color: 0x8e0b0e, emissive: 0xff1618, emissiveIntensity: 0.72, roughness: 0.18, clearcoat: 0.8 },
      Tokyo_Amber: { color: 0xd96b08, emissive: 0xff8c12, emissiveIntensity: 0.42, roughness: 0.22, clearcoat: 0.6 },
    },
    exhaustTips: Object.freeze([[-0.57, 0.27, 2.33], [0.57, 0.27, 2.33]]),
    cockpit: 'drift',
    nitro: true,
    // Turbo 2.5 flat-four (EJ257-style boxer) on unequal-length headers: even 180 deg firing, but the
    // pulses reach the collector unevenly, so half orders fill in under the 2nd-order note -> the boxer
    // "rumble" a Rally Hatch's equal inline-four doesn't have. Bigger, later-spooling turbo with an
    // atmospheric blow-off valve ("pssh"), deeper burbly overrun, sequential whine, wet nitrous kit
    // (nitrous + fuel solenoids clack together).
    sound: {
      fires: 2, tone: 1.05, intake: 2.2, intakeFreq: [950, 2900], drive: 1.0, body: 1.1, crackle: 1.0, cracklePitch: 0.8,
      turbo: 1, turboFreq: [2000, 6400], spoolRpm: [2800, 4600], spoolLag: 0.45, bov: 'valve', whoosh: 1,
      whine: { level: 0.6, teeth: 23, perMps: 19 }, n2o: { hiss: 1, roar: 1.5, wet: true },
      synth: { firing: [0, 180, 360, 540], stagger: [0, 34, -8, 26], amps: [1, 0.86, 0.96, 0.82], highStagger: 0.45, pulse: [0.03, 0.02],
        level: 0.95, sample: 0.55, exhaust: [120, 0.9, 5], lowpass: [800, 9000], drive: 0.6, rough: 0.4, jitter: 9 },
    },
    tuning: {
      mass: 1320,
      com: { y: 0.44, z: -0.08 },
      inertiaBox: { width: 1.98, height: 1.38, length: 4.52 },
      geometry: {
        frontAxleZ: -1.35,
        rearAxleZ: 1.35,
        halfTrack: 0.855,
        wheelRadius: 0.340,
        wheelCenterY: 0.340,
      },
      suspension: {
        staticLength: 0.25,
        travel: 0.125,
        springFront: 54000,
        springRear: 51000,
        bumpFront: 3350,
        reboundFront: 5450,
        bumpRear: 3180,
        reboundRear: 5200,
        // Lowered MacPherson front / multi-link rear (roll centres ~60/100 mm); bars sized for
        // ~1.5 deg/g of roll and a neutral 53 % front load transfer, so the tail stays lively.
        rollCentreFront: 0.06,
        rollCentreRear: 0.10,
        antiRollFront: 8000,
        antiRollRear: 2200,
        damperKnee: 0.14,
      },
      steering: { maxLockDeg: 40, mechanicalLockDeg: 46, rate: 4.1, returnRate: 6.4 },
      tire: {
        mu: 1.24,
        peakSlipDeg: 11.2,
        slideRatio: 0.92,
        falloff: 1.15,
        gravelPeakDeg: 13.0,
        gravelSlideRatio: 0.92,
      },
      drivetrain: {
        awd: true,
        frontDriveShare: 0.32,
        axleTorqueBias: 2.9,
        peakTorque: 510,
        idleRpm: 1150,
        launchRpm: 3800,
        redlineRpm: 8000,
        limiterRpm: 8200,
        upshiftRpm: 7700,
        downshiftRpmCoast: 1800,
        downshiftRpmPower: 4200,
        torqueCurve: [
          [0, 0.34], [1600, 0.50], [2800, 0.82], [3800, 0.96],
          [5200, 1.0], [6600, 0.95], [7600, 0.86], [8200, 0.68],
        ],
        gearRatios: [3.22, 2.34, 1.80, 1.44, 1.19, 0.98],
        finalDrive: 4.18,
        shiftTime: 0.08,
        engineBrakeBase: 14,
      },
      brakes: { maxForce: 21500, frontBias: 0.60 },
      aero: { dragArea: 0.94, liftArea: 1.1, downforceFront: 0.38 },
      body: {
        contactPoints: scalePoints(BASE_TUNING.body.contactPoints, 1.04, 0.96, 1.04),
        collisionSpheres: scalePoints(BASE_TUNING.body.collisionSpheres, 1.05, 0.98, 1.05),
      },
    },
  }),
]);

export function getCar(id) {
  return CARS.find((car) => car.id === id) || CARS[0];
}
