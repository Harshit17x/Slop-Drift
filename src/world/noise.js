// Deterministic 2D value noise and the fractal sums built on it.
// Formulas: quintic-fade value noise with analytic derivatives, Musgrave's ridged multifractal,
// and Inigo Quilez's derivative-damped fBm (steep areas lose high-frequency detail, which reads as erosion).

export function seedFromValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value | 0;
  const text = String(value ?? 'mountain');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

/** Small seeded PRNG (mulberry32). Returns a function producing floats in [0, 1). */
export function createRandom(seed) {
  let state = seedFromValue(seed) >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const derivative = { v: 0, dx: 0, dy: 0 };

export class Noise2D {
  constructor(seed = 1) {
    this.seed = seedFromValue(seed);
  }

  /** Hash of an integer lattice point, in [-1, 1]. */
  lattice(ix, iy) {
    let h = this.seed ^ Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 2147483647.5 - 1;
  }

  /** Value noise in [-1, 1]. */
  value(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const u = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
    const v = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
    const a = this.lattice(x0, y0);
    const b = this.lattice(x0 + 1, y0);
    const c = this.lattice(x0, y0 + 1);
    const d = this.lattice(x0 + 1, y0 + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** Value noise plus its analytic gradient. Writes { v, dx, dy } into `out`. */
  valueD(x, y, out = derivative) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const u = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
    const v = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
    const du = 30 * tx * tx * (tx - 1) * (tx - 1);
    const dv = 30 * ty * ty * (ty - 1) * (ty - 1);
    const a = this.lattice(x0, y0);
    const b = this.lattice(x0 + 1, y0);
    const c = this.lattice(x0, y0 + 1);
    const d = this.lattice(x0 + 1, y0 + 1);
    const k = a - b - c + d;
    out.v = a + (b - a) * u + (c - a) * v + k * u * v;
    out.dx = du * (b - a + k * v);
    out.dy = dv * (c - a + k * u);
    return out;
  }

  /** Fractal Brownian motion, normalised to roughly [-1, 1]. */
  fbm(x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
    let amplitude = 1;
    let total = 0;
    let norm = 0;
    let fx = x;
    let fy = y;
    for (let i = 0; i < octaves; i += 1) {
      total += this.value(fx, fy) * amplitude;
      norm += amplitude;
      amplitude *= gain;
      // Rotate each octave so lattice axes do not line up.
      const rx = fx * 0.8 - fy * 0.6;
      fy = (fx * 0.6 + fy * 0.8) * lacunarity;
      fx = rx * lacunarity;
    }
    return total / norm;
  }

  /** Ridged multifractal (Musgrave): sharp crests, in [0, 1]. */
  ridged(x, y, octaves = 5, lacunarity = 2.1, gain = 2) {
    let frequencyWeight = 1;
    let weight = 1;
    let total = 0;
    let norm = 0;
    let fx = x;
    let fy = y;
    for (let i = 0; i < octaves; i += 1) {
      let signal = 1 - Math.abs(this.value(fx, fy));
      signal *= signal * weight;
      weight = Math.min(1, Math.max(0, signal * gain));
      total += signal * frequencyWeight;
      norm += frequencyWeight;
      frequencyWeight *= 0.5;
      const rx = fx * 0.8 - fy * 0.6;
      fy = (fx * 0.6 + fy * 0.8) * lacunarity;
      fx = rx * lacunarity;
    }
    return total / norm;
  }

  /** Derivative-damped fBm (IQ): detail fades where the accumulated slope is steep. Roughly [-1, 1]. */
  eroded(x, y, octaves = 6, damping = 1.4) {
    let amplitude = 1;
    let total = 0;
    let norm = 0;
    let dx = 0;
    let dy = 0;
    let fx = x;
    let fy = y;
    for (let i = 0; i < octaves; i += 1) {
      const n = this.valueD(fx, fy, derivative);
      dx += n.dx;
      dy += n.dy;
      total += (amplitude * n.v) / (1 + damping * (dx * dx + dy * dy));
      norm += amplitude;
      amplitude *= 0.5;
      const rx = fx * 0.8 - fy * 0.6;
      fy = (fx * 0.6 + fy * 0.8) * 2;
      fx = rx * 2;
    }
    return total / norm;
  }
}
