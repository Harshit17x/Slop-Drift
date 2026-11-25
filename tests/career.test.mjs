// Career (progression) tests: node tests/career.test.mjs
import { Career, formatTarget, sanitizeName } from '../src/meta/Career.js';
import {
  ACHIEVEMENTS, MEDAL_TARGETS, MUSSOORIE_MEDAL_TARGETS, TRACK_MEDAL_TARGETS, UNLOCKS, XP, levelForXp, medalTargets, xpForLevel,
} from '../src/meta/catalog.js';
import { trackKey, parseTrackKey, modeOfTrack } from '../src/meta/trackKey.js';
import { MAPS } from '../src/world/maps.js';
import { PAINT_OPTIONS, MODES } from '../src/config.js';
import { CARS } from '../src/vehicle/cars.js';

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  (${detail})` : ''}`);
}

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
}

let clock = new Date('2026-11-17T09:00:00Z');
const now = () => clock;
const state = (speed, wheels = 4) => ({ speed, speedKmh: speed * 3.6, wheelsOnGround: wheels });
const noDrift = { active: false, event: null, lastDriftScore: 0, multiplier: 1 };
const result = (modeId, extra) => ({ modeId, modeLabel: modeId, time: 999, bestTime: null, isRecord: false, score: 0, bestScore: null, topSpeedKmh: 120, respawns: 0, laps: [], ...extra });

// --- catalogue sanity
check('xp curve starts at level 1 with 0 xp', xpForLevel(1) === 0 && levelForXp(0) === 1);
check('xp curve is increasing', [2, 3, 4, 5, 10, 20].every((l) => xpForLevel(l + 1) > xpForLevel(l)));
check('levelForXp inverts xpForLevel', [2, 5, 9, 17].every((l) => levelForXp(xpForLevel(l)) === l && levelForXp(xpForLevel(l) - 1) === l - 1));
check('every paint unlock has a paint colour', UNLOCKS.filter((u) => u.slot === 'paint').every((u) => PAINT_OPTIONS.some((p) => p.id === u.value)));
check('every achievement unlock requirement exists', UNLOCKS.filter((u) => u.requires.achievement).every((u) => ACHIEVEMENTS.some((a) => a.id === u.requires.achievement)));
check('medal targets are ordered', Object.values(MEDAL_TARGETS).every((t) => (t.kind === 'time' ? t.bronze > t.silver && t.silver > t.gold && t.gold > t.author : t.bronze < t.silver && t.silver < t.gold && t.gold < t.author)));
check('achievement ids are unique', new Set(ACHIEVEMENTS.map((a) => a.id)).size === ACHIEVEMENTS.length);

// --- names
check('sanitizeName keeps a valid name', sanitizeName('  Harsh  Drift ') === 'Harsh Drift');
check('sanitizeName rejects junk', sanitizeName('<script>') === null && sanitizeName('a') === null);
check('formatTarget', formatTarget('time', 168) === '2:48.0' && formatTarget('score', 8000) === '8,000');

// --- profile persistence
const storage = memoryStorage();
let career = new Career({ storage, now });
const id = career.profile.id;
check('new profile is saved', storage.map.size === 1);
check('new profile needs a name', career.needsName);
check('rename works', career.setName('Harsh') === 'Harsh' && !career.needsName);
career = new Career({ storage, now });
check('profile reloads with the same id and name', career.profile.id === id && career.profile.name === 'Harsh');
const damaged = memoryStorage();
damaged.setItem('slop-drift-profile-v1', '{"xp":-5,"medals":{"sprint":"platinum"},"name":"<b>"}');
const repaired = new Career({ storage: damaged, now });
check('damaged save is repaired', repaired.profile.xp === 0 && !repaired.profile.medals.sprint && repaired.profile.name.startsWith('Driver'));
damaged.setItem('slop-drift-profile-v1', 'not json');
check('garbage save starts fresh', new Career({ storage: damaged, now }).profile.xp === 0);
check('no storage still works', new Career({ storage: null, now }).level === 1);

