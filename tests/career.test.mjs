// Career (progression) tests: node tests/career.test.mjs
import { Career, formatTarget, sanitizeName } from '../src/meta/Career.js';
import {
  ACHIEVEMENTS, CAR_UNLOCKS, CONTRACT_REWARD, CREDITS, MASTERY_STARS, MASTERY_STAR_CREDITS, streakBoost, FEATURE_UNLOCKS, MAP_UNLOCKS, MEDAL_TARGETS,
  MUSSOORIE_MEDAL_TARGETS, TRACK_MEDAL_TARGETS, UNLOCKS, XP, levelForXp, medalTargets, xpForLevel,
} from '../src/meta/catalog.js';
import { trackKey, parseTrackKey, modeOfTrack } from '../src/meta/trackKey.js';
import { MAPS } from '../src/world/maps.js';
import { PAINT_OPTIONS, SMOKE_OPTIONS, MODES, modesForWorld } from '../src/config.js';
import { CARS, getCar } from '../src/vehicle/cars.js';
import { applyCarUpgrades, effectiveCarRatings, effectiveClassInfo, hasCarNitro } from '../src/vehicle/upgradeTuning.js';
import { DriftScorer } from '../src/vehicle/DriftScorer.js';
import { RIVALS } from '../src/meta/catalog.js';
import { Road } from '../src/world/Road.js';
import { WORLD } from '../src/world/worldConfig.js';
import { buildPaceGhost } from '../src/ghost/paceGhost.js';
import { GhostPlayer } from '../src/ghost/GhostPlayer.js';
import * as THREE from 'three';

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
check('every smoke unlock has a smoke colour', UNLOCKS.filter((u) => u.slot === 'smoke').every((u) => SMOKE_OPTIONS.some((s) => s.id === u.value)));
check('every achievement unlock requirement exists', UNLOCKS.filter((u) => u.requires.achievement).every((u) => ACHIEVEMENTS.some((a) => a.id === u.requires.achievement)));
check('medal targets are ordered', Object.values(MEDAL_TARGETS).every((t) => (t.kind === 'time' ? t.bronze > t.silver && t.silver > t.gold && t.gold > t.author : t.bronze < t.silver && t.silver < t.gold && t.gold < t.author)));
check('achievement ids are unique', new Set(ACHIEVEMENTS.map((a) => a.id)).size === ACHIEVEMENTS.length);
check('every car and map has an unlock rule', CARS.every((c) => Boolean(CAR_UNLOCKS[c.id])) && Object.keys(MAPS).every((id) => Boolean(MAP_UNLOCKS[id])));

// --- names
check('sanitizeName keeps a valid name', sanitizeName('  Harsh  Drift ') === 'Harsh Drift');
check('sanitizeName rejects junk', sanitizeName('<script>') === null && sanitizeName('a') === null);
check('formatTarget', formatTarget('time', 168) === '2:48.0' && formatTarget('score', 8000) === '8,000');

// --- profile persistence & legacy migration
const storage = memoryStorage();
let career = new Career({ storage, now });
const id = career.profile.id;
check('new profile is saved with starter credits', storage.map.size === 1 && career.credits === CREDITS.starter);
check('new profile needs a name', career.needsName);
check('rename works', career.setName('Harsh') === 'Harsh' && !career.needsName);
career = new Career({ storage, now });
check('profile reloads with the same id and name', career.profile.id === id && career.profile.name === 'Harsh');
const damaged = memoryStorage();
damaged.setItem('slop-drift-profile-v1', '{"xp":-5,"medals":{"sprint":"platinum"},"name":"<b>"}');
const repaired = new Career({ storage: damaged, now });
check('damaged save is repaired', repaired.profile.xp === 0 && !repaired.profile.medals.sprint && repaired.profile.name.startsWith('Driver') && repaired.credits === CREDITS.starter);
damaged.setItem('slop-drift-profile-v1', 'not json');
check('garbage save starts fresh', new Career({ storage: damaged, now }).profile.xp === 0);
check('no storage still works', new Career({ storage: null, now }).level === 1);

