// Headless checks of the Blender-authored Mussoorie map: node tests/map.test.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { World, ROAD_IDS } from '../src/world/World.js';
import { MAPS, parseMapData } from '../src/world/maps.js';
import { SURFACE } from '../src/config.js';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  ok    ${name}${detail ? `  (${detail})` : ''}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

const map = MAPS.mussoorie;
const json = JSON.parse(await readFile(fileURLToPath(map.assets.json), 'utf8'));
const terrain = await readFile(fileURLToPath(map.assets.terrain));
const data = parseMapData(json, terrain.buffer.slice(terrain.byteOffset, terrain.byteOffset + terrain.byteLength));

const started = performance.now();
const world = new World(map.config, data);
await world.build();
console.log(`\nMussoorie build ${(performance.now() - started).toFixed(0)} ms`);

const [loop, spur] = world.roads;
const ground = {};
const location = {};

function stats(road) {
  let maxGrade = 0;
  let minRadius = Infinity;
  for (let i = 0; i < road.count; i += 1) {
    const j = road.closed ? (i + 1) % road.count : Math.min(i + 1, road.count - 1);
    if (j === i) continue;
    maxGrade = Math.max(maxGrade, Math.abs(road.py[j] - road.py[i]) / road.spacing);
    if (Math.abs(road.curvature[i]) > 1e-6) minRadius = Math.min(minRadius, 1 / Math.abs(road.curvature[i]));
  }
  return { maxGrade, minRadius, length: road.length };
}

const loopStats = stats(loop);
const spurStats = stats(spur);
check('loop is a closed circuit of useful length', loop.closed && loopStats.length > 2500, `${loopStats.length.toFixed(0)} m`);
check('spur climbs to Lal Tibba', spurStats.length > 1400 && world.plaza.y - spur.py[0] > 70, `${spurStats.length.toFixed(0)} m, +${(world.plaza.y - spur.py[0]).toFixed(0)} m`);
check('loop grade within limit', loopStats.maxGrade < 0.125, `${(loopStats.maxGrade * 100).toFixed(1)} %`);
check('spur grade within limit', spurStats.maxGrade < 0.13, `${(spurStats.maxGrade * 100).toFixed(1)} %`);
check('no corner tighter than a hairpin', Math.min(loopStats.minRadius, spurStats.minRadius) > 9, `min radius ${Math.min(loopStats.minRadius, spurStats.minRadius).toFixed(1)} m`);
check('Lal Tibba displays about 2,250 m', Math.abs(world.displayAltitude(world.plaza.y) - 2250) < 120, `${world.displayAltitude(world.plaza.y).toFixed(0)} m`);

// Every road sample is asphalt at the road height, and the car can't fall in the water.
let offRoad = 0;
let maxGap = 0;
for (const road of world.roads) {
  for (let i = 0; i < road.count; i += 4) {
    world.sampleGround(road.px[i], road.pz[i], ground);
    if (ground.surface !== SURFACE.ASPHALT) offRoad += 1;
    maxGap = Math.max(maxGap, Math.abs(ground.y - road.py[i]));
  }
}
check('centreline is asphalt everywhere', offRoad === 0, `${offRoad} samples off`);
check('surface matches road profile', maxGap < 0.35, `max gap ${maxGap.toFixed(2)} m`);
check('roads stay above the water', Math.min(...world.roads.map((road) => Math.min(...road.py))) > world.waterLevel + 2);

// Terrain never pokes through the asphalt.
let poke = 0;
for (const road of world.roads) {
  for (let i = 0; i < road.count; i += 3) {
    for (const lateral of [-0.8, 0, 0.8]) {
      const x = road.px[i] + road.rx[i] * road.halfWidth[i] * lateral;
      const z = road.pz[i] + road.rz[i] * road.halfWidth[i] * lateral;
      world.sampleGround(x, z, ground);
      if (world.grid.heightAt(x, z) > ground.y + 0.25) poke += 1;
    }
  }
}
check('terrain stays below the asphalt', poke === 0, `${poke} points`);

