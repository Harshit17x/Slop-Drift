// The playable maps. 'alpine' is generated entirely in code; 'mussoorie' is authored in Blender
// (tools/blender/mussoorie) and exported to src/assets/maps/mussoorie.
import { WORLD } from './worldConfig.js';

/**
 * World config for an authored map: the procedural defaults with the parts the map replaces.
 * Roads, terrain and the plaza come from the map data; these numbers only shape carving,
 * erosion, scenery and shading.
 */
const MUSSOORIE_WORLD = Object.freeze({
  ...WORLD,
  seed: 1827,
  map: 'mussoorie',
  mountain: Object.freeze({
    ...WORLD.mountain,
    valleyFloor: 0,
    waterLevel: 30,
    // Mussoorie sits at about 2,000 m: no snow cap, forest up to the top of Lal Tibba.
    snowLine: 100000,
    treeLine: 100000,
    lake: null,
    // Grass on the steep banks between the Nag Tibba switchback legs instead of bare rock:
    // within `radius` of the named plaza, only near-vertical faces stay rock.
    grassBank: Object.freeze({ plaza: 'nagtibba', radius: 600 }),
  }),
  erosion: Object.freeze({ ...WORLD.erosion, droplets: 45000, strength: 0.4 }),
  road: Object.freeze({ ...WORLD.road, halfWidth: 4.2, hairpinExtraWidth: 1.5, sink: 0 }),
  // Displayed altitude in metres: Lal Tibba reads about 2,250 m.
  altitude: Object.freeze({ scale: 1 / 0.55, offset: 1650 }),
});

// The server (Cloudflare Worker) imports this file only for map ids, where import.meta.url may be
// missing; asset URLs are then null instead of throwing at load. The literal new URL(...) form is
// what Vite looks for to bundle the files, so keep it inline.
const HAS_URL = typeof import.meta.url === 'string';

/**
 * Metadata for the homepage map picker. `routes` mirrors the routes World.build makes from each
 * map's roads and is used to count the events that map can run; `preview` is a still drone shot and
 * `clip` a short silent flyover, both captured from the built world in the game.
 */
export const MAPS = Object.freeze({
  mussoorie: Object.freeze({
    id: 'mussoorie',
    label: 'Mussoorie',
    tagline: 'Mall Road, Camel\'s Back and the Landour climb',
    highlights: Object.freeze(['Town streets', 'Landour ridge', 'Nag Tibba hairpins']),
    routes: Object.freeze(['loop', 'climb', 'descent', 'peak', 'peakdown']),
    preview: HAS_URL ? new URL('../assets/maps/previews/mussoorie.jpg', import.meta.url).href : null,
    clip: HAS_URL ? new URL('../assets/maps/previews/mussoorie.mp4', import.meta.url).href : null,
    config: MUSSOORIE_WORLD,
    assets: Object.freeze({
      json: HAS_URL ? new URL('../assets/maps/mussoorie/map.json', import.meta.url).href : null,
      terrain: HAS_URL ? new URL('../assets/maps/mussoorie/terrain.bin', import.meta.url).href : null,
      props: HAS_URL ? new URL('../assets/maps/mussoorie/props.glb', import.meta.url).href : null,
    }),
  }),
  jungle: Object.freeze({
    id: 'jungle', label: 'Monsoon Run',
    tagline: 'A five-kilometre rally through the rainforest',
    highlights: ['Rope bridge · 40 km/h', 'Flood Cut · 110 km/h', 'Cloud Ridge'],
    routes: Object.freeze(['loop']), assets: null,
    preview: HAS_URL ? new URL('../assets/maps/previews/jungle.jpg', import.meta.url).href : null,
    previewAlt: 'A wet rut winds between ferns and overhanging trees on Monsoon Run',
    config: Object.freeze({ ...WORLD, map: 'jungle', seed: 63291,
      grid: Object.freeze({ size: 577, cell: 4 }),
      mountain: Object.freeze({ ...WORLD.mountain, valleyFloor: 0, waterLevel: 4, treeLine: 900, snowLine: 1100, lake: null }),
      road: Object.freeze({ ...WORLD.road, halfWidth: 3.3, hairpinExtraWidth: 0.9, shoulder: 0.55, bedMargin: 6 }),
    }),
  }),
  alpine: Object.freeze({
    id: 'alpine',
    label: 'Alpine Peak',
    tagline: 'The original procedural mountain',
    highlights: Object.freeze(['Snow summit', 'Lakeside loop', 'Open sweepers']),
    routes: Object.freeze(['loop', 'climb', 'descent']),
    preview: HAS_URL ? new URL('../assets/maps/previews/alpine.jpg', import.meta.url).href : null,
    clip: HAS_URL ? new URL('../assets/maps/previews/alpine.mp4', import.meta.url).href : null,
    config: WORLD,
    assets: null,
  }),
});

export const DEFAULT_MAP = 'mussoorie';

export function getMap(id) {
  return MAPS[id] || MAPS[DEFAULT_MAP];
}

/**
 * Turn the exported files into what World.build needs.
 * @param {object} json  Parsed map.json.
 * @param {ArrayBuffer} terrainBuffer  terrain.bin: uint16 heights, rows north to south.
 */
export function parseMapData(json, terrainBuffer) {
  const { size, min, max } = json.grid;
  const raw = new Uint16Array(terrainBuffer);
  if (raw.length !== size * size) throw new Error(`terrain.bin has ${raw.length} samples, expected ${size * size}`);
  const heights = new Float32Array(raw.length);
  const scale = (max - min) / 65535;
  for (let i = 0; i < raw.length; i += 1) heights[i] = min + raw[i] * scale;
  return { ...json, heights };
}

/** Browser loader. Node tests read the files themselves and call parseMapData. */
export async function loadMapData(map) {
  if (!map.assets) return null;
  const [json, terrain] = await Promise.all([
    fetch(map.assets.json).then((response) => {
      if (!response.ok) throw new Error(`map.json: HTTP ${response.status}`);
      return response.json();
    }),
    fetch(map.assets.terrain).then((response) => {
      if (!response.ok) throw new Error(`terrain.bin: HTTP ${response.status}`);
      return response.arrayBuffer();
    }),
  ]);
  return parseMapData(json, terrain);
}
