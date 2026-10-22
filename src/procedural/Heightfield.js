import { SeededNoise } from './SeededNoise.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class Heightfield {
  constructor(options = {}) {
    this.seed = options.seed ?? 1337;
    this.noise = options.noise || new SeededNoise(this.seed);
    this.sizeX = options.sizeX ?? 320;
    this.sizeZ = options.sizeZ ?? 260;
    this.baseHeight = options.baseHeight ?? 0;
    this.amplitude = options.amplitude ?? 16;
    this.ridgeAmplitude = options.ridgeAmplitude ?? 12;
    this.detailAmplitude = options.detailAmplitude ?? 3.5;
    this.basinDepth = options.basinDepth ?? 10;
    this.basinRadius = options.basinRadius ?? 0.58;
    this.rimHeight = options.rimHeight ?? 27;
    this.rimRadius = options.rimRadius ?? 0.7;
    this.rimWidth = options.rimWidth ?? 0.2;
    this.edgeDrop = options.edgeDrop ?? 18;
    this.edgePower = options.edgePower ?? 2.2;
    this.frequency = options.frequency ?? 0.0045;
    this.detailFrequency = options.detailFrequency ?? 0.018;
    this.ridgeFrequency = options.ridgeFrequency ?? 0.008;
    this.octaves = options.octaves ?? 5;
    this.normalStep = options.normalStep ?? 0.35;
    this.bounds = {
      minX: -this.sizeX * 0.5,
      maxX: this.sizeX * 0.5,
      minZ: -this.sizeZ * 0.5,
      maxZ: this.sizeZ * 0.5,
    };
  }

  contains(x, z, padding = 0) {
    return x >= this.bounds.minX - padding && x <= this.bounds.maxX + padding && z >= this.bounds.minZ - padding && z <= this.bounds.maxZ + padding;
  }

  edgeFactor(x, z) {
    const nx = Math.abs((x - (this.bounds.minX + this.bounds.maxX) * 0.5) / (this.sizeX * 0.5));
    const nz = Math.abs((z - (this.bounds.minZ + this.bounds.maxZ) * 0.5) / (this.sizeZ * 0.5));
    const edge = Math.max(nx, nz);
    return clamp((edge - 0.72) / 0.28, 0, 1);
  }

  sampleHeight(x, z) {
    const warp = this.noise.domainWarp2D(x * this.frequency, z * this.frequency, {
      frequency: 0.9,
      octaves: 3,
      lacunarity: 2,
      gain: 0.5,
      strength: 0.55,
    });
    const macro = this.noise.fbm2D(warp.x, warp.y, {
      frequency: 1,
      octaves: this.octaves,
      lacunarity: 2.05,
      gain: 0.52,
    });
    const ridge = this.noise.ridged2D(x, z, {
      frequency: this.ridgeFrequency,
      octaves: 4,
      lacunarity: 2,
      gain: 0.52,
    });
    const detail = this.noise.fbm2D(x, z, {
      frequency: this.detailFrequency,
      octaves: 3,
      lacunarity: 2.2,
      gain: 0.48,
    });
    const nx = x / Math.max(1, this.sizeX * 0.5);
    const nz = z / Math.max(1, this.sizeZ * 0.5);
    const radial = Math.hypot(nx, nz);
    const angle = Math.atan2(nz, nx);
    const basin = -this.basinDepth * Math.exp(-((radial / this.basinRadius) ** 2));
    const rimEnvelope = Math.exp(-(((radial - this.rimRadius) / this.rimWidth) ** 2));
    const angularPeaks = clamp(
      0.62 + 0.18 * Math.sin(angle * 3 + 0.8) + 0.12 * Math.sin(angle * 7 - 1.7) + 0.08 * Math.cos(angle * 11 + 0.3),
      0.24,
      1.08,
    );
    const rim = rimEnvelope * this.rimHeight * angularPeaks;
    const shoulder = Math.exp(-(((radial - 0.42) / 0.26) ** 2)) * 3.5;
    const edge = this.edgeFactor(x, z);
    const edgeDrop = Math.pow(edge, this.edgePower) * this.edgeDrop;
    return this.baseHeight + macro * this.amplitude + (ridge - 0.5) * this.ridgeAmplitude + detail * this.detailAmplitude + basin + rim + shoulder - edgeDrop;
  }

  sampleNormal(x, z, step = this.normalStep) {
    const left = this.sampleHeight(x - step, z);
    const right = this.sampleHeight(x + step, z);
    const down = this.sampleHeight(x, z - step);
    const up = this.sampleHeight(x, z + step);
    const dx = (right - left) / (step * 2);
    const dz = (up - down) / (step * 2);
    const normal = { x: -dx, y: 1, z: -dz };
    const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
    return { x: normal.x / length, y: normal.y / length, z: normal.z / length };
  }

  sample(x, z, options = {}) {
    const height = this.sampleHeight(x, z);
    const normal = this.sampleNormal(x, z, options.normalStep ?? this.normalStep);
    const slope = Math.sqrt(normal.x * normal.x + normal.z * normal.z);
    const slopeAngle = Math.atan2(slope, normal.y);
    const inside = this.contains(x, z);
    return {
      x,
      z,
      height,
      normal,
      slope,
      slopeAngle,
      inside,
      edge: this.edgeFactor(x, z),
    };
  }

  getBounds() {
    return { ...this.bounds };
  }
}