// Buildings clear the carriageway, and the spawn points are clear of buildings. A footprint is a row
// of circles along its long axis, as World collides it (long thin props such as prayer flags are not discs).
let blocking = [];
for (const placement of world.placements) {
  const along = placement.w >= placement.d;
  const length = along ? placement.w : placement.d;
  const thick = (along ? placement.d : placement.w) / 2;
  const ax = along ? Math.cos(placement.yaw) : -Math.sin(placement.yaw);
  const az = along ? -Math.sin(placement.yaw) : -Math.cos(placement.yaw);
  let worst = Infinity;
  for (let k = 0; k <= 8; k += 1) {
    const offset = (length / 2 - thick) * (k / 4 - 1);
    world.locate(placement.x + ax * offset, placement.z + az * offset, location);
    if (location.roadId >= 0) worst = Math.min(worst, location.distance - (thick + location.halfWidth + 1));
  }
  if (worst < 0) blocking.push(`${placement.prop} ${(worst).toFixed(1)} m`);
}
check('no building on the road', blocking.length === 0, blocking.slice(0, 4).join(', ') || `${world.placements.length} placements`);
const hit = {};
for (const routeId of Object.keys(world.routes)) {
  const route = world.routes[routeId];
  const spawn = world.getSpawn(routeId, route.startS);
  world.collideObstacle(spawn.position.x, spawn.position.y, spawn.position.z, 2.2, hit);
  check(`spawn on ${routeId} is clear`, !hit.hit);
}
// Every open road starts on the loop and ends at its own plaza, which it actually reaches.
check('one plaza per open road', world.plazas.length === world.roads.length - 1
  && world.roads.slice(1).every((road) => world.plazas.filter((plaza) => plaza.roadId === road.id).length === 1), `${world.plazas.length} plazas`);
check('plaza alias is the spur plaza', world.plaza === world.plazas.find((plaza) => plaza.roadId === ROAD_IDS.SPUR));
for (const plaza of world.plazas) {
  const road = world.roads[plaza.roadId];
  const last = road.count - 1;
  world.sampleGround(plaza.x, plaza.z, ground);
  const reach = Math.hypot(road.px[last] - plaza.x, road.pz[last] - plaza.z);
  check(`${plaza.id} plaza is reached by its road`, reach < plaza.radius && ground.surface === SURFACE.ASPHALT && ground.roadId === plaza.roadId
    && Math.abs(ground.y - plaza.y) < 0.05 && Math.abs(road.py[last] - plaza.y) < 0.35, `end ${reach.toFixed(1)} m from centre`);
  world.collideBarrier(road.px[last], road.py[last] + 0.3, road.pz[last], 1, hit);
  check(`${plaza.id} plaza entry is open`, !hit.hit);
}
for (const junction of world.junctions) {
  const road = world.roads[junction.roadId];
  world.locate(road.px[0], road.pz[0], location, ROAD_IDS.LOOP);
  check(`${road.name} starts on the loop`, location.distance < 4 && Math.abs(location.s - junction.s) < 12, `${location.distance.toFixed(1)} m off`);
}
const markers = world.getMapData().markers;
check('one summit marker per plaza and one junction marker per fork', markers.filter((m) => m.kind === 'summit').length === world.plazas.length
  && markers.filter((m) => m.kind === 'junction').length === world.junctions.length);

// The Nag Tibba road, once the export has it.
const peak = world.roads[ROAD_IDS.PEAK];
if (peak) {
  const peakStats = stats(peak);
  const peakPlaza = world.plazas.find((plaza) => plaza.roadId === ROAD_IDS.PEAK);
  const gain = peakPlaza.y - peak.py[0];
  console.log(`  Nag Tibba road: ${peakStats.length.toFixed(0)} m, +${gain.toFixed(0)} m, max grade ${(peakStats.maxGrade * 100).toFixed(1)} %, min radius ${peakStats.minRadius.toFixed(1)} m, plaza ${world.displayAltitude(peakPlaza.y).toFixed(0)} m displayed`);
  check('peak road is a long climb', peakStats.length > 2000 && gain > 150, `${peakStats.length.toFixed(0)} m, +${gain.toFixed(0)} m`);
  check('peak grade within limit', peakStats.maxGrade < 0.13, `${(peakStats.maxGrade * 100).toFixed(1)} %`);
  check('peak hairpins are drivable', peakStats.minRadius > 9, `min radius ${peakStats.minRadius.toFixed(1)} m`);
  // Asphalt all the way, sampled densely: stacked hairpin legs must not bury or cut each other.
  let gaps = 0;
  for (let s = 0; s <= peak.length; s += 1) {
    const frame = peak.frameAt(s, {});
    world.sampleGround(frame.x, frame.z, ground);
    if (ground.surface !== SURFACE.ASPHALT || Math.abs(ground.y - frame.y) > 0.35) gaps += 1;
  }
  check('peak road is continuous asphalt', gaps === 0, `${gaps} bad metres`);
  check('peak routes exist', world.routes.peak?.roadId === ROAD_IDS.PEAK && world.routes.peakdown?.direction === -1
    && world.routes.peak.length > 1500, `${(world.routes.peak?.length / 1000).toFixed(2)} km`);
  check('peak plaza is named', Boolean(peakPlaza.label), peakPlaza.label || 'unnamed');
} else {
  check('no peak routes without a peak road', !world.routes.peak && !world.routes.peakdown);
}

check('landmark labels exported', world.labels.length >= 10 && world.getMapData().labels.length === world.labels.length, `${world.labels.length}`);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll map checks passed');
process.exit(failures ? 1 : 0);
