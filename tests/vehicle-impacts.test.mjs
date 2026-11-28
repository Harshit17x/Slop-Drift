// Impact regression tests: `node tests/vehicle-impacts.test.mjs` (exit code 1 on failure).
// Driving off the road into a mountainside, a step between road beds, a barrier or a tree must stop,
// scrape or deflect the car, never launch it into the air.
import { Vehicle } from '../src/vehicle/Vehicle.js';
import { CONFIG } from '../src/config.js';

const DT = CONFIG.physics.fixedDt;
const DEG = Math.PI / 180;
let failures = 0;
let passes = 0;

function check(name, ok, detail = '') {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  (${detail})` : ''}`);
}

function fill(o, y, nx, ny, nz, surface = 0, grip = 1, rolling = 0.012) {
  const len = Math.hypot(nx, ny, nz);
  o.y = y; o.nx = nx / len; o.ny = ny / len; o.nz = nz / len;
  o.surface = surface; o.grip = grip; o.rolling = rolling; o.roughness = 0.02; o.roadId = -1;
  return o;
}

// ------------------------------------------------------------------ worlds (the car drives toward -Z)

/** Flat to z = -20, then a face rising at `deg` (an analytic plane). */
const faceWorld = (deg) => {
  const k = Math.tan(deg * DEG);
  return {
    waterLevel: -Infinity,
    sampleGround(x, z, o) {
      const d = -20 - z;
      return d <= 0 ? fill(o, 0, 0, 1, 0) : fill(o, k * d, 0, 1, k, 4, 0.62, 0.05);
    },
  };
};

/** The same face on a bilinear 2 m grid with normals from central differences, as TerrainGrid has it. */
const gridFaceWorld = (deg) => {
  const k = Math.tan(deg * DEG);
  const cell = 2;
  const node = (i) => Math.max(0, k * (-20 - i * cell));
  const h = (z) => { const g = z / cell; const i = Math.floor(g); return node(i) + (node(i + 1) - node(i)) * (g - i); };
  return {
    waterLevel: -Infinity,
    sampleGround: (x, z, o) => fill(o, h(z), 0, 1, -(h(z + cell) - h(z - cell)) / (2 * cell), 4, 0.62, 0.05),
  };
};

/** A step of height H over 0.4 m at z = -20 whose normal is smoothed, like a bank between two road beds. */
const stepWorld = (H) => ({
  waterLevel: -Infinity,
  sampleGround(x, z, o) {
    const t = Math.min(1, Math.max(0, (-20 - z) / 0.4));
    const ramp = z < -18 && z > -22 ? H / 4 : 0;
    return fill(o, H * t, 0, 1, ramp, 2, 0.56, 0.06);
  },
});

const flatGround = (x, z, o) => fill(o, 0, 0, 1, 0);

/** Straight wall along x = wallX. */
const barrierWorld = (wallX) => ({
  waterLevel: -Infinity,
  sampleGround: flatGround,
  collideBarrier(x, y, z, r, out) {
    const pen = x + r - wallX;
    out.hit = pen > 0; out.nx = -1; out.nz = 0; out.depth = Math.max(0, pen);
    return out;
  },
});

/** One round obstacle (tree trunk or boulder). */
const obstacleWorld = (ox, oz, radius) => ({
  waterLevel: -Infinity,
  sampleGround: flatGround,
  collideObstacle(x, y, z, r, out) {
    out.hit = false; out.depth = 0; out.nx = 0; out.nz = 0;
    const dx = x - ox;
    const dz = z - oz;
    const reach = r + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= reach * reach || d2 < 1e-8) return out;
    const d = Math.sqrt(d2);
    out.hit = true; out.depth = reach - d; out.nx = dx / d; out.nz = dz / d;
    return out;
  },
});

// ------------------------------------------------------------------ harness

/**
 * Drive at `kmh` with light throttle for `seconds`. rise: highest the centre of mass gets above its
 * ride height over the ground below it. maxAirRising: longest spell with no wheel down while the car
 * climbs. energyGain: peak (kinetic + potential) energy per kg above the start, throttle off.
 */
function drive(world, { kmh, yawDeg = 0, seconds = 4, throttle = 0.4 }) {
  const v = new Vehicle({ world, assists: { handling: 'balanced' } });
  v.teleport({ position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: Math.sin(yawDeg * DEG / 2), z: 0, w: Math.cos(yawDeg * DEG / 2) } });
  const ground = {};
  const rideHeight = v.position.y - world.sampleGround(v.position.x, v.position.z, ground).y;
  v.velocity.copy(v.forward).multiplyScalar(kmh / 3.6);
  const energy = () => 0.5 * v.velocity.lengthSq() + 9.81 * v.position.y;
  const e0 = energy();
  let rise = 0;
  let minUp = 1;
  let maxVy = 0;
  let air = 0;
  let maxAirRising = 0;
  let energyGain = -Infinity;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const s = v.step(DT, { throttle, brake: 0, steer: 0, handbrake: false, boost: false, shift: 0 });
    rise = Math.max(rise, v.position.y - world.sampleGround(v.position.x, v.position.z, ground).y - rideHeight);
    minUp = Math.min(minUp, v.up.y);
    maxVy = Math.max(maxVy, v.velocity.y);
    if (s.wheelsOnGround === 0 && v.velocity.y > 0.5) maxAirRising = Math.max(maxAirRising, air += DT);
    else air = 0;
    energyGain = Math.max(energyGain, energy() - e0);
  }
  return { v, rise, minUp, maxVy, maxAirRising, energyGain };
}

