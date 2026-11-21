// What there is to play for: medals, driver levels, unlockable cosmetics, achievements and the
// daily challenge rules. Pure data; the logic that awards them lives in src/meta/Career.js.

import { trackKey } from './trackKey.js';

/** Medal tiers, worst to best. */
export const MEDAL_TIERS = Object.freeze(['bronze', 'silver', 'gold', 'author']);
export const MEDAL_LABELS = Object.freeze({ bronze: 'Bronze', silver: 'Silver', gold: 'Gold', author: 'Author' });

/**
 * Per-event medal targets on the Alpine map (keyed by mode id; see TRACK_MEDAL_TARGETS for every map). Timed events: seconds, lower is better. Drift: points, higher is better.
 * Calibrated against a scripted centreline driver (which cannot use racing lines): its fast clean run
 * sets roughly Gold, its at-the-limit run roughly sits between Gold and Author.
 *   loop 168 / 165 s, circuit 333 s, climb 110 / 107 s, descent 101 / 96 s.
 * Drift targets come from the scoring formula: a strong 120 s session is about 5-6k.
 */
export const MEDAL_TARGETS = Object.freeze({
  sprint: Object.freeze({ kind: 'time', bronze: 215, silver: 188, gold: 168, author: 157 }),
  circuit: Object.freeze({ kind: 'time', bronze: 430, silver: 375, gold: 336, author: 316 }),
  climb: Object.freeze({ kind: 'time', bronze: 140, silver: 122, gold: 110, author: 103 }),
  descent: Object.freeze({ kind: 'time', bronze: 128, silver: 112, gold: 101, author: 93 }),
  drift: Object.freeze({ kind: 'score', bronze: 1500, silver: 4000, gold: 8000, author: 14000 }),
});

/**
 * Mussoorie medal targets. PROVISIONAL: derived from the Alpine targets above by track length, not
 * driven yet. Calibrate them with the scripted driver (tests/autopilot.js) before treating them as final.
 *   loop:  2.93 km vs 5.7 km Alpine, x1.08 for the tighter town corners  -> factor 0.555
 *   spur:  1.75 km (~112 m of climb) vs ~3 km Alpine, x1.10 for the tighter hairpins -> factor 0.642
 * Drift scoring does not depend on the track, so the drift targets are Alpine's.
 */
export const MUSSOORIE_MEDAL_TARGETS = Object.freeze({
  sprint: Object.freeze({ kind: 'time', bronze: 119, silver: 104, gold: 93, author: 87 }),
  circuit: Object.freeze({ kind: 'time', bronze: 239, silver: 208, gold: 187, author: 175 }),
  climb: Object.freeze({ kind: 'time', bronze: 90, silver: 78, gold: 71, author: 66 }),
  descent: Object.freeze({ kind: 'time', bronze: 82, silver: 72, gold: 65, author: 60 }),
  drift: MEDAL_TARGETS.drift,
  // PROVISIONAL, and not driven at all yet: the Nag Tibba road (~2.86 km, stacked 14 m hairpins)
  // did not exist when these were set. Scaled from the Lal Tibba spur above by length
  // (2.86 / 1.75 = x1.63) and x1.05 for the longer run of tight switchbacks -> factor ~1.72.
  peak: Object.freeze({ kind: 'time', bronze: 154, silver: 134, gold: 122, author: 113 }),
  peakdown: Object.freeze({ kind: 'time', bronze: 141, silver: 124, gold: 112, author: 103 }),
});

function keyedByTrack(mapId, targets) {
  return Object.fromEntries(Object.entries(targets).map(([modeId, value]) => [trackKey(mapId, modeId), value]));
}

/**
 * Medal targets for every ranked track, by track key (src/meta/trackKey.js). Alpine keys are the
 * bare mode ids of MEDAL_TARGETS. Its keys are exactly the tracks with medals and leaderboards.
 */
export const TRACK_MEDAL_TARGETS = Object.freeze({
  ...keyedByTrack('alpine', MEDAL_TARGETS),
  ...keyedByTrack('mussoorie', MUSSOORIE_MEDAL_TARGETS),
});

/** Medal targets for a track key, or null for unranked tracks (free roam, maps without targets). */
export function medalTargets(key) {
  return Object.prototype.hasOwnProperty.call(TRACK_MEDAL_TARGETS, key) ? TRACK_MEDAL_TARGETS[key] : null;
}

