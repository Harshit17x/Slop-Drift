import { SURFACE, SURFACE_PROPS, CONFIG } from '../config.js';
import { clamp, lerp, smoothstep } from '../core/math.js';
import { WORLD } from './worldConfig.js';
import { createRandom } from './noise.js';
import { nextTask as pause } from '../core/yield.js';
import { inWashout, WASHOUT } from './jungleStage.js';
import { buildJungle, onBridge, BRIDGE, wetness } from './Jungle.js';
import { buildHollowCreek } from './HollowCreek.js';
import { MountainShape } from './MountainShape.js';
import { TerrainGrid } from './TerrainGrid.js';
import { Road, gradeLimitedProfile } from './Road.js';
import { buildLoopPlan, buildSpurPlan } from './TrackLayout.js';

const LOOP = 0;
const SPUR = 1;
const PEAK = 2;
// Open roads of an authored map are given ids in this order (after the loop); any other open road follows.
const BRANCH_ORDER = ['spur', 'peak'];
const CORRIDOR_CELL = 8;
const MACRO_STEP = 2; // macro relief is sampled every 2 grid cells (4 m)
const OBSTACLE_CELL = 16;
const MOUTH_LEFT = 1;
const MOUTH_RIGHT = 2;
const PIN_RAMP = 24; // metres over which a branch's climb eases in after its pinned stretch


// Scratch objects reused by the queries so the physics step never allocates.
const scratchLocation = {};
const scratchLocationB = {};
const scratchFrame = {};
const scratchNormal = { nx: 0, ny: 1, nz: 0 };

/**
 * The game world as data: the baked terrain, the road network and every spatial query the
 * vehicle, race logic and scenery need. It has no rendering code and runs unchanged in Node.
 */
export class World {
  /**
   * @param {object} [config]  WORLD, or a map's config from maps.js.
   * @param {object} [mapData]  parseMapData() output for an authored map; null generates the procedural mountain.
   */
  constructor(config = WORLD, mapData = null) {
    this.config = config;
    this.mapData = mapData;
    this.placements = [];
    this.labels = [];
    this.staticObstacles = [];
    this.grid = new TerrainGrid(config.grid);
    this.shape = null;
    this.roads = [];
    this.routes = {};
    /** @type {{id:string, roadId:number, x:number, z:number, y:number, radius:number, label:(string|null)}[]} One per open road, at its end. */
    this.plazas = [];
    /** The spur's plaza (alias of an entry of `plazas`), kept for callers that know only one summit. */
    this.plaza = null;
    /** @type {{roadId:number, s:number}[]} Where each open road leaves the loop (s along the loop). */
    this.junctions = [];
    /** Raised Tokyo service-alley and corner-apron decks, sampled like the pavements. */
    this.tokyoPavements = [];
    /** The spur's junction s on the loop (alias of its `junctions` entry). */
    this.junctionS = 0;
    this.waterLevel = config.mountain.waterLevel;
    this.bounds = { minX: -this.grid.half, maxX: this.grid.half, minZ: -this.grid.half, maxZ: this.grid.half };
    this.summit = { x: 0, y: 0, z: 0 };
    this.obstacleHash = new Map();
    this.built = false;
  }

  /**
   * Generate everything. `onProgress(fraction, label)` is called between stages; the build yields to
   * the event loop at those points so a loading screen can repaint.
   */
  async build(onProgress = () => {}) {
    const config = this.config;
    const stage = async (fraction, label) => {
      onProgress(fraction, label);
      await pause();
    };
    if (config.map === 'tokyo') {
      const { buildTokyo } = await import('./Tokyo.js');
      return buildTokyo(this, stage);
    }
    if (config.map === 'hollow') return buildHollowCreek(this, stage);
    if (config.map === 'jungle') return buildJungle(this, stage);
    if (this.mapData) return this.buildFromMap(stage);

    await stage(0.02, 'Surveying the mountain');
    this.shape = new MountainShape(config.mountain, config.seed);
    const loopPoints = buildLoopPlan(this.shape, config);
    const spurPlan = buildSpurPlan(this.shape, config, loopPoints);
    this.buildCorridorField([loopPoints, spurPlan.points]);

    await stage(0.06, 'Raising the terrain');
    await this.buildMacroField((fraction) => stage(0.06 + fraction * 0.22, 'Raising the terrain'));
    await this.grid.fill((x, z) => this.rawHeight(x, z), (fraction) => stage(0.28 + fraction * 0.22, 'Raising the terrain'));
    this.macro = null;

    await stage(0.52, 'Eroding ridges and gullies');
    this.grid.erode(config.erosion, createRandom(config.seed + 5));

    await stage(0.7, 'Grading the roads');
    this.buildRoads(loopPoints, spurPlan);
    this.flagMouths();

    await stage(0.8, 'Cutting the roadbed');
    this.grid.carve(this.roads, this.plazas, config.road);
    this.flagRails();
    this.buildRoutes();
    this.corridor = null;
    this.built = true;
    await stage(0.9, 'Planting the forest');
    return this;
  }

  /** Build from an authored map (maps.js): its terrain, its loop, every open road and their plazas. */
  async buildFromMap(stage) {
    const config = this.config;
    const data = this.mapData;
    this.waterLevel = data.waterLevel ?? config.mountain.waterLevel;

    await stage(0.05, 'Reading the survey');
    const source = data.grid;
    const sourceHalf = ((source.size - 1) * source.cell) / 2;
    const heights = data.heights;
    const sampleSource = (x, z) => {
      const gx = clamp((x + sourceHalf) / source.cell, 0, source.size - 1.001);
      const gz = clamp((z + sourceHalf) / source.cell, 0, source.size - 1.001);
      const ix = gx | 0;
      const iz = gz | 0;
      const fx = gx - ix;
      const fz = gz - iz;
      const node = iz * source.size + ix;
      const top = heights[node] + (heights[node + 1] - heights[node]) * fx;
      const bottom = heights[node + source.size] + (heights[node + source.size + 1] - heights[node + source.size]) * fx;
      return top + (bottom - top) * fz;
    };
    await this.grid.fill(sampleSource, (fraction) => stage(0.08 + fraction * 0.3, 'Raising the terrain'));

    await stage(0.4, 'Eroding ridges and gullies');
    if (config.erosion.droplets > 0) this.grid.erode(config.erosion, createRandom(config.seed + 5));

    await stage(0.62, 'Grading the roads');
    this.buildMapRoads(data);
    this.flagMouths();

    await stage(0.78, 'Cutting the roadbed');
    this.grid.carve(this.roads, this.plazas, config.road);
    this.flagRails();
    this.buildRoutes();

    this.labels = (data.labels || []).map((label) => ({ ...label }));
    // A named plaza the map does not already label gets one, so every summit reads on the map.
    for (const plaza of this.plazas) {
      if (!plaza.label) continue;
      const name = plaza.label.toLowerCase();
      if (!this.labels.some((label) => String(label.name).toLowerCase() === name)) this.labels.push({ name: plaza.label, x: plaza.x, z: plaza.z });
    }
    // Footprints: w along the building's local x, d along its local depth, both turned by yaw.
    // A building moved onto a road in Blender is dropped rather than left to block it.
    this.placements = [];
    this.staticObstacles = [];
    for (const source of data.placements || []) {
      const placement = { ...source, w: source.w ?? 8, d: source.d ?? 8 };
      placement.radius = Math.hypot(placement.w, placement.d) / 2;
      let blocked = false;
      for (const current of this.roads) {
        if (current.locate(placement.x, placement.z, scratchLocation) && !scratchLocation.beyondEnd
          && scratchLocation.distance < Math.min(placement.w, placement.d) / 2 + scratchLocation.halfWidth + config.road.shoulder) blocked = true;
      }
      if (blocked) continue;
      this.placements.push(placement);
      // Solid as a row of circles along the long axis.
      const along = placement.w >= placement.d;
      const length = along ? placement.w : placement.d;
      const radius = (along ? placement.d : placement.w) / 2;
      const ax = along ? Math.cos(placement.yaw) : -Math.sin(placement.yaw);
      const az = along ? -Math.sin(placement.yaw) : -Math.cos(placement.yaw);
      const circles = Math.max(1, Math.ceil(length / (radius * 2)));
      for (let k = 0; k < circles; k += 1) {
        const offset = circles === 1 ? 0 : -length / 2 + radius + ((length - radius * 2) * k) / (circles - 1);
        this.staticObstacles.push(placement.x + ax * offset, placement.z + az * offset, radius * 0.96);
      }
    }
    this.setObstacles([]);
    this.built = true;
    await stage(0.9, 'Planting the forest');
    return this;
  }

