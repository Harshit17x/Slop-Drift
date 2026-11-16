// Headless checks of world generation: node tests/world.test.mjs
import { World } from '../src/world/World.js';
import { SURFACE } from '../src/config.js';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  ok    ${name}${detail ? `  (${detail})` : ''}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

const stages = [];
let last = performance.now();
let lastLabel = 'start';
const world = new World();
const started = performance.now();
await world.build((fraction, label) => {
  const now = performance.now();
  // Time since the previous callback belongs to the stage that was announced then.
  if (stages.length && stages[stages.length - 1].label === lastLabel) stages[stages.length - 1].ms += now - last;
  else stages.push({ label: lastLabel, ms: now - last });
  last = now;
  lastLabel = label;
});
const buildMs = performance.now() - started;
console.log(`\nBuild ${buildMs.toFixed(0)} ms`);
stages.forEach((stage) => console.log(`  ${stage.label.padEnd(30)} ${stage.ms.toFixed(0)} ms`));

const [loop, spur] = world.roads;
const ground = {};
const location = {};

function roadStats(road) {
  let maxGrade = 0;
  let maxCurvature = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxBank = 0;
  let hairpins = 0;
  let inHairpin = false;
  let maxGradeStep = 0;
  for (let i = 0; i < road.count; i += 1) {
    maxGrade = Math.max(maxGrade, Math.abs(road.grade[i]));
    maxCurvature = Math.max(maxCurvature, Math.abs(road.curvature[i]));
    maxBank = Math.max(maxBank, Math.abs(road.bank[i]));
    minY = Math.min(minY, road.py[i]);
    maxY = Math.max(maxY, road.py[i]);
    const tight = Math.abs(road.curvature[i]) > 1 / 30;
    if (tight && !inHairpin) hairpins += 1;
    inHairpin = tight;
    if (i > 0) maxGradeStep = Math.max(maxGradeStep, Math.abs(road.grade[i] - road.grade[i - 1]));
  }
  return { maxGrade, minRadius: 1 / maxCurvature, minY, maxY, maxBank, hairpins, maxGradeStep };
}

console.log('\nRoads');
for (const road of world.roads) {
  const stats = roadStats(road);
  console.log(`  ${road.name}: ${(road.length / 1000).toFixed(2)} km, ${road.count} samples, altitude ${stats.minY.toFixed(0)}-${stats.maxY.toFixed(0)} m, `
    + `max grade ${(stats.maxGrade * 100).toFixed(1)}%, min radius ${stats.minRadius.toFixed(1)} m, tight corners ${stats.hairpins}, max bank ${(Math.atan(stats.maxBank) * 57.3).toFixed(1)} deg`);
  check(`${road.name} grade within limit`, stats.maxGrade <= 0.125, `${(stats.maxGrade * 100).toFixed(1)}%`);
  check(`${road.name} min radius drivable`, stats.minRadius >= 12, `${stats.minRadius.toFixed(1)} m`);
  check(`${road.name} grade changes smoothly`, stats.maxGradeStep < 0.012, `${stats.maxGradeStep.toFixed(4)} per sample`);
}
check('loop is long', loop.length > 4500, `${loop.length.toFixed(0)} m`);
check('spur is long', spur.length > 1800, `${spur.length.toFixed(0)} m`);

// Loop closure: first and last samples are neighbours.
const gap = Math.hypot(loop.px[0] - loop.px[loop.count - 1], loop.pz[0] - loop.pz[loop.count - 1]);
check('loop closes', Math.abs(gap - loop.spacing) < 0.2, `gap ${gap.toFixed(2)} m`);

// Separate stretches of road must not run into each other (switchback legs, loop vs spur).
function minSeparation(a, b, same) {
  let min = Infinity;
  let at = null;
  for (let i = 0; i < a.count; i += 4) {
    for (let j = 0; j < b.count; j += 4) {
      if (same) {
        let along = Math.abs(i - j);
        along = Math.min(along, a.count - along) * a.spacing;
        if (along < 130) continue;
      }
      const d = Math.hypot(a.px[i] - b.px[j], a.pz[i] - b.pz[j]);
      if (d < min) {
        min = d;
        at = [i, j];
      }
    }
  }
  return { min, at };
}
const loopSelf = minSeparation(loop, loop, true);
check('loop legs keep apart', loopSelf.min > 24, `${loopSelf.min.toFixed(1)} m at samples ${loopSelf.at}`);
const spurSelf = minSeparation(spur, spur, true);
check('spur legs keep apart', spurSelf.min > 24, `${spurSelf.min.toFixed(1)} m at samples ${spurSelf.at}`);
let crossMin = Infinity;
for (let i = Math.round(260 / spur.spacing); i < spur.count; i += 3) {
  if (loop.locate(spur.px[i], spur.pz[i], location)) crossMin = Math.min(crossMin, location.distance);
}
check('spur clears the loop after the fork', crossMin > 24, `${crossMin.toFixed(1)} m`);