// --- distance xp and level up mid-run
career = new Career({ storage: memoryStorage(), now });
career.beginRun({ modeId: 'roam' });
for (let i = 0; i < 60 * 60 * 10; i += 1) career.trackFrame(1 / 60, state(30), noDrift); // 10 min at 30 m/s = 18 km
const distanceXp = Math.round(18 * XP.perKm);
check('distance xp is paid while driving', Math.abs(career.profile.xp - distanceXp) <= 2, `${career.profile.xp} vs ${distanceXp}`);
const midRun = career.drainEvents();
check('level up announced mid-run', midRun.some((e) => e.type === 'levelUp'), midRun.map((e) => e.type).join(','));
check('level unlocks announced', midRun.some((e) => e.type === 'unlock'));
check('distance stat tracked', Math.abs(career.profile.stats.distanceKm - 18) < 0.01);
const roam = career.abandonRun();
check('abandoning keeps the xp and reports it', roam.xpGained === career.profile.xp && roam.lines.some((l) => l.label === 'Distance'));
check('drainEvents empties the queue', career.drainEvents().length === 0);

// --- medals
career = new Career({ storage: memoryStorage(), now });
const t = MEDAL_TARGETS.climb;
check('no medal above bronze time', career.medalFor('climb', result('climb', { time: t.bronze + 1 })) === null);
check('bronze at the bronze time', career.medalFor('climb', result('climb', { time: t.bronze })) === 'bronze');
check('author medal', career.medalFor('climb', result('climb', { time: t.author - 1 })) === 'author');
check('drift medal by score', career.medalFor('drift', result('drift', { score: MEDAL_TARGETS.drift.gold + 1 })) === 'gold');
check('roam has no medal', career.medalFor('roam', result('roam', { time: 10 })) === null);

career.beginRun({ modeId: 'climb' });
let summary = career.finishRun(result('climb', { time: t.gold - 0.5, isRecord: true }));
check('first run straight to gold pays bronze+silver+gold', summary.lines.find((l) => l.label === 'Gold medal')?.xp === XP.medal.bronze + XP.medal.silver + XP.medal.gold);
check('medal is new', summary.medal.tier === 'gold' && summary.medal.isNew);
check('next medal is author', summary.medal.next?.tier === 'author');
check('finish and pb xp', summary.lines.some((l) => l.label === 'Finish') && summary.lines.some((l) => l.label === 'Personal best'));
check('achievements: finish, summit, clean, first gold', ['first-finish', 'summit', 'first-gold'].every((a) => summary.achievements.some((x) => x.id === a)), summary.achievements.map((a) => a.id).join(','));
check('summary xp matches profile delta', summary.after.xp - summary.before.xp === summary.xpGained, `${summary.after.xp - summary.before.xp} vs ${summary.xpGained}`);
career.beginRun({ modeId: 'climb' });
summary = career.finishRun(result('climb', { time: t.gold - 0.2 }));
check('repeating a medal pays no medal xp', !summary.lines.some((l) => l.label.endsWith('medal')) && summary.medal && !summary.medal.isNew);
career.beginRun({ modeId: 'climb' });
summary = career.finishRun(result('climb', { time: t.silver - 1 }));
check('a worse run does not downgrade the medal', career.profile.medals.climb === 'gold');
check('medal board', career.medalBoard().climb.medal === 'gold' && career.medalBoard().sprint.next.tier === 'bronze');

// --- each unlock is announced exactly once, even when a medal causes a level-up
career = new Career({ storage: memoryStorage(), now });
career.beginRun({ modeId: 'climb' });
career.finishRun(result('climb', { time: MEDAL_TARGETS.climb.gold - 0.5, isRecord: true }));
const unlockTitles = career.drainEvents().filter((e) => e.type === 'unlock').map((e) => e.title);
check('no duplicate unlock notifications', unlockTitles.length === new Set(unlockTitles).size && unlockTitles.length > 0, unlockTitles.join(', '));

// --- medal-count unlocks and all-gold
career = new Career({ storage: memoryStorage(), now });
const before = career.unlockedIds();
for (const modeId of ['sprint', 'circuit', 'climb']) {
  career.beginRun({ modeId });
  career.finishRun(result(modeId, { time: MEDAL_TARGETS[modeId].gold - 0.1 }));
}
check('3 golds unlock Sunburst', career.unlockedIds().has('paint:sunburst') && !before.has('paint:sunburst'));
for (const modeId of ['descent']) {
  career.beginRun({ modeId });
  career.finishRun(result(modeId, { time: MEDAL_TARGETS[modeId].gold - 0.1 }));
}
career.beginRun({ modeId: 'drift' });
summary = career.finishRun(result('drift', { time: 120, score: MEDAL_TARGETS.drift.gold + 10 }));
check('gold everywhere unlocks Mountain Master', Boolean(career.profile.achievements['all-gold']));
check('Mountain Master unlocks Obsidian', career.unlockedIds().has('paint:obsidian'));
check('5 golds unlock gold rims', career.unlockedIds().has('rim:gold'));

