// Game-wide constants and persisted player settings.
// Vehicle tuning lives in src/vehicle/tuning.js; world generation parameters in src/world/worldConfig.js.

import { MAPS, DEFAULT_MAP } from './world/maps.js';
import { LEGACY_MAP, trackKey } from './meta/trackKey.js';

const STORAGE_KEY = 'slop-drift-settings-v2';
const RECORDS_KEY = 'slop-drift-records-v1';

/** Surface ids returned by World.sampleGround(). Index into SURFACE_PROPS. */
export const SURFACE = Object.freeze({ ASPHALT: 0, GRAVEL: 1, GRASS: 2, DIRT: 3, ROCK: 4, SNOW: 5, WATER: 6, MUD: 7, WOOD: 8, HARDPACK: 9, COBBLE: 10, CONCRETE: 11, KERB: 12 });

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
  Object.freeze({ name:'wet cobblestone', grip:.93, rolling:.016, roughness:.17 }),
  Object.freeze({name:'concrete',grip:.96,rolling:.014,roughness:.09}),
  Object.freeze({name:'painted kerb',grip:.86,rolling:.018,roughness:.19}),
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
  ...[['gp','Grand Prix'],['ridge','Mountain Circuit'],['international','International Sprint'],['bowl','Stadium Circuit'],['academy','Motorsport Academy']].map(([id,label])=>Object.freeze({id,label,tagline:'APEX International Motorsport Park',route:id,laps:1})),
  ...[
    ['shibuya','Neon Crown','3 km · Shibuya Neon Circuit'],
    ['express','Metropolitan Expressway','9 km · elevated sweepers and tunnels'],
    ['bay','Tokyo Bay Run','4 km · waterfront circuit'],
    ['parkade','Midnight Parkade Ascent','B2 to 7F · climb all nine levels'],
    ['parkdown','Full Building Descent','7F to B2 · reverse time trial'],
    ['underground','Underground Echo','Tunnel sector · point to point'],
    ['tour','Grand Tokyo Tour','15 km · night endurance circuit'],
  ].map(([id,label,tagline])=>Object.freeze({id,label,tagline,route:id,laps:1})),
  Object.freeze({ id:'quarter', label:'Forgotten Quarter', tagline:'3 km · Clock Square time trial', route:'quarter', laps:1 }),
  Object.freeze({ id:'vanishing', label:'The Vanishing Road', tagline:'7 km · Signal Tunnel endurance run', route:'vanishing', laps:1 }),
  Object.freeze({ id: 'roam', label: 'Free Roam', tagline: 'Explore the whole mountain', route: 'loop', laps: 0 }),
]);

export function getMode(id) {
  return MODES.find((mode) => mode.id === id) || MODES.find(mode => mode.id === 'sprint');
}

/**
 * The modes a built world can run: those whose route it has (e.g. no Nag Tibba events on Alpine).
 * @param {{routes?: Object<string, object>}|null} world
 */
export function modesForWorld(world) {
  const routes = world?.routes || {};
  const modes=MODES.filter((mode) => Object.prototype.hasOwnProperty.call(routes, mode.route));
  if(world?.config?.map==='apex')return modes.map(mode=>({...mode,label:({sprint:'Endurance Qualifying',circuit:'Endurance Race',roam:'Open Track Day'})[mode.id]||mode.label,tagline:mode.id==='roam'?'Explore the paddock and all six layouts':mode.id==='drift'?'Two-minute drift exhibition':`${(routes[mode.route].metres/1000).toFixed(2)} km · ${mode.laps} ${mode.laps===1?'lap':'laps'}`}));
  if(world?.config?.map==='tokyo')return modes.map(mode=>{
    const overrides={sprint:['Tokyo Midnight Circuit','5 km · Minato and Electric Town'],circuit:['Midnight Endurance','Two laps of Tokyo'],roam:['City Explorer','Explore districts and collect night photographs']};
    return overrides[mode.id]?{...mode,label:overrides[mode.id][0],tagline:overrides[mode.id][1]}:mode;
  });
  if(world?.config?.map==='fujimi')return modes.map(mode=>{
    const overrides={sprint:['Fujimi Rally','2.5 km · one lap under Mount Fuji'],circuit:['Fujimi Endurance','Two laps · 5 km'],
      drift:['Clipping Zone Attack','120 s · drift through the glowing zones'],roam:['Free Practice','Free laps and drift practice']};
    return overrides[mode.id]?{...mode,label:overrides[mode.id][0],tagline:overrides[mode.id][1]}:mode;
  });
  if(world?.config?.map!=='hollow')return modes;
  return modes.map(mode=>mode.id==='sprint'?{...mode,label:'Hollow Creek Circuit',tagline:'5 km · main circuit'}:
    mode.id==='circuit'?{...mode,label:'Creek Endurance',tagline:'Two laps of the main circuit'}:
    mode.id==='roam'?{...mode,tagline:'Garage dispatch and exploration'}:mode);
}

