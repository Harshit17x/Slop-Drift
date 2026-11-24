// The cars a driver can pick in the garage. Each one is the shared physics with its own tuning
// overrides (deep-merged over the handling preset), a body (procedural, or a GLB built by
// tools/blender/cars/), and an interior style for the cockpit camera (see Cockpit.js STYLES).
// Wheel positions and radii come from tools/blender/cars/split_export.py's printout.

import { BASE_TUNING } from './tuning.js';

const scalePoints = (points, sx, sy, sz) => points.map(([x, y, z, ...rest]) => [x * sx, y * sy, z * sz, ...rest]);

export const CARS = Object.freeze([
  Object.freeze({
    id: 'hatch',
    label: 'Rally Hatch',
    blurb: 'Light, rear-drive, built to slide',
    model: null,
    cockpit: 'drift',
    // A built drift car with a nitrous bottle. The road cars have none, as in real life.
    nitro: true,
    tuning: null,
  }),
  Object.freeze({
    id: 'gt',
    label: 'Track RS',
    blurb: 'Rear-engine, 9,000 rpm, big wing',
    model: new URL('../assets/cars/gt.glb', import.meta.url).href,
    // Rebuilt PBR textures encode body paint / forged-rim masks in RGBA Alpha and AO/Roughness/Metalness
    // in ORM channels; multi-layer paint/rim colour-blend shader tints painted zones while keeping carbon,
    // glass, decals, gold crest and rubber tyres intact, plus glowing front headlamp ovals & rear light bar.
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
      GT_Wheel: {
        role: 'rim',
        paintMode: 'maskedRim',
        color: 0xffffff,
        metalness: 1,
        roughness: 1,
        rimMetalness: 0.88,
        rimRoughness: 0.19,
        clearcoat: 0.42,
        clearcoatRoughness: 0.12,
        aoMapIntensity: 0.45,
        envMapIntensity: 1.35,
      },
      GT_BrakeDisc: { color: 0x5c626c, metalness: 0.92, roughness: 0.28, envMapIntensity: 1.25 },
    },
    lamps: { tail: [[0, 0.64, 1.975, 1.16, 0.024]] },
    cockpit: 'gt',
    // Flat-six: 3 firing pulses per revolution (rpm / 20 Hz), dry and metallic, intake howl above 6,000 rpm.
    sound: { fires: 3, tone: 1.15, intake: 2.4, intakeFreq: [1100, 3200], drive: 0.8, body: 0.5, crackle: 0.6 },
    // Sources: Porsche press kit and spec sheets (1,450 kg, 2,457 mm wheelbase, 465 Nm @ 6,300, 9,000 rpm,
    // 860 kg downforce @ 285 km/h, 296 km/h), evo (springs ~50% stiffer than the GT3), Car and Driver
    // (1.16 g skidpad). Unpublished figures are estimates: 39/61 weight split, ~2.9 Hz front / 3.0 Hz rear
    // ride, damping ~0.7 bump / 0.85 rebound, 991.2 PDK ratios with a shorter final drive.
    tuning: {
      mass: 1450,
      com: { y: 0.45, z: 0.25 }, // 39 % front
      inertiaBox: { width: 1.87, height: 1.1, length: 4.0 },
      geometry: { frontAxleZ: -1.12, rearAxleZ: 1.125, halfTrack: 0.742, wheelRadius: 0.335, wheelCenterY: 0.335 },
      // Double wishbone front, multi-link rear, rose-jointed; per-wheel rates for the ride frequencies above.
      suspension: {
        staticLength: 0.22, travel: 0.08, springFront: 94000, springRear: 157000,
        bumpFront: 7200, reboundFront: 8800, bumpRear: 11700, reboundRear: 14200,
        antiRollFront: 42000, antiRollRear: 30000, maxForce: 90000,
      },
      // Cup-type tyres, 275 front / 335 rear: the wider rear carries the engine.
      tire: { mu: 1.3, frontGrip: 1.0, rearGrip: 1.06, peakSlipDeg: 7, slideRatio: 0.8, falloff: 1.6 },
      drivetrain: {
        peakTorque: 465, idleRpm: 950, launchRpm: 4500, redlineRpm: 9000, limiterRpm: 9100, upshiftRpm: 8900,
        downshiftRpmCoast: 2600, downshiftRpmPower: 5600,
        torqueCurve: [[0, 0.6], [1500, 0.71], [3000, 0.8], [4000, 0.86], [5500, 0.97], [6300, 1], [7500, 0.98], [8500, 0.94], [9000, 0.88], [9300, 0.4]],
        gearRatios: [3.75, 2.38, 1.72, 1.34, 1.11, 0.96, 0.84], finalDrive: 4.5, shiftTime: 0.08,
      },
      brakes: { maxForce: 23000, frontBias: 0.6 },
      // 860 kg at 79 m/s: liftArea = F / (0.5 rho v^2) = 2.2 m^2, balance ~30/70.
      aero: { dragArea: 0.8, liftArea: 2.2, downforceFront: 0.3 },
      body: {
        contactPoints: scalePoints(BASE_TUNING.body.contactPoints, 1.04, 0.93, 0.93),
        collisionSpheres: scalePoints(BASE_TUNING.body.collisionSpheres, 1.04, 0.93, 0.93),
      },
    },
  }),
  Object.freeze({
    id: 'thar',
    label: 'Hill 4x4',
    blurb: 'Four-wheel drive, tall springs: made for mud',
    model: new URL('../assets/cars/thar.glb', import.meta.url).href,
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
      Thar_Glass_Dark: { color: 0x0b1016, metalness: 0.12, roughness: 0.03, clearcoat: 1.0, clearcoatRoughness: 0.02, envMapIntensity: 1.50, transparent: true, opacity: 0.62, vertexAoStrength: 0.0 },
    },
    cockpit: 'suv',
    // Diesel four: 2 pulses per revolution (rpm / 30 Hz), dark, injector clatter, turbo whistle, no pops.
    sound: { fires: 2, tone: 0.5, intake: 0.4, intakeFreq: [400, 900], drive: 0.6, body: 1.4, crackle: 0, clatter: 1, turbo: 1 },
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
        antiRollFront: 14000, antiRollRear: 6000,
      },
      // Highway-terrain tyres: about 0.8 g on dry tarmac, forgiving past the limit.
      tire: { mu: 0.98, peakSlipDeg: 10, slideRatio: 0.88, falloff: 1.0 },
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
        contactPoints: scalePoints(BASE_TUNING.body.contactPoints, 1.12, 1.45, 1.1),
        collisionSpheres: scalePoints(BASE_TUNING.body.collisionSpheres, 1.12, 1.45, 1.1),
      },
    },
  }),
]);

export function getCar(id) {
  return CARS.find((car) => car.id === id) || CARS[0];
}