/** XP awarded for things that happen while driving. */
export const XP = Object.freeze({
  perKm: 12,
  perCheckpoint: 4,
  perDriftPoints: 1 / 40, // banked drift points -> XP
  finish: 40,
  personalBest: 60,
  medal: Object.freeze({ bronze: 60, silver: 120, gold: 240, author: 480 }), // first time each tier per event
  dailyChallenge: 300,
});

/**
 * Total XP needed to reach `level` (level 1 needs 0). A gentle power curve: early levels come in
 * the first session, later ones take a few evenings each.
 *   L2 150, L3 ~390, L5 ~1,100, L10 ~3,900, L20 ~12,600
 */
export function xpForLevel(level) {
  if (level <= 1) return 0;
  return Math.round(150 * Math.pow(level - 1, 1.5));
}

export function levelForXp(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp && level < 99) level += 1;
  return level;
}

/**
 * Cosmetics. `paint` entries extend PAINT_OPTIONS in src/config.js by id, `neon` ones NEON_OPTIONS;
 * `rim` and `number` are new slots. `requires` is one of: { level }, { medalCount: { tier, count } }, { achievement }.
 */
export const UNLOCKS = Object.freeze([
  { id: 'paint:pearl', slot: 'paint', value: 'pearl', label: 'Pearl', requires: { level: 1 } },
  { id: 'paint:ember', slot: 'paint', value: 'ember', label: 'Ember', requires: { level: 1 } },
  { id: 'paint:glacier', slot: 'paint', value: 'glacier', label: 'Glacier', requires: { level: 2 } },
  { id: 'rim:graphite', slot: 'rim', value: 'graphite', label: 'Graphite rims', requires: { level: 3 } },
  { id: 'paint:acid', slot: 'paint', value: 'acid', label: 'Acid', requires: { level: 4 } },
  { id: 'number:custom', slot: 'number', value: 'custom', label: 'Custom door number', requires: { level: 5 } },
  { id: 'paint:violet', slot: 'paint', value: 'violet', label: 'Violet', requires: { level: 6 } },
  { id: 'rim:bronze', slot: 'rim', value: 'bronze', label: 'Bronze rims', requires: { level: 7 } },
  { id: 'paint:midnight', slot: 'paint', value: 'midnight', label: 'Midnight', requires: { level: 8 } },
  { id: 'paint:racing-green', slot: 'paint', value: 'racing-green', label: 'Racing Green', requires: { level: 10 } },
  { id: 'paint:sunburst', slot: 'paint', value: 'sunburst', label: 'Sunburst', requires: { medalCount: { tier: 'gold', count: 3 } } },
  { id: 'rim:gold', slot: 'rim', value: 'gold', label: 'Gold rims', requires: { medalCount: { tier: 'gold', count: 5 } } },
  { id: 'paint:summit', slot: 'paint', value: 'summit', label: 'Summit Chrome', requires: { medalCount: { tier: 'author', count: 1 } } },
  { id: 'neon:cyan', slot: 'neon', value: 'cyan', label: 'Cyan neon', requires: { level: 1 } },
  { id: 'neon:magenta', slot: 'neon', value: 'magenta', label: 'Magenta neon', requires: { level: 2 } },
  { id: 'neon:lime', slot: 'neon', value: 'lime', label: 'Lime neon', requires: { level: 3 } },
  { id: 'neon:red', slot: 'neon', value: 'red', label: 'Red neon', requires: { level: 5 } },
  { id: 'neon:amber', slot: 'neon', value: 'amber', label: 'Amber neon', requires: { level: 6 } },
  { id: 'neon:violet', slot: 'neon', value: 'violet', label: 'Violet neon', requires: { level: 9 } },
  { id: 'neon:ice', slot: 'neon', value: 'ice', label: 'Ice White neon', requires: { level: 12 } },
  { id: 'neon:rainbow', slot: 'neon', value: 'rainbow', label: 'Rainbow neon', requires: { achievement: 'night-run' } },
  { id: 'paint:obsidian', slot: 'paint', value: 'obsidian', label: 'Obsidian', requires: { achievement: 'all-gold' } },
]);

/** Rim colours by unlock value. */
export const RIM_OPTIONS = Object.freeze([
  { id: 'silver', label: 'Silver', color: 0xbfc4ca },
  { id: 'graphite', label: 'Graphite', color: 0x3a3f45 },
  { id: 'bronze', label: 'Bronze', color: 0xa77a3c },
  { id: 'gold', label: 'Gold', color: 0xe0b23a },
]);

/**
 * Achievements. `stat` achievements unlock when profile.stats[stat] >= value; `event` ones are
 * awarded by Career when the named moment happens. `xp` is granted once on unlock.
 */