const HAS_SKIN_URL = typeof import.meta.url === 'string';
const skinUrl = (file) => (HAS_SKIN_URL ? new URL(`./assets/skins/${file}`, import.meta.url).href : null);

// finishMode: 0 = Gloss PPF, 1 = Satin Stealth PPF, 2 = 3D Carbon Twill PPF, 3 = Brushed Metal Foil PPF
export const PAINT_OPTIONS = Object.freeze([
  Object.freeze({ id: 'minato-gold', label: 'Minato Gold', finishTag: 'FACTORY', finishMode: 0, iridescence: 0.45, color: 0xcb8f43, flopColor: 0x722e55, creviceColor: 0x231a32, metalness: 0.79, roughness: 0.21, clearcoat: 0.92, clearcoatRoughness: 0.05, flake: 0.31, blend: 0.70 }),
  Object.freeze({ id: 'saltline', label: 'Saltline Service', finishTag: 'HERITAGE', finishMode: 1, iridescence: 0.0, color: 0x507b76, creviceColor: 0x1b3639, flopColor: 0xe6d6ab, metalness: 0.58, roughness: 0.36, clearcoat: 0.67, clearcoatRoughness: 0.22, flake: 0.14, blend: 0.66 }),
  Object.freeze({ id: 'pearl', label: 'Himalayan Topo', finishTag: 'GLOSS', finishMode: 0, iridescence: 0.14, skinUrl: skinUrl('himalayan-topo.webp'), color: 0xeef3f8, creviceColor: 0x8ea0b5, flopColor: 0xffffff, metalness: 0.22, roughness: 0.14, clearcoat: 0.98, clearcoatRoughness: 0.04, flake: 0.16, blend: 0.52 }),
  Object.freeze({ id: 'ember', label: 'Tokyo Touge', finishTag: 'GLOSS', finishMode: 0, iridescence: 0.24, skinUrl: skinUrl('tokyo-touge.webp'), color: 0xf24423, creviceColor: 0x6b0b04, flopColor: 0xff8b4d, metalness: 0.30, roughness: 0.14, clearcoat: 0.96, clearcoatRoughness: 0.04, flake: 0.22, blend: 0.56 }),
  Object.freeze({ id: 'glacier', label: 'Alpine Glacier', finishTag: 'GLOSS', finishMode: 0, iridescence: 0.40, skinUrl: skinUrl('alpine-glacier.webp'), color: 0x2aa8ff, creviceColor: 0x072b6e, flopColor: 0xa6f2ff, metalness: 0.36, roughness: 0.14, clearcoat: 0.96, clearcoatRoughness: 0.04, flake: 0.24, blend: 0.58 }),
  Object.freeze({ id: 'acid', label: 'Acid Splinter', finishTag: 'SATIN', finishMode: 1, iridescence: 0.04, skinUrl: skinUrl('acid-splinter.webp'), color: 0xbfff24, creviceColor: 0x1b221a, flopColor: 0x454e59, metalness: 0.18, roughness: 0.34, clearcoat: 0.36, clearcoatRoughness: 0.28, flake: 0.12, blend: 0.44 }),
  Object.freeze({ id: 'violet', label: 'Midnight Sakura', finishTag: 'FLIP', finishMode: 0, iridescence: 0.78, skinUrl: skinUrl('midnight-sakura.webp'), color: 0x8d52ff, creviceColor: 0x1f0b47, flopColor: 0xff62cb, metalness: 0.32, roughness: 0.13, clearcoat: 1.0, clearcoatRoughness: 0.03, flake: 0.28, blend: 0.62 }),
  Object.freeze({ id: 'chameleon', label: 'Oil-Slick Chameleon', finishTag: 'FLIP', finishMode: 0, iridescence: 1.0, skinUrl: skinUrl('oil-slick-chameleon.webp'), color: 0x18e0b0, creviceColor: 0x1a0d38, flopColor: 0xff45b8, metalness: 0.48, roughness: 0.11, clearcoat: 1.0, clearcoatRoughness: 0.03, flake: 0.30, blend: 0.72 }),
  Object.freeze({ id: 'bayside', label: 'Bayside Flip Pearl', finishTag: 'FLIP', finishMode: 0, iridescence: 0.72, skinUrl: skinUrl('bayside-pearl.webp'), color: 0x1a68ff, creviceColor: 0x06194d, flopColor: 0x9b4dff, metalness: 0.48, roughness: 0.12, clearcoat: 1.0, clearcoatRoughness: 0.03, flake: 0.30, blend: 0.68 }),
  Object.freeze({ id: 'ruby-carbon', label: 'Ruby Exposed Carbon', finishTag: 'CARBON', finishMode: 2, iridescence: 0.32, skinUrl: skinUrl('ruby-carbon.webp'), color: 0xb8102a, creviceColor: 0x1a0206, flopColor: 0xff425c, metalness: 0.30, roughness: 0.17, clearcoat: 0.94, clearcoatRoughness: 0.05, flake: 0.18, blend: 0.56 }),
  Object.freeze({ id: 'stealth-gunmetal', label: 'Stealth Gunmetal Hex', finishTag: 'SATIN', finishMode: 1, iridescence: 0.0, skinUrl: skinUrl('stealth-gunmetal.webp'), color: 0x353c47, creviceColor: 0x111419, flopColor: 0x5c6675, metalness: 0.24, roughness: 0.38, clearcoat: 0.34, clearcoatRoughness: 0.30, flake: 0.10, blend: 0.46 }),
  Object.freeze({ id: 'tiffany-ice', label: 'Tiffany Liquid Pearl', finishTag: 'GLOSS', finishMode: 0, iridescence: 0.52, skinUrl: skinUrl('tiffany-pearl.webp'), color: 0x36e6d3, creviceColor: 0x0a4a47, flopColor: 0xeafffc, metalness: 0.34, roughness: 0.12, clearcoat: 1.0, clearcoatRoughness: 0.03, flake: 0.24, blend: 0.60 }),
  Object.freeze({ id: 'midnight', label: 'Forged Carbon', finishTag: 'CARBON', finishMode: 2, iridescence: 0.14, skinUrl: skinUrl('forged-carbon.webp'), color: 0x202733, creviceColor: 0x05080d, flopColor: 0x545d6b, metalness: 0.28, roughness: 0.18, clearcoat: 0.92, clearcoatRoughness: 0.05, flake: 0.20, blend: 0.50 }),
  Object.freeze({ id: 'kitsune', label: 'Neon Cyber Kitsune', finishTag: 'FLIP', finishMode: 0, iridescence: 0.68, skinUrl: skinUrl('cyber-kitsune.webp'), color: 0x101c48, creviceColor: 0x070812, flopColor: 0x00f6ff, metalness: 0.32, roughness: 0.13, clearcoat: 0.98, clearcoatRoughness: 0.03, flake: 0.26, blend: 0.62 }),
  Object.freeze({ id: 'racing-green', label: 'Monsoon Emerald', finishTag: 'GLOSS', finishMode: 0, iridescence: 0.26, skinUrl: skinUrl('monsoon-emerald.webp'), color: 0x0f5a3a, creviceColor: 0x031a10, flopColor: 0xd9be6b, metalness: 0.38, roughness: 0.14, clearcoat: 0.96, clearcoatRoughness: 0.04, flake: 0.24, blend: 0.56 }),
  Object.freeze({ id: 'gold-rush', label: '24K Brushed Gold', finishTag: 'BRUSHED', finishMode: 3, iridescence: 0.28, skinUrl: skinUrl('gold-brushed.webp'), color: 0xe5ae35, creviceColor: 0x5c3b06, flopColor: 0xffe89c, metalness: 0.84, roughness: 0.16, clearcoat: 0.84, clearcoatRoughness: 0.07, flake: 0.16, blend: 0.64 }),
  Object.freeze({ id: 'damascus', label: 'Damascus Titanium', finishTag: 'BRUSHED', finishMode: 3, iridescence: 0.48, skinUrl: skinUrl('damascus-titanium.webp'), color: 0x8ea0b8, creviceColor: 0x1a2028, flopColor: 0x5cb3ff, metalness: 0.78, roughness: 0.17, clearcoat: 0.88, clearcoatRoughness: 0.06, flake: 0.18, blend: 0.62 }),
  Object.freeze({ id: 'arctic-splinter', label: 'Arctic Stealth Camo', finishTag: 'SATIN', finishMode: 1, iridescence: 0.0, skinUrl: skinUrl('arctic-camo.webp'), color: 0xd8e2ed, creviceColor: 0x232933, flopColor: 0xeaf0f6, metalness: 0.12, roughness: 0.38, clearcoat: 0.30, clearcoatRoughness: 0.30, flake: 0.06, blend: 0.42 }),
  Object.freeze({ id: 'sunset-fade', label: 'Supernova Fade', finishTag: 'FLIP', finishMode: 0, iridescence: 0.82, skinUrl: skinUrl('supernova-fade.webp'), color: 0xeb286b, creviceColor: 0x2d0d5e, flopColor: 0xff9429, metalness: 0.46, roughness: 0.12, clearcoat: 1.0, clearcoatRoughness: 0.03, flake: 0.28, blend: 0.66 }),
  Object.freeze({ id: 'sunburst', label: 'Sunburst Drift', finishTag: 'GLOSS', finishMode: 0, iridescence: 0.28, skinUrl: skinUrl('sunburst-rising.webp'), color: 0xffb21a, creviceColor: 0x823800, flopColor: 0xffe46e, metalness: 0.44, roughness: 0.15, clearcoat: 0.96, clearcoatRoughness: 0.04, flake: 0.24, blend: 0.58 }),
  Object.freeze({ id: 'summit', label: 'Liquid Chrome', finishTag: 'CHROME', finishMode: 3, iridescence: 0.42, skinUrl: skinUrl('summit-chrome.webp'), color: 0xe6ecf4, creviceColor: 0x4b5563, flopColor: 0x82e6ff, metalness: 0.92, roughness: 0.09, clearcoat: 0.92, clearcoatRoughness: 0.04, flake: 0.08, blend: 0.65 }),
  Object.freeze({ id: 'obsidian', label: 'Obsidian Oni', finishTag: 'SATIN', finishMode: 1, iridescence: 0.18, skinUrl: skinUrl('obsidian-oni.webp'), color: 0x101116, creviceColor: 0x020204, flopColor: 0x3b3e48, metalness: 0.24, roughness: 0.32, clearcoat: 0.48, clearcoatRoughness: 0.24, flake: 0.18, blend: 0.50 }),
]);

