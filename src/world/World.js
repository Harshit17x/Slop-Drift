import { SURFACE, SURFACE_PROPS, CONFIG } from '../config.js';
import { clamp, lerp, smoothstep } from '../core/math.js';
import { WORLD } from './worldConfig.js';
import { createRandom } from './noise.js';
import { nextTask as pause } from '../core/yield.js';
import { MountainShape } from './MountainShape.js';
import { TerrainGrid } from './TerrainGrid.js';
import { Road, gradeLimitedProfile } from './Road.js';
import { buildLoopPlan, buildSpurPlan } from './TrackLayout.js';

const LOOP = 0;
const SPUR = 1;
const CORRIDOR_CELL = 8;
const MACRO_STEP = 2; // macro relief is sampled every 2 grid cells (4 m)
const OBSTACLE_CELL = 16;
const MOUTH_LEFT = 1;
const MOUTH_RIGHT = 2;


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
  constructor(config = WORLD) {
    this.config = config;
    this.grid = new TerrainGrid(config.grid);
    this.shape = null;
    this.roads = [];
    this.routes = {};
    this.plaza = null;
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
    this.grid.carve(this.roads, this.plaza, config.road);
    this.flagRails();
    this.buildRoutes();
    this.corridor = null;
    this.built = true;
    await stage(0.9, 'Planting the forest');
    return this;
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
    this.plaza = { x: 0, z: 0, y: plazaY, radius: config.spur.plazaRadius };
    this.summit = { x: 0, y: plazaY, z: 0 };
    this.junctionS = spurPlan.junctionIndex * loop.spacing;
  }

  /** Mark where roads merge into each other or the plaza (no rails, verge or edge lines on those sides). */
  flagMouths() {
    const [loop, spur] = this.roads;
    const plaza = this.plaza;

    for (let i = 0; i < spur.count; i += 1) {
      const s = i * spur.spacing;
      if (s < 260 && loop.locate(spur.px[i], spur.pz[i], scratchLocation)) {
        const near = scratchLocation.u < 0.5 ? scratchLocation.index : (scratchLocation.index + 1) % loop.count;
        if (scratchLocation.distance < loop.ribbonHalfAt(near) + spur.ribbonHalfAt(i) + 1.5) {
          spur.mouth[i] = MOUTH_LEFT | MOUTH_RIGHT;
          const side = scratchLocation.lateral < 0 ? MOUTH_LEFT : MOUTH_RIGHT;
          for (let k = -4; k <= 4; k += 1) loop.mouth[(near + k + loop.count) % loop.count] |= side;
        }
      }
      if (Math.hypot(spur.px[i] - plaza.x, spur.pz[i] - plaza.z) < plaza.radius + spur.ribbonHalfAt(i) + 2) {
        spur.mouth[i] = MOUTH_LEFT | MOUTH_RIGHT;
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

  buildRoutes() {
    const [loop, spur] = this.roads;
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
    const spurStart = 190;
    const spurFinish = spur.length - 58;
    this.routes = {
      loop: {
        id: 'loop', roadId: LOOP, closed: true, direction: 1, startS: loopStart, finishS: loopStart, length: loop.length,
        checkpoints: gatesBetween(loopStart, loopStart, 1, loop.length, true),
      },
      climb: {
        id: 'climb', roadId: SPUR, closed: false, direction: 1, startS: spurStart, finishS: spurFinish, length: spurFinish - spurStart,
        checkpoints: gatesBetween(spurStart, spurFinish, 1, spur.length, false),
      },
      descent: {
        id: 'descent', roadId: SPUR, closed: false, direction: -1, startS: spurFinish, finishS: spurStart, length: spurFinish - spurStart,
        checkpoints: gatesBetween(spurFinish, spurStart, -1, spur.length, false),
      },
    };
  }

  // ---------------------------------------------------------------- queries

  /** Height of whatever the car would drive on at (x, z). */
  heightAt(x, z) {
    return this.sampleGround(x, z, scratchGround).y;
  }

  /** @returns {import('../core/contracts.js').GroundSample} */
  sampleGround(x, z, out) {
    const road = this.config.road;
    let bestClass = 9;
    let bestY = 0;
    let gradX = 0;
    let gradZ = 0;
    let bestRoad = -1;

    for (let r = 0; r < this.roads.length; r += 1) {
      const current = this.roads[r];
      if (!current.locate(x, z, scratchLocation) || scratchLocation.beyondEnd) continue;
      const halfWidth = scratchLocation.halfWidth;
      const a = scratchLocation.distance;
      if (a > halfWidth + current.vergeEdge) continue;
      const side = scratchLocation.lateral < 0 ? -1 : 1;
      const offset = current.profileAt(a, halfWidth);
      const surfaceClass = a <= halfWidth ? 0 : a <= halfWidth + current.shoulderEdge ? 1 : 2;
      let y = scratchLocation.y + side * a * scratchLocation.bank + offset;
      // The verge is soft ground: where another road's bed has been cut higher, the ground wins.
      if (surfaceClass === 2) y = Math.max(y, this.grid.heightAt(x, z));
      if (surfaceClass < bestClass || (surfaceClass === bestClass && y > bestY)) {
        bestClass = surfaceClass;
        bestY = y;
        bestRoad = r;
        const lateralSlope = scratchLocation.bank + side * Road.profileSlope;
        // Horizontal tangent is (rz, -rx); height gradient = grade * tangent + lateralSlope * right.
        gradX = scratchLocation.grade * scratchLocation.rz + lateralSlope * scratchLocation.rx;
        gradZ = -scratchLocation.grade * scratchLocation.rx + lateralSlope * scratchLocation.rz;
      }
    }

    const plaza = this.plaza;
    if (plaza) {
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
          bestRoad = SPUR;
          const slope = beyond > 0 && distance > 0 ? -road.vergeDrop / road.verge / distance : 0;
          gradX = dx * slope;
          gradZ = dz * slope;
        }
      }
    }

    if (bestClass < 9) {
      const inverse = 1 / Math.sqrt(gradX * gradX + gradZ * gradZ + 1);
      const surface = bestClass === 0 ? SURFACE.ASPHALT : bestClass === 1 ? SURFACE.GRAVEL : SURFACE.GRASS;
      const props = SURFACE_PROPS[surface];
      out.y = bestY;
      out.nx = -gradX * inverse;
      out.ny = inverse;
      out.nz = -gradZ * inverse;
      out.surface = surface;
      out.grip = props.grip;
      out.rolling = props.rolling;
      out.roughness = props.roughness;
      out.roadId = bestRoad;
      return out;
    }

    const y = this.grid.heightAt(x, z);
    this.grid.normalAt(x, z, scratchNormal);
    const mountain = this.config.mountain;
    let surface = SURFACE.DIRT;
    if (y < this.waterLevel - 0.15) surface = SURFACE.WATER;
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
  locate(x, z, out, roadId = -1) {
    out.roadId = -1;
    if (roadId >= 0) {
      this.roads[roadId].locate(x, z, out);
      return out;
    }
    let best = Infinity;
    for (let r = 0; r < this.roads.length; r += 1) {
      if (this.roads[r].locate(x, z, scratchLocationB) && scratchLocationB.distance < best) {
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
      if (!current.locate(x, z, scratchLocation) || scratchLocation.beyondEnd) continue;
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

    const plaza = this.plaza;
    if (plaza && y - plaza.y < road.railHeight + 0.3) {
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

  /** True where the spur road passes through the plaza rail ring. */
  inPlazaEntry(x, z) {
    const spur = this.roads[SPUR];
    if (!spur.locate(x, z, scratchLocationB)) return false;
    return scratchLocationB.distance < scratchLocationB.halfWidth + this.config.road.shoulder + 1.2;
  }

  /** Register solid scenery (tree trunks, boulders) as flat [x, z, radius, ...] triples. */
  setObstacles(triples) {
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

  /** @returns {import('../core/contracts.js').BarrierHit} */
  collideObstacle(x, y, z, radius, out) {
    out.hit = false;
    out.depth = 0;
    out.nx = 0;
    out.nz = 0;
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
    const frame = this.roads[route.roadId].frameAt(s, scratchFrame);
    const d = route.direction;
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
      return { id: road.id, closed: road.closed, points, heights };
    });
    const start = this.roads[LOOP].frameAt(this.routes.loop.startS, scratchFrame);
    const markers = [{ x: start.x, z: start.z, kind: 'start' }];
    const junction = this.roads[LOOP].frameAt(this.junctionS, scratchFrame);
    markers.push({ x: junction.x, z: junction.z, kind: 'junction' });
    markers.push({ x: this.plaza.x, z: this.plaza.z, kind: 'summit' });
    return { bounds: { ...this.bounds }, roads, markers };
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

export const ROAD_IDS = Object.freeze({ LOOP, SPUR });
export const MOUTH = Object.freeze({ LEFT: MOUTH_LEFT, RIGHT: MOUTH_RIGHT });
