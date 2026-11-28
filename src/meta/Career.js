import { MODES, PAINT_OPTIONS, SMOKE_OPTIONS, getMode, getNeon, getSmoke } from '../config.js';
import { createRandom } from '../world/noise.js';
import { CARS, getCar } from '../vehicle/cars.js';
import {
  UPGRADE_SLOTS, MAX_UPGRADE_STAGE, effectiveCarRatings, effectiveClassInfo,
  getUpgradeSlot, hasCarNitro, normalizeCarUpgrades,
} from '../vehicle/upgradeTuning.js';
import {
  ACHIEVEMENTS, CAR_UNLOCKS, CONTRACT_REWARD, CONTRACT_TEMPLATES, CREDITS, MASTERY_STARS, MASTERY_STAR_CREDITS, masteryStars, LEGACY_GATES, legacyLevelForXp, RIVALS, RIVAL_TIERS, DAILY_TEMPLATES, streakBoost, FEATURE_UNLOCKS, MAP_UNLOCKS,
  MEDAL_LABELS, MEDAL_TARGETS, MEDAL_TIERS, PRO_BONUS, RIM_OPTIONS, UNLOCKS, XP,
  levelForXp, medalTargets, xpForLevel,
} from './catalog.js';
import { LEGACY_MAP, parseTrackKey, trackKey } from './trackKey.js';
import { MAPS } from '../world/maps.js';

const STORAGE_KEY = 'slop-drift-profile-v1';
const PROFILE_VERSION = 2; // 2: tougher level curve; v1 saves keep the cars and maps they had opened
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

const MODE_IDS = Object.freeze(MODES.map((mode) => mode.id));
// Maps whose roads carry clipping zones (Scenery/ClipZones and Fujimi's authored ones).
const CLIP_MAPS = new Set(['mussoorie', 'alpine', 'fujimi', 'tokyo', 'hollow', 'jungle', 'apex']);

/** Awards screen groups, from what the achievement is about. */
export function achievementGroup(def) {
  const id = def.id;
  if (/rival|royalty|ghost|multiplayer|daily|streak|needle/.test(id)) return 'rivals';
  if (/drift|combo|multiplier|wall|backward|clips/.test(id)) return 'drifting';
  if (/upgrade|tune|mastery/.test(id)) return 'garage';
  if (/distance|speed|trap|air|tokyo-(tower|explorer)|hollow/.test(id)) return 'explorer';
  return 'racing';
}

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
    credits: CREDITS.starter,
    unlockedCars: [],
    unlockedMaps: [],
    upgrades: {},
    stats: {
      distanceKm: 0, driveSeconds: 0, runs: 0, finishes: 0, driftsBanked: 0, bestCombo: 0,
      totalDriftPoints: 0, wallTaps: 0, cleanRuns: 0, upgradesBought: 0,
      topSpeedKmh: 0, bestTrapKmh: 0, speedTrapsCleared: 0,
      respawns: 0, dailyStreak: 0, dailyStreakBest: 0, dailyCompleted: 0,
    },
    medals: {},
    achievements: {},
    cosmetics: { paint: 'pearl', rim: 'silver', number: '27', neon: 'off', smoke: 'white', car: 'hatch' },
    favorites: [],
    daily: { date: '', done: false, lastDoneDate: null, streak: 0 },
    contracts: { date: '', progress: {}, done: {} },
    mastery: {},
    rivals: {},
    speedTraps: {},
  };
}

