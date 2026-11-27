// What there is to play for: medals, driver levels, credits, locked cars/maps/features,
// unlockable cosmetics, achievements and the daily challenge rules. Pure data; the logic lives in Career.js.

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
 */
export const MUSSOORIE_MEDAL_TARGETS = Object.freeze({
  sprint: Object.freeze({ kind: 'time', bronze: 119, silver: 104, gold: 93, author: 87 }),
  circuit: Object.freeze({ kind: 'time', bronze: 239, silver: 208, gold: 187, author: 175 }),
  climb: Object.freeze({ kind: 'time', bronze: 90, silver: 78, gold: 71, author: 66 }),
  descent: Object.freeze({ kind: 'time', bronze: 82, silver: 72, gold: 65, author: 60 }),
  drift: MEDAL_TARGETS.drift,
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
  ...keyedByTrack('apex', {
    ...Object.fromEntries(Object.entries({sprint:340,gp:235,bowl:102})
      .map(([id,gold])=>[id,{kind:'time',bronze:Math.round(gold*1.4),silver:Math.round(gold*1.17),gold,author:Math.round(gold*.87)}])),
  }),
  ...keyedByTrack('tokyo', {
    ...Object.fromEntries(Object.entries({ sprint: 245, circuit: 490, shibuya: 152, express: 347, bay: 196, parkade: 179, parkdown: 165, tour: 635, underground: 85 })
      .map(([id, gold]) => [id, { kind: 'time', bronze: Math.round(gold * 1.5), silver: Math.round(gold * 1.23), gold, author: Math.round(gold * 0.85) }])),
    drift: MEDAL_TARGETS.drift,
  }),
  ...keyedByTrack('fujimi', {
    sprint: { kind: 'time', bronze: 190, silver: 156, gold: 128, author: 112 },
    circuit: { kind: 'time', bronze: 380, silver: 312, gold: 256, author: 224 },
    drift: MEDAL_TARGETS.drift,
  }),
  ...keyedByTrack('hollow', {
    sprint: { kind: 'time', bronze: 276, silver: 235, gold: 205, author: 186 },
    circuit: { kind: 'time', bronze: 552, silver: 470, gold: 410, author: 372 },
    drift: MEDAL_TARGETS.drift,
    quarter: { kind: 'time', bronze: 176, silver: 151, gold: 133, author: 120 },
    vanishing: { kind: 'time', bronze: 385, silver: 337, gold: 292, author: 264 },
  }),
  ...keyedByTrack('jungle', {
    sprint: { kind: 'time', bronze: 310, silver: 270, gold: 235, author: 210 },
    circuit: { kind: 'time', bronze: 620, silver: 540, gold: 470, author: 420 },
    drift: MEDAL_TARGETS.drift,
  }),
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

/** Chai Credits (CR) awarded alongside XP to buy car upgrades and early car unlocks. */
export const CREDITS = Object.freeze({
  starter: 150,
  perKm: 8,
  perDriftPoints: 1 / 20,
  finish: 60,
  personalBest: 80,
  medal: Object.freeze({ bronze: 100, silver: 200, gold: 350, author: 650 }),
  dailyChallenge: 400,
  achievementFactor: 1.2,
});

/** Difficulty bonus multipliers for Sim handling and Manual transmission (+15% each). */
export const PRO_BONUS = Object.freeze({
  simHandling: 0.15,
  manualGears: 0.15,
});

/**
 * Total XP needed to reach `level` (level 1 needs 0). Fast early levels so players unlock Stage 1
 * tuning, a second car, and ghosts inside their first 10 minutes, scaling smoothly afterward.
 *   L2 100, L3 293, L4 549, L5 857, L10 3,013, L20 9,601
 */
export function xpForLevel(level) {
  if (level <= 1) return 0;
  return Math.round(100 * Math.pow(level - 1, 1.55));
}

export function levelForXp(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp && level < 99) level += 1;
  return level;
}

/** Progression gates for cars. Players unlock free on reaching `level`, or buy early with `earlyCost` CR. */
export const CAR_UNLOCKS = Object.freeze({
  hatch: Object.freeze({ level: 1, earlyCost: 0 }),
  thar: Object.freeze({ level: 2, earlyCost: 250 }),
  tokyo: Object.freeze({ level: 5, earlyCost: 850 }),
  raijin: Object.freeze({ level: 9, earlyCost: 1650 }),
  gt: Object.freeze({ level: 12, earlyCost: 2400 }),
});

/** Progression gates for world maps (joining a friend's Party on any map always bypasses solo lock). */
export const MAP_UNLOCKS = Object.freeze({
  mussoorie: Object.freeze({ level: 1 }),
  alpine: Object.freeze({ level: 2 }),
  fujimi: Object.freeze({ level: 3 }),
  tokyo: Object.freeze({ level: 5 }),
  jungle: Object.freeze({ level: 7 }),
  hollow: Object.freeze({ level: 9 }),
  apex: Object.freeze({ level: 11 }),
});

/** Gameplay features unlocked while leveling up. */
export const FEATURE_UNLOCKS = Object.freeze([
  Object.freeze({ id: 'ghosts', label: 'Ghost Rivals & Live Split Delta', level: 2, summary: 'Race your Personal Best and global leaderboard ghosts.' }),
  Object.freeze({ id: 'tuning-1', label: 'Garage Upgrades Stage 1', level: 2, summary: 'Unlock Stage 1 engine, tires, nitrous & brake kits.' }),
  Object.freeze({ id: 'smoke', label: 'Custom Tire Smoke Colors', level: 3, summary: 'Unlock colored drift smoke trails in the Garage.' }),
  Object.freeze({ id: 'tuning-2', label: 'Garage Upgrades Stage 2', level: 4, summary: 'Unlock twin-scroll turbos, angle kits & dual N2O.' }),
  Object.freeze({ id: 'pro-bonus', label: 'Pro Difficulty Bonus (+30%)', level: 6, summary: 'Earn +15% XP & CR each for Sim handling and Manual gears.' }),
  Object.freeze({ id: 'tuning-3', label: 'Pro Race Spec Stage 3', level: 7, summary: 'Unlock top-tier forged internals, compounds & cryo N2O.' }),
  Object.freeze({ id: 'author-hunt', label: 'Author Medal Challenges', level: 10, summary: 'Unlock prestigious Author targets & gold smoke finishes.' }),
]);

/**
 * Cosmetics. `paint` entries extend PAINT_OPTIONS in src/config.js by id, `neon` ones NEON_OPTIONS,
 * `smoke` ones SMOKE_OPTIONS; `rim` and `number` are extra slots.
 */
export const UNLOCKS = Object.freeze([
  { id: 'paint:pearl', slot: 'paint', value: 'pearl', label: 'Himalayan Topo', requires: { level: 1 } },
  { id: 'paint:chameleon', slot: 'paint', value: 'chameleon', label: 'Oil-Slick Chameleon', requires: { level: 1 } },
  { id: 'paint:violet', slot: 'paint', value: 'violet', label: 'Midnight Sakura', requires: { level: 1 } },
  { id: 'paint:bayside', slot: 'paint', value: 'bayside', label: 'Bayside Flip Pearl', requires: { level: 1 } },
  { id: 'paint:ruby-carbon', slot: 'paint', value: 'ruby-carbon', label: 'Ruby Exposed Carbon', requires: { level: 1 } },
  { id: 'paint:stealth-gunmetal', slot: 'paint', value: 'stealth-gunmetal', label: 'Stealth Gunmetal Hex', requires: { level: 1 } },
  { id: 'paint:tiffany-ice', slot: 'paint', value: 'tiffany-ice', label: 'Tiffany Liquid Pearl', requires: { level: 1 } },
  { id: 'paint:ember', slot: 'paint', value: 'ember', label: 'Tokyo Touge', requires: { level: 1 } },
  { id: 'paint:glacier', slot: 'paint', value: 'glacier', label: 'Alpine Glacier', requires: { level: 1 } },
  { id: 'paint:acid', slot: 'paint', value: 'acid', label: 'Acid Splinter', requires: { level: 1 } },
  { id: 'paint:racing-green', slot: 'paint', value: 'racing-green', label: 'Monsoon Emerald', requires: { level: 1 } },
  { id: 'paint:kitsune', slot: 'paint', value: 'kitsune', label: 'Neon Cyber Kitsune', requires: { level: 2 } },
  { id: 'rim:graphite', slot: 'rim', value: 'graphite', label: 'Graphite rims', requires: { level: 3 } },
  { id: 'paint:gold-rush', slot: 'paint', value: 'gold-rush', label: '24K Brushed Gold', requires: { level: 4 } },
  { id: 'number:custom', slot: 'number', value: 'custom', label: 'Custom door number', requires: { level: 5 } },
  { id: 'paint:damascus', slot: 'paint', value: 'damascus', label: 'Damascus Titanium', requires: { level: 6 } },
  { id: 'rim:bronze', slot: 'rim', value: 'bronze', label: 'Bronze rims', requires: { level: 7 } },
  { id: 'paint:midnight', slot: 'paint', value: 'midnight', label: 'Forged Carbon', requires: { level: 8 } },
  { id: 'paint:arctic-splinter', slot: 'paint', value: 'arctic-splinter', label: 'Arctic Stealth Camo', requires: { medalCount: { tier: 'silver', count: 1 } } },
  { id: 'paint:sunset-fade', slot: 'paint', value: 'sunset-fade', label: 'Supernova Fade', requires: { medalCount: { tier: 'gold', count: 1 } } },
  { id: 'paint:sunburst', slot: 'paint', value: 'sunburst', label: 'Sunburst Drift', requires: { medalCount: { tier: 'gold', count: 3 } } },
  { id: 'rim:gold', slot: 'rim', value: 'gold', label: 'Gold rims', requires: { medalCount: { tier: 'gold', count: 5 } } },
  { id: 'paint:summit', slot: 'paint', value: 'summit', label: 'Liquid Chrome', requires: { medalCount: { tier: 'author', count: 1 } } },
  { id: 'neon:cyan', slot: 'neon', value: 'cyan', label: 'Cyan neon', requires: { level: 1 } },
  { id: 'neon:magenta', slot: 'neon', value: 'magenta', label: 'Magenta neon', requires: { level: 2 } },
  { id: 'neon:lime', slot: 'neon', value: 'lime', label: 'Lime neon', requires: { level: 3 } },
  { id: 'neon:red', slot: 'neon', value: 'red', label: 'Red neon', requires: { level: 5 } },
  { id: 'neon:amber', slot: 'neon', value: 'amber', label: 'Amber neon', requires: { level: 6 } },
  { id: 'neon:violet', slot: 'neon', value: 'violet', label: 'Violet neon', requires: { level: 9 } },
  { id: 'neon:ice', slot: 'neon', value: 'ice', label: 'Ice White neon', requires: { level: 12 } },
  { id: 'neon:rainbow', slot: 'neon', value: 'rainbow', label: 'Rainbow neon', requires: { achievement: 'night-run' } },
  { id: 'smoke:amber', slot: 'smoke', value: 'amber', label: 'Marigold Haze smoke', requires: { level: 3 } },
  { id: 'smoke:cyan', slot: 'smoke', value: 'cyan', label: 'Electric Cyan smoke', requires: { level: 5 } },
  { id: 'smoke:pink', slot: 'smoke', value: 'pink', label: 'Sakura Pink smoke', requires: { level: 7 } },
  { id: 'smoke:crimson', slot: 'smoke', value: 'crimson', label: 'Crimson Torch smoke', requires: { medalCount: { tier: 'gold', count: 3 } } },
  { id: 'smoke:lime', slot: 'smoke', value: 'lime', label: 'Acid Lime smoke', requires: { achievement: 'combo-5k' } },
  { id: 'smoke:gold', slot: 'smoke', value: 'gold', label: '24K Gold Dust smoke', requires: { achievement: 'first-author' } },
  { id: 'paint:minato-gold', slot: 'paint', value: 'minato-gold', label: 'Minato Gold', requires: { achievement: 'tokyo-tower' } },
  { id: 'paint:saltline', slot: 'paint', value: 'saltline', label: 'Saltline Service', requires: { achievement: 'hollow-pumps' } },
  { id: 'paint:obsidian', slot: 'paint', value: 'obsidian', label: 'Obsidian Oni', requires: { achievement: 'all-gold' } },
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
 * awarded by Career when the named moment happens. `xp` (and proportional CR) is granted once on unlock.
 */
export const ACHIEVEMENTS = Object.freeze([
  { id: 'tokyo-tower', title: 'Tower Photographer', description: 'Photograph Minato, the rooftop and the expressway.', xp: 85 },
  { id: 'tokyo-explorer', title: 'Night Passport', description: 'Discover every Tokyo district.', xp: 120 },
  { id: 'tokyo-parkade', title: 'Deck Champion', description: 'Master all eight lower decks in Midnight Parkade.', xp: 180 },
  { id: 'hollow-pumps', title: 'Saltline Service', description: 'Find the abandoned fuel station in Hollow Creek.', xp: 55 },
  { id: 'hollow-cartographer', title: 'Town Archivist', description: 'Discover every Hollow Creek landmark.', xp: 150 },
  { id: 'fujimi-clips', title: 'Apex Clipper', description: 'Clip all 8 glowing drift zones in a single Fujimi Rally run.', event: 'fujimi:all-clips', xp: 180 },
  { id: 'jungle-finish', title: 'Monsoon Survivor', description: 'Finish a Monsoon Run stage.', event: 'map:jungle:finish', xp: 150 },
  { id: 'alpine-silver', title: 'Alpine Specialist', description: 'Earn Silver or better in every Alpine Peak event.', event: 'alpine:all-silver', xp: 220 },
  { id: 'first-finish', title: 'Off the Line', description: 'Finish any timed event.', event: 'finish', xp: 50 },
  { id: 'first-drift', title: 'Sideways', description: 'Bank your first drift.', event: 'drift', xp: 30 },
  { id: 'summit', title: 'Top of the World', description: 'Finish the Summit Climb.', event: 'finish:climb', xp: 100 },
  { id: 'descent', title: 'Gravity Assisted', description: 'Finish the Touge Descent.', event: 'finish:descent', xp: 100 },
  { id: 'nag-tibba', title: 'Nag Tibba Summit', description: 'Finish the Nag Tibba Hill Climb.', event: 'finish:peak', xp: 150 },
  { id: 'clean-lap', title: 'Clean Sheet', description: 'Finish the Mountain Loop without a reset.', event: 'clean:sprint', xp: 120 },
  { id: 'wall-tap', title: 'Paint Swapper', description: 'Score a drift Wall Tap near a guardrail without crashing.', event: 'style:wallTap', xp: 120 },
  { id: 'backward-entry', title: 'Reverse Entry', description: 'Hold a 52°+ drift angle above 80 km/h.', event: 'style:backward', xp: 140 },
  { id: 'combo-1k', title: 'Linked Up', description: 'Bank a single drift combo worth 1,000 points.', event: 'combo:1000', xp: 100 },
  { id: 'combo-5k', title: 'Tandem Dreams', description: 'Bank a single drift combo worth 5,000 points.', event: 'combo:5000', xp: 300 },
  { id: 'multiplier-5', title: 'Maxed Out', description: 'Reach a x5 drift multiplier.', event: 'multiplier:5', xp: 150 },
  { id: 'drift-total-50k', title: 'Tire Shredder', description: 'Bank 50,000 lifetime drift points.', stat: 'totalDriftPoints', value: 50000, xp: 250 },
  { id: 'drift-total-250k', title: 'Smoke Legend', description: 'Bank 250,000 lifetime drift points.', stat: 'totalDriftPoints', value: 250000, xp: 600 },
  { id: 'speed-200', title: 'Two Hundred', description: 'Reach 200 km/h.', stat: 'topSpeedKmh', value: 200, xp: 150 },
  { id: 'distance-25', title: 'Mountain Regular', description: 'Drive 25 km in total.', stat: 'distanceKm', value: 25, xp: 150 },
  { id: 'distance-100', title: 'High Mileage', description: 'Drive 100 km in total.', stat: 'distanceKm', value: 100, xp: 400 },
  { id: 'distance-500', title: 'Highway Nomad', description: 'Drive 500 km in total.', stat: 'distanceKm', value: 500, xp: 750 },
  { id: 'air', title: 'Airtime', description: 'Get all four wheels off the ground for a full second.', event: 'air:1', xp: 120 },
  { id: 'night-run', title: 'Night Shift', description: 'Finish an event at night.', event: 'finish:night', xp: 80 },
  { id: 'first-upgrade', title: 'First Wrench', description: 'Install your first performance upgrade in the Garage.', stat: 'upgradesBought', value: 1, xp: 80 },
  { id: 'max-tune', title: 'Full Build', description: 'Max out all four upgrade slots on any single car.', event: 'max-tune', xp: 400 },
  { id: 'first-gold', title: 'Gold Standard', description: 'Earn a gold medal.', event: 'medal:gold', xp: 150 },
  { id: 'first-author', title: 'Beat the Author', description: 'Earn an author medal.', event: 'medal:author', xp: 500 },
  { id: 'medals-10', title: 'Trophy Shelf', description: 'Earn 10 medals across any events.', event: 'medals:10', xp: 250 },
  { id: 'medals-25', title: 'Podium Collector', description: 'Earn 25 medals across any events.', event: 'medals:25', xp: 600 },
  { id: 'all-gold', title: 'Mountain Master', description: 'Earn gold or better in every event on a map.', event: 'all-gold', xp: 1000 },
  { id: 'purist-gold', title: 'Zero-Assist Purist', description: 'Earn Gold with Sim handling, Manual gears, ABS off, and 0% Drift Assist.', event: 'purist-gold', xp: 500 },
  { id: 'underdog', title: 'Underdog Run', description: 'Earn Gold in the Hill 4x4 or an un-upgraded Rally Hatch.', event: 'underdog', xp: 250 },
  { id: 'daily-1', title: 'Daily Driver', description: 'Complete a daily challenge.', event: 'daily', xp: 50 },
  { id: 'streak-7', title: 'Week Streak', description: 'Complete the daily challenge 7 days in a row.', stat: 'dailyStreakBest', value: 7, xp: 500 },
  { id: 'ghostbuster', title: 'Ghostbuster', description: 'Beat a leaderboard ghost.', event: 'beat-ghost', xp: 200 },
  { id: 'multiplayer', title: 'Company on the Mountain', description: 'Drive with another player online.', event: 'multiplayer', xp: 80 },
]);

/**
 * Daily challenge templates. One is picked per UTC day from a seeded random, together with an event.
 */
export const DAILY_TEMPLATES = Object.freeze([
  { id: 'beat-silver', modes: ['sprint', 'climb', 'descent', 'peak', 'peakdown'], text: (t) => `Finish under ${t}`, target: (m) => m.silver * 0.99, kind: 'time' },
  { id: 'clean-gold', modes: ['climb', 'descent', 'peak', 'peakdown'], text: (t) => `Finish under ${t} with no resets`, target: (m) => m.gold * 1.04, kind: 'time', clean: true },
  { id: 'drift-score', modes: ['drift'], text: (t) => `Score ${t} drift points`, target: (m) => m.silver * 1.1, kind: 'score' },
  { id: 'drift-night', modes: ['drift'], text: (t) => `Score ${t} drift points at night`, target: (m) => m.bronze * 1.6, kind: 'score', timeOfDay: 'night' },
  { id: 'circuit', modes: ['circuit'], text: (t) => `Finish both laps under ${t}`, target: (m) => m.silver, kind: 'time' },
]);