const fmt = (r) => `rise ${r.rise.toFixed(2)} m, peak vy ${r.maxVy.toFixed(1)} m/s, rising airtime ${r.maxAirRising.toFixed(2)} s, min up.y ${r.minUp.toFixed(2)}`;

// ------------------------------------------------------------------ tests

function testMountainFaces() {
  console.log('\nRunning off the road into a mountainside');
  for (const kmh of [60, 100, 140]) {
    for (const deg of [45, 60, 75, 85]) {
      for (const [label, world] of [['plane', faceWorld(deg)], ['grid', gridFaceWorld(deg)]]) {
        const r = drive(world, { kmh });
        check(`${deg} deg ${label} face at ${kmh} km/h stops the car without launching it`,
          r.rise < 2 && r.maxAirRising < 0.75 && r.minUp > 0.1 && r.v.velocity.length() < 12, fmt(r));
      }
    }
  }
}

function testRoadBedSteps() {
  console.log('\nHitting a bank between two road beds (a step with a smoothed normal)');
  for (const H of [0.4, 0.7]) {
    for (const kmh of [60, 100, 140]) {
      const r = drive(stepWorld(H), { kmh });
      check(`${H} m step at ${kmh} km/h`, r.rise < 1.5 && r.maxVy < 7 && r.minUp > 0.5, fmt(r));
    }
  }
}

function testBarriersAndObstacles() {
  console.log('\nBarriers and obstacles');
  for (const kmh of [60, 100, 140]) {
    for (const yaw of [-20, -45, -90]) {
      const r = drive(barrierWorld(6), { kmh, yawDeg: yaw, throttle: 0 });
      check(`barrier at ${-yaw} deg, ${kmh} km/h: no lift, no energy gained`,
        r.maxVy < 1 && r.rise < 0.1 && r.minUp > 0.9 && r.energyGain < 0.5, `${fmt(r)}, energy gain ${r.energyGain.toFixed(2)} J/kg`);
    }
    for (const [label, world] of [['tree, head on', obstacleWorld(0, -20, 0.5)], ['tree, offset', obstacleWorld(0.9, -20, 0.5)], ['boulder', obstacleWorld(0.5, -20, 2)]]) {
      const r = drive(world, { kmh, throttle: 0 });
      check(`${label} at ${kmh} km/h: no lift, no energy gained`,
        r.maxVy < 1 && r.rise < 0.1 && r.minUp > 0.9 && r.energyGain < 0.5, `${fmt(r)}, energy gain ${r.energyGain.toFixed(2)} J/kg`);
    }
  }
}

function testWheelRaysStayOnTheRay() {
  console.log('\nWheel rays on steep faces and tilted chassis');
  // A wheel ray that diverges on a steep face used to report a hit above its own mount, which the
  // bump stop turned into a full-force push. Every hit must be on the ray, below the mount, in reach.
  const world = gridFaceWorld(60);
  const v = new Vehicle({ world });
  const sample = {};
  const g = {};
  let worst = 0;
  let negative = 0;
  let hits = 0;
  for (let i = 0; i < 2000; i++) {
    const a = (i * 0.618034) % 1;
    const b = (i * 0.414214) % 1;
    const pitch = (a - 0.5) * 140 * DEG; // chassis-down tilted up to 70 degrees either way
    const dx = 0;
    const dy = -Math.cos(pitch);
    const dz = Math.sin(pitch);
    const c = (i * 0.732051) % 1;
    const z = -30 + b * 25;
    const M = { x: 0, y: world.sampleGround(0, z, g).y - 0.3 + c * 1.2, z };
    if (dy > -0.25) continue;
    const t = v._castWheel(M, dx, dy, dz, 0.72, sample);
    if (!Number.isFinite(t)) continue;
    hits++;
    if (t < 0) negative++;
    const px = M.x + t * dx;
    const py = M.y + t * dy;
    const pz = M.z + t * dz;
    worst = Math.max(worst, Math.abs(py - world.sampleGround(px, pz, g).y));
  }
  check('every wheel hit lies on the ground along its ray, below the mount', hits > 300 && negative === 0 && worst < 0.02,
    `${hits} hits, worst miss ${worst.toFixed(4)} m, ${negative} behind the mount`);
}

function testNormalDrivingUnaffected() {
  console.log('\nOrdinary terrain is still driven over');
  // A 25 degree bank is a slope, not a wall: the car still climbs it and keeps its wheels on it.
  const k = Math.tan(25 * DEG);
  const world = { waterLevel: -Infinity, sampleGround: (x, z, o) => (z > -20 ? fill(o, 0, 0, 1, 0) : fill(o, k * (-20 - z), 0, 1, k, 2, 0.56, 0.06)) };
  const r = drive(world, { kmh: 50, seconds: 3, throttle: 0.6 });
  check('climbs a 25 degree grass bank', r.v.position.z < -26 && r.rise < 0.6 && r.minUp > 0.8, `${fmt(r)}, reached z ${r.v.position.z.toFixed(1)}`);
}

testMountainFaces();
testRoadBedSteps();
testBarriersAndObstacles();
testWheelRaysStayOnTheRay();
testNormalDrivingUnaffected();

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