export const SKIN_OPTIONS = PAINT_OPTIONS;
export function getSkin(id) { return getPaint(id); }

/**
 * Render quality presets.
 * terrainLod: multiplier on terrain LOD switch distances. trees: fraction of the full tree count.
 */
export const QUALITY_PRESETS = Object.freeze({
  Low: Object.freeze({ pixelRatio: 1, shadowMapSize: 0, terrainLod: 0.6, trees: 0.35, effects: 0.45, bloom: false, clouds: false, anisotropy: 1, underglowCars: 0, wildlife: false, farClip: 3800, antialias: false }),
  Medium: Object.freeze({ pixelRatio: 1.25, shadowMapSize: 1024, terrainLod: 0.85, trees: 0.65, effects: 0.75, bloom: false, clouds: true, anisotropy: 4, underglowCars: 2, wildlife: true, farClip: 5200, antialias: true }),
  High: Object.freeze({ pixelRatio: 1.5, shadowMapSize: 2048, terrainLod: 1, trees: 1, effects: 1, bloom: true, clouds: true, anisotropy: 8, underglowCars: 6, wildlife: true, farClip: 7200, antialias: true }),
  Ultra: Object.freeze({ pixelRatio: 2, shadowMapSize: 4096, terrainLod: 1.3, trees: 1.4, effects: 1.3, bloom: true, clouds: true, anisotropy: 8, underglowCars: 6, wildlife: true, farClip: 9000, antialias: true }),
});