  /** Resample an exported polyline (x, z pairs plus heights) to the road spacing. */
  static resamplePolyline(flat, heights, closed, spacing) {
    const count = heights.length;
    const xs = [];
    const zs = [];
    const ys = [];
    for (let i = 0; i < count; i += 1) {
      xs.push(flat[i * 2]);
      zs.push(flat[i * 2 + 1]);
      ys.push(heights[i]);
    }
    if (closed) {
      xs.push(xs[0]);
      zs.push(zs[0]);
      ys.push(ys[0]);
    }
    const cumulative = [0];
    for (let i = 1; i < xs.length; i += 1) cumulative.push(cumulative[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
    const total = cumulative[cumulative.length - 1];
    const samples = closed ? Math.max(8, Math.round(total / spacing)) : Math.max(2, Math.round(total / spacing) + 1);
    const step = closed ? total / samples : total / (samples - 1);
    const points = [];
    const profile = new Float32Array(samples);
    let segment = 0;
    for (let k = 0; k < samples; k += 1) {
      const s = Math.min(total, k * step);
      while (segment < cumulative.length - 2 && cumulative[segment + 1] < s) segment += 1;
      const span = cumulative[segment + 1] - cumulative[segment] || 1;
      const t = clamp((s - cumulative[segment]) / span, 0, 1);
      points.push([lerp(xs[segment], xs[segment + 1], t), lerp(zs[segment], zs[segment + 1], t)]);
      profile[k] = lerp(ys[segment], ys[segment + 1], t);
    }
    // The export is a 4 m polyline; linear resampling leaves its corners as curvature spikes.
    for (let pass = 0; pass < 4; pass += 1) {
      const previous = points.map((point) => point.slice());
      for (let k = 0; k < samples; k += 1) {
        if (!closed && (k === 0 || k === samples - 1)) continue;
        const a = previous[(k - 1 + samples) % samples];
        const b = previous[(k + 1) % samples];
        points[k][0] = (a[0] + 2 * previous[k][0] + b[0]) / 4;
        points[k][1] = (a[1] + 2 * previous[k][1] + b[1]) / 4;
      }
    }
    return { points, profile };
  }

  /**
   * The loop and every open road of an authored map. Road ids are array indices: the loop is LOOP,
   * then the open roads in BRANCH_ORDER ('spur' = SPUR, 'peak' = PEAK), then any others in file order.
   * Each open road starts on the loop and ends at its plaza.
   */
  buildMapRoads(data) {
    const config = this.config;
    const road = config.road;
    const spacing = road.spacing;
    const loopData = data.roads.find((entry) => entry.name === 'loop') || data.roads.find((entry) => entry.closed);
    const rank = (entry) => {
      const index = BRANCH_ORDER.indexOf(entry.name);
      return index < 0 ? BRANCH_ORDER.length : index;
    };
    const branchData = data.roads.filter((entry) => entry !== loopData && !entry.closed)
      .map((entry, order) => ({ entry, order }))
      .sort((a, b) => rank(a.entry) - rank(b.entry) || a.order - b.order)
      .map(({ entry }) => entry);

    const loopSampled = World.resamplePolyline(loopData.points, loopData.heights, true, spacing);
    const loopPoints = loopSampled.points;
    const loopHeights = gradeLimitedProfile(loopSampled.profile, spacing, road.maxGrade, true);

    // Every open road starts on the loop. Find where, so each fork is kept flat and unbanked on the loop.
    const branches = branchData.map((entry) => {
      const sampled = World.resamplePolyline(entry.points, entry.heights, false, spacing);
      const first = sampled.points[0];
      let junctionIndex = 0;
      let nearest = Infinity;
      for (let i = 0; i < loopPoints.length; i += 1) {
        const d = Math.hypot(loopPoints[i][0] - first[0], loopPoints[i][1] - first[1]);
        if (d < nearest) {
          nearest = d;
          junctionIndex = i;
        }
      }
      return { entry, sampled, junctionIndex };
    });
    const loopFlatten = new Float32Array(loopPoints.length);
    for (let i = 0; i < loopPoints.length; i += 1) {
      let flat = 0;
      for (const branch of branches) {
        let offset = Math.abs(i - branch.junctionIndex);
        offset = Math.min(offset, loopPoints.length - offset) * spacing;
        flat = Math.max(flat, 1 - smoothstep(85, 130, offset));
      }
      loopFlatten[i] = flat;
    }
    const loop = new Road({ id: LOOP, name: 'loop', closed: true, points: loopPoints, heights: loopHeights, config: road, flatten: loopFlatten });

    this.roads = [loop];
    this.plazas = [];
    this.junctions = [];
    for (const branch of branches) {
      const id = this.roads.length;
      const { entry, sampled, junctionIndex } = branch;
      const built = this.buildMapBranch(loop, id, entry.name, sampled, junctionIndex);
      this.roads.push(built.road);
      const source = World.plazaSource(data, entry, branches.length);
      const last = sampled.points[sampled.points.length - 1];
      this.plazas.push({
        id: String(source?.id ?? (entry.name === 'spur' ? 'summit' : entry.name)),
        roadId: id,
        x: source ? source.x : last[0],
        z: source ? source.z : last[1],
        y: built.plazaY,
        radius: source?.radius ?? config.spur.plazaRadius,
        label: source?.label ?? null,
      });
      this.junctions.push({ roadId: id, s: junctionIndex * loop.spacing });
    }
    this.setPlazaAliases();
  }

  /** The map.json plaza for an open road: its `plazas` entry, else the legacy single `plaza` for the spur. */
  static plazaSource(data, entry, branchCount) {
    const listed = Array.isArray(data.plazas) ? data.plazas.find((plaza) => plaza.road === entry.name) : null;
    if (listed) return listed;
    if (data.plaza && (entry.name === 'spur' || branchCount === 1)) return data.plaza;
    return null;
  }

  /** Point `plaza`, `summit` and `junctionS` at the spur's entries (or the first open road's). */
  setPlazaAliases() {
    this.plaza = this.plazas.find((plaza) => plaza.roadId === SPUR) || this.plazas[0] || null;
    const junction = this.junctions.find((entry) => entry.roadId === SPUR) || this.junctions[0];
    this.junctionS = junction ? junction.s : 0;
    // The summit is the highest plaza.
    let top = null;
    for (const plaza of this.plazas) if (!top || plaza.y > top.y) top = plaza;
    this.summit = top ? { x: top.x, y: top.y, z: top.z } : { x: 0, y: 0, z: 0 };
  }

  /**
   * One open road of an authored map: resampled `sampled` ({points, profile}), the approach to its
   * plaza levelled, grade-limited, and pinned to the loop through its fork at `junctionIndex`.
   * @returns {{road: Road, plazaY: number}}
   */
  buildMapBranch(loop, id, name, sampled, junctionIndex) {
    const road = this.config.road;
    const spacing = road.spacing;
    const points = sampled.points;

    // Level the approach to the plaza before grading, so the road arrives flat instead of being
    // squeezed level in its last few metres. Likewise ease the departure into the loop's height, so
    // an export that starts above or below the graded loop does not leave a kink at the fork.
    const raw = sampled.profile;
    const rawLength = (raw.length - 1) * spacing;
    const arrival = raw[Math.max(0, Math.round((rawLength - 110) / spacing))];
    for (let i = 0; i < raw.length; i += 1) raw[i] = lerp(raw[i], arrival, smoothstep(rawLength - 150, rawLength - 70, i * spacing));
    if (loop.locate(points[0][0], points[0][1], scratchLocation)) {
      const departure = scratchLocation.y;
      for (let i = 0; i < raw.length; i += 1) raw[i] = lerp(departure, raw[i], smoothstep(0, 80, i * spacing));
    }
    const own = gradeLimitedProfile(raw, spacing, road.maxGrade, false);
    const heights = this.pinSpurToLoop(loop, points, own, junctionIndex);
    const plazaY = heights[heights.length - 1];
    const count = points.length;
    const length = (count - 1) * spacing;
    const flatten = new Float32Array(count);
    const pinnedLength = this.lastPinnedLength;
    for (let i = 0; i < count; i += 1) {
      const s = i * spacing;
      flatten[i] = Math.max(1 - smoothstep(pinnedLength + 60, pinnedLength + 120, s), smoothstep(length - 70, length - 30, s));
    }
    const branch = new Road({ id, name, closed: false, points, heights, config: road, flatten });
    this.matchForkCrossSlope(loop, branch, this.lastHeldLength);
    return { road: branch, plazaY };
  }

  /**
   * Where an open road crosses the loop's asphalt its surface must be the loop's surface. Along its
   * own centreline pinSpurToLoop guarantees that; across it, tilt the branch (its `bank`) to the
   * slope the loop has in that direction, easing back to the branch's own banking once clear. A road
   * leaving a climbing loop at a right angle needs this; for a shallow fork the tilt is near zero.
   */
  matchForkCrossSlope(loop, branch, heldLength) {
    const fade = 24;
    for (let i = 0; i < branch.count; i += 1) {
      const s = i * branch.spacing;
      if (s > heldLength + fade) break;
      if (!loop.locate(branch.px[i], branch.pz[i], scratchLocation)) continue;
      // Loop height changes by grade along its tangent (rz, -rx) and by bank along its right.
      const alongLoop = scratchLocation.rz * branch.rx[i] - scratchLocation.rx * branch.rz[i];
      const acrossLoop = scratchLocation.rx * branch.rx[i] + scratchLocation.rz * branch.rz[i];
      const tilt = scratchLocation.grade * alongLoop + scratchLocation.bank * acrossLoop;
      branch.bank[i] = lerp(tilt, branch.bank[i], smoothstep(heldLength, heldLength + fade, s));
    }
  }

  /**
   * Through the fork the two asphalt surfaces overlap, so the spur copies the loop's height until
   * they are clear of each other, then climbs at the grade limit until it rejoins its own profile,
   * and the kink where the pinned stretch ends is rounded off. The rounding never reaches back onto
   * the loop's asphalt and shoulder, so a road that leaves the loop at a right angle (whose pinned
   * stretch is short) still meets it flush. The last metres are levelled with wherever the graded
   * road arrives (the plaza). Sets this.lastPinnedLength.
   */
  pinSpurToLoop(loop, spurPoints, own, junctionIndex) {
    const road = this.config.road;
    const spacing = road.spacing;
    const count = spurPoints.length;
    const spurLength = (count - 1) * spacing;
    const plazaY = own[count - 1];
    const spurHeights = new Float32Array(count);
    const clearSeparation = loop.halfWidth[junctionIndex] * 2 + road.shoulder * 2 + 6;
    const onLoop = loop.halfWidth[junctionIndex] + road.shoulder;
    let pinnedUntil = 0;
    let heldUntil = 0;
    for (let i = 0; i < count; i += 1) {
      const s = i * spacing;
      spurHeights[i] = own[i];
      if (s > 320 || !loop.locate(spurPoints[i][0], spurPoints[i][1], scratchLocation)) continue;
      if (scratchLocation.distance < clearSeparation && i === pinnedUntil) {
        spurHeights[i] = scratchLocation.y;
        pinnedUntil = i + 1;
        if (scratchLocation.distance < onLoop && i === heldUntil) heldUntil = i + 1;
      }
    }
    // The climb away from the pinned stretch eases in over RAMP metres (a vertical curve), so the
    // grade never steps where the pin ends.
    const maxStep = road.maxGrade * spacing * 0.9;
    const pinnedLength = pinnedUntil * spacing;
    for (let i = Math.max(1, pinnedUntil); i < count; i += 1) {
      const step = maxStep * Math.max(0.05, smoothstep(0, PIN_RAMP, i * spacing - pinnedLength));
      const limited = clamp(own[i], spurHeights[i - 1] - step, spurHeights[i - 1] + step);
      spurHeights[i] = limited;
      if (limited === own[i] && i > pinnedUntil + 40) break;
    }
    // Round off what is left of the kink, but never on the loop's own asphalt and shoulder.
    const pinnedHeights = spurHeights.slice();
    const eased = gradeLimitedProfile(spurHeights, spacing, road.maxGrade * 1.15, false, 20);
    const easeFrom = Math.max(pinnedLength - 36, heldUntil * spacing);
    const easeTo = Math.max(pinnedLength - 2, easeFrom + 20);
    for (let i = 0; i < count; i += 1) {
      const s = i * spacing;
      spurHeights[i] = lerp(pinnedHeights[i], eased[i], smoothstep(easeFrom, easeTo, s));
    }
    for (let i = 0; i < count; i += 1) spurHeights[i] = lerp(spurHeights[i], plazaY, smoothstep(spurLength - 46, spurLength - 24, i * spacing));
    this.lastPinnedLength = pinnedLength;
    this.lastHeldLength = heldUntil * spacing;
    return spurHeights;
  }

  // ---------------------------------------------------------------- generation

  /** Coarse field of distance to the nearest road, used to calm the terrain along road corridors. */
  buildCorridorField(paths) {
    const size = Math.ceil((this.grid.half * 2) / CORRIDOR_CELL) + 1;
    const field = new Float32Array(size * size).fill(1e6);
    const fade = this.config.road.corridorFade;
    const reach = Math.ceil(fade / CORRIDOR_CELL) + 1;
    const half = this.grid.half;
    for (const points of paths) {
      for (let p = 0; p < points.length; p += 2) {
        const x = points[p][0];
        const z = points[p][1];
        const cx = Math.round((x + half) / CORRIDOR_CELL);
        const cz = Math.round((z + half) / CORRIDOR_CELL);
        for (let iz = Math.max(0, cz - reach); iz <= Math.min(size - 1, cz + reach); iz += 1) {
          const dz = iz * CORRIDOR_CELL - half - z;
          for (let ix = Math.max(0, cx - reach); ix <= Math.min(size - 1, cx + reach); ix += 1) {
            const dx = ix * CORRIDOR_CELL - half - x;
            const distance = Math.sqrt(dx * dx + dz * dz);
            const node = iz * size + ix;
            if (distance < field[node]) field[node] = distance;
          }
        }
      }
    }
    this.corridor = { field, size };
  }

  corridorDistance(x, z) {
    const { field, size } = this.corridor;
    const gx = clamp((x + this.grid.half) / CORRIDOR_CELL, 0, size - 1.001);
    const gz = clamp((z + this.grid.half) / CORRIDOR_CELL, 0, size - 1.001);
    const ix = gx | 0;
    const iz = gz | 0;
    const fx = gx - ix;
    const fz = gz - iz;
    const node = iz * size + ix;
    const top = field[node] + (field[node + 1] - field[node]) * fx;
    const bottom = field[node + size] + (field[node + size + 1] - field[node + size]) * fx;
    return top + (bottom - top) * fz;
  }

  /**
   * The ridges and eroded relief are 100 m-scale features but cost most of the generation time, so
   * they are evaluated every MACRO_STEP grid cells (already faded out along road corridors) and
   * interpolated. Fine ground texture and erosion still run at full resolution.
   */
  async buildMacroField(pause) {
    const grid = this.grid;
    const size = Math.ceil((grid.size - 1) / MACRO_STEP) + 1;
    const cell = grid.cell * MACRO_STEP;
    const values = new Float32Array(size * size);
    const road = this.config.road;
    for (let iz = 0; iz < size; iz += 1) {
      const z = iz * cell - grid.half;
      for (let ix = 0; ix < size; ix += 1) {
        const x = ix * cell - grid.half;
        const keep = smoothstep(road.corridorClear, road.corridorFade, this.corridorDistance(x, z));
        values[iz * size + ix] = keep > 0 ? this.shape.macroDetail(x, z) * keep : 0;
      }
      if (pause && iz % 64 === 63) await pause(iz / size);
    }
    this.macro = { values, size, cell };
  }

  macroAt(x, z) {
    const { values, size, cell } = this.macro;
    const gx = clamp((x + this.grid.half) / cell, 0, size - 1.001);
    const gz = clamp((z + this.grid.half) / cell, 0, size - 1.001);
    const ix = gx | 0;
    const iz = gz | 0;
    const fx = gx - ix;
    const fz = gz - iz;
    const node = iz * size + ix;
    const top = values[node] + (values[node + 1] - values[node]) * fx;
    const bottom = values[node + size] + (values[node + size + 1] - values[node + size]) * fx;
    return top + (bottom - top) * fz;
  }

  /** Terrain height before erosion and road carving. */
  rawHeight(x, z) {
    const height = this.shape.base(x, z) + this.shape.fixedDetail(x, z);
    if (this.macro) return height + this.macroAt(x, z);
    const road = this.config.road;
    const keep = smoothstep(road.corridorClear, road.corridorFade, this.corridorDistance(x, z));
    return keep > 0 ? height + this.shape.macroDetail(x, z) * keep : height;
  }

  buildRoads(loopPoints, spurPlan) {
    const config = this.config;
    const road = config.road;
    const spacing = road.spacing;

    // Loop: follow the smooth base (the layout sits on its contours), sunk slightly so it runs in cut.
    const loopRaw = new Float32Array(loopPoints.length);
    for (let i = 0; i < loopPoints.length; i += 1) loopRaw[i] = this.shape.base(loopPoints[i][0], loopPoints[i][1]) - road.sink;
    const loopHeights = gradeLimitedProfile(loopRaw, spacing, road.maxGrade, true);
    // No banking or widening through the fork, so the two road surfaces coincide where they overlap.
    const loopFlatten = new Float32Array(loopPoints.length);
    const forkCentre = spurPlan.junctionIndex + Math.round(55 / spacing);
    for (let i = 0; i < loopPoints.length; i += 1) {
      let offset = Math.abs(i - forkCentre);
      offset = Math.min(offset, loopPoints.length - offset) * spacing;
      loopFlatten[i] = 1 - smoothstep(85, 130, offset);
    }
    const loop = new Road({ id: LOOP, name: 'loop', closed: true, points: loopPoints, heights: loopHeights, config: road, flatten: loopFlatten });

    // Spur: own profile, pinned to the loop surface through the fork and to the plaza at the top.
    const spurPoints = spurPlan.points;
    const count = spurPoints.length;
    const plazaTarget = this.shape.base(0, 0) - 7.5;
    const spurLength = (count - 1) * spacing;
    const spurRaw = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const s = i * spacing;
      const natural = this.shape.base(spurPoints[i][0], spurPoints[i][1]) - road.sink;
      spurRaw[i] = lerp(natural, plazaTarget, smoothstep(spurLength - 150, spurLength - 70, s));
    }
    const own = gradeLimitedProfile(spurRaw, spacing, road.maxGrade, false);
    // The plaza sits wherever the graded road actually arrives, so the last metres are level with it.
    const plazaY = own[count - 1];
    // Through the fork the two asphalt surfaces overlap, so the spur copies the loop's height until
    // they are clear of each other, then climbs at the grade limit until it rejoins its own profile.
    const spurHeights = new Float32Array(count);
    const clearSeparation = loop.halfWidth[spurPlan.junctionIndex] * 2 + road.shoulder * 2 + 6;
    let pinnedUntil = 0;
    for (let i = 0; i < count; i += 1) {
      const s = i * spacing;
      spurHeights[i] = own[i];
      if (s > 320 || !loop.locate(spurPoints[i][0], spurPoints[i][1], scratchLocation)) continue;
      if (scratchLocation.distance < clearSeparation && i === pinnedUntil) {
        spurHeights[i] = scratchLocation.y;
        pinnedUntil = i + 1;
      }
    }
    const maxStep = road.maxGrade * spacing * 0.9;
    for (let i = pinnedUntil; i < count; i += 1) {
      const limited = clamp(own[i], spurHeights[i - 1] - maxStep, spurHeights[i - 1] + maxStep);
      spurHeights[i] = limited;
      if (limited === own[i] && i > pinnedUntil + 40) break;
    }
    // Round off the kink where the pinned stretch ends. The blend starts once the asphalt edges are
    // already apart, so the two surfaces still agree wherever a wheel could be on both.
    const pinnedHeights = spurHeights.slice();
    const eased = gradeLimitedProfile(spurHeights, spacing, road.maxGrade * 1.15, false, 20);
    const pinnedLength = pinnedUntil * spacing;
    const spurFlatten = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const s = i * spacing;
      spurHeights[i] = lerp(pinnedHeights[i], eased[i], smoothstep(pinnedLength - 36, pinnedLength - 2, s));
      spurFlatten[i] = Math.max(1 - smoothstep(pinnedLength + 60, pinnedLength + 120, s), smoothstep(spurLength - 70, spurLength - 30, s));
    }
    for (let i = 0; i < count; i += 1) spurHeights[i] = lerp(spurHeights[i], plazaY, smoothstep(spurLength - 46, spurLength - 24, i * spacing));
    const spur = new Road({ id: SPUR, name: 'spur', closed: false, points: spurPoints, heights: spurHeights, config: road, flatten: spurFlatten });

    this.roads = [loop, spur];
    this.plazas = [{ id: 'summit', roadId: SPUR, x: 0, z: 0, y: plazaY, radius: config.spur.plazaRadius, label: null }];
    this.junctions = [{ roadId: SPUR, s: spurPlan.junctionIndex * loop.spacing }];
    this.setPlazaAliases();
  }

