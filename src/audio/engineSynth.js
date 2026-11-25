// Procedural engine layer: the exhaust pulse train of each car's own engine.
//
// The recorded loops in engine.m4a are one engine. To make each car sound like its own engine, the
// AudioEngine mixes them with a synthesised pulse train built from that engine's firing pattern:
//
//   * One four-stroke cycle is 720 crank degrees, so the cycle repeats at rpm / 120 Hz. Every cylinder
//     fires once per cycle, and each firing sends one exhaust pulse down the pipe.
//   * Even firing (inline-four every 180 deg, flat-six every 120 deg) puts all the energy on multiples of
//     the firing frequency (2nd engine order for a four, 3rd for a six). Anything that makes the pulses
//     unequal (bank-to-bank differences, unequal-length headers) adds the half orders in between, which is
//     what the ear hears as a "rumble" (Subaru boxer) or "rasp" (flat-six banks).
//   * The pulse shape (a fast rise and an exponential fall) sets how bright the note is; a turbine or a
//     diesel particulate filter rounds the pulses off, an open race exhaust keeps them sharp.
//
// pulseSeries() computes the Fourier series of one cycle analytically (sum of the per-cylinder pulses,
// each delayed by its firing angle plus its header stagger), which Web Audio plays as a PeriodicWave
// oscillator at rpm / 120 Hz: no per-sample script, two oscillators per car. Everything in this file is
// pure math so it can be tested in Node; the Web Audio wiring lives in AudioEngine.js.

export const CYCLE_DEG = 720;
export const HARMONICS = 160;
/** RMS of one recorded engine loop in engine.m4a (all 16 layers are normalised to it). */
export const SAMPLE_RMS = 0.12;

/**
 * Per-car synth defaults. `firing`: crank angle (deg, 0..720) of each cylinder's exhaust pulse in firing
 * order; `stagger`: extra pulse-arrival delay per cylinder (deg) from unequal header lengths, applied in full
 * at low rpm and scaled by `highStagger` at the top end; `amps`: relative pulse strength per cylinder at the
 * tailpipe; `pulse`: pulse decay as a fraction of the cycle at [idle, redline] (bigger = rounder, darker);
 * `level`: synth share relative to one recorded layer; `sample`: share of the recorded loops; `exhaust`:
 * [Hz, Q, dB] pipe / muffler resonance; `lowpass`: [Hz at idle and no load, Hz at redline full load];
 * `drive`: soft-clip amount (rasp); `rough`: cycle-to-cycle combustion variation; `jitter`: rpm wander (cents).
 */
export const SYNTH_DEFAULTS = Object.freeze({
  firing: Object.freeze([0, 180, 360, 540]),
  stagger: Object.freeze([0, 0, 0, 0]),
  amps: Object.freeze([1, 1, 1, 1]),
  highStagger: 0.4,
  pulse: Object.freeze([0.03, 0.02]),
  level: 0.5,
  sample: 0.7,
  exhaust: Object.freeze([160, 1.2, 4]),
  lowpass: Object.freeze([700, 7000]),
  drive: 0.4,
  rough: 0.35,
  jitter: 8,
});

function num(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function list(v, fallback, n) {
  if (!Array.isArray(v) || v.length === 0) return fallback;
  if (n !== undefined && v.length !== n) return fallback;
  return v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? v : fallback;
}

/** Fill a profile's `synth` block with defaults; null when the profile has no synth layer. */
export function resolveSynth(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const d = SYNTH_DEFAULTS;
  const firing = list(spec.firing, d.firing);
  const n = firing.length;
  return {
    firing,
    stagger: list(spec.stagger, new Array(n).fill(0), n),
    amps: list(spec.amps, new Array(n).fill(1), n),
    highStagger: num(spec.highStagger, d.highStagger),
    pulse: list(spec.pulse, d.pulse, 2),
    level: Math.max(0, num(spec.level, d.level)),
    sample: Math.max(0, num(spec.sample, d.sample)),
    exhaust: list(spec.exhaust, d.exhaust, 3),
    lowpass: list(spec.lowpass, d.lowpass, 2),
    drive: Math.max(0, num(spec.drive, d.drive)),
    rough: Math.max(0, num(spec.rough, d.rough)),
    jitter: Math.max(0, num(spec.jitter, d.jitter)),
  };
}

/** Engine cycle frequency (one 720 deg four-stroke cycle). */
export function cycleHz(rpm) {
  return Math.max(0, num(rpm, 0)) / 120;
}

/** Firing frequency: cylinders firing per second. */
export function firingHz(rpm, cylinders) {
  return cycleHz(rpm) * Math.max(1, num(cylinders, 4));
}

/**
 * Fourier coefficients of one cycle of exhaust pulses, in createPeriodicWave(real, imag) form
 * (wave = sum real[h] cos(2 pi h t) + imag[h] sin(2 pi h t), t in cycles).
 * stagger scales the header stagger, pulse is the pulse decay time (fraction of the cycle).
 */
export function pulseSeries(synth, { stagger = 1, pulse = 0.025, harmonics = HARMONICS } = {}) {
  const s = resolveSynth(synth) || resolveSynth({});
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  const tau = Math.max(1e-4, pulse);
  const angles = s.firing.map((a, k) => (a + stagger * s.stagger[k]) / CYCLE_DEG);
  for (let h = 1; h <= harmonics; h += 1) {
    // Pulse spectrum: two-pole decay 1 / (1 + i w)^2, w = 2 pi h tau.
    const w = 2 * Math.PI * h * tau;
    const den = (1 + w * w) * (1 + w * w);
    const pr = (1 - w * w) / den;
    const pi = (-2 * w) / den;
    // Sum of the cylinders' pulses, each delayed by its arrival angle.
    let sr = 0;
    let si = 0;
    for (let k = 0; k < angles.length; k += 1) {
      const ph = -2 * Math.PI * h * angles[k];
      sr += s.amps[k] * Math.cos(ph);
      si += s.amps[k] * Math.sin(ph);
    }
    const cr = pr * sr - pi * si;
    const ci = pr * si + pi * sr;
    real[h] = 2 * cr;
    imag[h] = -2 * ci;
  }
  return { real, imag };
}

/** Time-domain peak and RMS of a series (and of the same wave normalised to peak 1, as Web Audio plays it). */
export function waveStats(series, points = 1024) {
  const { real, imag } = series;
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < points; i += 1) {
    const t = i / points;
    let v = 0;
    for (let h = 1; h < real.length; h += 1) {
      const ph = 2 * Math.PI * h * t;
      v += real[h] * Math.cos(ph) + imag[h] * Math.sin(ph);
    }
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
  }
  const rms = Math.sqrt(sum / points);
  return { peak, rms, normRms: peak > 0 ? rms / peak : 0 };
}