const legacy = memoryStorage();
legacy.setItem('slop-drift-profile-v1', JSON.stringify({ xp: 1000, medals: { 'tokyo.sprint': 'silver' }, cosmetics: { car: 'tokyo' } }));
const migrated = new Career({ storage: legacy, now });
check('legacy save receives retroactive credits and keeps car/map access', migrated.credits > CREDITS.starter && migrated.isCarUnlocked('tokyo') && migrated.isMapUnlocked('tokyo'));

// --- distance xp/credits and level up mid-run
career = new Career({ storage: memoryStorage(), now });
career.beginRun({ modeId: 'roam' });
for (let i = 0; i < 60 * 60 * 30; i += 1) career.trackFrame(1 / 60, state(30), noDrift); // 30 min at 30 m/s = 54 km
const distanceXp = Math.round(54 * XP.perKm);
check('distance xp is paid while driving', Math.abs(career.run.lines.get('Distance') - distanceXp) <= 2, `${career.run.lines.get('Distance')} vs ${distanceXp}`);
check('distance credits are paid while driving', career.credits > CREDITS.starter);
const midRun = career.drainEvents();
check('level up announced mid-run', midRun.some((e) => e.type === 'levelUp'), midRun.map((e) => e.type).join(','));
check('level unlocks announced', midRun.some((e) => e.type === 'unlock'));
check('distance stat tracked', Math.abs(career.profile.stats.distanceKm - 54) < 0.01);
const roam = career.abandonRun();
check('abandoning keeps the xp and reports it', roam.xpGained === career.profile.xp && roam.lines.some((l) => l.label === 'Distance'));
career.drainEvents();
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
check('finish and pb xp and credits', summary.lines.some((l) => l.label === 'Finish') && summary.lines.some((l) => l.label === 'Personal best') && summary.creditsGained > 0);
check('achievements: finish, summit, underdog, first gold', ['first-finish', 'summit', 'first-gold', 'underdog'].every((a) => summary.achievements.some((x) => x.id === a)), summary.achievements.map((a) => a.id).join(','));
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

// --- medal-count unlocks and all-gold / alpine-silver / purist-gold
career = new Career({ storage: memoryStorage(), now });
const before = career.unlockedIds();
for (const modeId of ['sprint', 'circuit', 'climb']) {
  career.beginRun({ modeId });
  career.finishRun(result(modeId, { time: MEDAL_TARGETS[modeId].gold - 0.1 }));
}
check('3 golds unlock Sunburst and Crimson smoke', career.unlockedIds().has('paint:sunburst') && career.unlockedIds().has('smoke:crimson') && !before.has('paint:sunburst'));
for (const modeId of ['descent']) {
  career.beginRun({ modeId });
  career.finishRun(result(modeId, { time: MEDAL_TARGETS[modeId].gold - 0.1 }));
}
career.beginRun({ modeId: 'drift', settings: { handling: 'Sim', transmission: 'manual', abs: false, driftAssist: 0 } });
summary = career.finishRun(result('drift', { time: 120, score: MEDAL_TARGETS.drift.gold + 10 }));
check('gold everywhere unlocks Mountain Master and Alpine Specialist', Boolean(career.profile.achievements['all-gold']) && Boolean(career.profile.achievements['alpine-silver']));
check('Zero-Assist Purist achievement triggers on Sim+Manual+NoABS+0 assist gold', Boolean(career.profile.achievements['purist-gold']));
check('Mountain Master unlocks Obsidian', career.unlockedIds().has('paint:obsidian'));
check('5 golds unlock gold rims', career.unlockedIds().has('rim:gold'));

// --- car/map/feature locks, early unlock, trial car, and upgrades
career = new Career({ storage: memoryStorage(), now });
check('only Rally Hatch and Mussoorie unlocked at Level 1', career.isCarUnlocked('hatch') && !career.isCarUnlocked('thar') && !career.isCarUnlocked('gt') && career.isMapUnlocked('mussoorie') && !career.isMapUnlocked('tokyo'));
check('features locked at Level 1 and unlock as driver levels up', !career.isFeatureUnlocked('ghosts') && !career.isFeatureUnlocked('smoke') && FEATURE_UNLOCKS.length >= 6);
check('cannot pick locked car directly', career.setCosmetic('car', 'gt') === false && career.activeCarId() === 'hatch');
career.beginRun({ modeId: 'sprint' });
check('1-run trial car temporarily equips locked car and clears on finish', career.startTrialCar('gt') && career.activeCarId() === 'gt' && career.finishRun(result('sprint', { time: 200 })) && career.activeCarId() === 'hatch');

