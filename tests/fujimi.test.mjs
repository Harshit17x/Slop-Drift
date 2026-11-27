// Fujimi Rally: `node tests/fujimi.test.mjs` (exit code 1 on failure).
// The Blender export builds a closed 2.3-2.8 km course whose barriers, props and drift zones sit where
// the game expects them, and a car dropped at the start settles on the road.
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World.js';
import { MAPS } from '../src/world/maps.js';
import { Vehicle } from '../src/vehicle/Vehicle.js';
import { CONFIG, SURFACE, modesForWorld } from '../src/config.js';

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  (${detail})` : ''}`);
}

const layout = JSON.parse(readFileSync(new URL('../src/assets/maps/fujimi/layout.json', import.meta.url), 'utf8'));
const map = MAPS.fujimi;
const world = new World(map.config, layout);
await world.build();
const road = world.roads[0];
const rail = map.config.road.halfWidth + map.config.road.shoulder + map.config.road.railOffset;

check('one closed course, 2.3-2.8 km', world.roads.length === 1 && road.closed && road.length > 2300 && road.length < 2800,
  `${Math.round(road.length)} m`);
check('loop route with checkpoints', world.routes.loop?.checkpoints.length >= 6, `${world.routes.loop?.checkpoints.length}`);
check('sprint, circuit, drift and roam are offered', ['sprint', 'circuit', 'drift', 'roam'].every((id) => modesForWorld(world).some((m) => m.id === id)));
let tightest = Infinity;
for (let i = 0; i < road.count; i++) tightest = Math.min(tightest, 1 / Math.max(1e-6, Math.abs(road.curvature[i])));
check('tightest corner is a drivable hairpin (radius 15-35 m)', tightest > 15 && tightest < 35, `${tightest.toFixed(1)} m`);
check('barriers on both sides all the way round', road.railLeft.every(Boolean) && road.railRight.every(Boolean));

// Every placement lies off the asphalt except kerbs and pebbles (flat), the start gantry (spans it) and
// the solid tyre islands and boulders (deliberate obstacles, tested below).
const ON_ROAD = new Set(['K_Kerb', 'K_Gantry', 'K_Pebble', 'K_TyreStack', 'K_Boulder']);
const at = {};
let onRoad = 0;
let barrierMiss = 0;
let total = 0;
for (const [prop, group] of Object.entries(layout.placements)) {
  for (let k = 0; k < group.t.length; k += 4) {
    const x = group.t[k];
    const z = group.t[k + 2];
    total++;
    if (!road.locate(x, z, at)) continue;
    if (!ON_ROAD.has(prop) && at.distance < map.config.road.halfWidth + 0.3) onRoad++;
    if (/^K_(Barrier|Tyres)/.test(prop) && Math.abs(at.distance - rail - 0.32) > 0.3) barrierMiss++;
  }
}
check('no scenery on the asphalt', onRoad === 0, `${onRoad} of ${total}`);
check('barrier meshes sit on the collision line', barrierMiss === 0, `${barrierMiss} off by more than 30 cm`);
check('eight drift clipping zones on the course', world.driftZones.length === 8 && world.driftZones.every((z) => z.s >= 0 && z.s < road.length));

// Drop a car at the start; it settles on the road with all four wheels down.
const car = new Vehicle({ world });
const spawn = world.getSpawn('loop', world.routes.loop.startS);
car.teleport(spawn);
let state;
for (let i = 0; i < Math.round(2 / CONFIG.physics.fixedDt); i++) state = car.step(CONFIG.physics.fixedDt, { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, shift: 0 });
check('a car at the start settles on four wheels', state.wheelsOnGround === 4 && Math.abs(car.position.y - 0.5) < 0.6, `y ${car.position.y.toFixed(2)}`);

// Hitting the barrier at speed stops the car at the barrier, it does not pass through.
const side = world.getSpawn('loop', world.routes.loop.startS + 120);
car.teleport(side);
const f = road.frameAt(world.routes.loop.startS + 120, {});
car.velocity.set(f.rx * 25, 0, f.rz * 25);
for (let i = 0; i < Math.round(2 / CONFIG.physics.fixedDt); i++) car.step(CONFIG.physics.fixedDt, { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, shift: 0 });
road.locate(car.position.x, car.position.z, at);
check('a 90 km/h side hit stays inside the barrier', at.distance < rail + 0.2, `${at.distance.toFixed(2)} m from the centre line`);

// The Container Snake is gravel, the rest is asphalt.
const ground = { normal: { x: 0, y: 1, z: 0 } };
const surfaceAt = (s) => { const f = road.frameAt(s, {}); world.sampleGround(f.x, f.z, ground, f.y); return ground.surface; };
const [g0, g1] = layout.gravel;
check('gravel rally sector of 250-400 m', g1 - g0 > 250 && g1 - g0 < 400 && surfaceAt((g0 + g1) / 2) === SURFACE.GRAVEL
  && surfaceAt(g0 - 40) === SURFACE.ASPHALT && surfaceAt(g1 + 40) === SURFACE.ASPHALT, `${Math.round(g1 - g0)} m`);

// The canal crest lifts the road about 3.5 m; a car takes it at 120 km/h without launching.
let top = 0;
for (let i = 0; i < road.count; i++) top = Math.max(top, road.py[i]);
check('the lap climbs and drops: highest point 5-7 m', top > 5 && top < 7, `${top.toFixed(2)} m`);
let maxGrade = 0;
for (let i = 0; i < road.count; i++) maxGrade = Math.max(maxGrade, Math.abs(road.grade[i]));
check('grades stay drivable (under 8 %)', maxGrade < 0.08, `${(maxGrade * 100).toFixed(1)} %`);
const [c0, c1] = layout.crest;
car.teleport(world.getSpawn('loop', c0 - 60));
const fc = road.frameAt(c0 - 60, {});
car.velocity.set(fc.tx * 33, 0, fc.tz * 33);
let air = 0;
let maxAir = 0;
for (let i = 0; i < Math.round(4 / CONFIG.physics.fixedDt); i++) {
  const st = car.step(CONFIG.physics.fixedDt, { throttle: 0.6, brake: 0, steer: 0, handbrake: false, boost: false, shift: 0 });
  air = st.wheelsOnGround === 0 ? air + CONFIG.physics.fixedDt : 0;
  maxAir = Math.max(maxAir, air);
}
road.locate(car.position.x, car.position.z, at);
check('120 km/h over the crest keeps the car on the road', maxAir < 0.35 && at.distance < rail, `airtime ${maxAir.toFixed(2)} s`);

// Obstacles: every tyre island and boulder is solid, and each leaves a lane of 3 m or more.
const hit = {};
let solid = 0;
let narrow = 0;
for (const o of layout.solids) {
  world.collideObstacle(o.x, 0.5, o.z + o.r * 0.5, 0.8, hit);
  if (hit.hit) solid++;
  road.locate(o.x, o.z, at);
  const lane = Math.max(at.halfWidth - (at.lateral + o.r), at.halfWidth + (at.lateral - o.r));
  if (lane < 3) narrow++;
}
check('tyre islands and boulders are solid, with a 3 m lane past each', layout.solids.length >= 6 && solid === layout.solids.length && narrow === 0,
  `${layout.solids.length} obstacles, ${narrow} too tight`);

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