/** Fill in anything an older or damaged save is missing, so the rest of the code can trust the shape. */
function normalizeProfile(raw, now) {
  const base = newProfile(now);
  if (!raw || typeof raw !== 'object') return base;
  const profile = { ...base, ...raw };
  profile.stats = { ...base.stats, ...(raw.stats || {}) };
  profile.cosmetics = { ...base.cosmetics, ...(raw.cosmetics || {}) };
  if (!CARS.some((car) => car.id === profile.cosmetics.car)) profile.cosmetics.car = base.cosmetics.car;
  if (!SMOKE_OPTIONS.some((s) => s.id === profile.cosmetics.smoke)) profile.cosmetics.smoke = base.cosmetics.smoke;
  profile.favorites = Array.isArray(raw.favorites)
    ? [...new Set(raw.favorites.filter((id) => CARS.some((car) => car.id === id)))]
    : [];
  profile.unlockedCars = Array.isArray(raw.unlockedCars)
    ? [...new Set(raw.unlockedCars.filter((id) => CARS.some((car) => car.id === id)))]
    : [];
  profile.unlockedMaps = Array.isArray(raw.unlockedMaps)
    ? [...new Set(raw.unlockedMaps.filter((id) => Boolean(MAPS[id])))]
    : [];
  profile.upgrades = {};
  if (raw.upgrades && typeof raw.upgrades === 'object') {
    for (const car of CARS) {
      if (raw.upgrades[car.id]) profile.upgrades[car.id] = normalizeCarUpgrades(raw.upgrades[car.id]);
    }
  }
  profile.daily = { ...base.daily, ...(raw.daily || {}) };
  profile.mastery = {};
  for (const car of CARS) {
    const xp = Number(raw.mastery?.[car.id]);
    if (Number.isFinite(xp) && xp > 0) profile.mastery[car.id] = Math.floor(xp);
  }
  profile.rivals = {};
  for (const rival of RIVALS) {
    const best = Number(raw.rivals?.[rival.id]);
    if (Number.isFinite(best) && best > 0) profile.rivals[rival.id] = best;
  }
  profile.speedTraps = {};
  if (raw.speedTraps && typeof raw.speedTraps === 'object') {
    for (const [k, v] of Object.entries(raw.speedTraps)) {
      const kmh = Number(v);
      if (typeof k === 'string' && Number.isFinite(kmh) && kmh > 0) profile.speedTraps[k] = Math.round(kmh);
    }
  }
  const rc = raw.contracts;
  profile.contracts = rc && typeof rc === 'object' && typeof rc.date === 'string'
    ? { date: rc.date, progress: { ...(rc.progress || {}) }, done: { ...(rc.done || {}) } }
    : base.contracts;
  profile.medals = raw.medals && typeof raw.medals === 'object' ? { ...raw.medals } : {};
  profile.achievements = raw.achievements && typeof raw.achievements === 'object' ? { ...raw.achievements } : {};
  profile.xp = Number.isFinite(raw.xp) && raw.xp >= 0 ? raw.xp : 0;
  for (const key of Object.keys(profile.medals)) if (!MEDAL_TIERS.includes(profile.medals[key])) delete profile.medals[key];

  // Legacy migration: saves created before Credits/Locks keep earned access & get fair starter CR.
  const isLegacySave = raw.credits === undefined && (profile.xp > 0 || Object.keys(profile.medals).length > 0);
  if (Number.isFinite(raw.credits) && raw.credits >= 0) {
    profile.credits = Math.floor(raw.credits);
  } else if (isLegacySave) {
    const medalBonus = Object.keys(profile.medals).length * 100;
    profile.credits = CREDITS.starter + Math.floor(profile.xp * 0.4) + medalBonus;
    if (profile.cosmetics.car && profile.cosmetics.car !== 'hatch' && !profile.unlockedCars.includes(profile.cosmetics.car)) {
      profile.unlockedCars.push(profile.cosmetics.car);
    }
    for (const track of Object.keys(profile.medals)) {
      const { mapId } = parseTrackKey(track);
      if (MAPS[mapId] && !profile.unlockedMaps.includes(mapId)) profile.unlockedMaps.push(mapId);
    }
  } else {
    profile.credits = CREDITS.starter;
  }

  // v1 saves: the steeper curve lowers their level, so keep every car and map the old curve had opened.
  if ((raw.version || 1) < 2 && profile.xp > 0) {
    const oldLevel = legacyLevelForXp(profile.xp);
    for (const [carId, level] of Object.entries(LEGACY_GATES.cars)) {
      if (oldLevel >= level && !profile.unlockedCars.includes(carId)) profile.unlockedCars.push(carId);
    }
    for (const [mapId, level] of Object.entries(LEGACY_GATES.maps)) {
      if (oldLevel >= level && MAPS[mapId] && !profile.unlockedMaps.includes(mapId)) profile.unlockedMaps.push(mapId);
    }
  }

  profile.name = sanitizeName(raw.name) || base.name;
  if (typeof profile.id !== 'string' || profile.id.length < 8) profile.id = base.id;
  profile.version = PROFILE_VERSION;
  return profile;
}

/**
 * The meta game: everything the player earns across runs. It watches runs (trackFrame, session
 * events, finishRun), awards XP, Chai Credits, upgrades, medals, achievements, unlocks and the
 * daily challenge, persists the profile, and queues CareerEvents for the HUD.
 */
export class Career {
  constructor({ storage = defaultStorage(), now = () => new Date(), mapId = LEGACY_MAP } = {}) {
    this.storage = storage;
    this.now = now;
    this.mapId = mapId;
    this.events = [];
    this.run = null;
    this.trialCar = null;
    this.lastReward = null;
    this.saveClock = 0;
    this.profile = this.load();
    this.knownUnlocks = this.progressionUnlockedIds();
  }

  // ------------------------------------------------------------------ map

  setMap(mapId) {
    this.mapId = mapId || LEGACY_MAP;
  }

  trackKey(modeId) {
    return trackKey(this.mapId, modeId);
  }

  targetsFor(modeId) {
    return medalTargets(this.trackKey(modeId));
  }

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

  keepName() {
    this.profile.named = true;
    this.save();
  }

  rollPlayerId() {
    this.profile.id = randomId();
    this.save();
    return this.profile.id;
  }

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

  get credits() {
    return this.profile.credits || 0;
  }

  addXp(amount, line = null) {
    const gained = Math.max(0, Math.round(amount));
    if (!gained) return 0;
    const before = this.level;
    this.profile.xp += gained;
    if (line && this.run) this.run.lines.set(line, (this.run.lines.get(line) || 0) + gained);
    if (this.run) this.run.carXp = (this.run.carXp || 0) + gained;
    const after = this.level;
    if (after > before) {
      this.events.push({ type: 'levelUp', title: `Level ${after}`, detail: 'Driver level up' });
      this.announceUnlocks();
    }
    return gained;
  }

  addCredits(amount, line = null) {
    const gained = Math.max(0, Math.round(amount));
    if (!gained) return 0;
    this.profile.credits = (this.profile.credits || 0) + gained;
    if (line && this.run) this.run.creditLines.set(line, (this.run.creditLines.get(line) || 0) + gained);
    return gained;
  }

  // ------------------------------------------------------------------ car, map & feature locks

  isCarUnlocked(carId) {
    const gate = CAR_UNLOCKS[carId];
    if (!gate) return CARS.some((c) => c.id === carId);
    if (this.level >= gate.level) return true;
    return this.profile.unlockedCars.includes(carId);
  }

  carRequirementText(carId) {
    if (this.isCarUnlocked(carId)) return '';
    const gate = CAR_UNLOCKS[carId];
    if (!gate) return '';
    return gate.earlyCost ? `Level ${gate.level} or ${gate.earlyCost.toLocaleString('en-US')} CR` : `Level ${gate.level}`;
  }

  buyCarEarly(carId) {
    const car = CARS.find((c) => c.id === carId);
    const gate = CAR_UNLOCKS[carId];
    if (!car || !gate) return { ok: false, reason: 'unknown-car' };
    if (this.isCarUnlocked(carId)) return { ok: false, reason: 'already-unlocked' };
    if (!gate.earlyCost || this.credits < gate.earlyCost) return { ok: false, reason: 'insufficient-credits' };
    this.profile.credits -= gate.earlyCost;
    this.profile.unlockedCars.push(carId);
    this.profile.cosmetics.car = carId;
    this.trialCar = null;
    this.announceUnlocks();
    this.save();
    return { ok: true, credits: this.profile.credits };
  }

