// Game-wide constants and persisted player settings.
// Vehicle tuning lives in src/vehicle/tuning.js; world generation parameters in src/world/worldConfig.js.

import { MAPS, DEFAULT_MAP } from './world/maps.js';
import { LEGACY_MAP, trackKey } from './meta/trackKey.js';

const STORAGE_KEY = 'slop-drift-settings-v2';
const RECORDS_KEY = 'slop-drift-records-v1';

/** Surface ids returned by World.sampleGround(). Index into SURFACE_PROPS. */
export const SURFACE = Object.freeze({ ASPHALT: 0, GRAVEL: 1, GRASS: 2, DIRT: 3, ROCK: 4, SNOW: 5, WATER: 6, MUD: 7, WOOD: 8, HARDPACK: 9 });

export const SURFACE_PROPS = Object.freeze([
  Object.freeze({ name: 'asphalt', grip: 1.0, rolling: 0.012, roughness: 0.02 }),
  Object.freeze({ name: 'gravel', grip: 0.74, rolling: 0.03, roughness: 0.35 }),
  Object.freeze({ name: 'grass', grip: 0.56, rolling: 0.06, roughness: 0.5 }),
  Object.freeze({ name: 'dirt', grip: 0.64, rolling: 0.045, roughness: 0.45 }),
  Object.freeze({ name: 'rock', grip: 0.62, rolling: 0.05, roughness: 0.8 }),
  Object.freeze({ name: 'snow', grip: 0.34, rolling: 0.07, roughness: 0.3 }),
  Object.freeze({ name: 'water', grip: 0.3, rolling: 0.5, roughness: 0.2 }),
  Object.freeze({ name: 'mud', grip: 0.90, rolling: 0.017, roughness: 0.32 }),
  Object.freeze({ name: 'wet timber', grip: 0.7, rolling: 0.022, roughness: 0.15 }),
  Object.freeze({ name: 'hardpack', grip: 0.90, rolling: 0.015, roughness: 0.14 }),
]);

/**
 * Game modes. `route` names an entry of World.routes:
 *  loop    - closed circuit around the mountain
 *  climb   - summit spur, driven uphill from the pass junction to the summit plaza
 *  descent - summit spur, driven downhill from the plaza to the junction
 *  peak / peakdown - the Nag Tibba road (Mussoorie only), up to its plaza and back down
 * A map offers only the modes whose route its world has (modesForWorld). `tab` is an optional short
 * leaderboard-tab label (default: the first word of `label`).
 */
export const MODES = Object.freeze([
  Object.freeze({ id: 'sprint', label: 'Mountain Loop', tagline: '1 lap · time trial', route: 'loop', laps: 1 }),
  Object.freeze({ id: 'circuit', label: 'Ridge Circuit', tagline: '2 laps · endurance', route: 'loop', laps: 2 }),
  Object.freeze({ id: 'climb', label: 'Summit Climb', tagline: 'Hill climb to the peak', route: 'climb', laps: 1 }),
  Object.freeze({ id: 'descent', label: 'Touge Descent', tagline: 'Summit to the pass, downhill', route: 'descent', laps: 1 }),
  Object.freeze({ id: 'drift', label: 'Drift Session', tagline: '120 s · score attack', route: 'loop', laps: 0, timeLimit: 120 }),
  Object.freeze({ id: 'peak', label: 'Nag Tibba Hill Climb', tagline: 'Switchbacks to the top', route: 'peak', laps: 1, tab: 'Nag Tibba' }),
  Object.freeze({ id: 'peakdown', label: 'Nag Tibba Descent', tagline: 'Hairpins all the way down', route: 'peakdown', laps: 1, tab: 'Nag Descent' }),
  Object.freeze({ id: 'roam', label: 'Free Roam', tagline: 'Explore the whole mountain', route: 'loop', laps: 0 }),
]);

export function getMode(id) {
  return MODES.find((mode) => mode.id === id) || MODES[0];
}

/**
 * The modes a built world can run: those whose route it has (e.g. no Nag Tibba events on Alpine).
 * @param {{routes?: Object<string, object>}|null} world
 */
export function modesForWorld(world) {
  const routes = world?.routes || {};
  return MODES.filter((mode) => Object.prototype.hasOwnProperty.call(routes, mode.route));
}