const freshEarly = new Career({ storage: memoryStorage(), now });
freshEarly.addCredits(CAR_UNLOCKS.thar.earlyCost, 'Test');
const early = freshEarly.buyCarEarly('thar');
check('early unlock buys locked car with credits', early.ok && freshEarly.isCarUnlocked('thar') && freshEarly.profile.cosmetics.car === 'thar');

const upg1 = career.buyUpgrade('hatch', 'engine');
check('stage 1 engine upgrade installs at Level 1 and unlocks First Wrench', upg1.ok && career.carUpgrades('hatch').engine === 1 && Boolean(career.profile.achievements['first-upgrade']));
check('stage 2 engine upgrade blocked below level 5', career.buyUpgrade('hatch', 'engine').reason === 'level-locked');
career.addXp(xpForLevel(14));
career.addCredits(20000);
check('all cars unlocked at level 14', CARS.every((car) => career.isCarUnlocked(car.id) && career.setCosmetic('car', car.id)));
for (const slot of ['engine', 'tires', 'nitro', 'chassis']) {
  while (career.canBuyUpgrade('gt', slot).ok) career.buyUpgrade('gt', slot);
}
check('maxing all slots unlocks Full Build and equips nitro on GT3', Boolean(career.profile.achievements['max-tune']) && hasCarNitro(getCar('gt'), career.carUpgrades('gt')));
const gtTuned = applyCarUpgrades(getCar('gt'), career.carUpgrades('gt'));
check('upgrades boost physics torque, grip, mass and ratings', gtTuned.drivetrain.peakTorque > getCar('gt').tuning.drivetrain.peakTorque
  && gtTuned.tire.mu > getCar('gt').tuning.tire.mu
  && gtTuned.mass < getCar('gt').tuning.mass
  && effectiveClassInfo(getCar('gt'), career.carUpgrades('gt')).rank > getCar('gt').classRank
  && effectiveCarRatings(getCar('gt'), career.carUpgrades('gt')).acceleration > getCar('gt').ratings.acceleration);

// --- cosmetics & smoke
career = new Career({ storage: memoryStorage(), now });
check('cannot pick a locked paint', career.setCosmetic('paint', 'midnight') === false && career.profile.cosmetics.paint === 'pearl');
check('can pick a free paint', career.setCosmetic('paint', 'ember') === true && career.profile.cosmetics.paint === 'ember');
check('custom number locked at level 1', career.setCosmetic('number', '9') === false);
career.addXp(xpForLevel(5));
check('custom number after level 5', career.setCosmetic('number', '9x9') === true && career.profile.cosmetics.number === '99');
check('smoke color locked at Lv1, unlocks by Lv5', career.setCosmetic('smoke', 'cyan') === true && career.profile.cosmetics.smoke === 'cyan');
check('silver rims always allowed', career.setCosmetic('rim', 'silver'));
const garage = career.garage();
check('garage lists every unlock plus silver rims, no neon, white smoke and cars', garage.items.length === UNLOCKS.length + 3 + CARS.length
  && garage.items.some((i) => i.id === 'rim:silver') && garage.items.some((i) => i.id === 'neon:off') && garage.items.some((i) => i.id === 'smoke:white'));