const SOFTWARE_GPU_RE = /swiftshader|llvmpipe|softpipe|basic render|mali-4|adreno[^\d]*(3\d\d|4\d\d|50\d)|powervr[^\w]*sgx/i;

/**
 * Pick a starting Auto quality tier from hardware and WebGL capabilities so mobile phones,
 * low-RAM laptops and software renderers stay smooth without stutters or OOM crashes.
 */
export function detectInitialQuality(renderer = null) {
  const coarse = Boolean(globalThis.matchMedia?.('(pointer: coarse)')?.matches);
  const nav = globalThis.navigator;
  const mem = Number(nav?.deviceMemory) || 0;
  const cores = Number(nav?.hardwareConcurrency) || 0;
  let maxTex = 0;
  let gpuName = '';
  try {
    maxTex = Number(renderer?.capabilities?.maxTextureSize) || 0;
    const gl = renderer?.getContext?.();
    if (gl) {
      if (!maxTex) maxTex = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) gpuName = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
    }
  } catch {
    // Ignore restricted WebGL capability probes.
  }

  if (
    (gpuName && SOFTWARE_GPU_RE.test(gpuName))
    || (maxTex > 0 && maxTex < 4096)
    || (mem > 0 && mem <= 2)
    || (cores > 0 && cores <= 2 && mem > 0 && mem <= 4)
    || (coarse && ((mem > 0 && mem <= 4) || (cores > 0 && cores <= 4)))
  ) {
    return 'Low';
  }
  if (coarse || (mem > 0 && mem <= 4) || (cores > 0 && cores <= 2)) {
    return 'Medium';
  }
  return 'High';
}

