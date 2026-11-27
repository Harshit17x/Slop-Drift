import { clamp, smoothstep } from '../core/math.js';

const HASH_CELL = 40; // metres; locate() searches the 3x3 cells around a point
const HASH_OFFSET = 512;

// Broad phase for venues with several overlapping timing layouts. Include the
// same nine cells as locate(), preserving road order and both decks at flyovers.
export function indexPhysicalRoads(roads){
  const cells=new Map(),empty=[];
  for(const road of roads){
    const reaches=new Set();
    for(const key of road.hash.keys())for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)reaches.add(key+dx*2048+dz);
    for(const key of reaches){if(!cells.has(key))cells.set(key,[]);cells.get(key).push(road);}
  }
  return (x,z)=>cells.get((Math.floor(x/HASH_CELL)+HASH_OFFSET)*2048+Math.floor(z/HASH_CELL)+HASH_OFFSET)||empty;
}

function gaussianSmooth(values, sigmaSamples, closed) {
  const count = values.length;
  const radius = Math.max(1, Math.ceil(sigmaSamples * 3));
  const result = new Float32Array(count);
  const weights = new Float32Array(radius * 2 + 1);
  for (let k = -radius; k <= radius; k += 1) weights[k + radius] = Math.exp(-(k * k) / (2 * sigmaSamples * sigmaSamples));
  for (let i = 0; i < count; i += 1) {
    let sum = 0;
    let norm = 0;
    for (let k = -radius; k <= radius; k += 1) {
      let j = i + k;
      if (closed) j = ((j % count) + count) % count;
      else if (j < 0 || j >= count) continue;
      sum += values[j] * weights[k + radius];
      norm += weights[k + radius];
    }
    result[i] = sum / norm;
  }
  return result;
}

/**
 * Limit the slope between neighbouring samples to `maxStep` by sweeping both ways, then smooth.
 * Used to turn raw terrain heights along a path into a drivable road profile.
 */
export function gradeLimitedProfile(raw, spacing, maxGrade, closed, smoothMetres = 14) {
  const count = raw.length;
  let heights = gaussianSmooth(raw, 22 / spacing, closed);
  const maxStep = maxGrade * spacing * 0.94;
  for (let pass = 0; pass < 6; pass += 1) {
    for (let i = 1; i < count + (closed ? count : 0); i += 1) {
      const a = (i - 1) % count;
      const b = i % count;
      heights[b] = clamp(heights[b], heights[a] - maxStep, heights[a] + maxStep);
    }
    for (let i = count * (closed ? 2 : 1) - 2; i >= 0; i -= 1) {
      const a = (i + 1) % count;
      const b = i % count;
      heights[b] = clamp(heights[b], heights[a] - maxStep, heights[a] + maxStep);
    }
  }
  heights = gaussianSmooth(heights, smoothMetres / spacing, closed);
  return heights;
}

/**
 * One road: a centreline sampled at even spacing with a full frame per sample, plus the queries
 * the physics and the race logic need. Data is struct-of-arrays so queries never allocate.
 *
 * Cross-section (distance from the centreline): asphalt to halfWidth, flush gravel shoulder,
 * then a verge sloping down by `vergeDrop` to the carved bed. `ribbonHalf` is where the verge ends.
 */
export class Road {
  /**
   * @param {object} options
   * @param {number} options.id
   * @param {string} options.name
   * @param {boolean} options.closed
   * @param {number[][]} options.points  Evenly spaced [x, z] centreline points.
   * @param {Float32Array} options.heights  Road surface height at each point.
   * @param {object} options.config  WORLD.road
   * @param {Float32Array} [options.flatten]  Per-sample 0..1 factor that removes banking and widening (junctions, plaza).
   */
  constructor({ id, name, closed, points, heights, config, flatten = null }) {
    this.id = id;
    this.name = name;
    this.closed = closed;
    this.config = config;
    const count = points.length;
    this.count = count;
    this.segments = closed ? count : count - 1;

    this.px = new Float32Array(count);
    this.py = new Float32Array(count);
    this.pz = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      this.px[i] = points[i][0];
      this.pz[i] = points[i][1];
      this.py[i] = heights[i];
    }

    // Horizontal spacing is uniform by construction; measure it rather than trusting the request.
    let planLength = 0;
    for (let i = 0; i < this.segments; i += 1) {
      const j = (i + 1) % count;
      planLength += Math.hypot(this.px[j] - this.px[i], this.pz[j] - this.pz[i]);
    }
    this.spacing = planLength / this.segments;
    this.length = planLength;