  /** Temporarily unlocks one locked car for the next run (Test Drive / Rewarded Ad). */
  startTrialCar(carId) {
    if (!CARS.some((c) => c.id === carId)) return false;
    this.trialCar = carId;
    return true;
  }

  clearTrialCar() {
    const had = Boolean(this.trialCar);
    this.trialCar = null;
    return had;
  }

  activeCarId() {
    if (this.trialCar && CARS.some((c) => c.id === this.trialCar)) return this.trialCar;
    const picked = this.profile.cosmetics.car;
    if (this.isCarUnlocked(picked)) return picked;
    return 'hatch';
  }

  isMapUnlocked(mapId) {
    const gate = MAP_UNLOCKS[mapId];
    if (!gate) return Boolean(MAPS[mapId]);
    if (this.level >= gate.level) return true;
    return this.profile.unlockedMaps.includes(mapId);
  }

  mapRequirementText(mapId) {
    if (this.isMapUnlocked(mapId)) return '';
    const gate = MAP_UNLOCKS[mapId];
    return gate ? `Level ${gate.level}` : '';
  }

  /** Unlock a map on career when joining via a friend's party link or legacy record. */
  grantMapAccess(mapId) {
    if (!MAPS[mapId] || this.isMapUnlocked(mapId)) return false;
    this.profile.unlockedMaps.push(mapId);
    this.knownUnlocks.add(`map:${mapId}`);
    this.save();
    return true;
  }

  isFeatureUnlocked(featureId) {
    const def = FEATURE_UNLOCKS.find((f) => f.id === featureId);
    if (!def) return true;
    return this.level >= def.level;
  }

  featureRequirementText(featureId) {
    const def = FEATURE_UNLOCKS.find((f) => f.id === featureId);
    if (!def || this.level >= def.level) return '';
    return `Level ${def.level}`;
  }

  // ------------------------------------------------------------------ rivals

  /** The current map's rivals in order, each with its time, bounty and state (locked / open / beaten). */
  rivals(mapId = this.mapId, bests = {}) {
    let open = true;
    return RIVALS.filter((r) => r.mapId === mapId).map((r) => {
      const targets = medalTargets(trackKey(mapId, r.modeId));
      const tier = RIVAL_TIERS[r.tier];
      const beatenTime = this.profile.rivals[r.id] || null;
      const state = beatenTime ? 'beaten' : open ? 'open' : 'locked';
      if (!beatenTime) open = false;
      return {
        ...r, tierLabel: tier.label, modeLabel: getMode(r.modeId).label,
        time: targets ? Math.round(Math.min(targets.gold * tier.pace, (bests[r.modeId]?.time || Infinity) * tier.vsBest) * 10) / 10 : null,
        catchUp: tier.catchUp, easeOff: tier.easeOff,
        xp: tier.xp, credits: tier.credits, state, beatenTime,
      };
    }).filter((r) => r.time);
  }

  /**
   * Settle a duel: pays the bounty the first time the rival is beaten. `rivalFinish` is when the rival
   * actually crossed the line (rubber-banding moves it off their nominal time). Returns the results-screen line.
   */
  resolveRival(rivalId, result, rivalFinish) {
    const rival = this.rivals().find((r) => r.id === rivalId);
    if (!rival || result.modeId !== rival.modeId || !Number.isFinite(result.time)) return null;
    const finish = Number.isFinite(rivalFinish) ? rivalFinish : rival.time;
    const won = result.time < finish;
    const first = won && !rival.beatenTime;
    if (won) this.profile.rivals[rival.id] = Math.min(rival.beatenTime || Infinity, result.time);
    if (first) {
      this.events.push({ type: 'medal', title: `Beat ${rival.name}`, detail: `${rival.tierLabel} rival · ${rival.modeLabel}`, xp: rival.xp, credits: rival.credits });
      this.addXp(rival.xp, 'Rival bounty');
      this.addCredits(rival.credits, 'Rival bounty');
      this.trigger('rival:any');
      if (rival.tier === 'boss') this.trigger('rival:boss');
      if (RIVALS.filter((r) => r.tier === 'boss').every((r) => this.profile.rivals[r.id])) this.trigger('rival:all-bosses');
    }
    const next = this.rivals().find((r) => r.state === 'open') || null;
    return { id: rival.id, name: rival.name, tierLabel: rival.tierLabel, won, first, gap: result.time - finish, xp: rival.xp, credits: rival.credits, next: next && { id: next.id, name: next.name, tierLabel: next.tierLabel } };
  }

  // ------------------------------------------------------------------ car mastery

  masteryInfo(carId) {
    const xp = this.profile.mastery[carId] || 0;
    const stars = masteryStars(xp);
    return { xp, stars, next: MASTERY_STARS[stars] ?? null };
  }

  /** Bank the run's XP into its car's mastery; new stars pay credits. Called before the run summary. */
  applyMastery(run) {
    const carId = run.carId;
    if (!CARS.some((car) => car.id === carId) || !(run.carXp > 0)) return null;
    const before = this.masteryInfo(carId).stars;
    this.profile.mastery[carId] = (this.profile.mastery[carId] || 0) + run.carXp;
    run.carXp = 0;
    const info = this.masteryInfo(carId);
    const label = getCar(carId).label;
    for (let star = before + 1; star <= info.stars; star += 1) {
      this.events.push({ type: 'unlock', title: `${label} mastery ${star}/5`, detail: 'Mastery star earned', credits: star * MASTERY_STAR_CREDITS });
      this.addCredits(star * MASTERY_STAR_CREDITS, 'Mastery star');
    }
    if (info.stars >= 5) this.trigger('mastery:5');
    if (CARS.every((car) => this.masteryInfo(car.id).stars >= 5)) this.trigger('mastery:all');
    return { carId, label, ...info, newStars: info.stars - before };
  }