/**
 * Share of the wave's energy outside the firing orders (harmonics of the cycle that are not multiples of
 * the cylinder count): 0 for a perfectly even engine, larger for a lumpier / rumblier one.
 */
export function unevenness(series, cylinders) {
  const { real, imag } = series;
  const n = Math.max(1, Math.round(cylinders));
  let off = 0;
  let total = 0;
  for (let h = 1; h < real.length; h += 1) {
    const e = real[h] * real[h] + imag[h] * imag[h];
    total += e;
    if (h % n !== 0) off += e;
  }
  return total > 0 ? off / total : 0;
}

/** Energy of the series in cycle harmonic h, relative to the total. */
export function harmonicShare(series, h) {
  const { real, imag } = series;
  let total = 0;
  for (let k = 1; k < real.length; k += 1) total += real[k] * real[k] + imag[k] * imag[k];
  return total > 0 ? (real[h] * real[h] + imag[h] * imag[h]) / total : 0;
}

/** Spectral centroid of the series in cycle harmonics (brightness, independent of rpm). */
export function centroid(series) {
  const { real, imag } = series;
  let num_ = 0;
  let den = 0;
  for (let h = 1; h < real.length; h += 1) {
    const a = Math.hypot(real[h], imag[h]);
    num_ += h * a;
    den += a;
  }
  return den > 0 ? num_ / den : 0;
}

/**
 * The two waves a car's synth crossfades between (low rpm: full header stagger, its idle pulse width;
 * high rpm: reduced stagger, its redline pulse width) and the gain that brings each to the recorded
 * loops' RMS. Cached per synth block.
 */
const cache = new WeakMap();
export function synthWaves(synth) {
  const s = resolveSynth(synth);
  if (!s) return null;
  if (synth && typeof synth === 'object' && cache.has(synth)) return cache.get(synth);
  const low = pulseSeries(s, { stagger: 1, pulse: s.pulse[0] });
  const high = pulseSeries(s, { stagger: s.highStagger, pulse: s.pulse[1] });
  const lowStats = waveStats(low);
  const highStats = waveStats(high);
  const out = {
    spec: s,
    low,
    high,
    lowTrim: lowStats.normRms > 0 ? SAMPLE_RMS / lowStats.normRms : 0,
    highTrim: highStats.normRms > 0 ? SAMPLE_RMS / highStats.normRms : 0,
  };
  if (synth && typeof synth === 'object') cache.set(synth, out);
  return out;
}

/**
 * Turbo spool target 0..1: boost needs load and exhaust flow above the spool threshold.
 * spoolRpm: [rpm where boost starts, rpm of full boost]. antiLag keeps the turbine lit off throttle.
 */
export function spoolTarget(rpm, load, spoolRpm = [1300, 2700], antiLag = 0) {
  const a = num(spoolRpm && spoolRpm[0], 1300);
  const b = Math.max(a + 1, num(spoolRpm && spoolRpm[1], 2700));
  const flow = Math.min(1, Math.max(0, (num(rpm, 0) - a) / (b - a)));
  const l = Math.min(1, Math.max(0, num(load, 0)));
  let target = l * flow;
  if (antiLag > 0 && num(rpm, 0) > a) target = Math.max(target, Math.min(1, antiLag) * 0.8);
  return target;
}

/**
 * Straight-cut gear whine: [input head-set mesh (follows rpm), final-drive mesh (follows road speed)] in Hz.
 * whine: { teeth: head-set teeth, perMps: final-drive mesh Hz per m/s of road speed }.
 */
export function whineHz(rpm, speed, whine) {
  const teeth = num(whine && whine.teeth, 23);
  const perMps = num(whine && whine.perMps, 20);
  return [(Math.max(0, num(rpm, 0)) / 60) * teeth, Math.max(0, num(speed, 0)) * perMps];
}