check('neon is off by default and always switchable off', garage.selected.neon === 'off' && career.setCosmetic('neon', 'off'));
check('cyan neon fits at level 5', career.setCosmetic('neon', 'cyan') && career.profile.cosmetics.neon === 'cyan');
check('ice neon locked until level 12', career.setCosmetic('neon', 'ice') === false && career.profile.cosmetics.neon === 'cyan');
check('rainbow neon needs the night achievement', career.setCosmetic('neon', 'rainbow') === false);
check('unknown neon rejected', career.setCosmetic('neon', 'plaid') === false);
check('rally hatch is the default car', garage.selected.car === 'hatch');
check('unknown car rejected', career.setCosmetic('car', 'tank') === false);
check('favorite car toggles and persists', career.toggleFavoriteCar('gt') === true && career.garage().favorites.includes('gt') && career.toggleFavoriteCar('gt') === false && !career.garage().favorites.includes('gt'));
check('unknown favorite car rejected', career.toggleFavoriteCar('tank') === false);
check('garage locked items explain why', garage.items.filter((i) => !i.unlocked).every((i) => i.requirement.length > 0));

// --- drifting, style events and air
career = new Career({ storage: memoryStorage(), now });
career.beginRun({ modeId: 'drift' });
career.trackFrame(1 / 60, state(25), { active: true, event: null, lastDriftScore: 0, multiplier: 2, styleEvent: { kind: 'wallTap', label: 'WALL TAP', bonus: 180 } });
career.trackFrame(1 / 60, state(25), { active: true, event: null, lastDriftScore: 0, multiplier: 2, styleEvent: { kind: 'backward', label: 'REVERSE ENTRY', bonus: 120 } });
career.trackFrame(1 / 60, state(25), { active: false, event: 'drift_end', lastDriftScore: 1200, multiplier: 5 });
check('drift and style achievements', ['first-drift', 'combo-1k', 'multiplier-5', 'wall-tap', 'backward-entry'].every((a) => career.profile.achievements[a]));
check('drift xp', career.run.lines.get('Drifting') === Math.floor(1200 * XP.perDriftPoints));
for (let i = 0; i < 70; i += 1) career.trackFrame(1 / 60, state(25, 0), noDrift);
check('airtime achievement after a second airborne', Boolean(career.profile.achievements.air));

// --- DriftScorer wall tap & reverse entry detection
{
  const scorer = new DriftScorer();
  const s = (angDeg, speed = 26, scrape = 0) => {
    const r = (angDeg * Math.PI) / 180;
    return {
      velocity: { x: Math.sin(r) * speed, z: -Math.cos(r) * speed },
      forward: { x: 0, z: -1 },
      right: { x: 1, z: 0 },
      steerAngle: -0.35,
      handbrake: true,
      surface: 0,
      airborne: false,
      upsideDown: false,
      impact: 0,
      scrape,
    };
  };
  for (let i = 0; i < 15; i += 1) scorer.update(1 / 60, s(32, 26), { handbrake: true, steer: -0.5 });
  let backwardStyle = null;
  for (let i = 0; i < 8; i += 1) {
    const snap = scorer.update(1 / 60, s(58, 26), { handbrake: true, steer: -0.5 });
    if (snap.styleEvent?.kind === 'backward') backwardStyle = snap.styleEvent;
  }
  check('DriftScorer fires Reverse Entry on deep high-speed slip', backwardStyle?.kind === 'backward');
  const tap = scorer.update(1 / 60, s(35, 24, 4.5), { handbrake: true, steer: -0.5 });
  check('DriftScorer fires Wall Tap on gentle barrier scrape', tap.styleEvent?.kind === 'wallTap');
}

// --- daily challenge & 2x rewarded bonus
career = new Career({ storage: memoryStorage(), now });
const daily = career.daily();
check('daily is deterministic for a date', JSON.stringify(daily) === JSON.stringify(new Career({ storage: memoryStorage(), now }).daily()));
check('daily has a target and text', Number.isFinite(daily.target) && daily.text.includes(daily.modeLabel));
const passing = daily.kind === 'score' ? { score: daily.target + 1, time: 120 } : { time: daily.target - 0.1 };
career.beginRun({ modeId: daily.modeId, timeOfDay: daily.timeOfDay || 'day' });
summary = career.finishRun(result(daily.modeId, passing));
check('completing the daily pays out and starts a streak', summary.daily?.completed && summary.daily.streak === 1 && career.daily().done);
const beforeDbl = career.credits;
const dbl = career.claimAdDoubleBonus();
check('2x reward bonus pays once per finished run', dbl && career.credits === beforeDbl + summary.creditsGained && career.claimAdDoubleBonus() === null);
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

