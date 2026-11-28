// First-session and retention helpers: `node tests/launch.test.mjs` (exit code 1 on failure).
// Next-event and next-unlock suggestions, the cloud/local progress merge, and the new-player ad delay.
import { Career } from '../src/meta/Career.js';
import { mirroredStorage, profileXp } from '../src/platform/progressStorage.js';
import { CrazyGamesPlatform } from '../src/platform/CrazyGames.js';
import { ClipZones, findApexes } from '../src/render/ClipZones.js';
import { SpeedTraps, findSpeedTraps } from '../src/render/SpeedTraps.js';
import { Group } from 'three';
import { MAPS } from '../src/world/maps.js';
import { Traffic, judgePass, spawnTraffic, trafficPose } from '../src/game/Traffic.js';

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  (${detail})` : ''}`);
}
const memory = (init = {}) => {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
};

// ---- next event / next unlock
const career = new Career({ storage: memory(), mapId: 'mussoorie' });
const ranked = career.rankedModes();
check('the map ranks several events', ranked.length >= 3, ranked.join(','));
const first = career.nextEvent('roam');
check('after free roam, the first ranked event is suggested', first === ranked[0], first);
const afterFirst = career.nextEvent(ranked[0]);
check('after an event, the next one in order is suggested', afterFirst === ranked[1], afterFirst);
career.profile.medals[career.trackKey(ranked[1])] = 'bronze';
check('events already medalled are skipped', career.nextEvent(ranked[0]) === ranked[2], career.nextEvent(ranked[0]));
const drift = ranked.indexOf('drift');
check('after the first drift, a short event from the top of the list is next, not the long climb', career.nextEvent('drift') === ranked[0], career.nextEvent('drift'));
for (const id of ranked) career.profile.medals[career.trackKey(id)] = 'gold';
check('with every event medalled, the following event is suggested', career.nextEvent(ranked[drift]) === ranked[(drift + 1) % ranked.length]);
const unlock = career.nextUnlock();
check('a new driver sees the closest level unlock with XP to go', unlock && unlock.level >= 2 && unlock.xpToGo > 0, JSON.stringify(unlock));
career.profile.xp = 1e9;
check('nothing left to unlock by level at max XP', career.nextUnlock() === null);

// ---- cloud + local progress
const KEY = 'slop-drift-profile-v1';
const cloud = memory({ [KEY]: JSON.stringify({ xp: 100 }) });
const local = memory({ [KEY]: JSON.stringify({ xp: 900 }) });
const store = mirroredStorage(cloud, local);
check('the copy with more progress wins', profileXp(store.getItem(KEY)) === 900);
check('and is written back to the cloud', profileXp(cloud.data[KEY]) === 900);
const fresh = memory();
const store2 = mirroredStorage(fresh, memory({ [KEY]: JSON.stringify({ xp: 42 }) }));
check('a local-only save is migrated to the cloud', profileXp(store2.getItem(KEY)) === 42 && profileXp(fresh.data[KEY]) === 42);
store.setItem(KEY, JSON.stringify({ xp: 1000 }));
check('saves go to both copies', profileXp(cloud.data[KEY]) === 1000 && profileXp(local.data[KEY]) === 1000);
const asyncCloud = { getItem: () => Promise.resolve('x'), setItem: () => {} };
check('an async cloud API falls back to local', profileXp(mirroredStorage(asyncCloud, local).getItem(KEY)) === 1000);
const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
check('a throwing store does not break saving', (() => { mirroredStorage(broken, local).setItem(KEY, JSON.stringify({ xp: 5 })); return profileXp(local.data[KEY]) === 5; })());

// ---- ads
const platform = new CrazyGamesPlatform();
let requested = 0;
platform.initialized = true;
platform.sdk = { ad: { requestAd: async (_type, cb) => { requested++; cb.adFinished(); } } };
let finished = 0;
await platform.requestMidgameAd({ onFinish: () => finished++ });
check('no mid-game ad in the first minutes of a session', requested === 0 && finished === 1);
platform.sessionStart -= platform.firstAdDelay + 1000;
await platform.requestMidgameAd({ onFinish: () => finished++ });
check('ads resume after the delay', requested === 1 && finished === 2);
await platform.requestMidgameAd({ onFinish: () => finished++ });
check('and keep the 3-minute gap', requested === 1 && finished === 3);
const sdkData = memory();
platform.sdk.data = sdkData;
check('the data module is offered as cloud storage', platform.dataStorage === sdkData);
platform.initialized = false;
check('but not before the SDK is ready', platform.dataStorage === null);

