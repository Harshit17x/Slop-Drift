// N-road support on a tiny synthetic authored map (no assets): node tests/roads.test.mjs
// A loop with two open roads ('spur' and 'peak'), each ending at its own plaza, built through
// World.buildFromMap exactly as an exported map.json would be.
import { World, ROAD_IDS } from '../src/world/World.js';
import { TerrainGrid } from '../src/world/TerrainGrid.js';
import { MAPS } from '../src/world/maps.js';
import { SURFACE, modesForWorld } from '../src/config.js';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  ok    ${name}${detail ? `  (${detail})` : ''}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

const LOOP_RADIUS = 150;
const config = Object.freeze({
  ...MAPS.mussoorie.config,
  grid: Object.freeze({ cell: 2, size: 601 }), // 1200 m square
  erosion: Object.freeze({ ...MAPS.mussoorie.config.erosion, droplets: 0 }),
});

/** Terrain: a flat valley inside the loop rising gently outside it. */
const ground = (x, z) => 50 + 0.05 * Math.max(0, Math.hypot(x, z) - LOOP_RADIUS);

/** A polyline every 4 m from (x0, z0) along `heading(t)` for `length` metres, heights from `rise`. */
function branch(x0, z0, length, heading, rise) {
  const points = [];
  const heights = [];
  let x = x0;
  let z = z0;
  for (let s = 0; s <= length; s += 4) {
    points.push(x, z);
    heights.push(50 + rise * (s / length));
    const angle = heading(s / length);
    x += Math.cos(angle) * 4;
    z += Math.sin(angle) * 4;
  }
  return { points, heights };
}

function syntheticMap({ withPeak = true, legacyPlaza = false } = {}) {
  const size = 151;
  const cell = 8;
  const half = ((size - 1) * cell) / 2;
  const heights = new Float32Array(size * size);
  for (let iz = 0; iz < size; iz += 1) for (let ix = 0; ix < size; ix += 1) heights[iz * size + ix] = ground(ix * cell - half, iz * cell - half);

  const loop = { name: 'loop', closed: true, points: [], heights: [] };
  for (let k = 0; k < 236; k += 1) {
    const angle = (k / 236) * Math.PI * 2;
    loop.points.push(Math.cos(angle) * LOOP_RADIUS, Math.sin(angle) * LOOP_RADIUS);
    loop.heights.push(50);
  }
  // Spur leaves the east side of the loop at a shallow angle; the peak leaves the west side at a right angle.
  const spur = { name: 'spur', closed: false, ...branch(LOOP_RADIUS, 0, 380, (t) => 0.9 - 0.9 * t, 24) };
  const peak = { name: 'peak', closed: false, ...branch(-LOOP_RADIUS, 0, 360, (t) => Math.PI + 0.35 * t, 30) };
  const end = (road) => ({ x: road.points[road.points.length - 2], z: road.points[road.points.length - 1] });
  const roads = withPeak ? [loop, peak, spur] : [loop, spur]; // out of order on purpose: ids come from the names
  const map = {
    version: 2,
    name: 'Synthetic',
    grid: { size, cell, min: 0, max: 100 },
    waterLevel: 10,
    heights,
    roads,
    plaza: { ...end(spur), radius: 22 },
    labels: [{ name: 'Lal Tibba', ...end(spur) }],
    placements: [],
  };
  if (!legacyPlaza) {
    map.plazas = [{ id: 'laltibba', road: 'spur', ...end(spur), radius: 22, label: 'Lal Tibba' }];
    if (withPeak) map.plazas.push({ id: 'nagtibba', road: 'peak', ...end(peak), radius: 26, label: 'Nag Tibba' });
  }
  return map;
}

async function build(options) {
  const world = new World(config, syntheticMap(options));
  await world.build();
  return world;
}

const sample = {};
const hit = {};
const location = {};

// ---- three roads, two plazas
const world = await build();
const [loop, spur, peak] = world.roads;
check('three roads, ids are indices', world.roads.length === 3 && world.roads.every((road, i) => road.id === i));
check('roads ordered loop, spur, peak by name', loop.name === 'loop' && spur.name === 'spur' && peak.name === 'peak' && ROAD_IDS.PEAK === 2);
check('one plaza per open road', world.plazas.length === 2 && world.plazas[0].roadId === ROAD_IDS.SPUR && world.plazas[1].roadId === ROAD_IDS.PEAK);
check('plaza ids and labels from map.json', world.plazas[1].id === 'nagtibba' && world.plazas[1].label === 'Nag Tibba' && world.plazas[1].radius === 26);
check('world.plaza is the spur plaza', world.plaza === world.plazas[0]);
check('summit is the highest plaza', world.summit.y === Math.max(...world.plazas.map((plaza) => plaza.y)));
check('a junction per open road', world.junctions.length === 2 && world.junctionS === world.junctions[0].s);

for (const plaza of world.plazas) {
  const road = world.roads[plaza.roadId];
  world.sampleGround(plaza.x, plaza.z, sample);
  check(`${plaza.id}: plaza surface is asphalt of its road`, sample.surface === SURFACE.ASPHALT && sample.roadId === plaza.roadId && Math.abs(sample.y - plaza.y) < 1e-3);
  check(`${plaza.id}: road arrives level with the plaza`, Math.abs(road.py[road.count - 1] - plaza.y) < 0.05);
  // Rail ring: solid on the far side, open where the road comes in.
  const last = road.count - 1;
  const fx = road.tx[last];
  const fz = road.tz[last];
  const ring = plaza.radius + world.config.road.railOffset;
  world.collideBarrier(plaza.x + fx * (ring - 0.5), plaza.y + 0.3, plaza.z + fz * (ring - 0.5), 1, hit);
  check(`${plaza.id}: rail ring blocks the far side`, hit.hit && hit.nx * fx + hit.nz * fz < -0.9);
  world.collideBarrier(plaza.x - fx * (ring - 0.5), plaza.y + 0.3, plaza.z - fz * (ring - 0.5), 1, hit);
  check(`${plaza.id}: rail ring is open at the entry`, !hit.hit);
  check(`${plaza.id}: carved terrain stays under the plaza`, world.grid.heightAt(plaza.x, plaza.z) < plaza.y);
}