    this.tx = new Float32Array(count); // unit horizontal tangent
    this.tz = new Float32Array(count);
    this.rx = new Float32Array(count); // unit horizontal right = tangent x up
    this.rz = new Float32Array(count);
    this.grade = new Float32Array(count); // dy per horizontal metre
    const rawCurvature = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const before = closed ? (i - 1 + count) % count : Math.max(0, i - 1);
      const after = closed ? (i + 1) % count : Math.min(count - 1, i + 1);
      let dx = this.px[after] - this.px[before];
      let dz = this.pz[after] - this.pz[before];
      const span = Math.hypot(dx, dz) || 1;
      dx /= span;
      dz /= span;
      this.tx[i] = dx;
      this.tz[i] = dz;
      this.rx[i] = -dz;
      this.rz[i] = dx;
      this.grade[i] = (this.py[after] - this.py[before]) / span;
    }
    for (let i = 0; i < count; i += 1) {
      const before = closed ? (i - 1 + count) % count : Math.max(0, i - 1);
      const after = closed ? (i + 1) % count : Math.min(count - 1, i + 1);
      // Signed heading change per metre; positive turns toward +right.
      const cross = this.tx[before] * this.tz[after] - this.tz[before] * this.tx[after];
      const dot = this.tx[before] * this.tx[after] + this.tz[before] * this.tz[after];
      const span = Math.max(1e-6, (after - before + (closed && after < before ? count : 0)) * this.spacing);
      rawCurvature[i] = Math.atan2(cross, dot) / span;
    }
    this.curvature = gaussianSmooth(rawCurvature, 5 / this.spacing, closed);

    // Width grows and the surface banks into tight corners; both eased so they never step.
    const widen = new Float32Array(count);
    const bank = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const keep = flatten ? 1 - flatten[i] : 1;
      const tightness = smoothstep(1 / 70, 1 / 24, Math.abs(this.curvature[i]));
      widen[i] = config.halfWidth + config.hairpinExtraWidth * tightness * keep;
      // Right turn (positive curvature) lowers the right side: height = y + lateral * bank.
      bank[i] = -clamp(this.curvature[i] * config.bankGain, -config.maxBank, config.maxBank) * keep;
    }
    this.halfWidth = gaussianSmooth(widen, 12 / this.spacing, closed);
    this.bank = gaussianSmooth(bank, 12 / this.spacing, closed);

    // Which sides carry a guardrail, and where the road merges with another surface. Filled in by World.
    this.railLeft = new Uint8Array(count);
    this.railRight = new Uint8Array(count);
    this.mouth = new Uint8Array(count);

    this.shoulderEdge = config.shoulder;
    this.vergeEdge = config.shoulder + config.verge;
    this.buildHash();
  }

  buildHash() {
    const buckets = new Map();
    for (let i = 0; i < this.segments; i += 1) {
      const j = (i + 1) % this.count;
      const mx = (this.px[i] + this.px[j]) * 0.5;
      const mz = (this.pz[i] + this.pz[j]) * 0.5;
      const key = (Math.floor(mx / HASH_CELL) + HASH_OFFSET) * 2048 + (Math.floor(mz / HASH_CELL) + HASH_OFFSET);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = [];
        buckets.set(key, bucket);
      }
      bucket.push(i);
    }
    this.hash = new Map();
    buckets.forEach((list, key) => this.hash.set(key, Int32Array.from(list)));
  }

  /** Half width of everything the road mesh covers at sample i (asphalt + shoulder + verge). */
  ribbonHalfAt(i) {
    return this.halfWidth[i] + this.vergeEdge;
  }

  /**
   * Nearest point on the centreline within ~40 m of (x, z). Fills `out` (a RoadLocation plus the
   * segment `index` and interpolation `u`) and returns true, or returns false when no segment is near.
   */
  locate(x, z, out, referenceY) {
    const cx = Math.floor(x / HASH_CELL) + HASH_OFFSET;
    const cz = Math.floor(z / HASH_CELL) + HASH_OFFSET;
    let bestDistance = HASH_CELL * HASH_CELL;
    let bestMetric = bestDistance;
    let bestIndex = -1;
    let bestU = 0;
    // Tokyo opts into a stronger height preference; other maps keep the
    // original plan-distance metric their surfaces were tuned against.
    const heightWeight = this.heightWeight === undefined ? 1 : this.heightWeight;
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oz = -1; oz <= 1; oz += 1) {
        const bucket = this.hash.get((cx + ox) * 2048 + (cz + oz));
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k += 1) {
          const i = bucket[k];
          const j = i + 1 === this.count ? 0 : i + 1;
          const ax = this.px[i];
          const az = this.pz[i];
          const abx = this.px[j] - ax;
          const abz = this.pz[j] - az;
          const lengthSq = abx * abx + abz * abz;
          let u = lengthSq > 0 ? ((x - ax) * abx + (z - az) * abz) / lengthSq : 0;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const dx = x - (ax + abx * u);
          const dz = z - (az + abz * u);
          const distanceSq = dx * dx + dz * dz;
          const dy = referenceY === undefined ? 0 : this.py[i] + (this.py[j]-this.py[i])*u - referenceY;
          // Prefer the deck the caller is actually on. Stacked and parallel
          // flyovers can put another layer of the same road closer in plan
          // view; a plain distance + dy^2 metric then snaps to that deck and
          // the lower carriageway loses its ground sample. Weighting the
          // height difference keeps the near-horizontal layer authoritative.
          const metric = distanceSq + dy * dy * heightWeight;
          if (metric < bestMetric) {
            bestMetric = metric;
            bestDistance = distanceSq;
            bestIndex = i;
            bestU = u;
          }
        }
      }
    }
    if (bestIndex < 0) return false;
    const i = bestIndex;
    const j = i + 1 === this.count ? 0 : i + 1;
    const u = bestU;
    const cxp = this.px[i] + (this.px[j] - this.px[i]) * u;
    const czp = this.pz[i] + (this.pz[j] - this.pz[i]) * u;
    let rx = this.rx[i] + (this.rx[j] - this.rx[i]) * u;
    let rz = this.rz[i] + (this.rz[j] - this.rz[i]) * u;
    const rightLength = Math.hypot(rx, rz) || 1;
    rx /= rightLength;
    rz /= rightLength;
    const grade = this.grade[i] + (this.grade[j] - this.grade[i]) * u;
    const flat = 1 / Math.sqrt(1 + grade * grade);
    out.roadId = this.id;
    out.index = i;
    out.u = u;
    // Past either end of an open road the nearest point is the end itself; callers that need the
    // road surface (not just the nearest position) must ignore those hits.
    out.beyondEnd = !this.closed && ((i === 0 && u === 0) || (i === this.segments - 1 && u === 1));
    out.s = (i + u) * this.spacing;
    out.progress = out.s / this.length;
    out.lateral = (x - cxp) * rx + (z - czp) * rz;
    out.distance = Math.sqrt(bestDistance);
    out.halfWidth = this.halfWidth[i] + (this.halfWidth[j] - this.halfWidth[i]) * u;
    out.bank = this.bank[i] + (this.bank[j] - this.bank[i]) * u;
    out.grade = grade;
    out.curvature = this.curvature[i] + (this.curvature[j] - this.curvature[i]) * u;
    out.y = this.py[i] + (this.py[j] - this.py[i]) * u;
    out.rx = rx;
    out.rz = rz;
    // Unit tangent along +s, climbing with the grade. right x up gives -tangent, so tangent = (rz, ., -rx).
    out.tx = rz * flat;
    out.ty = grade * flat;
    out.tz = -rx * flat;
    return true;
  }

  /**
   * Height offset and surface class of the cross-section at distance `a` from the centreline.
   * Returns the offset below the banked road plane; writes the lateral slope into `Road.profileSlope`.
   */
  profileAt(a, halfWidth) {
    const beyond = a - halfWidth - this.shoulderEdge;
    if (beyond <= 0) {
      Road.profileSlope = 0;
      return 0;
    }
    const verge = this.config.verge;
    const t = Math.min(1, beyond / verge);
    Road.profileSlope = t < 1 ? -this.config.vergeDrop / verge : 0;
    return -this.config.vergeDrop * t;
  }

  escapeAt(loc) {
    const widths = loc.lateral < 0 ? this.escapeLeft : this.escapeRight;
    if (!widths) return 0;
    const i = loc.index, j = (i + 1) % this.count;
    return widths[i] + (widths[j] - widths[i]) * loc.u;
  }

  /** Frame at distance s along the road (wrapped on closed roads, clamped on open ones). */
  frameAt(s, out) {
    const max = this.segments;
    let f = s / this.spacing;
    if (this.closed) f = ((f % max) + max) % max;
    else f = clamp(f, 0, max - 1e-4);
    const i = Math.floor(f);
    const u = f - i;
    const j = i + 1 === this.count ? 0 : i + 1;
    const grade = this.grade[i] + (this.grade[j] - this.grade[i]) * u;
    const bank = this.bank[i] + (this.bank[j] - this.bank[i]) * u;
    let rx = this.rx[i] + (this.rx[j] - this.rx[i]) * u;
    let rz = this.rz[i] + (this.rz[j] - this.rz[i]) * u;
    const rightLength = Math.hypot(rx, rz) || 1;
    rx /= rightLength;
    rz /= rightLength;
    const flat = 1 / Math.sqrt(1 + grade * grade);
    out.index = i;
    out.u = u;
    out.x = this.px[i] + (this.px[j] - this.px[i]) * u;
    out.y = this.py[i] + (this.py[j] - this.py[i]) * u;
    out.z = this.pz[i] + (this.pz[j] - this.pz[i]) * u;
    out.tx = rz * flat;
    out.ty = grade * flat;
    out.tz = -rx * flat;
    // Banked right vector and surface normal.
    const bankFlat = 1 / Math.sqrt(1 + bank * bank);
    out.rx = rx * bankFlat;
    out.ry = bank * bankFlat;
    out.rz = rz * bankFlat;
    // normal = right x tangent
    out.nx = out.ry * out.tz - out.rz * out.ty;
    out.ny = out.rz * out.tx - out.rx * out.tz;
    out.nz = out.rx * out.ty - out.ry * out.tx;
    out.halfWidth = this.halfWidth[i] + (this.halfWidth[j] - this.halfWidth[i]) * u;
    out.bank = bank;
    out.grade = grade;
    out.curvature = this.curvature[i] + (this.curvature[j] - this.curvature[i]) * u;
    return out;
  }
}

Road.profileSlope = 0;
