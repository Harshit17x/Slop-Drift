import { MODES, PAINT_OPTIONS, getMode, getNeon } from '../config.js';
import { createRandom } from '../world/noise.js';
import {
  ACHIEVEMENTS, DAILY_TEMPLATES, MEDAL_LABELS, MEDAL_TARGETS, MEDAL_TIERS, RIM_OPTIONS, UNLOCKS, XP,
  levelForXp, medalTargets, xpForLevel,
} from './catalog.js';
import { LEGACY_MAP, trackKey } from './trackKey.js';

const STORAGE_KEY = 'slop-drift-profile-v1';
const PROFILE_VERSION = 1;
const AUTOSAVE_SECONDS = 15;
const NAME_PATTERN = /^[\p{L}\p{N} _-]{2,16}$/u;

/** @typedef {import('../core/contracts.js').Profile} Profile */
/** @typedef {import('../core/contracts.js').RewardSummary} RewardSummary */

function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function utcDate(date) {
  return date.toISOString().slice(0, 10);
}

function previousUtcDate(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return utcDate(date);
}

export function formatTarget(kind, value) {
  if (kind === 'score') return Math.round(value).toLocaleString('en-US');
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

/** Clean a requested display name; returns null when nothing usable is left. */
export function sanitizeName(name) {
  const trimmed = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return NAME_PATTERN.test(trimmed) ? trimmed : null;
}

/** Every mode id, in menu order. A map ranks those it has medal targets for (Career.rankedModes). */
const MODE_IDS = Object.freeze(MODES.map((mode) => mode.id));

function tierIndex(tier) {
  return tier ? MEDAL_TIERS.indexOf(tier) : -1;
}

function newProfile(now) {
  return {
    version: PROFILE_VERSION,
    id: randomId(),
    name: `Driver ${Math.floor(1000 + Math.random() * 9000)}`,
    named: false,
    createdAt: now,
    xp: 0,
    stats: {
      distanceKm: 0, driveSeconds: 0, runs: 0, finishes: 0, driftsBanked: 0, bestCombo: 0,
      topSpeedKmh: 0, respawns: 0, dailyStreak: 0, dailyStreakBest: 0, dailyCompleted: 0,
    },
    medals: {},
    achievements: {},
    cosmetics: { paint: 'pearl', rim: 'silver', number: '27', neon: 'off' },
    daily: { date: '', done: false, lastDoneDate: null, streak: 0 },
  };
}

/** Fill in anything an older or damaged save is missing, so the rest of the code can trust the shape. */
function normalizeProfile(raw, now) {
  const base = newProfile(now);
  if (!raw || typeof raw !== 'object') return base;
  const profile = { ...base, ...raw };
  profile.stats = { ...base.stats, ...(raw.stats || {}) };
  profile.cosmetics = { ...base.cosmetics, ...(raw.cosmetics || {}) };
  profile.daily = { ...base.daily, ...(raw.daily || {}) };
  profile.medals = raw.medals && typeof raw.medals === 'object' ? { ...raw.medals } : {};
  profile.achievements = raw.achievements && typeof raw.achievements === 'object' ? { ...raw.achievements } : {};
  profile.xp = Number.isFinite(raw.xp) && raw.xp >= 0 ? raw.xp : 0;
  profile.name = sanitizeName(raw.name) || base.name;
  if (typeof profile.id !== 'string' || profile.id.length < 8) profile.id = base.id;
  for (const key of Object.keys(profile.medals)) if (!MEDAL_TIERS.includes(profile.medals[key])) delete profile.medals[key];
  profile.version = PROFILE_VERSION;
  return profile;
}

/**
 * The meta game: everything the player earns across runs. It watches runs (trackFrame, session
 * events, finishRun), awards XP, medals, achievements, unlocks and the daily challenge, persists
 * the profile, and queues CareerEvents for the HUD. No rendering, no DOM; runs in Node.
 *
 * Medals and the daily challenge are per map: profile.medals is keyed by track key
 * (src/meta/trackKey.js) of the current map. Achievements use plain mode ids, so they count anywhere.
 */
export class Career {
  /**
   * @param {object} [options]
   * @param {Storage|null} [options.storage]
   * @param {() => Date} [options.now]
   * @param {string} [options.mapId]  Map being driven (src/world/maps.js); see setMap().
   */
  constructor({ storage = defaultStorage(), now = () => new Date(), mapId = LEGACY_MAP } = {}) {
    this.storage = storage;
    this.now = now;
    this.mapId = mapId;
    this.events = [];
    this.run = null;
    this.saveClock = 0;
    this.profile = this.load();
    // Unlocks already announced, so a level-up and a medal in the same moment do not both report one.
    this.knownUnlocks = this.unlockedIds();
  }

  // ------------------------------------------------------------------ map

  /** Select the map whose medals and daily challenge apply (the map is fixed per page load). */
  setMap(mapId) {
    this.mapId = mapId || LEGACY_MAP;
  }

  /** Track key of a mode on the current map. */
  trackKey(modeId) {
    return trackKey(this.mapId, modeId);
  }

  /** Medal targets of a mode on the current map, or null. */
  targetsFor(modeId) {
    return medalTargets(this.trackKey(modeId));
  }

  /**
   * Mode ids with medals on the current map, in menu order. A map ranks exactly the events it has
   * roads for (no Nag Tibba events on Alpine), so this is also what the daily challenge draws from.
   */
  rankedModes() {
    return MODE_IDS.filter((modeId) => this.targetsFor(modeId) !== null);
  }

  // ------------------------------------------------------------------ persistence

  load() {
    let raw = null;
    try {
      const text = this.storage?.getItem(STORAGE_KEY);
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = null;
    }
    const profile = normalizeProfile(raw, this.now().getTime());
    this.profile = profile;
    if (!raw) this.save();
    return profile;
  }

  save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.profile));
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ identity and level

  /** True until the player has chosen a name (the first-run prompt uses this). */
  get needsName() {
    return !this.profile.named;
  }

  setName(name) {
    const clean = sanitizeName(name);
    if (!clean) return null;
    this.profile.name = clean;
    this.profile.named = true;
    this.save();
    return clean;
  }

  /** Mark the suggested name as accepted without changing it. */
  keepName() {
    this.profile.named = true;
    this.save();
  }

  /** @returns {import('../core/contracts.js').LevelInfo} */
  levelInfo(xp = this.profile.xp) {
    const level = levelForXp(xp);
    const start = xpForLevel(level);
    const span = xpForLevel(level + 1) - start;
    const into = xp - start;
    return { level, xp, into, span, fraction: span > 0 ? Math.min(1, into / span) : 1 };
  }

  get level() {
    return levelForXp(this.profile.xp);
  }

  addXp(amount, line = null) {
    const gained = Math.max(0, Math.round(amount));
    if (!gained) return 0;
    const before = this.level;
    this.profile.xp += gained;
    if (line && this.run) this.run.lines.set(line, (this.run.lines.get(line) || 0) + gained);
    const after = this.level;
    if (after > before) {
      this.events.push({ type: 'levelUp', title: `Level ${after}`, detail: 'Driver level up' });
      this.announceUnlocks();
    }
    return gained;
  }

  // ------------------------------------------------------------------ medals

  /** Best medal a result on the current map earns on its own, or null. */
  medalFor(modeId, result) {
    const targets = this.targetsFor(modeId);
    if (!targets || !result) return null;
    const value = targets.kind === 'score' ? result.score : result.time;
    if (!Number.isFinite(value)) return null;
    for (let i = MEDAL_TIERS.length - 1; i >= 0; i -= 1) {
      const tier = MEDAL_TIERS[i];
      const met = targets.kind === 'score' ? value >= targets[tier] : value <= targets[tier];
      if (met) return tier;
    }
    return null;
  }

  /** The next medal to chase on an event, or null when the author medal is already won. */
  nextMedal(modeId) {
    const targets = this.targetsFor(modeId);
    if (!targets) return null;
    const index = tierIndex(this.profile.medals[this.trackKey(modeId)]) + 1;
    if (index >= MEDAL_TIERS.length) return null;
    const tier = MEDAL_TIERS[index];
    return { tier, target: targets[tier], kind: targets.kind, text: `${MEDAL_LABELS[tier]} ${formatTarget(targets.kind, targets[tier])}` };
  }

  /** { [modeId]: { medal, next } } for the event cards, on the current map. */
  medalBoard() {
    const board = {};
    for (const modeId of this.rankedModes()) board[modeId] = { medal: this.profile.medals[this.trackKey(modeId)] || null, next: this.nextMedal(modeId) };
    return board;
  }

  countMedals(minTier) {
    const floor = tierIndex(minTier);
    return Object.values(this.profile.medals).filter((tier) => tierIndex(tier) >= floor).length;
  }

  // ------------------------------------------------------------------ unlocks and cosmetics

  isUnlocked(def) {
    const requires = def.requires || {};
    if (requires.level && this.level < requires.level) return false;
    if (requires.medalCount && this.countMedals(requires.medalCount.tier) < requires.medalCount.count) return false;
    if (requires.achievement && !this.profile.achievements[requires.achievement]) return false;
    return true;
  }

  unlockedIds() {
    return new Set(UNLOCKS.filter((def) => this.isUnlocked(def)).map((def) => def.id));
  }

  /** Report every unlock that became available since the last call. */
  announceUnlocks() {
    const fresh = [];
    for (const def of UNLOCKS) {
      if (this.knownUnlocks.has(def.id) || !this.isUnlocked(def)) continue;
      this.knownUnlocks.add(def.id);
      fresh.push(def);
      this.events.push({ type: 'unlock', title: def.label, detail: 'Unlocked in the garage' });
      if (this.run) this.run.unlocks.push({ id: def.id, label: def.label, slot: def.slot });
    }
    return fresh;
  }

  requirementText(def) {
    const requires = def.requires || {};
    if (requires.level) return `Level ${requires.level}`;
    if (requires.medalCount) {
      const { tier, count } = requires.medalCount;
      return `Earn ${count} ${MEDAL_LABELS[tier].toLowerCase()} medal${count > 1 ? 's' : ''}`;
    }
    if (requires.achievement) {
      const achievement = ACHIEVEMENTS.find((entry) => entry.id === requires.achievement);
      return achievement ? `Achievement: ${achievement.title}` : 'Achievement';
    }
    return '';
  }

  /** Items for the garage panel. */
  garage() {
    const items = UNLOCKS.map((def) => {
      let color = null;
      if (def.slot === 'paint') color = PAINT_OPTIONS.find((paint) => paint.id === def.value)?.color ?? null;
      if (def.slot === 'rim') color = RIM_OPTIONS.find((rim) => rim.id === def.value)?.color ?? null;
      if (def.slot === 'neon') color = getNeon(def.value).color;
      return { id: def.id, slot: def.slot, value: def.value, label: def.label, color, unlocked: this.isUnlocked(def), requirement: this.requirementText(def) };
    });
    // Silver rims are the default, not an unlock.
    items.splice(items.findIndex((item) => item.slot === 'rim'), 0, { id: 'rim:silver', slot: 'rim', value: 'silver', label: 'Silver rims', color: RIM_OPTIONS[0].color, unlocked: true, requirement: '' });
    // No underglow is the default too.
    items.splice(items.findIndex((item) => item.slot === 'neon'), 0, { id: 'neon:off', slot: 'neon', value: 'off', label: 'No neon', color: null, unlocked: true, requirement: '' });
    return { items, selected: { ...this.profile.cosmetics } };
  }

  /** Select a cosmetic if it is unlocked. Returns true when applied. */
  setCosmetic(slot, value) {
    if (slot === 'number') {
      const custom = UNLOCKS.find((def) => def.id === 'number:custom');
      const digits = String(value ?? '').replace(/\D/g, '').slice(0, 2);
      if (!digits || !this.isUnlocked(custom)) return false;
      this.profile.cosmetics.number = digits;
    } else if (slot === 'rim' && value === 'silver') {
      this.profile.cosmetics.rim = 'silver';
    } else if (slot === 'neon' && value === 'off') {
      this.profile.cosmetics.neon = 'off';
    } else {
      const def = UNLOCKS.find((entry) => entry.slot === slot && entry.value === value);
      if (!def || !this.isUnlocked(def)) return false;
      this.profile.cosmetics[slot] = value;
    }
    this.save();
    return true;
  }

  // ------------------------------------------------------------------ achievements

  unlockAchievement(id) {
    if (this.profile.achievements[id]) return false;
    const def = ACHIEVEMENTS.find((entry) => entry.id === id);
    if (!def) return false;
    this.profile.achievements[id] = this.now().getTime();
    this.events.push({ type: 'achievement', title: def.title, detail: def.description, xp: def.xp });
    if (this.run) this.run.achievements.push({ id: def.id, title: def.title, description: def.description, xp: def.xp });
    this.addXp(def.xp, 'Achievements');
    this.announceUnlocks();
    return true;
  }

  /** Fire every achievement keyed to a named moment, e.g. 'finish:climb'. */
  trigger(eventName) {
    for (const def of ACHIEVEMENTS) if (def.event === eventName) this.unlockAchievement(def.id);
  }

  checkStatAchievements() {
    for (const def of ACHIEVEMENTS) {
      if (def.stat && (this.profile.stats[def.stat] || 0) >= def.value) this.unlockAchievement(def.id);
    }
  }

  achievements() {
    return ACHIEVEMENTS.map((def) => ({
      id: def.id, title: def.title, description: def.description, xp: def.xp,
      unlocked: Boolean(this.profile.achievements[def.id]), at: this.profile.achievements[def.id] || null,
    }));
  }

  // ------------------------------------------------------------------ daily challenge

  /**
   * Today's challenge on the current map. The template and event are the same on every map that
   * has that event; a map without it (Nag Tibba on Alpine) draws another of the template's events
   * from the same seeded sequence. The target comes from that map's medal targets, and only a run on
   * this map's track can complete it. One challenge (and one streak) per day, whichever map it is
   * completed on.
   * @returns {import('../core/contracts.js').DailyChallenge}
   */
  daily() {
    const date = utcDate(this.now());
    const random = createRandom(`daily:${date}`);
    const ranked = this.rankedModes();
    let template = DAILY_TEMPLATES[0];
    let modeId = null;
    for (let attempt = 0; attempt < 8 && !modeId; attempt += 1) {
      template = DAILY_TEMPLATES[Math.floor(random() * DAILY_TEMPLATES.length)];
      const pick = template.modes[Math.floor(random() * template.modes.length)];
      if (ranked.includes(pick)) modeId = pick;
      else {
        const available = template.modes.filter((id) => ranked.includes(id));
        if (available.length) modeId = available[Math.floor(random() * available.length)];
      }
    }
    if (!modeId) {
      template = DAILY_TEMPLATES[0];
      modeId = template.modes.find((id) => ranked.includes(id)) || template.modes[0];
    }
    const targets = this.targetsFor(modeId) || MEDAL_TARGETS[modeId];
    let target = template.target(targets);
    target = template.kind === 'score' ? Math.round(target / 50) * 50 : Math.round(target * 10) / 10;
    const state = this.profile.daily;
    const done = state.lastDoneDate === date;
    // A streak survives until a full day is missed.
    const alive = state.lastDoneDate === date || state.lastDoneDate === previousUtcDate(date);
    return {
      date,
      modeId,
      trackKey: this.trackKey(modeId),
      modeLabel: getMode(modeId).label,
      text: `${getMode(modeId).label}: ${template.text(formatTarget(template.kind, target))}`,
      kind: template.kind,
      target,
      timeOfDay: template.timeOfDay || null,
      clean: Boolean(template.clean),
      done,
      streak: alive ? state.streak : 0,
      xp: XP.dailyChallenge,
    };
  }

  dailyMet(challenge, result, run) {
    if (!result || this.trackKey(result.modeId) !== (challenge.trackKey ?? challenge.modeId)) return false;
    if (challenge.clean && (result.respawns || 0) > 0) return false;
    if (challenge.timeOfDay && run?.timeOfDay !== challenge.timeOfDay) return false;
    return challenge.kind === 'score' ? result.score >= challenge.target : result.time <= challenge.target;
  }

  completeDaily(challenge) {
    const state = this.profile.daily;
    const continued = state.lastDoneDate === previousUtcDate(challenge.date);
    state.streak = continued ? state.streak + 1 : 1;
    state.lastDoneDate = challenge.date;
    state.date = challenge.date;
    state.done = true;
    const stats = this.profile.stats;
    stats.dailyCompleted += 1;
    stats.dailyStreak = state.streak;
    stats.dailyStreakBest = Math.max(stats.dailyStreakBest, state.streak);
    this.events.push({ type: 'daily', title: 'Daily challenge complete', detail: `${state.streak}-day streak`, xp: XP.dailyChallenge });
    this.addXp(XP.dailyChallenge, 'Daily challenge');
    this.trigger('daily');
    this.checkStatAchievements();
    return { completed: true, streak: state.streak };
  }

  // ------------------------------------------------------------------ runs

  beginRun({ modeId, timeOfDay = 'day' }) {
    this.run = {
      modeId,
      timeOfDay,
      startXp: this.profile.xp,
      lines: new Map(),
      distance: 0,
      pendingDistanceXp: 0,
      pendingDriftXp: 0,
      airTime: 0,
      statClock: 0,
      respawns: 0,
      achievements: [],
      unlocks: [],
    };
    this.profile.stats.runs += 1;
    return this.run;
  }

  /**
   * Call every frame while a run is active.
   * @param {number} dt
   * @param {import('../core/contracts.js').VehicleState} state
   * @param {{active:boolean, event:(string|null), lastDriftScore:number, multiplier:number}} drift
   */
  trackFrame(dt, state, drift) {
    const run = this.run;
    if (!run || !(dt > 0)) return;
    const stats = this.profile.stats;
    const metres = state.speed * dt;
    run.distance += metres;
    stats.distanceKm += metres / 1000;
    stats.driveSeconds += dt;
    if (state.speedKmh > stats.topSpeedKmh) stats.topSpeedKmh = state.speedKmh;

    // XP is paid out as it is earned, so levels can come up mid-run (and in free roam).
    run.pendingDistanceXp += (metres / 1000) * XP.perKm;
    if (run.pendingDistanceXp >= 1) {
      const whole = Math.floor(run.pendingDistanceXp);
      run.pendingDistanceXp -= whole;
      this.addXp(whole, 'Distance');
    }

    if (state.wheelsOnGround === 0) {
      run.airTime += dt;
      if (run.airTime >= 1) this.trigger('air:1');
    } else {
      run.airTime = 0;
    }

    if (drift) {
      if (drift.event === 'drift_end' && drift.lastDriftScore > 0) {
        stats.driftsBanked += 1;
        stats.bestCombo = Math.max(stats.bestCombo, drift.lastDriftScore);
        this.trigger('drift');
        if (drift.lastDriftScore >= 1000) this.trigger('combo:1000');
        if (drift.lastDriftScore >= 5000) this.trigger('combo:5000');
        run.pendingDriftXp += drift.lastDriftScore * XP.perDriftPoints;
        const whole = Math.floor(run.pendingDriftXp);
        if (whole > 0) {
          run.pendingDriftXp -= whole;
          this.addXp(whole, 'Drifting');
        }
      }
      if (drift.multiplier >= 5) this.trigger('multiplier:5');
    }

    run.statClock += dt;
    if (run.statClock >= 1) {
      run.statClock = 0;
      this.checkStatAchievements();
    }
    this.saveClock += dt;
    if (this.saveClock >= AUTOSAVE_SECONDS) {
      this.saveClock = 0;
      this.save();
    }
  }

  /** Session events (checkpoint, lap, finish) from RaceSession.update(). */
  onSessionEvent(event) {
    if (event.type === 'checkpoint' || event.type === 'lap') this.addXp(XP.perCheckpoint, 'Checkpoints');
  }

  onRespawn() {
    if (this.run) this.run.respawns += 1;
    this.profile.stats.respawns += 1;
  }

  /** Another player was seen online during a run. */
  onMultiplayer() {
    this.trigger('multiplayer');
  }

  /** The player finished ahead of a leaderboard ghost they chose to race. */
  onBeatGhost() {
    this.trigger('beat-ghost');
  }

  /**
   * Close a finished run and award everything it earned.
   * @param {import('../core/contracts.js').RunResult} result
   * @returns {RewardSummary}
   */
  finishRun(result) {
    const run = this.run || this.beginRun({ modeId: result.modeId });
    const before = this.levelInfo(run.startXp);
    const stats = this.profile.stats;
    stats.finishes += 1;

    this.addXp(XP.finish, 'Finish');
    if (result.isRecord) this.addXp(XP.personalBest, 'Personal best');

    // Medals: every tier newly passed pays out once.
    let medal = null;
    const earned = this.medalFor(result.modeId, result);
    const medalKey = this.trackKey(result.modeId);
    if (earned) {
      const prior = this.profile.medals[medalKey] || null;
      const isNew = tierIndex(earned) > tierIndex(prior);
      if (isNew) {
        let medalXp = 0;
        for (let i = tierIndex(prior) + 1; i <= tierIndex(earned); i += 1) medalXp += XP.medal[MEDAL_TIERS[i]];
        this.profile.medals[medalKey] = earned;
        this.events.push({ type: 'medal', title: `${MEDAL_LABELS[earned]} medal`, detail: getMode(result.modeId).label, xp: medalXp });
        this.addXp(medalXp, `${MEDAL_LABELS[earned]} medal`);
        this.announceUnlocks();
      }
      medal = { tier: earned, isNew, next: this.nextMedal(result.modeId) };
      if (tierIndex(earned) >= tierIndex('gold')) this.trigger('medal:gold');
      if (earned === 'author') this.trigger('medal:author');
      // Every event on the map being driven.
      if (this.rankedModes().every((modeId) => tierIndex(this.profile.medals[this.trackKey(modeId)]) >= tierIndex('gold'))) this.trigger('all-gold');
    }

    const modeId = result.modeId;
    if (modeId !== 'drift') this.trigger('finish');
    this.trigger(`finish:${modeId}`);
    if ((result.respawns || 0) === 0) this.trigger(`clean:${modeId}`);
    if (run.timeOfDay === 'night') this.trigger('finish:night');

    let daily = null;
    const challenge = this.daily();
    if (!challenge.done && this.dailyMet(challenge, result, run)) daily = this.completeDaily(challenge);

    this.checkStatAchievements();
    const summary = this.summarize(run, before, medal, daily);
    this.run = null;
    this.save();
    return summary;
  }

  /** Leave a run without finishing (menu, restart, free roam): distance and drift XP are kept. */
  abandonRun() {
    if (!this.run) return null;
    const run = this.run;
    const summary = this.summarize(run, this.levelInfo(run.startXp), null, null);
    this.run = null;
    this.save();
    return summary;
  }

  summarize(run, before, medal, daily) {
    const lines = [...run.lines.entries()].filter(([, xp]) => xp > 0).map(([label, xp]) => ({ label, xp }));
    return {
      lines,
      xpGained: lines.reduce((sum, line) => sum + line.xp, 0),
      before,
      after: this.levelInfo(),
      medal,
      achievements: run.achievements.slice(),
      unlocks: run.unlocks.slice(),
      daily,
    };
  }

  /** Notifications queued since the last call. */
  drainEvents() {
    if (!this.events.length) return EMPTY;
    const events = this.events;
    this.events = [];
    return events;
  }
}

const EMPTY = Object.freeze([]);
