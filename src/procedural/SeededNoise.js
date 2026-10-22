function seedFromValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value | 0;
  const text = String(value ?? 'mountain');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

function fade(value) {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export class SeededNoise {
  constructor(seed = 1) {
    this.seed = seedFromValue(seed);
  }

  hash2D(x, y, salt = 0) {
    let hash = this.seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 1442695041);
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
  }

  value2D(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const sx = fade(tx);
    const sy = fade(ty);
    const a = this.hash2D(x0, y0) * 2 - 1;
    const b = this.hash2D(x0 + 1, y0) * 2 - 1;
    const c = this.hash2D(x0, y0 + 1) * 2 - 1;
    const d = this.hash2D(x0 + 1, y0 + 1) * 2 - 1;
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
  }

  sample2D(x, y, frequency = 1) {
    return this.value2D(x * frequency, y * frequency);
  }

  fbm2D(x, y, options = {}) {
    const octaves = Math.max(1, Math.floor(options.octaves ?? 5));
    const frequency = options.frequency ?? 1;
    const lacunarity = options.lacunarity ?? 2;
    const gain = options.gain ?? 0.5;
    let amplitude = options.amplitude ?? 1;
    let frequencyValue = frequency;
    let total = 0;
    let normalization = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
      total += this.value2D(x * frequencyValue, y * frequencyValue) * amplitude;
      normalization += amplitude;
      frequencyValue *= lacunarity;
      amplitude *= gain;
    }
    return normalization > 0 ? total / normalization : 0;
  }

  ridged2D(x, y, options = {}) {
    const value = this.fbm2D(x, y, options);
    return 1 - Math.abs(value);
  }

  domainWarp2D(x, y, options = {}) {
    const strength = options.strength ?? 0.5;
    const frequency = options.frequency ?? 1;
    const offsetX = this.fbm2D(x + 17.13, y - 4.71, { ...options, frequency });
    const offsetY = this.fbm2D(x - 9.42, y + 11.82, { ...options, frequency });
    return { x: x + offsetX * strength, y: y + offsetY * strength };
  }
}

export function normalizeSeed(seed) {
  return seedFromValue(seed);
}