// --- track keys
check('alpine track key is the bare mode id', trackKey('alpine', 'climb') === 'climb' && trackKey(undefined, 'climb') === 'climb');
check('other maps are namespaced', trackKey('mussoorie', 'climb') === 'mussoorie.climb');
check('parseTrackKey inverts trackKey', ['alpine', 'mussoorie'].every((mapId) => MODES.every((m) => {
  const parsed = parseTrackKey(trackKey(mapId, m.id));
  return parsed.mapId === mapId && parsed.modeId === m.id;
})));
check('modeOfTrack', modeOfTrack('mussoorie.drift') === 'drift' && modeOfTrack('drift') === 'drift');
check('mussoorie targets are ordered', Object.values(MUSSOORIE_MEDAL_TARGETS).every((t) => (t.kind === 'time' ? t.bronze > t.silver && t.silver > t.gold && t.gold > t.author : t.bronze < t.silver && t.silver < t.gold && t.gold < t.author)));
check('mussoorie timed targets are quicker than alpine', ['sprint', 'circuit', 'climb', 'descent'].every((m) => MUSSOORIE_MEDAL_TARGETS[m].gold < MEDAL_TARGETS[m].gold));
check('track targets resolve through the track key', medalTargets('sprint') === MEDAL_TARGETS.sprint && medalTargets('mussoorie.sprint') === MUSSOORIE_MEDAL_TARGETS.sprint);
check('unranked tracks have no targets', medalTargets('roam') === null && medalTargets('mussoorie.roam') === null && medalTargets('toString') === null);
const expectedTracks = Object.values(MAPS).flatMap(map => modesForWorld({config:map.config,routes:Object.fromEntries(map.routes.map(id=>[id,true]))})
  .filter(mode => mode.id !== 'roam')
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

// --- daily contracts & streak-boosted payout
check('streak boost: x1 on day 1, x2.5 from day 7', streakBoost(1) === 1 && streakBoost(2) === 1.25 && streakBoost(7) === 2.5 && streakBoost(30) === 2.5);
clock = new Date('2026-12-02T09:00:00Z');
const cc = new Career({ storage: memoryStorage(), now, mapId: 'mussoorie' });
const pair = cc.contracts();
check('two different contracts a day, same for everyone', pair.length === 2 && pair[0].id !== pair[1].id
  && JSON.stringify(pair) === JSON.stringify(new Career({ storage: memoryStorage(), now, mapId: 'mussoorie' }).contracts()));
check('no clipping-zone contract on a map without zones', [...Array(40).keys()].every((d) => {
  clock = new Date(Date.UTC(2027, 0, d + 1, 9));
  return new Career({ storage: memoryStorage(), now, mapId: 'tokyo' }).contracts().every((c) => c.id !== 'clips');
}));
clock = new Date('2026-12-02T09:00:00Z');
const statOf = { 'drift-points': 'driftPoints', distance: 'km', finishes: 'finishes', clean: 'cleanFinishes', clips: 'clips', style: 'styleMoves' };
const c0 = pair[0];
const xpBefore = cc.profile.xp;
const crBefore = cc.credits;
cc.bumpContract(statOf[c0.id], c0.goal - 0.5);
check('partial progress is kept, nothing paid yet', cc.contracts()[0].progress === c0.goal - 0.5 && !cc.contracts()[0].done && cc.profile.xp === xpBefore);
cc.bumpContract(statOf[c0.id], 1);
cc.bumpContract(statOf[c0.id], 50);
check('a filled contract pays once', cc.contracts()[0].done && cc.profile.xp === xpBefore + CONTRACT_REWARD.xp && cc.credits === crBefore + CONTRACT_REWARD.credits);
check('the daily card carries the contracts', cc.daily().contracts.length === 2);
clock = new Date('2026-12-03T09:00:00Z');
check('contracts reset the next day', cc.contracts().every((c) => !c.done && c.progress === 0));
const reloaded = new Career({ storage: cc.storage, now, mapId: 'mussoorie' });
reloaded.load?.();
clock = new Date('2026-12-02T09:00:00Z');
check('contract progress survives a reload', reloaded.contracts()[0].done);
const streaky = new Career({ storage: memoryStorage(), now });
streaky.profile.daily = { date: '2026-12-01', done: true, lastDoneDate: '2026-12-01', streak: 6 };
const d7 = streaky.daily();
check('day 7 of a streak pays x2.5', d7.boost === 2.5 && d7.xp === Math.round(XP.dailyChallenge * 2.5));

// --- car mastery
const mc = new Career({ storage: memoryStorage(), now });
mc.beginRun({ modeId: 'sprint', carId: 'hatch' });
mc.addXp(MASTERY_STARS[1] + 10, 'test');
const crMid = mc.credits;
const ms = mc.abandonRun();
check('run XP fills the car it was earned in', mc.masteryInfo('hatch').xp >= MASTERY_STARS[1] + 10 && mc.masteryInfo('thar').xp === 0);
check('two stars at once pay 150 + 300 CR', ms.mastery?.stars === 2 && ms.mastery.newStars === 2 && mc.credits === crMid + 3 * MASTERY_STAR_CREDITS);
mc.beginRun({ modeId: 'sprint', carId: 'hatch' });
mc.addXp(10, 'test');
check('no star, no pay', mc.abandonRun().mastery.newStars === 0);
mc.beginRun({ modeId: 'sprint', carId: 'hatch' });
mc.addXp(MASTERY_STARS[4], 'test');
mc.abandonRun();
check('five stars award One-Car Specialist', mc.masteryInfo('hatch').stars === 5 && Boolean(mc.profile.achievements['mastery-5']));
check('the garage lists each car\'s stars', mc.garage().items.find((i) => i.value === 'hatch')?.mastery?.stars === 5);
mc.save();
check('mastery survives a reload', new Career({ storage: mc.storage, now }).masteryInfo('hatch').stars === 5);

// --- rivals
const rc = new Career({ storage: memoryStorage(), now, mapId: 'mussoorie' });
let list = rc.rivals();
check('three rivals per region, only the first open', list.length === 3 && list.map((r) => r.state).join() === 'open,locked,locked');
check('every rival has a real event and time on its map', RIVALS.every((r) => new Career({ storage: memoryStorage(), now, mapId: r.mapId }).rivals().some((x) => x.id === r.id && x.time > 0)));
check('rookie is slower than challenger is slower than the boss, relative to gold', list[0].time / rc.targetsFor(list[0].modeId).gold > list[2].time / rc.targetsFor(list[2].modeId).gold);
check('a rival is always quicker than your best on their event', (() => {
  const fast = rc.rivals('mussoorie', { [list[0].modeId]: { time: list[0].time * 0.8 } })[0];
  return fast.time < list[0].time * 0.8 && fast.time >= list[0].time * 0.8 * 0.95;
})());
check('bosses push harder against your best than rookies', RIVALS.length && rc.rivals('mussoorie', { sprint: { time: 60 }, descent: { time: 60 }, peak: { time: 60 } }).map((r) => r.time).every((t, i, a) => i === 0 || t < a[i - 1]));
const rk = list[0];
rc.beginRun({ modeId: rk.modeId });
rc.run.rivalId = rk.id;
let rs = rc.finishRun(result(rk.modeId, { time: rk.time + 2 }));
check('losing a duel pays no bounty and keeps the rival open', rs.rival && !rs.rival.won && rs.rival.gap > 1.9 && rc.rivals()[0].state === 'open');
rc.beginRun({ modeId: rk.modeId });
rc.run.rivalId = rk.id;
const xpDuel = rc.profile.xp;
rs = rc.finishRun(result(rk.modeId, { time: rk.time - 1 }));
check('winning pays the bounty and opens the next rival', rs.rival.won && rs.rival.first && rc.profile.xp - xpDuel >= rk.xp && rc.rivals()[1].state === 'open' && rs.rival.next?.id === list[1].id);
check('first rival win awards Called Out', Boolean(rc.profile.achievements['first-rival']));
rc.beginRun({ modeId: rk.modeId });
rc.run.rivalId = rk.id;
rs = rc.finishRun(result(rk.modeId, { time: rk.time - 2 }));
check('a rematch win pays nothing new', rs.rival.won && !rs.rival.first && !rs.creditLines.some((l) => l.label === 'Rival bounty'));
rc.beginRun({ modeId: list[1].modeId });
rc.run.rivalId = list[1].id;
rc.run.rivalFinish = list[1].time - 5; // rubber-banded rival came home early
rs = rc.finishRun(result(list[1].modeId, { time: list[1].time - 3 }));
check('the duel is judged against when the rival actually finished', rs.rival && !rs.rival.won && Math.abs(rs.rival.gap - 2) < 1e-6);
rc.save();
check('beaten rivals survive a reload', new Career({ storage: rc.storage, now, mapId: 'mussoorie' }).rivals()[0].state === 'beaten');

// --- pace ghost: a 600 m loop (two straights joined by tight turns) driven in exactly the target time
const pts = [];
for (let i = 0; i < 600; i += 1) {
  const a = (i / 600) * Math.PI * 2;
  pts.push([Math.cos(a) * 160, Math.sin(a) * 40]);
}
const ring = new Road({ id: 0, name: 'loop', closed: true, points: pts, heights: pts.map(() => 0), config: WORLD.road });
const ringRoute = { roadId: 0, closed: true, direction: 1, startS: 10, finishS: 10, length: ring.length };
const pace = buildPaceGhost({ roads: [ring] }, ringRoute, 2, 70, { name: 'Test', paint: 'ember' });
check('pace ghost lasts exactly the target time', pace && Math.abs((pace.count - 1) / pace.rate - 70) < 0.11 && pace.time === 70);
const player = new GhostPlayer(pace);
const pos = new THREE.Vector3();
const q = new THREE.Quaternion();
const speeds = [];
let prev = null;
for (let t = 0; t <= 70; t += 0.5) {
  player.poseAt(t, pos, q);
  if (prev) speeds.push(pos.distanceTo(prev) / 0.5);
  prev = pos.clone();
}
const startPos = new THREE.Vector3();
player.poseAt(0, startPos, q);
const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
const tangent = {}; ring.frameAt(10, tangent);
check('it starts slow and is faster on the straights than in the turns', speeds[0] < speeds[10] && Math.max(...speeds) > Math.min(...speeds.slice(5)) * 1.3);
check('it faces along the road', fwd.x * tangent.tx + fwd.z * tangent.tz > 0.95);
check('two laps end back at the start line', pos.distanceTo(startPos) < 6, pos.distanceTo(startPos).toFixed(1));

// --- tougher economy: maps open by level, a race does not skip levels, old saves keep their unlocks
const eco = new Career({ storage: memoryStorage(), now, mapId: 'mussoorie' });
eco.beginRun({ modeId: 'sprint' });
for (let i = 0; i < 60 * 110; i += 1) eco.trackFrame(1 / 60, state(27), noDrift); // a ~2 min, 3 km race
const ecoSummary = eco.finishRun(result('sprint', { time: 110, isRecord: true }));
check('one race earns well under two levels', ecoSummary.xpGained < xpForLevel(3), `${ecoSummary.xpGained} XP`);
check('maps open in level order', Object.entries(MAP_UNLOCKS).sort((a, b) => a[1].level - b[1].level).map(([id]) => id)[0] === 'mussoorie'
  && new Set(Object.values(MAP_UNLOCKS).map((g) => g.level)).size === Object.keys(MAP_UNLOCKS).length);
check('Alpine opens at level 3, not before', !eco.isMapUnlocked('alpine') && (() => { eco.addXp(xpForLevel(3) - eco.profile.xp); return eco.isMapUnlocked('alpine'); })());
const v1 = memoryStorage();
v1.setItem('slop-drift-profile-v1', JSON.stringify({ version: 1, xp: 900, credits: 500, medals: {} }));
const v1c = new Career({ storage: v1, now });
check('a v1 save keeps maps and cars its old level had opened', v1c.level < 5 && v1c.isMapUnlocked('fujimi') && v1c.isCarUnlocked('tokyo'));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
