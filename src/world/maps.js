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
  apex: Object.freeze({
    id:'apex', label:'APEX Grand Prix', tagline:'International Motorsport Park · Forest, ridge and stadium',
    highlights:['Skyline Ridge','Thunder Bowl','Endurance pit lane'],
    routes:['loop','gp','bowl'], assets:null,
    preview: HAS_URL ? new URL('../assets/maps/previews/apex.jpg',import.meta.url).href : null,
    config:{...WORLD,map:'apex',seed:62025,grid:{size:513,cell:8},
      mountain:{...WORLD.mountain,waterLevel:12,valleyFloor:20,snowLine:580,treeLine:470,lake:null},
      road:{...WORLD.road,halfWidth:7,shoulder:5,verge:3,vergeDrop:.14,railOffset:4,railHeight:1.22,
        bedMargin:3,bankGain:5,maxBank:.075}}
  }),
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
  tokyo: Object.freeze({
    id:'tokyo', label:'Tokyo: After Hours', tagline:'東京・深夜 · Neon streets, bay tunnels and rooftop drift',
    highlights:['Shibuya Crossing','B2–7F Midnight Parkade','Minato Tower'],
    routes:['loop','shibuya','express','bay','parkade','parkdown','underground','tour'], assets:null,
    preview: HAS_URL ? new URL('../assets/maps/previews/tokyo.jpg', import.meta.url).href : null,
    config:{...WORLD,map:'tokyo',seed:81086,grid:{size:257,cell:40},
      mountain:{...WORLD.mountain,waterLevel:-30,valleyFloor:0,lake:null},
      road:{...WORLD.road,shoulder:.45,verge:.5,vergeDrop:.12,railHeight:1.4}},
  }),
  fujimi: Object.freeze({
    id: 'fujimi', label: 'Fujimi Rally', tagline: '富士見 · A compact bayside drift and rally course under Mount Fuji',
    highlights: Object.freeze(['Waterfront straight to Fuji', 'Container Snake', '8 clipping zones']),
    routes: Object.freeze(['loop']),
    preview: HAS_URL ? new URL('../assets/maps/previews/fujimi.jpg', import.meta.url).href : null,
    // Authored in Blender (tools/blender/fujimi): the layout is the map data, the GLB is the scenery.
    assets: Object.freeze({
      json: HAS_URL ? new URL('../assets/maps/fujimi/layout.json', import.meta.url).href : null,
      scenery: HAS_URL ? new URL('../assets/maps/fujimi/fujimi.glb', import.meta.url).href : null,
    }),
    config: Object.freeze({ ...WORLD, map: 'fujimi', seed: 2611, grid: Object.freeze({ size: 129, cell: 16 }),
      mountain: Object.freeze({ ...WORLD.mountain, waterLevel: -30, valleyFloor: 0, lake: null }),
      road: Object.freeze({ ...WORLD.road, halfWidth: 7, hairpinExtraWidth: 0, maxBank: 0, shoulder: 0.6, railOffset: 0.55,
        verge: 0.5, vergeDrop: 0.05, railHeight: 1.1 }) }),
  }),
  hollow: Object.freeze({
    id: 'hollow', label: 'Hollow Creek', tagline: 'Three circuits through a town abandoned to the fog',
    highlights: ['Clock Square', 'Signal Tunnel', 'East Wharf'],
    routes: ['loop','quarter','vanishing'], assets: null,
    preview: HAS_URL ? new URL('../assets/maps/previews/hollow.jpg', import.meta.url).href : null,
    config: Object.freeze({...WORLD, map:'hollow',seed:3927,grid:{size:513,cell:6},
      mountain:{...WORLD.mountain,waterLevel:-18,valleyFloor:0,lake:null,snowLine:9999,treeLine:9999},
      road:{...WORLD.road,halfWidth:5.5,shoulder:.7,bedMargin:4}}),
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
    // A flat authored map (Fujimi) has no terrain file: its layout is the whole map data.
    !map.assets.terrain ? null : fetch(map.assets.terrain).then((response) => {
      if (!response.ok) throw new Error(`terrain.bin: HTTP ${response.status}`);
      return response.arrayBuffer();
    }),
  ]);
  return terrain ? parseMapData(json, terrain) : json;
}