// The road surface must be smooth and continuous for the wheels.
let maxStep = 0;
let maxEdgeStep = 0;
let asphaltOk = true;
for (const road of world.roads) {
  const frame = {};
  let previous = null;
  for (let s = 0; s < road.length; s += 0.5) {
    road.frameAt(s, frame);
    world.sampleGround(frame.x, frame.z, ground);
    if (ground.surface !== SURFACE.ASPHALT) asphaltOk = false;
    if (previous !== null) maxStep = Math.max(maxStep, Math.abs(ground.y - previous - frame.grade * 0.5));
    previous = ground.y;
    if (Math.round(s * 2) % 40 === 0 && !road.mouth[frame.index]) {
      // Walk outward across the edge of the ribbon onto the carved bed: no step allowed. Stop one grid
      // cell short of the bed edge, where the cut or fill slope legitimately begins.
      for (const side of [-1, 1]) {
        let before = null;
        for (let offset = frame.halfWidth - 1; offset < frame.halfWidth + 3.2; offset += 0.25) {
          const hx = Math.hypot(frame.rx, frame.rz) || 1;
          world.sampleGround(frame.x + (frame.rx / hx) * side * offset, frame.z + (frame.rz / hx) * side * offset, ground);
          if (before !== null) maxEdgeStep = Math.max(maxEdgeStep, Math.abs(ground.y - before));
          before = ground.y;
        }
      }
    }
  }
}
check('centreline is asphalt everywhere', asphaltOk);
check('no bumps along the centreline', maxStep < 0.02, `${(maxStep * 100).toFixed(2)} cm beyond grade per 0.5 m`);
check('no step between road edge and terrain', maxEdgeStep < 0.08, `${(maxEdgeStep * 100).toFixed(1)} cm per 0.25 m`);

// Terrain must never rise through the road ribbon.
let poke = 0;
for (const road of world.roads) {
  const frame = {};
  for (let s = 0; s < road.length; s += 3) {
    road.frameAt(s, frame);
    const hx = Math.hypot(frame.rx, frame.rz) || 1;
    for (let offset = -frame.halfWidth - 2.8; offset <= frame.halfWidth + 2.8; offset += 0.7) {
      const x = frame.x + (frame.rx / hx) * offset;
      const z = frame.z + (frame.rz / hx) * offset;
      world.sampleGround(x, z, ground);
      poke = Math.max(poke, world.grid.heightAt(x, z) - ground.y);
    }
  }
}
check('terrain stays under the road ribbon', poke < 0.03, `${(poke * 100).toFixed(1)} cm`);

// Rails and routes.
const railShare = (road) => {
  let left = 0;
  let right = 0;
  for (let i = 0; i < road.count; i += 1) {
    left += road.railLeft[i];
    right += road.railRight[i];
  }
  return `${Math.round((left / road.count) * 100)}% left, ${Math.round((right / road.count) * 100)}% right`;
};
console.log(`\nGuardrails  loop ${railShare(loop)}  |  spur ${railShare(spur)}`);
for (const id of Object.keys(world.routes)) {
  const route = world.routes[id];
  const pose = world.getSpawn(id, route.startS);
  const q = pose.quaternion;
  // Forward (-Z) rotated by q.
  const fx = -2 * (q.x * q.z + q.w * q.y);
  const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  const ahead = world.locate(pose.position.x + fx * 6, pose.position.z + fz * 6, {}, route.roadId);
  const moved = (ahead.s - route.startS) * route.direction;
  check(`${id} spawn faces the driving direction`, moved > 3 && moved < 9, `advances ${moved.toFixed(1)} m`);
  console.log(`        ${id}: ${(route.length / 1000).toFixed(2)} km, ${route.checkpoints.length} checkpoints`);
}

// Barrier pushes a point on the rail back toward the road.
{
  const frame = {};
  let tested = false;
  for (let i = 100; i < loop.count && !tested; i += 1) {
    if (!loop.railRight[i] || !loop.railRight[i + 1]) continue;
    loop.frameAt(i * loop.spacing, frame);
    const hx = Math.hypot(frame.rx, frame.rz);
    const offset = frame.halfWidth + 1.4 + 0.55 + 0.2;
    const hit = world.collideBarrier(frame.x + (frame.rx / hx) * offset, frame.y + 0.3, frame.z + (frame.rz / hx) * offset, 0.1, {});
    const inward = hit.nx * (-frame.rx / hx) + hit.nz * (-frame.rz / hx);
    check('guardrail blocks and points inward', hit.hit && inward > 0.99 && Math.abs(hit.depth - 0.3) < 0.05, `depth ${hit.depth.toFixed(2)}`);
    const clear = world.collideBarrier(frame.x, frame.y + 0.3, frame.z, 0.5, {});
    check('centre of the road is clear', !clear.hit);
    tested = true;
  }
}

// Terrain statistics.
console.log(`\nTerrain  ${world.grid.size}x${world.grid.size} nodes, height ${world.grid.minHeight.toFixed(0)} to ${world.grid.maxHeight.toFixed(0)} m, plaza at ${world.plaza.y.toFixed(0)} m`);
let nonFinite = 0;
for (let i = 0; i < world.grid.heights.length; i += 1) if (!Number.isFinite(world.grid.heights[i])) nonFinite += 1;
check('all heights finite', nonFinite === 0, `${nonFinite} bad`);

// Query cost.
{
  const t0 = performance.now();
  const frame = {};
  let n = 0;
  for (let k = 0; k < 40; k += 1) {
    for (let s = 0; s < loop.length; s += 7) {
      loop.frameAt(s, frame);
      world.sampleGround(frame.x + 3, frame.z - 2, ground);
      world.sampleGround(frame.x + 60, frame.z + 45, ground);
      n += 2;
    }
  }
  const micros = ((performance.now() - t0) * 1000) / n;
  check('ground query is cheap', micros < 6, `${micros.toFixed(2)} us per query`);
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll world checks passed');
process.exit(failures ? 1 : 0);