// --- cosmetics
career = new Career({ storage: memoryStorage(), now });
check('cannot pick a locked paint', career.setCosmetic('paint', 'midnight') === false && career.profile.cosmetics.paint === 'pearl');
check('can pick a free paint', career.setCosmetic('paint', 'ember') === true && career.profile.cosmetics.paint === 'ember');
check('custom number locked at level 1', career.setCosmetic('number', '9') === false);
career.addXp(xpForLevel(5));
check('custom number after level 5', career.setCosmetic('number', '9x9') === true && career.profile.cosmetics.number === '99');
check('silver rims always allowed', career.setCosmetic('rim', 'silver'));
const garage = career.garage();
check('garage lists every unlock plus silver rims and no neon', garage.items.length === UNLOCKS.length + 2 + CARS.length && garage.items.some((i) => i.id === 'rim:silver') && garage.items.some((i) => i.id === 'neon:off'));
check('neon is off by default and always switchable off', garage.selected.neon === 'off' && career.setCosmetic('neon', 'off'));
check('cyan neon fits at level 5', career.setCosmetic('neon', 'cyan') && career.profile.cosmetics.neon === 'cyan');
check('ice neon locked until level 12', career.setCosmetic('neon', 'ice') === false && career.profile.cosmetics.neon === 'cyan');
check('rainbow neon needs the night achievement', career.setCosmetic('neon', 'rainbow') === false);
check('unknown neon rejected', career.setCosmetic('neon', 'plaid') === false);
check('rally hatch is the default car', garage.selected.car === 'hatch');
check('every car can be picked', CARS.every((car) => career.setCosmetic('car', car.id)) && career.profile.cosmetics.car === CARS.at(-1).id);
check('unknown car rejected', career.setCosmetic('car', 'tank') === false && career.profile.cosmetics.car === CARS.at(-1).id);
check('favorite car toggles and persists', career.toggleFavoriteCar('gt') === true && career.garage().favorites.includes('gt') && career.toggleFavoriteCar('gt') === false && !career.garage().favorites.includes('gt'));
check('unknown favorite car rejected', career.toggleFavoriteCar('tank') === false);
check('garage locked items explain why', garage.items.filter((i) => !i.unlocked).every((i) => i.requirement.length > 0));

// --- drifting and air
career = new Career({ storage: memoryStorage(), now });
career.beginRun({ modeId: 'drift' });
career.trackFrame(1 / 60, state(25), { active: false, event: 'drift_end', lastDriftScore: 1200, multiplier: 5 });
check('drift achievements', ['first-drift', 'combo-1k', 'multiplier-5'].every((a) => career.profile.achievements[a]));
check('drift xp', career.run.lines.get('Drifting') === Math.floor(1200 * XP.perDriftPoints));
for (let i = 0; i < 70; i += 1) career.trackFrame(1 / 60, state(25, 0), noDrift);
check('airtime achievement after a second airborne', Boolean(career.profile.achievements.air));

// --- daily challenge
career = new Career({ storage: memoryStorage(), now });
const daily = career.daily();
check('daily is deterministic for a date', JSON.stringify(daily) === JSON.stringify(new Career({ storage: memoryStorage(), now }).daily()));
check('daily has a target and text', Number.isFinite(daily.target) && daily.text.includes(daily.modeLabel));
const passing = daily.kind === 'score' ? { score: daily.target + 1, time: 120 } : { time: daily.target - 0.1 };
career.beginRun({ modeId: daily.modeId, timeOfDay: daily.timeOfDay || 'day' });
summary = career.finishRun(result(daily.modeId, passing));
check('completing the daily pays out and starts a streak', summary.daily?.completed && summary.daily.streak === 1 && career.daily().done);
career.beginRun({ modeId: daily.modeId, timeOfDay: daily.timeOfDay || 'day' });
summary = career.finishRun(result(daily.modeId, passing));
check('daily pays only once a day', summary.daily === null);
clock = new Date('2026-11-18T09:00:00Z');
const tomorrow = career.daily();
check('streak carries into the next day', tomorrow.streak === 1 && !tomorrow.done);
const passTomorrow = tomorrow.kind === 'score' ? { score: tomorrow.target + 1, time: 120 } : { time: tomorrow.target - 0.1 };
career.beginRun({ modeId: tomorrow.modeId, timeOfDay: tomorrow.timeOfDay || 'day' });
summary = career.finishRun(result(tomorrow.modeId, passTomorrow));
check('two days in a row is a 2-day streak', summary.daily?.streak === 2);
clock = new Date('2026-11-21T09:00:00Z');
check('missing a day breaks the streak', career.daily().streak === 0);
const dates = new Set();
for (let d = 1; d <= 28; d += 1) {
  clock = new Date(Date.UTC(2026, 11, d, 12));
  dates.add(career.daily().modeId);
}
check('dailies rotate through several events', dates.size >= 3, [...dates].join(','));
clock = new Date('2026-11-17T09:00:00Z');