export const PAINT_OPTIONS = Object.freeze([
  Object.freeze({ id: 'pearl', label: 'Pearl', color: 0xe9eef5, creviceColor: 0x9aa8bc, flopColor: 0xffffff, metalness: 0.24, roughness: 0.14, clearcoat: 0.95, flake: 0.20, blend: 0.70 }),
  Object.freeze({ id: 'ember', label: 'Ember', color: 0xff5b36, creviceColor: 0x8f1106, flopColor: 0xff9b52, metalness: 0.42, roughness: 0.15, clearcoat: 0.92, flake: 0.22, blend: 0.72 }),
  Object.freeze({ id: 'glacier', label: 'Glacier', color: 0x3fb4ff, creviceColor: 0x09357e, flopColor: 0x8ce2ff, metalness: 0.46, roughness: 0.15, clearcoat: 0.92, flake: 0.24, blend: 0.75 }),
  Object.freeze({ id: 'acid', label: 'Acid', color: 0xb8ff47, creviceColor: 0x336304, flopColor: 0xe8ff78, metalness: 0.34, roughness: 0.14, clearcoat: 0.94, flake: 0.18, blend: 0.68 }),
  Object.freeze({ id: 'violet', label: 'Violet', color: 0x9a6bff, creviceColor: 0x2e126e, flopColor: 0xd1b3ff, metalness: 0.48, roughness: 0.15, clearcoat: 0.92, flake: 0.26, blend: 0.76 }),
  Object.freeze({ id: 'midnight', label: 'Midnight', color: 0x1b2330, creviceColor: 0x05080d, flopColor: 0x415678, metalness: 0.56, roughness: 0.14, clearcoat: 0.94, flake: 0.26, blend: 0.75 }),
  // Unlockable (see UNLOCKS in src/meta/catalog.js). metalness/roughness override the default paint finish.
  Object.freeze({ id: 'racing-green', label: 'Racing Green', color: 0x0f4d32, creviceColor: 0x031a10, flopColor: 0x29875c, metalness: 0.46, roughness: 0.15, clearcoat: 0.94, flake: 0.24, blend: 0.75 }),
  Object.freeze({ id: 'sunburst', label: 'Sunburst', color: 0xffb21a, creviceColor: 0x914200, flopColor: 0xffe46e, metalness: 0.55, roughness: 0.18, clearcoat: 0.92, flake: 0.28, blend: 0.74 }),
  Object.freeze({ id: 'summit', label: 'Summit Chrome', color: 0xdfe4ea, creviceColor: 0x5c6472, flopColor: 0xffffff, metalness: 1, roughness: 0.10, clearcoat: 0.85, flake: 0.08, blend: 0.55 }),
  Object.freeze({ id: 'obsidian', label: 'Obsidian', color: 0x0b0b0e, creviceColor: 0x020204, flopColor: 0x2c3442, metalness: 0.70, roughness: 0.16, clearcoat: 0.95, flake: 0.22, blend: 0.68 }),
]);

/**
 * Render quality presets.
 * terrainLod: multiplier on terrain LOD switch distances. trees: fraction of the full tree count.
 */
export const QUALITY_PRESETS = Object.freeze({
  Low: Object.freeze({ pixelRatio: 1, shadowMapSize: 0, terrainLod: 0.6, trees: 0.35, effects: 0.5, bloom: false, clouds: false }),
  Medium: Object.freeze({ pixelRatio: 1.25, shadowMapSize: 1024, terrainLod: 0.8, trees: 0.6, effects: 0.75, bloom: false, clouds: true }),
  High: Object.freeze({ pixelRatio: 1.5, shadowMapSize: 2048, terrainLod: 1, trees: 1, effects: 1, bloom: true, clouds: true }),
  Ultra: Object.freeze({ pixelRatio: 2, shadowMapSize: 4096, terrainLod: 1.3, trees: 1.4, effects: 1.3, bloom: true, clouds: true }),
});

/** Names only; the tuning each one maps to lives in src/vehicle/tuning.js. */
export const HANDLING_PRESETS = Object.freeze(['Arcade', 'Balanced', 'Sim']);

export const TIME_OF_DAY = Object.freeze(['dawn', 'day', 'sunset', 'night']);

export const DEFAULT_SETTINGS = Object.freeze({
  map: DEFAULT_MAP,
  quality: 'High',
  timeOfDay: 'day',
  paint: 'pearl',
  handling: 'Balanced',
  units: 'kmh',
  driftAssist: 0.6,
  abs: true,
  transmission: 'auto',
  volume: 0.8,
  cameraShake: true,
  startGate: true,
});

export const CONFIG = Object.freeze({
  physics: Object.freeze({ fixedDt: 1 / 120, maxSubSteps: 8 }),
  race: Object.freeze({ countdownSeconds: 3, checkpointSpacing: 320 }),
  nitro: Object.freeze({ capacity: 100, drainPerSecond: 24, refillPerSecond: 6, driftRefill: 9, forceMultiplier: 1.35 }),
  camera: Object.freeze({ fovBase: 62, fovSpeedGain: 16, blendSeconds: 0.45 }),
  input: Object.freeze({ deadzone: 0.12 }),
});

