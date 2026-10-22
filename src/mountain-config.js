const STORAGE_KEY = 'mountain-drift-settings-v1';

export const PAINT_OPTIONS = Object.freeze([
  Object.freeze({ id: 'ember', label: 'Ember', color: 0xff5b36 }),
  Object.freeze({ id: 'glacier', label: 'Glacier', color: 0x55c8ff }),
  Object.freeze({ id: 'acid', label: 'Acid', color: 0xb8ff47 }),
  Object.freeze({ id: 'violet', label: 'Violet', color: 0xb58cff }),
  Object.freeze({ id: 'pearl', label: 'Pearl', color: 0xe9eef5 }),
]);

export const QUALITY_PRESETS = Object.freeze({
  Low: Object.freeze({ pixelRatio: 1, shadows: false, effects: 0.45, terrainResolution: 14 }),
  Medium: Object.freeze({ pixelRatio: 1.25, shadows: true, effects: 0.7, terrainResolution: 18 }),
  High: Object.freeze({ pixelRatio: 1.75, shadows: true, effects: 1, terrainResolution: 22 }),
  Ultra: Object.freeze({ pixelRatio: 2, shadows: true, effects: 1.35, terrainResolution: 26 }),
});

export const HANDLING_PRESETS = Object.freeze({
  Arcade: Object.freeze({ grip: 1.2, engine: 1.08, steering: 1.2, maxSpeed: 62, assist: 0.92 }),
  Balanced: Object.freeze({ grip: 1, engine: 1, steering: 1, maxSpeed: 58, assist: 0.68 }),
  Sim: Object.freeze({ grip: 0.84, engine: 0.96, steering: 0.86, maxSpeed: 56, assist: 0.28 }),
});

export const TIME_PRESETS = Object.freeze({
  dawn: Object.freeze({ background: 0x8fa6b9, fog: 0x9eb5c4, fogDensity: 0.008, hemiSky: 0xd8e7ef, hemiGround: 0x26303a, sun: 0xffbd83, sunIntensity: 1.45, ambient: 0.52, stars: 0.08 }),
  day: Object.freeze({ background: 0x79b8dc, fog: 0x8bc1de, fogDensity: 0.0065, hemiSky: 0xe7f4ff, hemiGround: 0x354c46, sun: 0xfff2cf, sunIntensity: 2.15, ambient: 0.66, stars: 0 }),
  sunset: Object.freeze({ background: 0x4b5f82, fog: 0x6f6a78, fogDensity: 0.009, hemiSky: 0xd99592, hemiGround: 0x211e27, sun: 0xff8a5b, sunIntensity: 1.55, ambient: 0.42, stars: 0.35 }),
  night: Object.freeze({ background: 0x07101f, fog: 0x0b1829, fogDensity: 0.012, hemiSky: 0x314870, hemiGround: 0x06080e, sun: 0x7ca4ff, sunIntensity: 0.42, ambient: 0.2, stars: 0.92 }),
});

export const DEFAULT_SETTINGS = Object.freeze({
  quality: 'High',
  timeOfDay: 'day',
  paint: 'pearl',
  handling: 'Balanced',
  units: 'kmh',
  driftAssist: 0.68,
  abs: true,
  transmission: 'auto',
});

export const CONFIG = {
  seed: 76421,
  world: {
    sizeX: 360,
    sizeZ: 300,
    chunkSize: 60,
    roadWidth: 7.6,
    shoulderWidth: 2.5,
    roadSegments: 440,
    checkpoints: 16,
  },
  vehicle: {
    mass: 1120,
    engineForce: 9200,
    reverseForce: 3600,
    brakeForce: 12000,
    steeringMaxDeg: 35,
    steeringResponse: 8.5,
    steeringReturn: 12,
    lateralGrip: 8.5,
    maxSpeed: 58,
    driveLayout: 'rwd',
  },
  drift: {
    minSpeed: 11,
    entryAngleDeg: 16,
    confirmTime: 0.15,
    comboWindow: 1.35,
    maxMultiplier: 5,
    maxAngleDeg: 72,
    scoreScale: 16,
  },
  race: {
    sprintLaps: 1,
    circuitLaps: 2,
    driftDuration: 90,
  },
  camera: {
    blendSeconds: 0.42,
    chaseDistance: 7.2,
    chaseHeight: 3.1,
    farDistance: 13.5,
    farHeight: 6.8,
    lookAhead: 8,
    cockpitHeight: 1.05,
  },
  input: {
    deadzone: 0.12,
  },
  effects: {
    particles: 240,
    skids: 360,
  },
  settings: { ...DEFAULT_SETTINGS },
};

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function getPaint(id) {
  return PAINT_OPTIONS.find((paint) => paint.id === id) || PAINT_OPTIONS[0];
}

export function getQualityPreset(name) {
  return QUALITY_PRESETS[name] || QUALITY_PRESETS.High;
}

export function getHandlingPreset(name) {
  return HANDLING_PRESETS[name] || HANDLING_PRESETS.Balanced;
}

export function getTimePreset(name) {
  return TIME_PRESETS[name] || TIME_PRESETS.sunset;
}

export function normalizeSettings(input = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...input };
  const quality = QUALITY_PRESETS[merged.quality] ? merged.quality : DEFAULT_SETTINGS.quality;
  const timeOfDay = TIME_PRESETS[merged.timeOfDay] ? merged.timeOfDay : DEFAULT_SETTINGS.timeOfDay;
  const paint = PAINT_OPTIONS.some((option) => option.id === merged.paint) ? merged.paint : DEFAULT_SETTINGS.paint;
  const handling = HANDLING_PRESETS[merged.handling] ? merged.handling : DEFAULT_SETTINGS.handling;
  const units = merged.units === 'mph' ? 'mph' : 'kmh';
  const transmission = merged.transmission === 'manual' ? 'manual' : 'auto';
  return {
    quality,
    timeOfDay,
    paint,
    handling,
    units,
    driftAssist: clamp(Number(merged.driftAssist), 0, 1),
    abs: Boolean(merged.abs),
    transmission,
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
    return normalized;
  }
  return normalized;
}