  /** Mark where open roads merge into the loop or a plaza (no rails, verge or edge lines on those sides). */
  flagMouths() {
    const loop = this.roads[LOOP];
    const plazas = this.plazas;
    for (let r = 0; r < this.roads.length; r += 1) {
      const branch = this.roads[r];
      if (r === LOOP || branch.closed) continue;
      for (let i = 0; i < branch.count; i += 1) {
        const s = i * branch.spacing;
        if (s < 260 && loop.locate(branch.px[i], branch.pz[i], scratchLocation)) {
          const near = scratchLocation.u < 0.5 ? scratchLocation.index : (scratchLocation.index + 1) % loop.count;
          if (scratchLocation.distance < loop.ribbonHalfAt(near) + branch.ribbonHalfAt(i) + 1.5) {
            branch.mouth[i] = MOUTH_LEFT | MOUTH_RIGHT;
            const side = scratchLocation.lateral < 0 ? MOUTH_LEFT : MOUTH_RIGHT;
            for (let k = -4; k <= 4; k += 1) loop.mouth[(near + k + loop.count) % loop.count] |= side;
          }
        }
        for (const plaza of plazas) {
          if (Math.hypot(branch.px[i] - plaza.x, branch.pz[i] - plaza.z) < plaza.radius + branch.ribbonHalfAt(i) + 2) {
            branch.mouth[i] = MOUTH_LEFT | MOUTH_RIGHT;
          }
        }
      }
    }
  }