export const ACHIEVEMENTS = Object.freeze([
  { id: 'first-finish', title: 'Off the Line', description: 'Finish any timed event.', event: 'finish', xp: 50 },
  { id: 'first-drift', title: 'Sideways', description: 'Bank your first drift.', event: 'drift', xp: 30 },
  { id: 'summit', title: 'Top of the World', description: 'Finish the Summit Climb.', event: 'finish:climb', xp: 100 },
  { id: 'descent', title: 'Gravity Assisted', description: 'Finish the Touge Descent.', event: 'finish:descent', xp: 100 },
  { id: 'nag-tibba', title: 'Nag Tibba Summit', description: 'Finish the Nag Tibba Hill Climb.', event: 'finish:peak', xp: 150 },
  { id: 'clean-lap', title: 'Clean Sheet', description: 'Finish the Mountain Loop without a reset.', event: 'clean:sprint', xp: 120 },
  { id: 'combo-1k', title: 'Linked Up', description: 'Bank a single drift combo worth 1,000 points.', event: 'combo:1000', xp: 100 },
  { id: 'combo-5k', title: 'Tandem Dreams', description: 'Bank a single drift combo worth 5,000 points.', event: 'combo:5000', xp: 300 },
  { id: 'multiplier-5', title: 'Maxed Out', description: 'Reach a x5 drift multiplier.', event: 'multiplier:5', xp: 150 },
  { id: 'speed-200', title: 'Two Hundred', description: 'Reach 200 km/h.', stat: 'topSpeedKmh', value: 200, xp: 150 },
  { id: 'distance-25', title: 'Mountain Regular', description: 'Drive 25 km in total.', stat: 'distanceKm', value: 25, xp: 150 },
  { id: 'distance-100', title: 'High Mileage', description: 'Drive 100 km in total.', stat: 'distanceKm', value: 100, xp: 400 },
  { id: 'air', title: 'Airtime', description: 'Get all four wheels off the ground for a full second.', event: 'air:1', xp: 120 },
  { id: 'night-run', title: 'Night Shift', description: 'Finish an event at night.', event: 'finish:night', xp: 80 },
  { id: 'first-gold', title: 'Gold Standard', description: 'Earn a gold medal.', event: 'medal:gold', xp: 150 },
  { id: 'first-author', title: 'Beat the Author', description: 'Earn an author medal.', event: 'medal:author', xp: 500 },
  { id: 'all-gold', title: 'Mountain Master', description: 'Earn gold or better in every event.', event: 'all-gold', xp: 1000 },
  { id: 'daily-1', title: 'Daily Driver', description: 'Complete a daily challenge.', event: 'daily', xp: 50 },
  { id: 'streak-7', title: 'Week Streak', description: 'Complete the daily challenge 7 days in a row.', stat: 'dailyStreakBest', value: 7, xp: 500 },
  { id: 'ghostbuster', title: 'Ghostbuster', description: 'Beat a leaderboard ghost.', event: 'beat-ghost', xp: 200 },
  { id: 'multiplayer', title: 'Company on the Mountain', description: 'Drive with another player online.', event: 'multiplayer', xp: 80 },
]);

/**
 * Daily challenge templates. One is picked per UTC day from a seeded random, together with an event.
 * `target` is relative to that event's medal targets so every day is achievable but not trivial.
 * Only events the current map ranks are drawn (Career.daily), so 'peak' never comes up on Alpine.
 */
export const DAILY_TEMPLATES = Object.freeze([
  { id: 'beat-silver', modes: ['sprint', 'climb', 'descent', 'peak', 'peakdown'], text: (t) => `Finish under ${t}`, target: (m) => m.silver * 0.99, kind: 'time' },
  { id: 'clean-gold', modes: ['climb', 'descent', 'peak', 'peakdown'], text: (t) => `Finish under ${t} with no resets`, target: (m) => m.gold * 1.04, kind: 'time', clean: true },
  { id: 'drift-score', modes: ['drift'], text: (t) => `Score ${t} drift points`, target: (m) => m.silver * 1.1, kind: 'score' },
  { id: 'drift-night', modes: ['drift'], text: (t) => `Score ${t} drift points at night`, target: (m) => m.bronze * 1.6, kind: 'score', timeOfDay: 'night' },
  { id: 'circuit', modes: ['circuit'], text: (t) => `Finish both laps under ${t}`, target: (m) => m.silver, kind: 'time' },
]);