/** Names only; the tuning each one maps to lives in src/vehicle/tuning.js. */
export const HANDLING_PRESETS = Object.freeze(['Arcade', 'Balanced', 'Sim']);

export const TIME_OF_DAY = Object.freeze(['dawn', 'day', 'sunset', 'night']);

/** UI accent colours the player can pick in Settings (buttons, highlights, HUD accents). */
export const UI_ACCENTS = Object.freeze({
  amber: '#F2B01E',
  red: '#FF5A3C',
  blue: '#4EA3FF',
  teal: '#2ED3B7',
  pink: '#FF5FA2',
  lime: '#B6E34A',
});

export const DEFAULT_SETTINGS = Object.freeze({
  map: DEFAULT_MAP,
  quality: 'Auto',
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
  touchSteer: 'arrows',
  uiAccent: 'amber',
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

/** Tyre smoke colours (unlocks in src/meta/catalog.js). */
export const SMOKE_OPTIONS = Object.freeze([
  Object.freeze({ id: 'white', label: 'Pure White', color: 0xe8eaed, rgb: [0.9, 0.9, 0.91] }),
  Object.freeze({ id: 'amber', label: 'Marigold Haze', color: 0xf2b01e, rgb: [0.96, 0.72, 0.16] }),
  Object.freeze({ id: 'cyan', label: 'Electric Cyan', color: 0x22e8ff, rgb: [0.22, 0.9, 0.98] }),
  Object.freeze({ id: 'pink', label: 'Sakura Pink', color: 0xff5fa2, rgb: [0.98, 0.38, 0.66] }),
  Object.freeze({ id: 'crimson', label: 'Crimson Torch', color: 0xff3b30, rgb: [0.96, 0.24, 0.2] }),
  Object.freeze({ id: 'lime', label: 'Acid Lime', color: 0xb6e34a, rgb: [0.72, 0.92, 0.28] }),
  Object.freeze({ id: 'gold', label: '24K Gold Dust', color: 0xffd24d, rgb: [0.98, 0.84, 0.32] }),
]);

export function getSmoke(id) {
  return SMOKE_OPTIONS.find((smoke) => smoke.id === id) || SMOKE_OPTIONS[0];
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

/**
 * @param {string} name  A QUALITY_PRESETS key, or 'Auto'.
 * @param {string} [autoLevel]  The level Auto currently resolves to (Game measures the frame rate).
 */
export function getQualityPreset(name, autoLevel = 'High') {
  if (name === 'Auto') return QUALITY_PRESETS[autoLevel] || QUALITY_PRESETS.High;
  return QUALITY_PRESETS[name] || QUALITY_PRESETS.High;
}

/** Auto quality: one level lower when a measured window averaged under 40 fps, else unchanged. Never steps up (no flip-flopping). */
export function nextAutoQuality(level, averageFps) {
  const levels = Object.keys(QUALITY_PRESETS);
  const i = levels.indexOf(level);
  return averageFps < 40 && i > 0 ? levels[i - 1] : level;
}

export function normalizeSettings(input = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...(input || {}) };
  return {
    map: MAPS[merged.map] ? merged.map : DEFAULT_SETTINGS.map,
    quality: QUALITY_PRESETS[merged.quality] || merged.quality === 'Auto' ? merged.quality : DEFAULT_SETTINGS.quality,
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
    touchSteer: merged.touchSteer === 'slider' ? 'slider' : 'arrows',
    uiAccent: UI_ACCENTS[merged.uiAccent] ? merged.uiAccent : DEFAULT_SETTINGS.uiAccent,
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