  /** Guardrail a side wherever the carved ground just beyond the bed drops away, and around tight corners. */
  flagRails() {
    const road = this.config.road;
    for (const current of this.roads) {
      const sides = [
        { sign: -1, flags: current.railLeft, bit: MOUTH_LEFT },
        { sign: 1, flags: current.railRight, bit: MOUTH_RIGHT },
      ];
      for (const side of sides) {
        const wanted = new Uint8Array(current.count);
        for (let i = 0; i < current.count; i += 1) {
          const reach = current.ribbonHalfAt(i) + road.bedMargin + 4;
          const natural = this.grid.heightAt(current.px[i] + current.rx[i] * side.sign * reach, current.pz[i] + current.rz[i] * side.sign * reach);
          const tight = Math.abs(current.curvature[i]) > 1 / 45;
          wanted[i] = current.py[i] - natural > road.railDropThreshold || tight ? 1 : 0;
        }
        // Extend each run a little and close short gaps so rails read as continuous barriers.
        const grow = Math.round(12 / current.spacing);
        for (let i = 0; i < current.count; i += 1) {
          if (!wanted[i]) continue;
          for (let k = -grow; k <= grow; k += 1) {
            let j = i + k;
            if (current.closed) j = (j + current.count) % current.count;
            else if (j < 0 || j >= current.count) continue;
            side.flags[j] = 1;
          }
        }
        for (let i = 0; i < current.count; i += 1) if (current.mouth[i] & side.bit) side.flags[i] = 0;
      }
    }
  }