// ---- clipping zones on the mountain roads: a closed 1 km road with two hairpins (one right, one left)
const n = 1000;
const curv = new Float32Array(n).fill(0.001);
for (let i = 200; i < 220; i += 1) curv[i] = 1 / 20;
for (let i = 600; i < 610; i += 1) curv[i] = -1 / 15;
const fakeRoad = {
  count: n, spacing: 1, length: n, closed: true, curvature: curv,
  px: Float32Array.from({ length: n }, (_, i) => i), pz: new Float32Array(n), py: new Float32Array(n),
  rx: new Float32Array(n), rz: new Float32Array(n).fill(1), bank: new Float32Array(n), halfWidth: new Float32Array(n).fill(4),
};
const apexes = findApexes(fakeRoad);
check('one zone per hairpin, gentle road ignored', apexes.length === 2, apexes.map((a) => a.index).join(','));
check('zones sit inside their hairpins', apexes[0].index >= 200 && apexes[0].index < 220 && apexes[1].index >= 600 && apexes[1].index < 610);
check('posts go on the outside of each turn', apexes[0].side === -1 && apexes[1].side === 1);
const clips = new ClipZones(fakeRoad);
const at = (x) => ({ position: { x, z: 0 } });
const z0 = clips.zones[0];
check('a drift through an apex pays once', clips.check(at(z0.x), { active: true })?.bonus > 0 && clips.check(at(z0.x), { active: true }) === null);
check('driving through without drifting pays nothing', clips.check(at(clips.zones[1].x), { active: false }) === null);
clips.check(at(z0.x + 100), { active: false });
check('leaving the zone re-arms it', clips.check(at(z0.x), { active: true }) !== null);

// ---- traffic: layout, motion and near-miss judging
const openRoute = { closed: false, direction: 1, startS: 100, finishS: 2100, length: 2000 };
const trafficMaps = new Set(['mussoorie', 'alpine', 'tokyo', 'hollow']);
for (const map of Object.values(MAPS)) {
  const scene = new Group();
  const traffic = Traffic.forMap(map, scene);
  check(map.id + ' follows the road traffic map list',
    Boolean(traffic) === trafficMaps.has(map.id) && scene.children.length === Number(trafficMaps.has(map.id)));
}
const cars = spawnTraffic(openRoute, 2300, 'mussoorie:climb');
check('traffic is dense and fixed per event', cars.length === 15 && JSON.stringify(cars) === JSON.stringify(spawnTraffic(openRoute, 2300, 'mussoorie:climb')));
check('no traffic car starts on the grid', cars.every((c) => c.s0 - openRoute.startS >= 180));
const openRoad = { closed: false, length: 2300 };
const toward = cars.find((c) => c.oncoming);
const ahead = cars.find((c) => !c.oncoming);
check('both oncoming cars and cars to overtake', toward && ahead);
check('oncoming cars drive at the player, the others away', trafficPose(openRoad, openRoute, toward, 5).s < trafficPose(openRoad, openRoute, toward, 0).s
  && trafficPose(openRoad, openRoute, ahead, 5).s > trafficPose(openRoad, openRoute, ahead, 0).s);
check('speeds vary between cars', new Set(cars.map((c) => Math.round(c.speed))).size > 4 && cars.every((c) => c.speed >= 15 && c.speed <= 26));
const late = trafficPose(openRoad, openRoute, cars[0], 1000);
check('a car that passes the start comes back from the far end', late.s >= 40 && late.s <= 2160);
check('side by side at speed with clear air is a near miss', judgePass(0, 3, 30) === 'nearMiss' && judgePass(1, -2.5, 25) === 'nearMiss');
check('too slow is not a near miss', judgePass(0, 3, 15) === null);
check('overlapping is a crash, far away is nothing', judgePass(0.5, 1, 30) === 'crash' && judgePass(0, 6, 30) === null && judgePass(8, 0.5, 30) === null);

// ---- speed traps on straight segments: placement, trigger once, and re-arm
{
  const m = 900;
  const sc = new Float32Array(m).fill(0);
  for (let i = 400; i < 460; i += 1) sc[i] = 1 / 25;
  const straightRoad = {
    count: m, spacing: 1, length: m, closed: false, curvature: sc, grade: new Float32Array(m),
    px: Float32Array.from({ length: m }, (_, i) => i), pz: new Float32Array(m), py: new Float32Array(m),
    rx: new Float32Array(m), rz: new Float32Array(m).fill(1), bank: new Float32Array(m), halfWidth: new Float32Array(m).fill(5),
  };
  const found = findSpeedTraps(straightRoad, { count: 2, gap: 200, prefix: 'test' });
  check('speed traps sit on straights, never in tight hairpins', found.length === 2 && found.every((t) => t.index < 380 || t.index > 500));
  const traps = new SpeedTraps(straightRoad, { count: 2, gap: 200, prefix: 'test' });
  const t0 = traps.traps[0];
  check('empty ClipZones does not fail on straight road', new ClipZones({ ...straightRoad, curvature: new Float32Array(m) }).mesh === null);
  check('speed trap fires once on crossing and re-arms after passing', traps.check({ position: { x: t0.x, z: 0 }, speedKmh: t0.targetKmh + 10 })?.speedKmh === t0.targetKmh + 10
    && traps.check({ position: { x: t0.x + 1, z: 0 }, speedKmh: t0.targetKmh + 10 }) === null
    && traps.check({ position: { x: t0.x + 45, z: 0 }, speedKmh: 90 }) === null
    && traps.check({ position: { x: t0.x, z: 0 }, speedKmh: 100 })?.speedKmh === 100);
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