  // ------------------------------------------------------------------ upgrades

  carUpgrades(carId) {
    return normalizeCarUpgrades(this.profile.upgrades?.[carId]);
  }

  canBuyUpgrade(carId, slotId) {
    if (!CARS.some((c) => c.id === carId)) return { ok: false, reason: 'unknown-car' };
    if (!this.isCarUnlocked(carId)) return { ok: false, reason: 'car-locked' };
    const slot = getUpgradeSlot(slotId);
    if (!slot) return { ok: false, reason: 'unknown-slot' };
    const current = this.carUpgrades(carId)[slotId] || 0;
    if (current >= MAX_UPGRADE_STAGE) return { ok: false, reason: 'maxed' };
    const next = slot.stages[current];
    if (this.level < next.level) return { ok: false, reason: 'level-locked', level: next.level };
    if (this.credits < next.cost) return { ok: false, reason: 'insufficient-credits', cost: next.cost };
    return { ok: true, stage: next };
  }

  buyUpgrade(carId, slotId) {
    const check = this.canBuyUpgrade(carId, slotId);
    if (!check.ok) return check;
    const next = check.stage;
    const current = this.carUpgrades(carId);
    current[slotId] = next.stage;
    this.profile.upgrades[carId] = current;
    this.profile.credits -= next.cost;
    this.profile.stats.upgradesBought = (this.profile.stats.upgradesBought || 0) + 1;
    this.events.push({ type: 'unlock', title: `${getCar(carId).label}: ${next.label}`, detail: next.effect });
    this.checkStatAchievements();
    if (UPGRADE_SLOTS.every((s) => current[s.id] >= MAX_UPGRADE_STAGE)) this.trigger('max-tune');
    this.save();
    return { ok: true, stage: next, upgrades: current, credits: this.profile.credits };
  }

  // ------------------------------------------------------------------ medals

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

  nextMedal(modeId) {
    const targets = this.targetsFor(modeId);
    if (!targets) return null;
    const index = tierIndex(this.profile.medals[this.trackKey(modeId)]) + 1;
    if (index >= MEDAL_TIERS.length) return null;
    const tier = MEDAL_TIERS[index];
    return { tier, target: targets[tier], kind: targets.kind, text: `${MEDAL_LABELS[tier]} ${formatTarget(targets.kind, targets[tier])}` };
  }

  /** Closest locked level milestone across features, cars, maps, and cosmetics. */
  /** The next map to open by level: { id, label, level, xpToGo }, or null when all are open. */
  nextMap() {
    const next = Object.entries(MAP_UNLOCKS)
      .filter(([id]) => MAPS[id] && !this.isMapUnlocked(id))
      .sort((a, b) => a[1].level - b[1].level)[0];
    if (!next) return null;
    const [id, gate] = next;
    return { id, label: MAPS[id].label, level: gate.level, xpToGo: Math.max(0, xpForLevel(gate.level) - this.profile.xp) };
  }

  nextUnlock() {
    const candidates = [];
    for (const f of FEATURE_UNLOCKS) {
      if (this.level < f.level) candidates.push({ label: f.label, slot: 'feature', level: f.level });
    }
    for (const car of CARS) {
      const gate = CAR_UNLOCKS[car.id];
      if (gate && !this.isCarUnlocked(car.id)) candidates.push({ label: car.label, slot: 'car', level: gate.level });
    }
    for (const map of Object.values(MAPS)) {
      const gate = MAP_UNLOCKS[map.id];
      if (gate && !this.isMapUnlocked(map.id)) candidates.push({ label: `${map.label} map`, slot: 'map', level: gate.level });
    }
    for (const def of UNLOCKS) {
      if (def.requires?.level && !this.isUnlocked(def)) candidates.push({ label: def.label, slot: def.slot, level: def.requires.level });
    }
    candidates.sort((a, b) => a.level - b.level);
    const next = candidates[0];
    if (!next) return null;
    return {
      label: next.label,
      slot: next.slot,
      level: next.level,
      xpToGo: Math.max(0, Math.ceil(xpForLevel(next.level) - this.profile.xp)),
    };
  }

  nextEvent(modeId) {
    const ranked = this.rankedModes();
    const fresh = ranked.find((id) => id !== modeId && !this.profile.medals[this.trackKey(id)]);
    if (fresh) return fresh;
    const i = ranked.indexOf(modeId);
    return ranked.length > 1 ? ranked[(i + 1) % ranked.length] : null;
  }

  medalBoard() {
    const board = {};
    for (const modeId of this.rankedModes()) board[modeId] = { medal: this.profile.medals[this.trackKey(modeId)] || null, next: this.nextMedal(modeId) };
    return board;
  }