  /**
   * Routes: 'loop' always; 'climb' / 'descent' on the spur; 'peak' / 'peakdown' only when the map
   * has a PEAK road. Modes whose route is missing are not offered (config.js modesForWorld).
   */
  buildRoutes() {
    const loop = this.roads[LOOP];
    const gateSpacing = CONFIG.race.checkpointSpacing;
    const gatesBetween = (from, to, direction, length, closed) => {
      const span = closed ? length : Math.abs(to - from);
      const count = Math.max(2, Math.round(span / gateSpacing));
      const gates = [];
      for (let k = 1; k < count; k += 1) {
        let s = from + direction * (span * k) / count;
        if (closed) s = ((s % length) + length) % length;
        gates.push(s);
      }
      return gates;
    };
    const loopStart = 40;
    this.routes = {
      loop: {
        id: 'loop', roadId: LOOP, closed: true, direction: 1, startS: loopStart, finishS: loopStart, length: loop.length,
        checkpoints: gatesBetween(loopStart, loopStart, 1, loop.length, true),
      },
    };
    // Up from just past the fork to just short of the plaza, and back down.
    const branchRoutes = (roadId, upId, downId) => {
      const branch = this.roads[roadId];
      if (!branch || branch.closed) return;
      const start = 190;
      const finish = branch.length - 58;
      if (finish - start < 100) return; // too short to race on
      this.routes[upId] = {
        id: upId, roadId, closed: false, direction: 1, startS: start, finishS: finish, length: finish - start,
        checkpoints: gatesBetween(start, finish, 1, branch.length, false),
      };
      this.routes[downId] = {
        id: downId, roadId, closed: false, direction: -1, startS: finish, finishS: start, length: finish - start,
        checkpoints: gatesBetween(finish, start, -1, branch.length, false),
      };
    };
    branchRoutes(SPUR, 'climb', 'descent');
    branchRoutes(PEAK, 'peak', 'peakdown');
  }

  // ---------------------------------------------------------------- queries

  /** Height of whatever the car would drive on at (x, z). */
  waterAt(x,z) {
    if(this.creek && ((x-this.creek.x)/98)**2+((z-this.creek.z)/86)**2<1)return this.creek.y;
    return this.waterLevel;
  }

  heightAt(x, z, referenceY) {
    return this.sampleGround(x, z, scratchGround, referenceY).y;
  }