// Both forks are flat and unbanked on the loop; elsewhere the loop banks into its curve.
const bankAt = (s) => loop.frameAt(s, {}).bank;
check('loop is unbanked through every fork', world.junctions.every((junction) => Math.abs(bankAt(junction.s)) < 1e-3),
  world.junctions.map((junction) => bankAt(junction.s).toFixed(4)).join(', '));
check('loop banks away from the forks', Math.abs(bankAt(loop.length * 0.25)) > 0.005, bankAt(loop.length * 0.25).toFixed(4));
check('fork mouths open the loop on both sides of the circle', world.junctions.every((junction) => {
  const i = Math.round(junction.s / loop.spacing) % loop.count;
  return loop.mouth[i] !== 0;
}));

// The fork surfaces agree: the branch meets the loop flush, even leaving at a right angle.
let forkGap = 0;
for (const road of [spur, peak]) {
  for (let i = 0; i < 6; i += 1) {
    world.locate(road.px[i], road.pz[i], location, ROAD_IDS.LOOP);
    if (location.distance < location.halfWidth) forkGap = Math.max(forkGap, Math.abs(road.py[i] - location.y));
  }
}
check('branches start flush with the loop', forkGap < 0.05, `${forkGap.toFixed(3)} m`);
let offAsphalt = 0;
for (const road of world.roads) {
  for (let s = 0; s < road.length; s += 2) {
    const frame = road.frameAt(s, {});
    world.sampleGround(frame.x, frame.z, sample);
    if (sample.surface !== SURFACE.ASPHALT || Math.abs(sample.y - frame.y) > 0.35) offAsphalt += 1;
  }
}
check('every road is continuous asphalt at its own height', offAsphalt === 0, `${offAsphalt} bad samples`);

// Routes and modes.
check('routes for every road', ['loop', 'climb', 'descent', 'peak', 'peakdown'].every((id) => world.routes[id]));
check('peak routes run on the peak road', world.routes.peak.roadId === ROAD_IDS.PEAK && world.routes.peakdown.roadId === ROAD_IDS.PEAK
  && world.routes.peak.direction === 1 && world.routes.peakdown.direction === -1
  && Math.abs(world.routes.peak.finishS - (peak.length - 58)) < 1e-6 && world.routes.peak.startS === 190);
check('climb routes stay on the spur', world.routes.climb.roadId === ROAD_IDS.SPUR && world.routes.descent.roadId === ROAD_IDS.SPUR);
for (const id of ['peak', 'peakdown']) {
  const route = world.routes[id];
  const pose = world.getSpawn(id, route.startS);
  const q = pose.quaternion;
  const fx = -2 * (q.x * q.z + q.w * q.y);
  const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  const ahead = world.locate(pose.position.x + fx * 6, pose.position.z + fz * 6, {}, route.roadId);
  const moved = (ahead.s - route.startS) * route.direction;
  check(`${id} spawn faces the driving direction`, moved > 3 && moved < 9, `advances ${moved.toFixed(1)} m`);
}
check('modes offered include the Nag Tibba events', ['peak', 'peakdown'].every((id) => modesForWorld(world).some((mode) => mode.id === id)));

const mapData = world.getMapData();
check('map data: a summit marker per plaza, a junction marker per fork', mapData.markers.filter((m) => m.kind === 'summit').length === 2
  && mapData.markers.filter((m) => m.kind === 'junction').length === 2 && mapData.roads.length === 3);
check('map data: summit markers carry plaza labels', mapData.markers.some((m) => m.kind === 'summit' && m.label === 'Nag Tibba'));
check('unlabelled plaza names are added to the map labels once', world.labels.filter((l) => l.name === 'Nag Tibba').length === 1
  && world.labels.filter((l) => l.name === 'Lal Tibba').length === 1);

// ---- the two-road shape of today's exports: legacy single plaza, no peak
const old = await build({ withPeak: false, legacyPlaza: true });
check('two-road map still builds with the legacy plaza', old.roads.length === 2 && old.plazas.length === 1 && old.plaza === old.plazas[0]
  && old.plaza.roadId === ROAD_IDS.SPUR && old.plaza.label === null);
check('no peak routes without a peak road', !old.routes.peak && !old.routes.peakdown && old.routes.climb && old.routes.descent);
check('modes without a route are not offered', !modesForWorld(old).some((mode) => mode.id === 'peak' || mode.id === 'peakdown')
  && modesForWorld(old).some((mode) => mode.id === 'climb'));

// ---- TerrainGrid.carve takes a plaza list or a single plaza
{
  const make = () => {
    const grid = new TerrainGrid({ size: 201, cell: 2 });
    grid.heights.fill(40);
    return grid;
  };
  const plaza = { x: 10, z: -20, y: 45, radius: 12 };
  const single = make();
  single.carve([], plaza, config.road);
  const listed = make();
  listed.carve([], [plaza], config.road);
  const none = make();
  none.carve([], null, config.road);
  let same = true;
  for (let i = 0; i < single.heights.length; i += 1) if (single.heights[i] !== listed.heights[i]) same = false;
  check('carve: single plaza and one-plaza list agree', same && single.heightAt(10, -20) > 44);
  check('carve: no plazas leaves the ground alone', none.heights.every((h) => h === 40));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll N-road checks passed');
process.exit(failures ? 1 : 0);