  countMedals(minTier = 'bronze') {
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

  /** Unlocked cosmetic UNLOCKS ids. */
  unlockedIds() {
    return new Set(UNLOCKS.filter((def) => this.isUnlocked(def)).map((def) => def.id));
  }

  /** All progression unlock ids including cars, maps, and features for notification deduping. */
  progressionUnlockedIds() {
    const set = this.unlockedIds();
    for (const car of CARS) if (this.isCarUnlocked(car.id)) set.add(`car:${car.id}`);
    for (const map of Object.values(MAPS)) if (this.isMapUnlocked(map.id)) set.add(`map:${map.id}`);
    for (const f of FEATURE_UNLOCKS) if (this.isFeatureUnlocked(f.id)) set.add(`feature:${f.id}`);
    return set;
  }

  /** Report every unlock (cosmetic, car, map, feature) that became available since the last call. */
  announceUnlocks() {
    const fresh = [];
    for (const car of CARS) {
      const id = `car:${car.id}`;
      if (this.knownUnlocks.has(id) || !this.isCarUnlocked(car.id)) continue;
      this.knownUnlocks.add(id);
      const entry = { id, label: car.label, slot: 'car' };
      fresh.push(entry);
      this.events.push({ type: 'unlock', title: car.label, detail: 'New car unlocked in Garage' });
      if (this.run) this.run.unlocks.push(entry);
    }
    for (const map of Object.values(MAPS)) {
      const id = `map:${map.id}`;
      if (this.knownUnlocks.has(id) || !this.isMapUnlocked(map.id)) continue;
      this.knownUnlocks.add(id);
      const entry = { id, label: `${map.label} map`, slot: 'map' };
      fresh.push(entry);
      this.events.push({ type: 'unlock', title: map.label, detail: 'New region unlocked on Map' });
      if (this.run) this.run.unlocks.push(entry);
    }
    for (const f of FEATURE_UNLOCKS) {
      const id = `feature:${f.id}`;
      if (this.knownUnlocks.has(id) || !this.isFeatureUnlocked(f.id)) continue;
      this.knownUnlocks.add(id);
      const entry = { id, label: f.label, slot: 'feature' };
      fresh.push(entry);
      this.events.push({ type: 'unlock', title: f.label, detail: f.summary });
      if (this.run) this.run.unlocks.push(entry);
    }
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

  /** Items, upgrades, locks and economy snapshot for the garage panel. */
  garage() {
    const items = UNLOCKS.map((def) => {
      let color = null;
      let skinUrl = null;
      let finishTag = null;
      let flopColor = null;
      let creviceColor = null;
      if (def.slot === 'paint') {
        const entry = PAINT_OPTIONS.find((paint) => paint.id === def.value);
        color = entry?.color ?? null;
        skinUrl = entry?.skinUrl ?? null;
        finishTag = entry?.finishTag ?? null;
        flopColor = entry?.flopColor ?? null;
        creviceColor = entry?.creviceColor ?? null;
      }
      if (def.slot === 'rim') color = RIM_OPTIONS.find((rim) => rim.id === def.value)?.color ?? null;
      if (def.slot === 'neon') color = getNeon(def.value).color;
      if (def.slot === 'smoke') color = getSmoke(def.value).color;
      return {
        id: def.id, slot: def.slot, value: def.value, label: def.label, color, skinUrl,
        finishTag, flopColor, creviceColor, unlocked: this.isUnlocked(def), requirement: this.requirementText(def),
      };
    });
    items.splice(items.findIndex((item) => item.slot === 'rim'), 0, {
      id: 'rim:silver', slot: 'rim', value: 'silver', label: 'Silver rims', color: RIM_OPTIONS[0].color, unlocked: true, requirement: '',
    });
    items.splice(items.findIndex((item) => item.slot === 'neon'), 0, {
      id: 'neon:off', slot: 'neon', value: 'off', label: 'No neon', color: null, unlocked: true, requirement: '',
    });
    items.splice(items.findIndex((item) => item.slot === 'smoke'), 0, {
      id: 'smoke:white', slot: 'smoke', value: 'white', label: 'Pure White smoke', color: SMOKE_OPTIONS[0].color, unlocked: true, requirement: '',
    });
    items.unshift(...CARS.map((car) => {
      const upgrades = this.carUpgrades(car.id);
      const unlocked = this.isCarUnlocked(car.id);
      const gate = CAR_UNLOCKS[car.id] || { level: 1, earlyCost: 0 };
      const cls = effectiveClassInfo(car, upgrades);
      return {
        id: `car:${car.id}`,
        slot: 'car',
        value: car.id,
        label: car.label,
        detail: car.blurb,
        color: null,
        unlocked,
        unlockLevel: gate.level,
        earlyCost: gate.earlyCost || 0,
        requirement: this.carRequirementText(car.id),
        upgrades,
        effectiveRatings: effectiveCarRatings(car, upgrades),
        classCode: cls.code,
        classBand: cls.band,
        nitroAvailable: hasCarNitro(car, upgrades),
        mastery: this.masteryInfo(car.id),
      };
    }));
    const carUpgrades = {};
    for (const car of CARS) carUpgrades[car.id] = this.carUpgrades(car.id);
    const maps = {};
    for (const id of Object.keys(MAPS)) {
      maps[id] = { unlocked: this.isMapUnlocked(id), requirement: this.mapRequirementText(id), level: MAP_UNLOCKS[id]?.level || 1 };
    }
    const features = {};
    for (const f of FEATURE_UNLOCKS) features[f.id] = { unlocked: this.isFeatureUnlocked(f.id), level: f.level, label: f.label, summary: f.summary };
    return {
      items,
      selected: { ...this.profile.cosmetics },
      favorites: [...(this.profile.favorites || [])],
      credits: this.credits,
      level: this.level,
      carUpgrades,
      maps,
      features,
      trialCar: this.trialCar,
    };
  }

  toggleFavoriteCar(carId) {
    if (!CARS.some((car) => car.id === carId)) return false;
    const favs = Array.isArray(this.profile.favorites) ? this.profile.favorites : [];
    const idx = favs.indexOf(carId);
    const next = idx < 0;
    if (next) favs.push(carId);
    else favs.splice(idx, 1);
    this.profile.favorites = favs;
    this.save();
    return next;
  }

  setCosmetic(slot, value) {
    if (slot === 'number') {
      const custom = UNLOCKS.find((def) => def.id === 'number:custom');
      const digits = String(value ?? '').replace(/\D/g, '').slice(0, 2);
      if (!digits || !this.isUnlocked(custom)) return false;
      this.profile.cosmetics.number = digits;
    } else if (slot === 'rim' && value === 'silver') {
      this.profile.cosmetics.rim = 'silver';
    } else if (slot === 'car') {
      if (!CARS.some((car) => car.id === value) || !this.isCarUnlocked(value)) return false;
      this.profile.cosmetics.car = value;
      this.trialCar = null;
    } else if (slot === 'neon' && value === 'off') {
      this.profile.cosmetics.neon = 'off';
    } else if (slot === 'smoke' && value === 'white') {
      this.profile.cosmetics.smoke = 'white';
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
    const cr = Math.round(def.xp * CREDITS.achievementFactor);
    this.events.push({ type: 'achievement', title: def.title, detail: def.description, xp: def.xp, credits: cr });
    if (this.run) this.run.achievements.push({ id: def.id, title: def.title, description: def.description, xp: def.xp, credits: cr });
    this.addXp(def.xp, 'Achievements');
    this.addCredits(cr, 'Achievements');
    this.announceUnlocks();
    return true;
  }

  trigger(eventName) {
    for (const def of ACHIEVEMENTS) if (def.event === eventName) this.unlockAchievement(def.id);
  }

  checkStatAchievements() {
    for (const def of ACHIEVEMENTS) {
      if (def.stat && (this.profile.stats[def.stat] || 0) >= def.value) this.unlockAchievement(def.id);
    }
  }

  /** Every achievement with its group, and how far along it is when that can be counted. */
  achievements() {
    const stats = this.profile.stats;
    const medals = this.countMedals('bronze');
    return ACHIEVEMENTS.map((def) => {
      const unlocked = Boolean(this.profile.achievements[def.id]);
      let progress = null;
      if (def.stat) progress = { value: stats[def.stat] || 0, target: def.value };
      else if (def.event === 'medals:10') progress = { value: medals, target: 10 };
      else if (def.event === 'medals:25') progress = { value: medals, target: 25 };
      else if (def.event === 'mastery:5') progress = { value: Math.max(0, ...CARS.map((c) => this.masteryInfo(c.id).stars)), target: 5 };
      if (progress) progress.value = Math.min(progress.target, progress.value);
      return {
        id: def.id, title: def.title, description: def.description, xp: def.xp,
        credits: Math.round(def.xp * CREDITS.achievementFactor),
        group: achievementGroup(def), progress,
        unlocked, at: this.profile.achievements[def.id] || null,
      };
    });
  }

  // ------------------------------------------------------------------ daily challenge

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
    const alive = state.lastDoneDate === date || state.lastDoneDate === previousUtcDate(date);
    const streak = alive ? state.streak : 0;
    const boost = streakBoost(done ? streak : streak + 1);
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
      streak,
      boost,
      xp: Math.round(XP.dailyChallenge * boost),
      credits: Math.round(CREDITS.dailyChallenge * boost),
      contracts: this.contracts(date),
    };
  }

  /** Today's two contracts with progress. Seeded by date so everyone gets the same pair. */
  contracts(date = utcDate(this.now())) {
    const random = createRandom(`contracts:${date}`);
    const pool = CONTRACT_TEMPLATES.filter((t) => t.stat !== 'clips' || CLIP_MAPS.has(this.mapId));
    const first = pool[Math.floor(random() * pool.length)];
    const rest = pool.filter((t) => t !== first && t.stat !== first.stat);
    const second = rest[Math.floor(random() * rest.length)];
    const state = this.profile.contracts;
    const today = state.date === date;
    return [first, second].map((t) => ({
      id: t.id, text: t.text, goal: t.goal,
      progress: Math.min(t.goal, today ? state.progress[t.id] || 0 : 0),
      done: Boolean(today && state.done[t.id]),
      xp: CONTRACT_REWARD.xp, credits: CONTRACT_REWARD.credits,
    }));
  }

  /** Count `amount` towards today's contracts that track `stat`; pays each one once when it fills. */
  bumpContract(stat, amount = 1) {
    if (!(amount > 0)) return;
    const date = utcDate(this.now());
    const state = this.profile.contracts;
    if (state.date !== date) this.profile.contracts = { date, progress: {}, done: {} };
    const { progress, done } = this.profile.contracts;
    for (const c of this.contracts(date)) {
      const def = CONTRACT_TEMPLATES.find((t) => t.id === c.id);
      if (def.stat !== stat || done[c.id]) continue;
      progress[c.id] = (progress[c.id] || 0) + amount;
      if (progress[c.id] < def.goal) continue;
      done[c.id] = true;
      this.events.push({ type: 'daily', title: 'Contract complete', detail: def.text, xp: CONTRACT_REWARD.xp, credits: CONTRACT_REWARD.credits });
      this.addXp(CONTRACT_REWARD.xp, 'Contracts');
      this.addCredits(CONTRACT_REWARD.credits, 'Contracts');
      this.save();
    }
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
    const boost = streakBoost(state.streak);
    const xp = Math.round(XP.dailyChallenge * boost);
    const credits = Math.round(CREDITS.dailyChallenge * boost);
    this.events.push({ type: 'daily', title: 'Daily challenge complete', detail: `${state.streak}-day streak · x${boost} payout`, xp, credits });
    this.addXp(xp, 'Daily challenge');
    this.addCredits(credits, 'Daily challenge');
    this.trigger('daily');
    this.checkStatAchievements();
    return { completed: true, streak: state.streak, boost };
  }

  // ------------------------------------------------------------------ runs

  beginRun({ modeId, timeOfDay = 'day', carId = null, settings = null }) {
    this.lastReward = null;
    this.run = {
      modeId,
      timeOfDay,
      carId: carId || this.activeCarId(),
      settings: settings || null,
      startXp: this.profile.xp,
      startCredits: this.credits,
      lines: new Map(),
      creditLines: new Map(),
      distance: 0,
      pendingDistanceXp: 0,
      pendingDistanceCr: 0,
      pendingDriftXp: 0,
      pendingDriftCr: 0,
      airTime: 0,
      statClock: 0,
      respawns: 0,
      achievements: [],
      unlocks: [],
    };
    this.profile.stats.runs += 1;
    return this.run;
  }

  trackFrame(dt, state, drift) {
    const run = this.run;
    if (!run || !(dt > 0)) return;
    const stats = this.profile.stats;
    const metres = state.speed * dt;
    run.distance += metres;
    run.contractKm = (run.contractKm || 0) + metres / 1000;
    if (run.contractKm >= 0.1) {
      this.bumpContract('km', run.contractKm);
      run.contractKm = 0;
    }
    stats.distanceKm += metres / 1000;
    stats.driveSeconds += dt;
    if (state.speedKmh > stats.topSpeedKmh) stats.topSpeedKmh = state.speedKmh;

    run.pendingDistanceXp += (metres / 1000) * XP.perKm;
    if (run.pendingDistanceXp >= 1) {
      const whole = Math.floor(run.pendingDistanceXp);
      run.pendingDistanceXp -= whole;
      this.addXp(whole, 'Distance');
    }

    run.pendingDistanceCr += (metres / 1000) * CREDITS.perKm;
    if (run.pendingDistanceCr >= 1) {
      const whole = Math.floor(run.pendingDistanceCr);
      run.pendingDistanceCr -= whole;
      this.addCredits(whole, 'Distance');
    }

    if (state.wheelsOnGround === 0) {
      run.airTime += dt;
      if (run.airTime >= 1) this.trigger('air:1');
    } else {
      run.airTime = 0;
    }

    if (drift) {
      if (drift.styleEvent?.kind === 'wallTap') {
        stats.wallTaps = (stats.wallTaps || 0) + 1;
        this.trigger('style:wallTap');
        this.bumpContract('styleMoves');
      } else if (drift.styleEvent?.kind === 'backward') {
        this.trigger('style:backward');
        this.bumpContract('styleMoves');
      }
      if (drift.event === 'drift_end' && drift.lastDriftScore > 0) {
        stats.driftsBanked += 1;
        stats.bestCombo = Math.max(stats.bestCombo, drift.lastDriftScore);
        stats.totalDriftPoints = (stats.totalDriftPoints || 0) + drift.lastDriftScore;
        this.bumpContract('driftPoints', drift.lastDriftScore);
        this.trigger('drift');
        if (drift.lastDriftScore >= 1000) this.trigger('combo:1000');
        if (drift.lastDriftScore >= 5000) this.trigger('combo:5000');
        run.pendingDriftXp += drift.lastDriftScore * XP.perDriftPoints;
        const whole = Math.floor(run.pendingDriftXp);
        if (whole > 0) {
          run.pendingDriftXp -= whole;
          this.addXp(whole, 'Drifting');
        }
        run.pendingDriftCr += drift.lastDriftScore * CREDITS.perDriftPoints;
        const wholeCr = Math.floor(run.pendingDriftCr);
        if (wholeCr > 0) {
          run.pendingDriftCr -= wholeCr;
          this.addCredits(wholeCr, 'Drifting');
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

  onSessionEvent(event) {
    if (event.type === 'checkpoint' || event.type === 'lap') this.addXp(XP.perCheckpoint, 'Checkpoints');
  }

  onRespawn() {
    if (this.run) this.run.respawns += 1;
    this.profile.stats.respawns += 1;
  }

  onMultiplayer() {
    this.trigger('multiplayer');
  }

  onBeatGhost() {
    this.trigger('beat-ghost');
  }

  onNearMiss() {
    this.addXp(XP.nearMiss, 'Near misses');
    this.addCredits(CREDITS.nearMiss, 'Near misses');
    if (this.run) {
      this.run.nearMisses = (this.run.nearMisses || 0) + 1;
      if (this.run.nearMisses >= 5) this.trigger('near-miss:5');
    }
  }

  onClip() {
    this.bumpContract('clips');
  }

  /** Record a Speed Trap crossing; rewards target clears and new trap speed records. */
  recordSpeedTrap({ key, name, speedKmh, targetKmh = 140 } = {}) {
    if (!key || !Number.isFinite(speedKmh) || speedKmh < 40) return null;
    const rounded = Math.round(speedKmh);
    const prev = this.profile.speedTraps[key] || 0;
    const isPb = rounded > prev;
    const clearedNow = prev < targetKmh && rounded >= targetKmh;
    if (isPb) this.profile.speedTraps[key] = rounded;
    if (rounded > (this.profile.stats.bestTrapKmh || 0)) this.profile.stats.bestTrapKmh = rounded;
    if (rounded >= targetKmh) this.bumpContract('traps');

    let xp = 0;
    let credits = 0;
    if (clearedNow) {
      this.profile.stats.speedTrapsCleared = (this.profile.stats.speedTrapsCleared || 0) + 1;
      xp = 20;
      credits = 30;
    } else if (isPb && prev > 0) {
      xp = 8;
      credits = 10;
    }
    if (xp > 0) this.addXp(xp, 'Speed traps');
    if (credits > 0) this.addCredits(credits, 'Speed traps');
    if (clearedNow || isPb) {
      this.checkStatAchievements();
      this.save();
    }
    return {
      key,
      name: name || 'Speed Trap',
      speedKmh: rounded,
      prevKmh: prev,
      targetKmh,
      isPb,
      clearedNow,
      alreadyCleared: prev >= targetKmh,
      xp,
      credits,
    };
  }

  onFujimiAllClips() {
    this.trigger('fujimi:all-clips');
  }

  finishRun(result, options = {}) {
    const run = this.run || this.beginRun({ modeId: result.modeId });
    const before = this.levelInfo(run.startXp);
    const stats = this.profile.stats;
    stats.finishes += 1;
    if ((result.respawns || 0) === 0) stats.cleanRuns = (stats.cleanRuns || 0) + 1;
    this.bumpContract('finishes');
    if ((result.respawns || 0) === 0) this.bumpContract('cleanFinishes');

    this.addXp(XP.finish, 'Finish');
    this.addCredits(CREDITS.finish, 'Finish');
    if (result.isRecord) {
      this.addXp(XP.personalBest, 'Personal best');
      this.addCredits(CREDITS.personalBest, 'Personal best');
    }

    // Pro difficulty bonus when unlocked (unassisted handling / Manual transmission).
    const settings = options.settings || run.settings;
    let proPct = 0;
    if (settings && this.isFeatureUnlocked('pro-bonus')) {
      if (settings.handling === 'none') proPct += PRO_BONUS.unassistedHandling;
      if (settings.transmission === 'manual') proPct += PRO_BONUS.manualGears;
    }
    if (proPct > 0) {
      const baseXp = [...run.lines.values()].reduce((s, v) => s + v, 0);
      const baseCr = [...run.creditLines.values()].reduce((s, v) => s + v, 0);
      this.addXp(Math.round(baseXp * proPct), 'Pro bonus');
      this.addCredits(Math.round(baseCr * proPct), 'Pro bonus');
    }

    let medal = null;
    const earned = this.medalFor(result.modeId, result);
    const medalKey = this.trackKey(result.modeId);
    if (earned) {
      const prior = this.profile.medals[medalKey] || null;
      const isNew = tierIndex(earned) > tierIndex(prior);
      if (isNew) {
        let medalXp = 0;
        let medalCr = 0;
        for (let i = tierIndex(prior) + 1; i <= tierIndex(earned); i += 1) {
          const tier = MEDAL_TIERS[i];
          medalXp += XP.medal[tier];
          medalCr += CREDITS.medal[tier];
        }
        this.profile.medals[medalKey] = earned;
        this.events.push({ type: 'medal', title: `${MEDAL_LABELS[earned]} medal`, detail: getMode(result.modeId).label, xp: medalXp, credits: medalCr });
        this.addXp(medalXp, `${MEDAL_LABELS[earned]} medal`);
        this.addCredits(medalCr, `${MEDAL_LABELS[earned]} medal`);
        this.announceUnlocks();
      }
      medal = { tier: earned, isNew, next: this.nextMedal(result.modeId) };
      if (tierIndex(earned) >= tierIndex('gold')) {
        this.trigger('medal:gold');
        const usedCar = options.carId || run.carId || this.activeCarId();
        const upgrades = this.carUpgrades(usedCar);
        const totalStages = UPGRADE_SLOTS.reduce((s, slot) => s + (upgrades[slot.id] || 0), 0);
        if (usedCar === 'thar' || (usedCar === 'hatch' && totalStages === 0)) this.trigger('underdog');
        if (settings && settings.handling === 'none' && settings.transmission === 'manual' && !settings.abs && settings.driftAssist === false) {
          this.trigger('purist-gold');
        }
      }
      if (earned === 'author') this.trigger('medal:author');
      if (this.rankedModes().every((modeId) => tierIndex(this.profile.medals[this.trackKey(modeId)]) >= tierIndex('gold'))) this.trigger('all-gold');
      if (this.mapId === 'alpine' && this.rankedModes().every((modeId) => tierIndex(this.profile.medals[this.trackKey(modeId)]) >= tierIndex('silver'))) {
        this.trigger('alpine:all-silver');
      }
      const totalMedals = this.countMedals('bronze');
      if (totalMedals >= 10) this.trigger('medals:10');
      if (totalMedals >= 25) this.trigger('medals:25');
    }

    const modeId = result.modeId;
    if (modeId !== 'drift') this.trigger('finish');
    this.trigger(`finish:${modeId}`);
    if (this.mapId === 'jungle' && modeId !== 'roam') this.trigger('map:jungle:finish');
    if ((result.respawns || 0) === 0) this.trigger(`clean:${modeId}`);
    if (run.timeOfDay === 'night') this.trigger('finish:night');

    const rival = run.rivalId ? this.resolveRival(run.rivalId, result, run.rivalFinish) : null;

    let daily = null;
    const challenge = this.daily();
    if (!challenge.done && this.dailyMet(challenge, result, run)) daily = this.completeDaily(challenge);

    this.checkStatAchievements();
    const mastery = this.applyMastery(run);
    const trialEnded = this.clearTrialCar();
    const summary = this.summarize(run, before, medal, daily);
    summary.mastery = mastery;
    summary.rival = rival;
    summary.trialEnded = trialEnded;
    this.lastReward = { xpGained: summary.xpGained, creditsGained: summary.creditsGained, claimed: false };
    this.run = null;
    this.save();
    return summary;
  }

  /** Grants a 2x bonus match on the most recent finished run (for opt-in Rewarded Ad). */
  claimAdDoubleBonus() {
    if (!this.lastReward || this.lastReward.claimed) return null;
    const xpBonus = Math.max(0, Math.round(this.lastReward.xpGained || 0));
    const crBonus = Math.max(0, Math.round(this.lastReward.creditsGained || 0));
    this.lastReward.claimed = true;
    this.addXp(xpBonus);
    this.addCredits(crBonus);
    this.save();
    return { xpBonus, crBonus, credits: this.credits, level: this.levelInfo() };
  }

  abandonRun() {
    if (!this.run) return null;
    const run = this.run;
    const mastery = this.applyMastery(run);
    const trialEnded = this.clearTrialCar();
    const summary = this.summarize(run, this.levelInfo(run.startXp), null, null);
    summary.mastery = mastery;
    summary.trialEnded = trialEnded;
    this.run = null;
    this.save();
    return summary;
  }

  summarize(run, before, medal, daily) {
    const lines = [...run.lines.entries()].filter(([, xp]) => xp > 0).map(([label, xp]) => ({ label, xp }));
    const creditLines = [...run.creditLines.entries()].filter(([, cr]) => cr > 0).map(([label, credits]) => ({ label, credits }));
    return {
      lines,
      xpGained: lines.reduce((sum, line) => sum + line.xp, 0),
      creditLines,
      creditsGained: creditLines.reduce((sum, line) => sum + line.credits, 0),
      creditsTotal: this.credits,
      before,
      after: this.levelInfo(),
      medal,
      achievements: run.achievements.slice(),
      unlocks: run.unlocks.slice(),
      daily,
    };
  }

  drainEvents() {
    if (!this.events.length) return EMPTY;
    const events = this.events;
    this.events = [];
    return events;
  }
}

const EMPTY = Object.freeze([]);