  /** @returns {import('../core/contracts.js').GroundSample} */
  sampleGround(x, z, out, referenceY = 0) {
    const dock=this.dock;
    if(dock){
      const dx=x-dock.x,dz=z-dock.z,along=-(dx*dock.rx+dz*dock.rz);
      if(along>-.35 && along<21 && Math.abs(dx*dock.tx+dz*dock.tz)<1.68){
        Object.assign(out,{y:dock.y+.115,nx:0,ny:1,nz:0,surface:SURFACE.WOOD,roadId:-1,...SURFACE_PROPS[SURFACE.WOOD]});
        return out;
      }
    }
    const road = this.config.road;
    const tokyoStreet = this.config.map === 'tokyo';
    let bestClass = 9;
    let bestY = 0;
    let bestSurface = SURFACE.GRASS;
    let gradX = 0;
    let gradZ = 0;
    let bestRoad = -1;
    let roadSurface = SURFACE.ASPHALT;
    let wet = 0;
    for (let r = 0; r < this.roads.length; r += 1) {
      const current = this.roads[r];
      if (!current.locate(x, z, scratchLocation, this.layered ? referenceY : undefined) || scratchLocation.beyondEnd) continue;
      if (this.layered && scratchLocation.y > referenceY + 1.65) continue;
      const halfWidth = scratchLocation.halfWidth;
      const a = scratchLocation.distance;
      // Tokyo's street blocks sit on a raised pavement platform. Carry wheel
      // contact across the full sidewalk instead of dropping onto the -0.35 m
      // city fill that is only visible inside unbuilt lots.
      const pavement = tokyoStreet && current.id !== 4 && current.id !== 5 &&
        current !== this.gymkhana && Math.abs(scratchLocation.y) < 1.45;
      const reach = pavement ? Math.max(current.vergeEdge, 4.82) : current.vergeEdge;
      if (a > halfWidth + reach) continue;
      const side = scratchLocation.lateral < 0 ? -1 : 1;
      const offset = current.profileAt(a, halfWidth);
      let surfaceClass = a <= halfWidth ? 0 : a <= halfWidth + current.shoulderEdge ? 1 : 2;
      let y = scratchLocation.y + side * a * scratchLocation.bank + offset;
      const veranda = pavement && a > halfWidth + 0.2;
      if (veranda) {
        // The slab spans curb + 0.2 m to curb + 4.8 m and is 0.155 m above
        // the carriageway; past its outer face the city fill takes over.
        y = scratchLocation.y + side * a * scratchLocation.bank + 0.155;
        surfaceClass = 1;
      }
      if (this.bridge) {
        if (inWashout(scratchLocation.s)) continue;
        if (this.washout.missed && scratchLocation.s >= WASHOUT.bank && scratchLocation.s < WASHOUT.bank + 8) {
          // Keep a short landing from colliding with the top of the cut before recovery.
          y = this.washout.bankY - 8;
        }
        if (onBridge(scratchLocation.s)) {
          if (this.bridge.broken || a > BRIDGE.halfWidth) continue;
          y += this.bridge.displacement(scratchLocation.s);
          roadSurface = SURFACE.WOOD;
        } else {
          wet = wetness(scratchLocation.s, scratchLocation.lateral, scratchLocation.curvature);
          roadSurface = wet > 0.38 ? SURFACE.MUD : SURFACE.HARDPACK;
        }
      }
      // The verge is soft ground: where another road's bed has been cut higher, the ground wins.
      if (surfaceClass === 2 && !this.layered) y = Math.max(y, this.grid.heightAt(x, z));
      // A lower crossing must never take a tyre off the shoulder of an upper deck.
      const differentDeck = this.layered && bestClass < 9 && Math.abs(y-bestY) > 1.65;
      // At a merge gore two carriageways overlap within a few centimetres of
      // each other. Always taking the higher one made a level street snap onto
      // the rising on-ramp lip as it passed beneath. On stacked maps keep the
      // deck closest to the caller's current height instead; a car already on
      // the ramp still climbs it, while traffic staying on the parent road
      // stays level. Flat maps keep the original higher-wins rule.
      const currentPick = differentDeck ? y > bestY
        : surfaceClass < bestClass ? true
          : surfaceClass > bestClass ? false
            : this.layered
              ? Math.abs(y - referenceY) < Math.abs(bestY - referenceY) - 0.01
              : y > bestY;
      if (currentPick) {
        bestClass = surfaceClass;
        bestY = y;
        bestRoad = r;
        if (this.config.map === 'hollow') {
          roadSurface = r === 9 ? SURFACE.DIRT : r === 2
            ? (scratchLocation.s>=1830 && scratchLocation.s<1870 ? SURFACE.WOOD : scratchLocation.s > 3310 && scratchLocation.s < 3480 ? SURFACE.MUD : SURFACE.GRAVEL)
            : r === 1 ? SURFACE.COBBLE : SURFACE.ASPHALT;
        }
        bestSurface = veranda ? SURFACE.HARDPACK : surfaceClass === 0 ? roadSurface
          : surfaceClass === 1 ? SURFACE.GRAVEL : SURFACE.GRASS;
        const lateralSlope = veranda ? 0 : scratchLocation.bank + side * Road.profileSlope;
        // Horizontal tangent is (rz, -rx); height gradient = grade * tangent + lateralSlope * right.
        gradX = scratchLocation.grade * scratchLocation.rz + lateralSlope * scratchLocation.rx;
        gradZ = -scratchLocation.grade * scratchLocation.rx + lateralSlope * scratchLocation.rz;
      }
    }

    // Tokyo service alleys and corner aprons are raised platforms too. They sit
    // outside the road corridors, so only claim the sample when no carriageway
    // already won it, and never lift a car that is on a higher deck.
    const pavements = this.tokyoPavements;
    if (pavements && pavements.length && bestClass > 1) {
      for (let p = 0; p < pavements.length; p += 1) {
        const pave = pavements[p];
        if (pave.y > referenceY + 1.65) continue;
        const dx = x - pave.x;
        const dz = z - pave.z;
        if (Math.abs(dx * pave.tx + dz * pave.tz) > pave.hl) continue;
        if (Math.abs(-dx * pave.tz + dz * pave.tx) > pave.hw) continue;
        bestClass = 1;
        bestY = pave.y;
        bestRoad = -1;
        bestSurface = SURFACE.HARDPACK;
        gradX = 0;
        gradZ = 0;
        break;
      }
    }

    const plazas = this.plazas;
    for (let p = 0; p < plazas.length; p += 1) {
      const plaza = plazas[p];
      const dx = x - plaza.x;
      const dz = z - plaza.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance <= plaza.radius + road.verge) {
        const beyond = Math.max(0, distance - plaza.radius);
        const surfaceClass = beyond > 0 ? 2 : 0;
        const y = plaza.y - (road.vergeDrop * beyond) / road.verge;
        if (surfaceClass < bestClass || (surfaceClass === bestClass && y > bestY)) {
          bestClass = surfaceClass;
          bestY = y;
          bestRoad = plaza.roadId;
          bestSurface = surfaceClass === 0 ? SURFACE.ASPHALT : SURFACE.GRASS;
          const slope = beyond > 0 && distance > 0 ? -road.vergeDrop / road.verge / distance : 0;
          gradX = dx * slope;
          gradZ = dz * slope;
        }
      }
    }