// --- clean / night / respawn rules
career = new Career({ storage: memoryStorage(), now });
career.beginRun({ modeId: 'sprint', timeOfDay: 'night' });
career.onRespawn();
summary = career.finishRun(result('sprint', { time: 300, respawns: 1 }));
check('respawn denies the clean-lap achievement', !career.profile.achievements['clean-lap']);
check('night finish achievement', Boolean(career.profile.achievements['night-run']));
check('respawn stat', career.profile.stats.respawns === 1);

// --- track keys: progress is per map, Alpine keeps the bare mode ids
check('alpine track key is the bare mode id', trackKey('alpine', 'climb') === 'climb' && trackKey(undefined, 'climb') === 'climb');
check('other maps are namespaced', trackKey('mussoorie', 'climb') === 'mussoorie.climb');
check('parseTrackKey inverts trackKey', ['alpine', 'mussoorie'].every((mapId) => MODES.every((m) => {
  const parsed = parseTrackKey(trackKey(mapId, m.id));
  return parsed.mapId === mapId && parsed.modeId === m.id;
})));
check('modeOfTrack', modeOfTrack('mussoorie.drift') === 'drift' && modeOfTrack('drift') === 'drift');
check('mussoorie targets are ordered', Object.values(MUSSOORIE_MEDAL_TARGETS).every((t) => (t.kind === 'time' ? t.bronze > t.silver && t.silver > t.gold && t.gold > t.author : t.bronze < t.silver && t.silver < t.gold && t.gold < t.author)));
check('mussoorie timed targets are quicker than alpine (shorter tracks)', ['sprint', 'circuit', 'climb', 'descent'].every((m) => MUSSOORIE_MEDAL_TARGETS[m].gold < MEDAL_TARGETS[m].gold));
check('track targets resolve through the track key', medalTargets('sprint') === MEDAL_TARGETS.sprint && medalTargets('mussoorie.sprint') === MUSSOORIE_MEDAL_TARGETS.sprint);
check('unranked tracks have no targets', medalTargets('roam') === null && medalTargets('mussoorie.roam') === null && medalTargets('toString') === null);
const expectedTracks = Object.values(MAPS).flatMap(map => MODES
  .filter(mode => mode.id !== 'roam' && map.routes.includes(mode.route))
  .map(mode => trackKey(map.id, mode.id)));
check('every map ranks its own events', expectedTracks.length === Object.keys(TRACK_MEDAL_TARGETS).length
  && expectedTracks.every(key => medalTargets(key)));
check('Nag Tibba is ranked on Mussoorie only', medalTargets('mussoorie.peak') && medalTargets('mussoorie.peakdown') && medalTargets('peak') === null && medalTargets('peakdown') === null);
check('Nag Tibba targets are longer than the Lal Tibba climb', MUSSOORIE_MEDAL_TARGETS.peak.gold > MUSSOORIE_MEDAL_TARGETS.climb.gold && MUSSOORIE_MEDAL_TARGETS.peakdown.gold > MUSSOORIE_MEDAL_TARGETS.descent.gold);