function clamp01(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

/** Neon underglow colours (unlocks in src/meta/catalog.js). `cycle` slowly runs through the hues. */
export const NEON_OPTIONS = Object.freeze([
  Object.freeze({ id: 'off', label: 'Off', color: null }),
  Object.freeze({ id: 'cyan', label: 'Cyan', color: 0x18e0ff }),
  Object.freeze({ id: 'magenta', label: 'Magenta', color: 0xff2bd0 }),
  Object.freeze({ id: 'lime', label: 'Lime', color: 0x6dff2e }),
  Object.freeze({ id: 'red', label: 'Red', color: 0xff2424 }),
  Object.freeze({ id: 'amber', label: 'Amber', color: 0xffa014 }),
  Object.freeze({ id: 'violet', label: 'Violet', color: 0x8443ff }),
  Object.freeze({ id: 'ice', label: 'Ice White', color: 0xdff1ff }),
  Object.freeze({ id: 'rainbow', label: 'Rainbow', color: null, cycle: true }),
]);

export function getNeon(id) {
  return NEON_OPTIONS.find((neon) => neon.id === id) || NEON_OPTIONS[0];
}

/** Underglow brightness by time of day: full at night, half at dawn and dusk, faint by day. */
export function neonLevel(timeOfDay) {
  if (timeOfDay === 'night') return 1;
  if (timeOfDay === 'dawn' || timeOfDay === 'sunset') return 0.55;
  return 0.2;
}

export function getPaint(id) {
  return PAINT_OPTIONS.find((paint) => paint.id === id) || PAINT_OPTIONS[0];
}

export function getQualityPreset(name) {
  return QUALITY_PRESETS[name] || QUALITY_PRESETS.High;
}

export function normalizeSettings(input = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...(input || {}) };
  return {
    map: MAPS[merged.map] ? merged.map : DEFAULT_SETTINGS.map,
    quality: QUALITY_PRESETS[merged.quality] ? merged.quality : DEFAULT_SETTINGS.quality,
    timeOfDay: TIME_OF_DAY.includes(merged.timeOfDay) ? merged.timeOfDay : DEFAULT_SETTINGS.timeOfDay,
    paint: PAINT_OPTIONS.some((option) => option.id === merged.paint) ? merged.paint : DEFAULT_SETTINGS.paint,
    handling: HANDLING_PRESETS.includes(merged.handling) ? merged.handling : DEFAULT_SETTINGS.handling,
    units: merged.units === 'mph' ? 'mph' : 'kmh',
    driftAssist: clamp01(merged.driftAssist, DEFAULT_SETTINGS.driftAssist),
    abs: Boolean(merged.abs),
    transmission: merged.transmission === 'manual' ? 'manual' : 'auto',
    volume: clamp01(merged.volume, DEFAULT_SETTINGS.volume),
    cameraShake: Boolean(merged.cameraShake),
    startGate: Boolean(merged.startGate),
  };
}

export function loadSettings() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : DEFAULT_SETTINGS);
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Storage can be unavailable (private mode); settings then last for the session only.
  }
  return normalized;
}

// Records of every map live in one stored object keyed by track key (src/meta/trackKey.js), so the
// Alpine entries saved before maps existed (bare mode ids) are still the Alpine records.
function readAllRecords() {
  try {
    const raw = globalThis.localStorage?.getItem(RECORDS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Best results on one map, keyed by plain mode id: { [modeId]: { time?: seconds, score?: points } }.
 * @param {string} [mapId]  Defaults to the Alpine map.
 */
export function loadRecords(mapId = LEGACY_MAP) {
  const all = readAllRecords();
  const records = {};
  for (const mode of MODES) {
    const record = all[trackKey(mapId, mode.id)];
    if (record && typeof record === 'object') records[mode.id] = record;
  }
  return records;
}

/**
 * Store one map's records (as returned by loadRecords) without touching other maps' entries.
 * @param {Object<string, object>} records  Keyed by plain mode id.
 * @param {string} [mapId]  Defaults to the Alpine map.
 */
export function saveRecords(records, mapId = LEGACY_MAP) {
  const all = readAllRecords();
  for (const [modeId, record] of Object.entries(records || {})) all[trackKey(mapId, modeId)] = record;
  try {
    globalThis.localStorage?.setItem(RECORDS_KEY, JSON.stringify(all));
  } catch {
    // See saveSettings.
  }
  return records;
}
