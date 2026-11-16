import { smoothstep, DEG2RAD } from '../core/math.js';
import { Noise2D } from './noise.js';

/**
 * The mountain as analytic functions of (x, z).
 *
 * `base` is a smooth star-shaped cone: height falls monotonically along every ray from the summit,
 * so a (bearing, altitude) pair maps to exactly one point (`radiusFor`). Roads are laid out on it.
 * `macroDetail` adds the ridges and eroded relief that get faded out near roads, and `fixedDetail`
 * adds the features that never touch a road (surrounding ranges, the lake basin, fine ground texture).
 */
export class MountainShape {
  constructor(config, seed) {
    this.config = config;
    this.ridgeNoise = new Noise2D(seed + 11);
    this.warpNoise = new Noise2D(seed + 23);
    this.detailNoise = new Noise2D(seed + 37);
    this.microNoise = new Noise2D(seed + 53);
    this.rimNoise = new Noise2D(seed + 71);
    this.relief = config.peakHeight - config.valleyFloor;
    this.lobes = config.lobes.map(([harmonic, amplitude, phase]) => ({ harmonic, amplitude, phase }));
  }

  /** Footprint radius multiplier at a bearing (radians). Always positive. */
  footprint(theta) {
    let scale = 1;
    for (let i = 0; i < this.lobes.length; i += 1) {
      const lobe = this.lobes[i];
      scale += lobe.amplitude * Math.sin(lobe.harmonic * theta + lobe.phase);
    }
    return scale;
  }

  /** Normalised height 0..1 of the base cone (1 at the summit). */
  profileAt(x, z) {
    const { baseRadius, summitRounding, profilePower } = this.config;
    const radius = Math.hypot(x, z);
    const t = radius / (baseRadius * this.footprint(Math.atan2(z, x)));
    const rounded = Math.sqrt(t * t + summitRounding * summitRounding) - summitRounding;
    return rounded >= 1 ? 0 : Math.pow(1 - rounded, profilePower);
  }

  base(x, z) {
    return this.config.valleyFloor + this.relief * this.profileAt(x, z);
  }

  /** Distance from the summit at which the base cone reaches `altitude` along bearing `theta` (radians). */
  radiusFor(theta, altitude) {
    const { baseRadius, summitRounding, profilePower, valleyFloor } = this.config;
    const p = Math.min(1, Math.max(0, (altitude - valleyFloor) / this.relief));
    const rounded = 1 - Math.pow(p, 1 / profilePower);
    const t = Math.sqrt(Math.max(0, (rounded + summitRounding) * (rounded + summitRounding) - summitRounding * summitRounding));
    return t * baseRadius * this.footprint(theta);
  }

  radiusForDegrees(bearing, altitude) {
    return this.radiusFor(bearing * DEG2RAD, altitude);
  }

  /** Ridges and eroded relief in metres. Faded out near roads by the caller. */
  macroDetail(x, z) {
    const config = this.config;
    const p = this.profileAt(x, z);
    // Most rugged on the flanks, calmer on the valley floor and on the summit dome.
    const flank = (0.3 + 0.7 * smoothstep(0, 0.22, p)) * (1 - 0.75 * smoothstep(0.82, 1, p));
    const warpX = this.warpNoise.fbm(x / 520, z / 520, 2) * 0.55;
    const warpZ = this.warpNoise.fbm(x / 520 + 31.7, z / 520 - 12.4, 2) * 0.55;
    const ridge = this.ridgeNoise.ridged(x / config.ridgeScale + warpX, z / config.ridgeScale + warpZ, 5) - 0.42;
    const detail = this.detailNoise.eroded(x / config.detailScale, z / config.detailScale, 6);
    return (ridge * config.ridgeAmplitude + detail * config.detailAmplitude) * flank;
  }

  /** Features that are independent of the roads: outer ranges, the lake basin, fine ground texture. */
  fixedDetail(x, z) {
    const config = this.config;
    const radius = Math.hypot(x, z);
    let height = this.microNoise.fbm(x / config.microScale, z / config.microScale, 3) * config.microAmplitude;
    const rim = smoothstep(config.rimStart, config.rimStart + 460, radius);
    if (rim > 0) {
      const crest = this.rimNoise.ridged(x / 430, z / 430, 5);
      const roll = this.rimNoise.fbm(x / 900 + 7.1, z / 900 - 3.3, 3);
      height += rim * config.rimHeight * (0.45 + 0.75 * crest + 0.35 * roll);
    }
    const lake = config.lake;
    const lx = x - lake.x;
    const lz = z - lake.z;
    const lakeFalloff = Math.exp(-(lx * lx + lz * lz) / (lake.radius * lake.radius));
    if (lakeFalloff > 0.002) height -= lake.depth * lakeFalloff;
    return height;
  }
}