const mapStorage = memoryStorage();
const alpine = new Career({ storage: mapStorage, now });
alpine.beginRun({ modeId: 'climb' });
alpine.finishRun(result('climb', { time: MEDAL_TARGETS.climb.gold - 0.5 }));
check('alpine medal is stored under the bare mode id', alpine.profile.medals.climb === 'gold' && !alpine.profile.medals['mussoorie.climb']);
const hills = new Career({ storage: mapStorage, now, mapId: 'mussoorie' });
check('alpine medals do not show on mussoorie', hills.medalBoard().climb.medal === null);
check('mussoorie next medal uses mussoorie targets', hills.nextMedal('climb').target === MUSSOORIE_MEDAL_TARGETS.climb.bronze);
check('an alpine-gold time is no medal on mussoorie', hills.medalFor('climb', result('climb', { time: MEDAL_TARGETS.climb.gold - 0.5 })) === null);
hills.beginRun({ modeId: 'climb' });
summary = hills.finishRun(result('climb', { time: MUSSOORIE_MEDAL_TARGETS.climb.silver - 0.1 }));
check('mussoorie medal is keyed by track', hills.profile.medals['mussoorie.climb'] === 'silver' && hills.profile.medals.climb === 'gold' && summary.medal?.tier === 'silver');
check('achievements still use plain mode ids on any map', Boolean(hills.profile.achievements.summit));
hills.beginRun({ modeId: 'peak' });
summary = hills.finishRun(result('peak', { time: MUSSOORIE_MEDAL_TARGETS.peak.bronze - 0.1 }));
check('finishing the Nag Tibba climb earns its achievement and a medal', Boolean(hills.profile.achievements['nag-tibba']) && hills.profile.medals['mussoorie.peak'] === 'bronze');
hills.setMap('alpine');
check('setMap switches the board back to alpine', hills.medalBoard().climb.medal === 'gold');

// --- daily challenge follows the map
const dailyAlpine = new Career({ storage: memoryStorage(), now }).daily();
const dailyHills = new Career({ storage: memoryStorage(), now, mapId: 'mussoorie' }).daily();
check('same event on every map that has it, keyed per map', (dailyAlpine.modeId === dailyHills.modeId || !new Career({ storage: memoryStorage(), now }).rankedModes().includes(dailyHills.modeId))
  && dailyAlpine.trackKey === dailyAlpine.modeId && dailyHills.trackKey === `mussoorie.${dailyHills.modeId}`);
{
  const alpineDays = new Career({ storage: memoryStorage(), now: () => clock });
  const hillDays = new Career({ storage: memoryStorage(), now: () => clock, mapId: 'mussoorie' });
  const alpineModes = new Set();
  const hillModes = new Set();
  let agree = true;
  for (let d = 0; d < 366; d += 1) {
    clock = new Date(Date.UTC(2026, 0, 1 + d, 12));
    const a = alpineDays.daily();
    const h = hillDays.daily();
    alpineModes.add(a.modeId);
    hillModes.add(h.modeId);
    if (alpineDays.rankedModes().includes(h.modeId) && a.modeId !== h.modeId) agree = false;
  }
  clock = new Date('2026-11-17T09:00:00Z');
  check('alpine never rolls a Nag Tibba daily', !alpineModes.has('peak') && !alpineModes.has('peakdown'), [...alpineModes].join(','));
  check('mussoorie dailies can be Nag Tibba events', hillModes.has('peak') && hillModes.has('peakdown'), [...hillModes].join(','));
  check('maps agree on the daily whenever both have the event', agree);
  check('ranked modes follow the map', alpineDays.rankedModes().join() === 'sprint,circuit,climb,descent,drift'
    && hillDays.rankedModes().join() === 'sprint,circuit,climb,descent,drift,peak,peakdown');
  check('mussoorie medal board lists the Nag Tibba events', 'peak' in hillDays.medalBoard() && !('peak' in alpineDays.medalBoard()));
}
check('daily label stays friendly', dailyHills.modeLabel === MODES.find((m) => m.id === dailyHills.modeId).label);
const passFor = (d) => (d.kind === 'score' ? { score: d.target + 1, time: 120 } : { time: d.target - 0.1 });
const wrongMap = new Career({ storage: memoryStorage(), now, mapId: 'mussoorie' });
const challengeAlpine = { ...dailyAlpine, target: dailyAlpine.kind === 'score' ? 0 : 1e9 };
check('a run on another map does not complete the daily', !wrongMap.dailyMet(challengeAlpine, result(dailyAlpine.modeId, passFor(challengeAlpine)), { timeOfDay: challengeAlpine.timeOfDay || 'day' }));
const onMap = new Career({ storage: memoryStorage(), now, mapId: 'mussoorie' });
onMap.beginRun({ modeId: dailyHills.modeId, timeOfDay: dailyHills.timeOfDay || 'day' });
summary = onMap.finishRun(result(dailyHills.modeId, passFor(dailyHills)));
check('a run on the daily\'s map completes it', summary.daily?.completed === true);
if (dailyHills.kind === 'time') check('mussoorie daily target comes from mussoorie medals', dailyHills.target < dailyAlpine.target);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