    if (bestClass < 9) {
      const inverse = 1 / Math.sqrt(gradX * gradX + gradZ * gradZ + 1);
      const surface = bestSurface;
      const props = SURFACE_PROPS[surface];
      out.y = bestY;
      out.nx = -gradX * inverse;
      out.ny = inverse;
      out.nz = -gradZ * inverse;
      out.surface = surface;
      out.grip = props.grip * (1 - 0.43 * wet);
      out.rolling = props.rolling * (1 + wet);
      out.roughness = props.roughness;
      out.roadId = bestRoad;
      return out;
    }

    const y = this.grid.heightAt(x, z);
    this.grid.normalAt(x, z, scratchNormal);
    const mountain = this.config.mountain;
    let surface = SURFACE.DIRT;
    if (y < this.waterAt(x,z) - 0.15) surface = SURFACE.WATER;
    else if (scratchNormal.ny < 0.78) surface = SURFACE.ROCK;
    else if (y > mountain.snowLine + 12) surface = SURFACE.SNOW;
    else if (y < mountain.treeLine + 20 && scratchNormal.ny > 0.86) surface = SURFACE.GRASS;
    const props = SURFACE_PROPS[surface];
    out.y = y;
    out.nx = scratchNormal.nx;
    out.ny = scratchNormal.ny;
    out.nz = scratchNormal.nz;
    out.surface = surface;
    out.grip = props.grip;
    out.rolling = props.rolling;
    out.roughness = props.roughness;
    out.roadId = -1;
    return out;
  }

  /**
   * Position relative to a road. With `roadId` only that road is considered; otherwise the nearest.
   * Returns `out` with roadId -1 when no road is within ~40 m.
   * @returns {import('../core/contracts.js').RoadLocation}
   */
  locate(x, z, out, roadId = -1, referenceY) {
    const layerY = this.layered ? referenceY : undefined;
    out.roadId = -1;
    if (roadId >= 0) {
      if (this.roads[roadId].locate(x, z, out, layerY) && layerY !== undefined && Math.abs(out.y-layerY)>3) out.roadId=-1;
      return out;
    }
    let best = Infinity;
    for (let r = 0; r < this.roads.length; r += 1) {
      if (this.roads[r].locate(x, z, scratchLocationB, layerY) && (layerY === undefined || Math.abs(scratchLocationB.y-layerY)<3) && scratchLocationB.distance < best) {
        best = scratchLocationB.distance;
        Object.assign(out, scratchLocationB);
      }
    }
    return out;
  }

  /** @returns {import('../core/contracts.js').BarrierHit} */
  collideBarrier(x, y, z, radius, out) {
    const road = this.config.road;
    out.hit = false;
    out.depth = 0;
    out.nx = 0;
    out.nz = 0;

    for (let r = 0; r < this.roads.length; r += 1) {
      const current = this.roads[r];
      if (!current.locate(x, z, scratchLocation, this.layered ? y : undefined) || scratchLocation.beyondEnd) continue;
      if (this.layered && y < scratchLocation.y-0.6) continue;
      const railAt = scratchLocation.halfWidth + road.shoulder + road.railOffset;
      const a = Math.abs(scratchLocation.lateral);
      // Only the road side of a rail is solid; a car that is already beyond it is left alone.
      if (a + radius <= railAt || a > railAt + 1.1) continue;
      const near = scratchLocation.u < 0.5 ? scratchLocation.index : (scratchLocation.index + 1) % current.count;
      const side = scratchLocation.lateral < 0 ? -1 : 1;
      if (!(side < 0 ? current.railLeft[near] : current.railRight[near])) continue;
      const surfaceY = scratchLocation.y + scratchLocation.lateral * scratchLocation.bank;
      if (y - surfaceY > road.railHeight + 0.3) continue;
      const depth = a + radius - railAt;
      if (depth > out.depth) {
        out.hit = true;
        out.depth = depth;
        out.nx = -side * scratchLocation.rx;
        out.nz = -side * scratchLocation.rz;
      }
    }

    const plazas = this.plazas;
    for (let p = 0; p < plazas.length; p += 1) {
      const plaza = plazas[p];
      if (y - plaza.y >= road.railHeight + 0.3) continue;
      const dx = x - plaza.x;
      const dz = z - plaza.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      const railAt = plaza.radius + road.railOffset;
      if (distance + radius > railAt && distance < railAt + 1.1 && !this.inPlazaEntry(x, z)) {
        const depth = distance + radius - railAt;
        if (depth > out.depth) {
          out.hit = true;
          out.depth = depth;
          out.nx = -dx / distance;
          out.nz = -dz / distance;
        }
      }
    }

    if(this.mineGate && !this.mineOpen){
      const f=this.mineGate,dx=x-f.x,dz=z-f.z;
      const along=dx*f.tx+dz*f.tz;
      if(Math.abs(along)<radius+.14 && Math.abs(dx*f.rx+dz*f.rz)<3.2+radius && y<f.y+3.5){
        const penetration=radius+.14-Math.abs(along);
        if(penetration>out.depth){out.hit=true;out.depth=penetration;out.nx=Math.sign(along||1)*f.tx;out.nz=Math.sign(along||1)*f.tz;}
      }
    }
    // The edge of the map is a soft wall so nothing can drive off the grid.
    const limit = this.grid.half - 14;
    if (Math.abs(x) + radius > limit || Math.abs(z) + radius > limit) {
      const overX = Math.abs(x) + radius - limit;
      const overZ = Math.abs(z) + radius - limit;
      const depth = Math.max(overX, overZ);
      if (depth > out.depth) {
        out.hit = true;
        out.depth = depth;
        out.nx = overX >= overZ ? -Math.sign(x) : 0;
        out.nz = overX >= overZ ? 0 : -Math.sign(z);
      }
    }
    return out;
  }

  /** True where an open road passes through a plaza rail ring (the ring is open there). */
  inPlazaEntry(x, z) {
    const reach = this.config.road.shoulder + 1.2;
    for (let r = 0; r < this.roads.length; r += 1) {
      const current = this.roads[r];
      if (r === LOOP || current.closed || !current.locate(x, z, scratchLocationB)) continue;
      if (scratchLocationB.distance < scratchLocationB.halfWidth + reach) return true;
    }
    return false;
  }

  /** Register solid scenery (tree trunks, boulders) as flat [x, z, radius, ...] triples. */
  /** Dynamic obstacles (Scenery's trees and rocks). The map's buildings are always included. */
  setObstacles(dynamic) {
    const triples = this.staticObstacles.length ? this.staticObstacles.concat(dynamic) : dynamic;
    this.obstacleHash = new Map();
    this.obstacles = triples;
    for (let i = 0; i < triples.length; i += 3) {
      const key = (Math.floor(triples[i] / OBSTACLE_CELL) + 512) * 2048 + (Math.floor(triples[i + 1] / OBSTACLE_CELL) + 512);
      let bucket = this.obstacleHash.get(key);
      if (!bucket) {
        bucket = [];
        this.obstacleHash.set(key, bucket);
      }
      bucket.push(i);
    }
  }

  indexTokyoSolids() {
    this.tokyoObstacleHash=new Map();
    for(const item of this.tokyoSolids){
      const key=(Math.floor(item.p.x/32)+512)*2048+Math.floor(item.p.z/32)+512;
      if(!this.tokyoObstacleHash.has(key))this.tokyoObstacleHash.set(key,[]);
      this.tokyoObstacleHash.get(key).push(item);
    }
  }

  /** @returns {import('../core/contracts.js').BarrierHit} */
  collideObstacle(x, y, z, radius, out) {
    out.hit = false;
    out.depth = 0;
    out.nx = 0;
    out.nz = 0;
    if(this.tokyoObstacleHash){
      const ix=Math.floor(x/32)+512,iz=Math.floor(z/32)+512;
      for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
        const bucket=this.tokyoObstacleHash.get((ix+dx)*2048+iz+dz);
        if(!bucket)continue;
        for(const item of bucket){
          if(item.box){
            const {p,h,box}=item;
            if(y+radius<p.y || y-radius>p.y+h)continue;
            const dx=x-p.x,dz=z-p.z;
            const u=dx*box.tx+dz*box.tz,v=-dx*box.tz+dz*box.tx;
            const du=Math.abs(u)-box.length,dv=Math.abs(v)-box.width;
            const gap=Math.hypot(Math.max(0,du),Math.max(0,dv));
            const depth=radius-gap-Math.min(0,Math.max(du,dv));
            if(depth<=out.depth)continue;
            const nu=gap>0?Math.sign(u)*Math.max(0,du)/gap:du>=dv?(Math.sign(u)||1):0;
            const nv=gap>0?Math.sign(v)*Math.max(0,dv)/gap:dv>du?(Math.sign(v)||1):0;
            out.hit=true;out.depth=depth;out.nx=nu*box.tx-nv*box.tz;out.nz=nu*box.tz+nv*box.tx;
            continue;
          }
          const {p,r,h}=item;
          if(y<p.y-1.8 || y>p.y+h)continue;
          const a=x-p.x,b=z-p.z,d=Math.hypot(a,b),depth=r+radius-d;
          if(depth>out.depth && d>.001){out.hit=true;out.depth=depth;out.nx=a/d;out.nz=b/d;}
        }
      }
    }
    if (!this.obstacles) return out;
    const cx = Math.floor(x / OBSTACLE_CELL) + 512;
    const cz = Math.floor(z / OBSTACLE_CELL) + 512;
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oz = -1; oz <= 1; oz += 1) {
        const bucket = this.obstacleHash.get((cx + ox) * 2048 + (cz + oz));
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k += 1) {
          const i = bucket[k];
          const dx = x - this.obstacles[i];
          const dz = z - this.obstacles[i + 1];
          const reach = radius + this.obstacles[i + 2];
          const distanceSq = dx * dx + dz * dz;
          if (distanceSq >= reach * reach || distanceSq < 1e-8) continue;
          const distance = Math.sqrt(distanceSq);
          const depth = reach - distance;
          if (depth > out.depth) {
            out.hit = true;
            out.depth = depth;
            out.nx = dx / distance;
            out.nz = dz / distance;
          }
        }
      }
    }
    return out;
  }

  /**
   * Pose on a route at distance `s` along its road, facing the route's driving direction.
   * @returns {import('../core/contracts.js').SpawnPose}
   */
  getSpawn(routeId, s, out = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }) {
    const route = this.routes[routeId] || this.routes.loop;
    return this.roadSpawn(route.roadId,s,route.direction,out);
  }

  roadSpawn(roadId,s,d,out) {
    const frame = this.roads[roadId].frameAt(s, scratchFrame);
    out.position.x = frame.x;
    out.position.y = frame.y;
    out.position.z = frame.z;
    // Rotation with columns (right, up, back) where back = -forward.
    basisToQuaternion(
      frame.rx * d, frame.ry * d, frame.rz * d,
      frame.nx, frame.ny, frame.nz,
      -frame.tx * d, -frame.ty * d, -frame.tz * d,
      out.quaternion,
    );
    return out;
  }

  /** True within `margin` metres of a building footprint (Scenery keeps trees out). */
  isReserved(x, z, margin = 0) {
    for (const placement of this.placements) {
      const reach = placement.radius + margin;
      const dx = x - placement.x;
      const dz = z - placement.z;
      if (dx * dx + dz * dz < reach * reach) return true;
    }
    return false;
  }

  /** Displayed altitude in metres for a world height. */
  displayAltitude(y) {
    const altitude = this.config.altitude;
    return altitude ? y * altitude.scale + altitude.offset : y - this.config.mountain.valleyFloor;
  }

  /** Road outlines and landmarks for the minimap (Hud.setTrack). */
  getMapData() {
    const roads = this.roads.map((road) => {
      const points = [];
      const heights = [];
      const add = (i) => {
        points.push(road.px[i], road.pz[i]);
        heights.push(road.py[i]);
      };
      for (let i = 0; i < road.count; i += 3) add(i);
      if (!road.closed) add(road.count - 1);
      return { id: road.id, closed: road.closed, points, heights, layered: this.layered, parkade: this.config.map==='tokyo' && road.id===4 };
    });
    const start = this.roads[LOOP].frameAt(this.routes.loop.startS, scratchFrame);
    const markers = [{ x: start.x, z: start.z, kind: 'start' }];
    for (const entry of this.junctions) {
      const junction = this.roads[LOOP].frameAt(entry.s, scratchFrame);
      markers.push({ x: junction.x, z: junction.z, kind: 'junction' });
    }
    for (const plaza of this.plazas) {
      const marker = { x: plaza.x, z: plaza.z, kind: 'summit' };
      if (plaza.label) marker.label = plaza.label;
      markers.push(marker);
    }
    return { routeRoads:Object.fromEntries(Object.entries(this.routes).map(([id,r])=>[id,r.roadId])),bounds: { ...this.bounds }, roads, markers, labels: this.labels.map((label) => ({ ...label })) };
  }
}

const scratchGround = {};

/** Quaternion from an orthonormal basis given as three column vectors. */
function basisToQuaternion(m00, m10, m20, m01, m11, m21, m02, m12, m22, out) {
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    out.w = 0.25 / s;
    out.x = (m21 - m12) * s;
    out.y = (m02 - m20) * s;
    out.z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    out.w = (m21 - m12) / s;
    out.x = 0.25 * s;
    out.y = (m01 + m10) / s;
    out.z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    out.w = (m02 - m20) / s;
    out.x = (m01 + m10) / s;
    out.y = 0.25 * s;
    out.z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    out.w = (m10 - m01) / s;
    out.x = (m02 + m20) / s;
    out.y = (m12 + m21) / s;
    out.z = 0.25 * s;
  }
  const length = Math.hypot(out.x, out.y, out.z, out.w) || 1;
  out.x /= length;
  out.y /= length;
  out.z /= length;
  out.w /= length;
  return out;
}

export const ROAD_IDS = Object.freeze({ LOOP, SPUR, PEAK });
export const MOUTH = Object.freeze({ LEFT: MOUTH_LEFT, RIGHT: MOUTH_RIGHT });
