// Sample-based vehicle audio (Web Audio API).
//
// Every car sound is a real recording or is cut / re-synthesised offline from one. The derived
// sprites are built by tools/audio/build_car_audio.py from the originals in car-sound/:
//
//   engine.m4a  16 seamless engine loops: 8 rpm points (900..7600) x on-load / off-load.
//               Source: "Car engine 2" (ID 0291), BigSoundBank.com (free licence, royalty-free).
//               Every engine cycle of the recording's two throttle ramps (on-load) and closed-throttle
//               decays (off-load) is cut into a pitch-synchronous grain; each layer is a TD-PSOLA
//               re-synthesis at an exact firing rate (rpm / 15 Hz) with natural cycle-to-cycle variation.
//   loops.m4a   skid       - Kenney "Racing Pack" skid (CC0)
//               skidHeavy  - "Screeching tires 1" (ID 2368), BigSoundBank.com
//               nitro      - nitro.ogg recorded N2O hiss (origin unknown, supplied with the project)
//               gravel     - granular stream of tiny Kenney impact transients (CC0)
//               scrape     - granular Kenney impact metal ring over chattered recorded hiss
//   sfx.m4a     crackle0-7 / brap0-2 - real overrun crackles cut from the BigSoundBank engine decays
//               clunkUp / clunkDown  - gear-shift.wav mechanical click (origin unknown) + Kenney thud
//               solenoid / purge     - gear-shift.wav tick, nitro.ogg hiss burst
//               impactLight / impact / impactBody / debris / landing - Kenney impact (CC0), processed
//               chirp                - onset of the BigSoundBank tyre screech
//
// Engine model (the classic rpm-indexed loop crossfade used by racing games, fed by granular-built
// loops): the two layers bracketing the rpm play with playbackRate = rpm / layerRpm and an equal-power
// crossfade in log-rpm; on-load and off-load sets crossfade by effective load (throttle, minus shift
// cuts and limiter cuts, plus idle support). Load also drives a soft-clip drive path, the tone
// low-pass and an intake band. Shifts cut the throttle, clunk, and blat (up) or blip (down); the rev
// limiter cuts the ignition in a ~14 Hz bounce with backfires; lift-off at high rpm crackles.
//
// Continuous beds are built once in unlock(); update() only moves AudioParams (no nodes per frame).
// Every bed gain also gets a scheduled fade-out a short time in the future that the next update() cancels.
// With no AudioContext, a context that failed to build, or after dispose(), every method is a silent no-op.

import { SURFACE, SURFACE_PROPS } from '../config.js';
import { SPRITES } from './audioSprites.js';

const HAS_URL = typeof URL !== 'undefined' && typeof import.meta !== 'undefined' && Boolean(import.meta.url);
const ENGINE_URL = HAS_URL ? new URL('../assets/audio/engine.m4a', import.meta.url).href : '';
const LOOPS_URL = HAS_URL ? new URL('../assets/audio/loops.m4a', import.meta.url).href : '';
const SFX_URL = HAS_URL ? new URL('../assets/audio/sfx.m4a', import.meta.url).href : '';

const WATCHDOG = 0.3; // seconds after the last update() before beds fade out on their own
const NOISE_SECONDS = 2;
const EMPTY = Object.freeze([]);
/**
 * Per-car engine character (setProfile). The loops were built at 4 firing pulses per revolution
 * (rpm / 15 Hz); `fires` sets the car's own (flat-six 3, inline-four 2), so the pitch follows its firing
 * frequency. tone / intake / drive / body scale the filter ceiling, intake band, distortion and exhaust
 * body; crackle scales overrun pops (0 for a diesel); clatter and turbo add diesel injector tick and
 * turbo whistle.
 */
const DEFAULT_PROFILE = Object.freeze({ fires: 4, tone: 1, intake: 1, intakeFreq: [500, 2100], drive: 1, body: 1, crackle: 1, clatter: 0, turbo: 0 });

const CRACKLES = ['crackle0', 'crackle1', 'crackle2', 'crackle3', 'crackle4', 'crackle5', 'crackle6', 'crackle7'];
const BRAPS = ['brap0', 'brap1', 'brap2'];

// Decoded sample bank, shared by every AudioEngine instance (AudioBuffers are context-independent).
const bank = { engine: null, loops: null, sfx: null };
let loadPromise = null;

function saturate(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function finite(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function isLoose(surface) {
  return surface === SURFACE.GRAVEL || surface === SURFACE.DIRT || surface === SURFACE.SNOW;
}

function gearNumber(g) {
  if (g === 'R') return -1;
  if (g === 'N') return 0;
  return finite(Number(g), 1);
}

async function fetchDecoded(ctx, url) {
  if (!url || typeof globalThis.fetch !== 'function') return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.arrayBuffer();
    return await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(data, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
  } catch {
    return null;
  }
}

/** Copy [start, start + length) seconds of channel 0 into a new buffer; optionally trim leading silence. */
function slice(ctx, buf, start, length, trimLead) {
  const sr = buf.sampleRate;
  const src = buf.getChannelData(0);
  let a = Math.max(0, Math.min(src.length - 1, Math.round(start * sr)));
  let n = Math.max(1, Math.min(src.length - a, Math.round(length * sr)));
  if (trimLead) {
    let peak = 0;
    for (let i = a; i < a + n; i += 1) peak = Math.max(peak, Math.abs(src[i]));
    const thr = peak * 0.03;
    let first = a;
    while (first < a + n - 1 && Math.abs(src[first]) < thr) first += 1;
    const b = Math.max(a, first - Math.round(0.0015 * sr));
    n -= b - a;
    a = b;
  }
  const out = ctx.createBuffer(1, n, sr);
  out.getChannelData(0).set(src.subarray(a, a + n));
  return out;
}

function buildBank(ctx, engineBuf, loopsBuf, sfxBuf) {
  if (engineBuf && !bank.engine) {
    const E = SPRITES.engine;
    const on = [];
    const off = [];
    const rpm = [];
    for (const layer of E.layers) {
      // Loops are stored as two periods + margin: one exact period from the middle is seamless
      // whatever delay the AAC decoder adds.
      const b = slice(ctx, engineBuf, layer.start + E.loop * 0.5, E.loop, false);
      if (layer.load === 'on') {
        on.push(b);
        rpm.push(layer.rpm);
      } else off.push(b);
    }
    if (on.length > 1 && on.length === off.length) bank.engine = { on, off, rpm };
  }
  if (loopsBuf && !bank.loops) {
    const loops = {};
    for (const [name, s] of Object.entries(SPRITES.loops)) loops[name] = slice(ctx, loopsBuf, s.start + s.loop * 0.5, s.loop, false);
    bank.loops = loops;
  }
  if (sfxBuf && !bank.sfx) {
    const sfx = {};
    for (const [name, s] of Object.entries(SPRITES.sfx)) sfx[name] = slice(ctx, sfxBuf, s.start, s.length, true);
    bank.sfx = sfx;
  }
}

export class AudioEngine {
  constructor({ volume = 0.8 } = {}) {
    this.ctx = null;
    this._g = null; // graph nodes
    this._volume = saturate(finite(volume, 0.8));
    this._muted = false;
    this._platformMuted = false;
    this._adMuted = false;
    this._disposed = false;
    this._cool = Object.create(null);
    this._onVisibility = null;
    this._profile = DEFAULT_PROFILE;
    this._spool = 0;
    this._resetDrive();
  }

  get muted() {
    return this._muted || this._platformMuted || this._adMuted;
  }

  get volume() {
    return this._volume;
  }

  /** Create / resume the AudioContext. Call from a user gesture. Resolves true when audio is running. */
  async unlock() {
    try {
      if (this._disposed) return false;
      if (!this.ctx) {
        const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (typeof Ctor !== 'function') return false;
        let ctx;
        try {
          ctx = new Ctor({ latencyHint: 'interactive' });
        } catch {
          return false;
        }
        this.ctx = ctx;
        try {
          this._build();
          this._loadSamples();
        } catch {
          this._teardown();
          return false;
        }
        this._watchVisibility();
      }
      if (this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
        try {
          await this.ctx.resume();
        } catch {
          // Autoplay policy: stays suspended until a later gesture calls unlock() again.
        }
      }
      return Boolean(this.ctx) && this.ctx.state === 'running';
    } catch {
      return false;
    }
  }

  /** The car's engine character (see DEFAULT_PROFILE); null restores the default. */
  setProfile(profile) {
    this._profile = { ...DEFAULT_PROFILE, ...(profile || {}) };
  }

  setVolume(value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    this._volume = saturate(v);
    this._applyOutput();
  }

  setMuted(value) {
    this._muted = Boolean(value);
    this._applyOutput();
    return this.muted;
  }

  setPlatformMuted(value) {
    this._platformMuted = Boolean(value);
    if (this._platformMuted) this.silence();
    this._applyOutput();
    return this.muted;
  }

  setAdMuted(value) {
    this._adMuted = Boolean(value);
    if (this._adMuted) this.silence();
    this._applyOutput();
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this._muted);
  }

  /** Drive every continuous sound from the vehicle state. Call every frame while a run is active. */
  update(dt, state, options) {
    if (!this._live()) return;
    try {
      this._update(dt, state, options || EMPTY);
    } catch {
      // Never let audio break the frame loop.
    }
  }

  /** Fade the engine, tyre, wind, scrape and nitro beds to zero (menus, pause). */
  silence() {
    if (!this._live()) return;
    try {
      const now = this.ctx.currentTime;
      for (const param of this._g.beds) {
        param.cancelScheduledValues(now);
        param.setTargetAtTime(0, now, 0.06);
      }
      const gate = this._g.limiterGate.gain;
      gate.cancelScheduledValues(now);
      gate.setTargetAtTime(1, now, 0.02);
      this._resetDrive();
    } catch {
      // ignore
    }
  }

  countdown(n) {
    if (!this._canPlay()) return;
    this._safe(() => {
      if (n === 'GO' || n === 0) {
        this._tone({ freq: 1046, dur: 0.5, vol: 0.2, type: 'triangle' });
        this._tone({ freq: 523, dur: 0.5, vol: 0.12, type: 'sine' });
      } else {
        this._tone({ freq: 523, dur: 0.16, vol: 0.18, type: 'triangle' });
        this._tone({ freq: 261.6, dur: 0.16, vol: 0.08, type: 'sine' });
      }
    });
  }

  ui() {
    if (!this._canPlay() || !this._cooldown('ui', 0.03)) return;
    this._safe(() => this._tone({ freq: 720, freqEnd: 820, dur: 0.06, vol: 0.08, type: 'sine', attack: 0.003 }));
  }

  /**
   * Gear change. update() already handles state.shifted with the full sequence (it knows the gear
   * direction and rpm), so a call in the same frame is ignored; a bare call plays the clunk.
   */
  shift() {
    if (this._shiftFrame) return;
    if (!this._canPlay() || !this._cooldown('shift', 0.08)) return;
    this._safe(() => {
      if (!this._shot('clunkUp', 0.34, 0.96 + Math.random() * 0.08)) {
        this._noise({ dur: 0.05, vol: 0.08, filter: 'lowpass', freq: 900, attack: 0.002 });
      }
    });
  }

  checkpoint() {
    if (!this._canPlay() || !this._cooldown('checkpoint', 0.1)) return;
    this._safe(() => {
      this._tone({ freq: 988, dur: 0.12, vol: 0.13, type: 'triangle' });
      this._tone({ freq: 1319, dur: 0.22, vol: 0.13, type: 'triangle', when: 0.08 });
    });
  }

  finish() {
    if (!this._canPlay() || !this._cooldown('finish', 0.5)) return;
    this._safe(() => {
      const notes = [523.3, 659.3, 784, 1046.5];
      for (let i = 0; i < notes.length; i += 1) {
        const last = i === notes.length - 1;
        this._tone({ freq: notes[i], dur: last ? 0.7 : 0.16, vol: last ? 0.16 : 0.12, type: 'triangle', when: i * 0.09 });
      }
      this._tone({ freq: 261.6, dur: 0.9, vol: 0.08, type: 'sine', when: 0.27 });
    });
  }

  respawn() {
    if (!this._canPlay() || !this._cooldown('respawn', 0.2)) return;
    this._safe(() => {
      this._noise({ dur: 0.38, vol: 0.12, filter: 'bandpass', freq: 2200, freqEnd: 300, q: 1.2, attack: 0.03 });
      this._tone({ freq: 420, freqEnd: 110, dur: 0.32, vol: 0.1, type: 'sine', attack: 0.01 });
    });
  }

  /** Collision. strengthMps: closing speed in m/s. Light taps, solid hits and heavy crashes layer differently. */
  impact(strengthMps) {
    const strength = finite(strengthMps, 0);
    if (strength < 0.5 || !this._canPlay()) return;
    const s = saturate((strength - 0.5) / 14);
    // Within the cooldown only a clearly harder hit gets through.
    const now = this.ctx.currentTime;
    if (now - finite(this._cool.impact, -1) < 0.07 && s < this._lastImpact + 0.2) return;
    this._cool.impact = now;
    this._lastImpact = s;
    this._safe(() => {
      const rate = (0.93 + Math.random() * 0.14) * (1.06 - 0.16 * s);
      if (!bank.sfx) {
        this._noise({ dur: 0.1 + 0.2 * s, vol: 0.06 + 0.24 * s, filter: 'lowpass', freq: 700 + 2200 * s, freqEnd: 250, attack: 0.002 });
        return;
      }
      if (s < 0.2) {
        this._shot('impactLight', 0.16 + 1.1 * s, rate * 1.1);
        return;
      }
      this._shot('impact', 0.26 + 0.5 * s, rate);
      this._shot('impactBody', 0.18 + 0.6 * s, rate * 0.95);
      if (s > 0.45) this._shot('debris', 0.12 + 0.45 * (s - 0.45) / 0.55, 0.9 + Math.random() * 0.25, 0.012 + Math.random() * 0.03);
    });
  }

  /** Suspension bottoming out on touchdown. strengthMps: vertical speed absorbed. */
  landing(strengthMps) {
    const strength = finite(strengthMps, 0);
    if (strength < 1 || !this._canPlay() || !this._cooldown('landing', 0.12)) return;
    this._safe(() => {
      const s = saturate((strength - 1) / 10);
      if (!bank.sfx) {
        this._noise({ dur: 0.14, vol: 0.05 + 0.15 * s, filter: 'lowpass', freq: 400, freqEnd: 150, attack: 0.003 });
        return;
      }
      this._shot('landing', 0.2 + 0.55 * s, 0.94 + Math.random() * 0.14);
      if (s > 0.45) this._shot('impactBody', 0.3 * s, 0.85 + Math.random() * 0.1, 0.01);
    });
  }

  dispose() {
    this._disposed = true;
    this._teardown();
  }

  // ------------------------------------------------------------------ internals

  _resetDrive() {
    this._load = 0;
    this._prevThrottle = 0;
    this._prevBoost = false;
    this._prevGear = null;
    this._shiftFrame = false;
    this._cut = 0; // seconds of shift throttle cut left
    this._blip = 0; // downshift blip, 1 -> 0
    this._overrun = 0; // crackle energy after a lift-off
    this._limiterNext = 0;
    this._limiterCutEnd = 0;
    this._jit = 0;
    this._lope = 0;
    this._skidAmt = 0;
    this._skidLow = 0; // time since the screech was last quiet (for the onset chirp)
    this._lastImpact = 0;
    this._lastCrackle = -1;
  }

  _live() {
    return !this._disposed && this.ctx !== null && this._g !== null && this.ctx.state !== 'closed';
  }

  /** One-shots only while the context is actually running, so nothing piles up while suspended. */
  _canPlay() {
    return this._live() && !this.muted && this.ctx.state === 'running';
  }

  _safe(fn) {
    try {
      fn();
    } catch {
      // ignore
    }
  }

  _cooldown(name, seconds) {
    const now = this.ctx.currentTime;
    const last = this._cool[name];
    if (last !== undefined && now - last < seconds && now >= last) return false;
    this._cool[name] = now;
    return true;
  }

  _applyOutput() {
    if (!this._live()) return;
    try {
      const g = this._g.output.gain;
      const now = this.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(this.muted ? 0 : this._volume, now, 0.05);
    } catch {
      // ignore
    }
  }

  _watchVisibility() {
    const doc = globalThis.document;
    if (!doc || typeof doc.addEventListener !== 'function') return;
    this._onVisibility = () => {
      if (doc.visibilityState === 'hidden') this.silence();
    };
    doc.addEventListener('visibilitychange', this._onVisibility);
  }

  _teardown() {
    const doc = globalThis.document;
    if (this._onVisibility && doc && typeof doc.removeEventListener === 'function') {
      try {
        doc.removeEventListener('visibilitychange', this._onVisibility);
      } catch {
        // ignore
      }
    }
    this._onVisibility = null;
    if (this._g) {
      for (const source of this._g.sources) {
        try {
          source.stop();
        } catch {
          // ignore
        }
        try {
          source.disconnect();
        } catch {
          // ignore
        }
      }
    }
    if (this.ctx && typeof this.ctx.close === 'function') {
      try {
        const closing = this.ctx.close();
        if (closing && typeof closing.catch === 'function') closing.catch(() => {});
      } catch {
        // ignore
      }
    }
    this._g = null;
    this.ctx = null;
  }

  _build() {
    const ctx = this.ctx;
    const sources = [];
    const beds = [];

    const gain = (value, to) => {
      const node = ctx.createGain();
      node.gain.value = value;
      if (to) node.connect(to);
      return node;
    };
    const filter = (type, freq, q, to) => {
      const node = ctx.createBiquadFilter();
      node.type = type;
      node.frequency.value = freq;
      node.Q.value = q;
      if (to) node.connect(to);
      return node;
    };
    const compressor = (threshold, knee, ratio, attack, release, to) => {
      const node = ctx.createDynamicsCompressor();
      node.threshold.value = threshold;
      node.knee.value = knee;
      node.ratio.value = ratio;
      node.attack.value = attack;
      node.release.value = release;
      node.connect(to);
      return node;
    };

    // Master chain.
    const output = gain(this.muted ? 0 : this._volume, ctx.destination);
    const limiter = compressor(-2, 0, 20, 0.002, 0.12, output);
    const glue = compressor(-18, 10, 3, 0.008, 0.25, limiter);
    const mix = gain(0.9, glue);
    const engineBus = gain(0.85, mix);
    const tireBus = gain(0.7, mix);
    const envBus = gain(0.55, mix);
    const sfxBus = gain(0.9, mix);

    // Shared white noise (wind, road roar, grass: physically broadband noise sources).
    const length = Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS));
    const noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const noiseSource = (to) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      src.connect(to);
      src.start(0, Math.random() * NOISE_SECONDS * 0.9);
      sources.push(src);
      return src;
    };

    // ---- engine: layers -> on/off buses -> clean + soft-clipped drive -> tone -> exhaust body -> limiter gate
    const engineAmp = gain(0, engineBus);
    const limiterGate = gain(1, engineAmp);
    const body = filter('peaking', 95, 0.9, limiterGate);
    body.gain.value = 0;
    const tone = filter('lowpass', 6000, 0.6, body);
    const clean = gain(1, tone);
    const driveMix = gain(0, tone);
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDriveCurve(2.4);
    shaper.oversample = '2x';
    shaper.connect(driveMix);
    const drivePre = gain(2.2, shaper);
    const engineIn = gain(1, clean);
    engineIn.connect(drivePre);
    const onBus = gain(0, engineIn);
    const offBus = gain(0, engineIn);
    const intakeGain = gain(0, limiterGate);
    const intakeFilter = filter('bandpass', 900, 1.1, intakeGain);
    onBus.connect(intakeFilter);
    // Minimal quiet fallback while / if the engine recording is unavailable.
    const fallbackGain = gain(0, engineIn);
    const fallbackTone = filter('lowpass', 500, 0.7, fallbackGain);
    const fallbackOsc = ctx.createOscillator();
    fallbackOsc.type = 'triangle';
    fallbackOsc.frequency.value = 60;
    fallbackOsc.connect(fallbackTone);
    fallbackOsc.start();
    sources.push(fallbackOsc);

    // ---- diesel: injector clatter (band-passed noise gated by a pulse at the firing rate) and turbo whistle
    const clatterLevel = gain(0, engineBus);
    const clatterVca = gain(0, clatterLevel);
    noiseSource(filter('bandpass', 3200, 1.4, clatterVca));
    const clatterOsc = ctx.createOscillator();
    clatterOsc.type = 'sawtooth';
    clatterOsc.frequency.value = 27;
    const pulse = ctx.createWaveShaper();
    pulse.curve = new Float32Array(Array.from({ length: 256 }, (_, i) => (i / 255 > 0.82 ? 1 : 0)));
    clatterOsc.connect(pulse);
    pulse.connect(clatterVca.gain);
    clatterOsc.start();
    sources.push(clatterOsc);
    const turboGain = gain(0, engineBus);
    const turboOsc = ctx.createOscillator();
    turboOsc.type = 'sine';
    turboOsc.frequency.value = 2200;
    turboOsc.connect(turboGain);
    turboOsc.start();
    sources.push(turboOsc);

    // ---- tyres and surfaces
    const skidFilter = filter('lowpass', 6000, 0.5, tireBus);
    const skidGain = gain(0, skidFilter);
    const skidHeavyGain = gain(0, skidFilter);
    const gravelGain = gain(0, tireBus);
    const gravelFilter = filter('lowpass', 5000, 0.5, gravelGain);
    const roadGain = gain(0, tireBus);
    const roadFilter = filter('lowpass', 400, 0.7, roadGain);
    noiseSource(roadFilter);
    const grassGain = gain(0, tireBus);
    const grassFilter = filter('bandpass', 1800, 0.6, grassGain);
    noiseSource(grassFilter);
    const scrapeGain = gain(0, tireBus);
    const scrapeFilter = filter('bandpass', 2000, 0.6, scrapeGain);

    // ---- wind and nitro
    const windGain = gain(0, envBus);
    const windFilter = filter('bandpass', 400, 0.5, windGain);
    noiseSource(windFilter);
    const buffetGain = gain(0, envBus);
    const buffetFilter = filter('lowpass', 110, 0.7, buffetGain);
    noiseSource(buffetFilter);
    const nitroGain = gain(0, envBus);
    const nitroFilter = filter('highpass', 300, 0.6, nitroGain);

    beds.push(
      engineAmp.gain, intakeGain.gain, fallbackGain.gain, clatterLevel.gain, turboGain.gain, skidGain.gain, skidHeavyGain.gain, gravelGain.gain,
      roadGain.gain, grassGain.gain, scrapeGain.gain, windGain.gain, buffetGain.gain, nitroGain.gain,
    );

    this._g = {
      output, sfxBus, noiseBuffer, sources, beds,
      engineAmp, limiterGate, body, tone, driveMix, onBus, offBus, intakeGain, intakeFilter,
      fallbackGain, fallbackTone, fallbackOsc, clatterLevel, clatterOsc, turboGain, turboOsc,
      layers: null, // { rpm, on: [{src, gain}], off: [...] }
      skidFilter, skidGain, skidHeavyGain, skidSrc: null, skidHeavySrc: null,
      gravelGain, gravelFilter, gravelSrc: null,
      roadGain, roadFilter, grassGain, scrapeGain, scrapeFilter, scrapeSrc: null,
      windGain, windFilter, buffetGain, nitroGain, nitroFilter, nitroSrc: null,
    };
  }

  _loadSamples() {
    if (!this._live() || typeof this.ctx.decodeAudioData !== 'function' || typeof this.ctx.createBuffer !== 'function') return;
    if (bank.engine && bank.loops && bank.sfx) {
      this._attachSamples();
      return;
    }
    if (typeof globalThis.fetch !== 'function') return;
    if (!loadPromise) {
      const ctx = this.ctx;
      loadPromise = Promise.all([
        fetchDecoded(ctx, ENGINE_URL),
        fetchDecoded(ctx, LOOPS_URL),
        fetchDecoded(ctx, SFX_URL),
      ]).then(([engine, loops, sfx]) => {
        try {
          buildBank(ctx, engine, loops, sfx);
        } catch {
          // keep whatever was built
        }
        if (!(bank.engine && bank.loops && bank.sfx)) loadPromise = null; // allow a retry on the next unlock
      }).catch(() => {
        loadPromise = null;
      });
    }
    loadPromise.then(() => this._attachSamples()).catch(() => {});
  }

  _loopSource(buffer, to, rate = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    src.connect(to);
    src.start(0, Math.random() * buffer.duration * 0.95);
    this._g.sources.push(src);
    return src;
  }

  _attachSamples() {
    if (!this._live()) return;
    const g = this._g;
    try {
      if (bank.engine && !g.layers) {
        const make = (buffers, bus) => buffers.map((b) => {
          const gn = this.ctx.createGain();
          gn.gain.value = 0;
          gn.connect(bus);
          return { src: this._loopSource(b, gn), gain: gn };
        });
        g.layers = { rpm: bank.engine.rpm, on: make(bank.engine.on, g.onBus), off: make(bank.engine.off, g.offBus) };
      }
      if (bank.loops && !g.skidSrc) {
        const L = bank.loops;
        if (L.skid) g.skidSrc = this._loopSource(L.skid, g.skidGain);
        if (L.skidHeavy) g.skidHeavySrc = this._loopSource(L.skidHeavy, g.skidHeavyGain);
        if (L.gravel) g.gravelSrc = this._loopSource(L.gravel, g.gravelFilter);
        if (L.scrape) g.scrapeSrc = this._loopSource(L.scrape, g.scrapeFilter);
        if (L.nitro) g.nitroSrc = this._loopSource(L.nitro, g.nitroFilter);
      }
    } catch {
      // ignore: whatever attached keeps working
    }
  }

  /** Bed gain: move toward value now, and schedule a fade-out in case update() stops arriving. */
  _bed(param, value, tc, now) {
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, tc);
    param.setTargetAtTime(0, now + WATCHDOG, 0.12);
  }

  _update(dt, state, options) {
    this._shiftFrame = false;
    if (!state || options.paused) {
      this.silence();
      return;
    }
    const g = this._g;
    const now = this.ctx.currentTime;
    dt = finite(dt, 0);
    if (dt < 0) dt = 0;
    if (dt > 0.25) dt = 0.25;

    // ---- vehicle telemetry
    const rpmMax = finite(state.rpmMax, 0) > 1000 ? state.rpmMax : 7200;
    const idle = Math.min(900, rpmMax * 0.125);
    const rpm = Math.min(rpmMax * 1.08, Math.max(idle * 0.85, finite(state.rpm, idle)));
    const rpmN = saturate((rpm - idle) / (rpmMax - idle));
    const throttle = saturate(finite(state.throttle, 0));
    const speed = Math.max(0, finite(state.speed, 0));
    const boosting = options.boosting !== undefined ? Boolean(options.boosting) : Boolean(state.boosting);
    const gear = gearNumber(state.gear);

    // ---- gear change sequence
    if (state.shifted) {
      this._shiftFrame = true;
      this._onShift(gear, rpmN, throttle);
    }
    this._prevGear = gear;
    this._cut = Math.max(0, this._cut - dt);
    this._blip = Math.max(0, this._blip - dt / 0.2);

    // ---- rev limiter: ignition cut bounce (~14 Hz) with the odd backfire
    const limiting = rpm >= rpmMax * 1.012 && throttle > 0.5;
    if (limiting && (now >= this._limiterNext || this._limiterNext - now > 1)) {
      const gate = g.limiterGate.gain;
      gate.cancelScheduledValues(now);
      gate.setTargetAtTime(0.28, now, 0.004);
      gate.setTargetAtTime(1, now + 0.032, 0.01);
      this._limiterCutEnd = now + 0.032;
      this._limiterNext = now + 0.064 + Math.random() * 0.018;
      if (Math.random() < 0.3) this._crackle(0.45 + 0.35 * Math.random(), Math.random() < 0.15);
    }
    const inCut = limiting && now < this._limiterCutEnd;

    // ---- effective engine load (what the cylinders are doing, not the pedal)
    let loadTarget = this._cut > 0 || inCut ? 0 : throttle;
    loadTarget = Math.max(loadTarget, 0.85 * this._blip, 0.35 * (1 - saturate((rpm - idle) / 700)));
    if (boosting && this._cut <= 0) loadTarget = 1;
    const tc = loadTarget > this._load ? 0.035 : 0.07;
    this._load += (loadTarget - this._load) * (1 - Math.exp(-dt / tc));
    const load = this._load;

    // ---- audio rpm: physics rpm + cycle jitter, idle lope, limiter dip, downshift blip
    this._jit += (Math.random() * 2 - 1) * 0.35 * Math.sqrt(dt * 60) - this._jit * Math.min(1, dt * 8);
    this._lope += dt * (1.1 + 0.5 * Math.random()) * Math.PI * 2;
    const idleness = 1 - saturate((rpm - idle) / 600);
    let rpmA = rpm * (1 + this._jit * (0.003 - 0.002 * rpmN) + idleness * 0.012 * Math.sin(this._lope));
    if (inCut) rpmA *= 0.985;
    rpmA *= 1 + 0.05 * this._blip;

    // The loops fire 4 times a revolution; scale so the pitch matches this car's firing frequency.
    this._engine(rpmA * this._profile.fires / 4, rpmN, load, boosting, now);
    this._diesel(rpm, rpmN, load, dt, now);

    // ---- overrun: crackle and burble when the throttle is shut at high rpm
    if (this._prevThrottle > 0.6 && throttle < 0.15 && rpmN > 0.45) {
      this._overrun = 0.5 + 0.5 * rpmN;
      if (Math.random() < 0.7) this._crackle(0.5 + 0.3 * rpmN, rpmN > 0.65 && Math.random() < 0.35);
    }
    this._overrun *= Math.exp(-dt / 1.1);
    if (throttle < 0.15 && rpmN > 0.3 && !limiting && this._cut <= 0) {
      const rate = (0.8 + 8 * this._overrun) * rpmN;
      if (Math.random() < rate * dt) this._crackle((0.15 + 0.3 * Math.random()) * (0.6 + this._overrun));
    }

    // ---- nitro: solenoid click, pressurised hiss bed, purge release
    if (!this._prevBoost && boosting) this._shot('solenoid', 0.32, 0.95 + Math.random() * 0.1);
    if (this._prevBoost && !boosting) {
      this._shot('purge', 0.42, 0.95 + Math.random() * 0.12);
      this._shot('solenoid', 0.22, 0.9 + Math.random() * 0.1);
    }
    if (boosting) {
      this._bed(g.nitroGain.gain, 0.5, 0.04, now);
      if (g.nitroSrc) g.nitroSrc.playbackRate.setTargetAtTime(0.96 + 0.12 * rpmN, now, 0.1);
    } else {
      this._bed(g.nitroGain.gain, 0, 0.07, now);
    }
    this._prevThrottle = throttle;
    this._prevBoost = boosting;

    // ---- tyres and surfaces
    const wheels = Array.isArray(state.wheels) ? state.wheels : EMPTY;
    let screech = 0;
    let asphalt = 0;
    let rough = 0;
    let crunch = 0;
    let grass = 0;
    for (let i = 0; i < wheels.length; i += 1) {
      const w = wheels[i];
      if (!w || !w.contact) continue;
      const surface = finite(w.surface, SURFACE.ASPHALT) | 0;
      const props = SURFACE_PROPS[surface] || SURFACE_PROPS[SURFACE.ASPHALT];
      const slip = Math.max(0, finite(w.slip, 0));
      if (surface === SURFACE.ASPHALT || surface === SURFACE.ROCK) {
        asphalt += 1;
        screech += saturate((slip - 0.9) / 1.3) * (surface === SURFACE.ROCK ? 0.5 : 1);
        if (surface === SURFACE.ROCK) rough += props.roughness;
      } else {
        rough += props.roughness;
        if (isLoose(surface)) crunch += props.roughness * (1 + 1.5 * saturate(slip - 0.5));
        if (surface === SURFACE.GRASS) grass += 1 + saturate(slip - 0.5);
      }
    }
    let skid = saturate(screech / 2);
    if (options.drifting && asphalt > 0 && skid < 0.25) skid = 0.25;
    const speedGate = saturate((speed - 1.5) / 6);
    skid *= speedGate;
    this._skidAmt += (skid - this._skidAmt) * (1 - Math.exp(-dt / 0.04));
    const sk = this._skidAmt;
    const heavy = saturate((sk - 0.35) / 0.5);
    this._bed(g.skidGain.gain, 0.55 * Math.pow(sk, 0.7) * (1 - 0.6 * heavy), 0.04, now);
    this._bed(g.skidHeavyGain.gain, 0.6 * Math.pow(sk, 0.7) * heavy, 0.04, now);
    if (g.skidSrc) g.skidSrc.playbackRate.setTargetAtTime(0.88 + 0.22 * sk + Math.min(0.12, speed * 0.003), now, 0.05);
    if (g.skidHeavySrc) g.skidHeavySrc.playbackRate.setTargetAtTime(0.9 + 0.15 * sk, now, 0.05);
    g.skidFilter.frequency.setTargetAtTime(2500 + 9000 * sk, now, 0.05);
    // Drift chirp on a fresh break of traction.
    if (sk < 0.12) this._skidLow = 0;
    else this._skidLow += dt;
    if (skid > 0.4 && this._skidLow < 0.25 && speed > 5 && this._cooldown('chirp', 0.7)) {
      this._shot('chirp', 0.22 + 0.25 * skid, 0.9 + Math.random() * 0.25);
    }

    const crunchAmt = saturate(crunch / 4 / 0.4) * saturate(speed / 18);
    this._bed(g.gravelGain.gain, 0.6 * crunchAmt, 0.06, now);
    if (g.gravelSrc) g.gravelSrc.playbackRate.setTargetAtTime(0.75 + 0.55 * saturate(speed / 30), now, 0.1);
    g.gravelFilter.frequency.setTargetAtTime(2500 + 7000 * saturate(speed / 30), now, 0.1);
    const roughAmt = saturate(rough / 4 / 0.5);
    this._bed(g.roadGain.gain, (0.05 + 0.3 * roughAmt) * saturate(speed / 35), 0.08, now);
    g.roadFilter.frequency.setTargetAtTime(160 + Math.min(700, speed * 12), now, 0.1);
    this._bed(g.grassGain.gain, 0.06 * Math.min(2, grass / 2) * saturate(speed / 20), 0.08, now);

    // ---- body scraping along a wall / barrier
    const scrape = Math.max(0, finite(state.scrape, 0));
    const sc = saturate(scrape / 12);
    this._bed(g.scrapeGain.gain, sc > 0.01 ? 0.65 * Math.pow(sc, 0.6) : 0, 0.03, now);
    if (g.scrapeSrc) g.scrapeSrc.playbackRate.setTargetAtTime(0.75 + 0.5 * saturate(scrape / 25), now, 0.05);
    g.scrapeFilter.frequency.setTargetAtTime(1200 + 2800 * saturate(scrape / 25), now, 0.08);

    // ---- wind
    const windN = saturate(speed / 70);
    this._bed(g.windGain.gain, 0.22 * windN * windN, 0.15, now);
    g.windFilter.frequency.setTargetAtTime(300 + speed * 16, now, 0.15);
    this._bed(g.buffetGain.gain, 0.12 * windN * windN, 0.2, now);

    // ---- per-step collision events
    const impact = finite(state.impact, 0);
    if (impact > 1.5) this.impact(impact);
    const landing = finite(state.landing, 0);
    if (landing > 2) this.landing(landing);
  }

  /** Diesel extras: clatter ticking at the firing rate (loudest at idle) and the turbo spooling with load. */
  _diesel(rpm, rpmN, load, dt, now) {
    const g = this._g;
    const p = this._profile;
    if (!p.clatter && !p.turbo) {
      this._bed(g.clatterLevel.gain, 0, 0.1, now);
      this._bed(g.turboGain.gain, 0, 0.1, now);
      return;
    }
    g.clatterOsc.frequency.setTargetAtTime((rpm * p.fires) / 60, now, 0.02);
    this._bed(g.clatterLevel.gain, p.clatter * 0.09 * (1 - 0.65 * rpmN) * (0.55 + 0.45 * load), 0.05, now);
    const boostTarget = load * saturate((rpm - 1300) / 1400);
    this._spool += (boostTarget - this._spool) * (1 - Math.exp(-dt / (boostTarget > this._spool ? 0.6 : 0.25)));
    g.turboOsc.frequency.setTargetAtTime(2200 + 4800 * this._spool, now, 0.05);
    this._bed(g.turboGain.gain, p.turbo * 0.03 * this._spool * this._spool, 0.05, now);
  }

  /** Crossfade the rpm layers and shape the tone. */
  _engine(rpmA, rpmN, load, boosting, now) {
    const g = this._g;
    const L = g.layers;
    const level = (0.3 + 0.7 * Math.pow(rpmN, 0.9)) * (0.5 + 0.5 * load) * (boosting ? 1.15 : 1);
    this._bed(g.engineAmp.gain, 0.9 * level, 0.03, now);
    const onW = Math.sin(load * Math.PI / 2);
    const offW = Math.cos(load * Math.PI / 2);
    g.onBus.gain.setTargetAtTime(onW, now, 0.02);
    g.offBus.gain.setTargetAtTime(offW * 0.85, now, 0.02);

    if (L) {
      const rpms = L.rpm;
      const n = rpms.length;
      let i = 0;
      while (i < n - 2 && rpmA >= rpms[i + 1]) i += 1;
      const t = saturate(Math.log(rpmA / rpms[i]) / Math.log(rpms[i + 1] / rpms[i]));
      const lo = Math.cos(t * Math.PI / 2);
      const hi = Math.sin(t * Math.PI / 2);
      for (let k = 0; k < n; k += 1) {
        const w = k === i ? lo : k === i + 1 ? hi : 0;
        const on = L.on[k];
        const off = L.off[k];
        on.gain.gain.setTargetAtTime(w, now, 0.012);
        off.gain.gain.setTargetAtTime(w, now, 0.012);
        if (k >= i - 1 && k <= i + 2) {
          const rate = Math.max(0.25, Math.min(4, rpmA / rpms[k]));
          on.src.playbackRate.setTargetAtTime(rate, now, 0.012);
          off.src.playbackRate.setTargetAtTime(rate, now, 0.012);
        }
      }
      this._bed(g.fallbackGain.gain, 0, 0.05, now);
    } else {
      g.fallbackOsc.frequency.setTargetAtTime(rpmA / SPRITES.engine.rpmPerHz, now, 0.02);
      g.fallbackTone.frequency.setTargetAtTime(300 + 1500 * rpmN * (0.4 + 0.6 * load), now, 0.05);
      this._bed(g.fallbackGain.gain, 0.12, 0.05, now);
    }

    // Load and nitro: brighter, more driven, more intake; coasting is darker and cleaner.
    const p = this._profile;
    const cutoff = (1500 + 9500 * (0.25 + 0.75 * load) * (0.3 + 0.7 * rpmN) + (boosting ? 3500 : 0)) * p.tone;
    g.tone.frequency.setTargetAtTime(Math.min(16000, cutoff), now, 0.04);
    g.driveMix.gain.setTargetAtTime((0.05 + 0.35 * load * rpmN + (boosting ? 0.3 : 0)) * p.drive, now, 0.05);
    g.body.gain.setTargetAtTime(4 * load * (1 - 0.6 * rpmN) * p.body, now, 0.06);
    // A high-revving engine's intake howl grows over the last third of the rev range.
    const howl = p.intake > 1 ? 1 + (p.intake - 1) * saturate((rpmN - 0.55) / 0.35) : p.intake;
    this._bed(g.intakeGain.gain, (0.12 * load * (0.2 + 0.8 * rpmN)) * (boosting ? 1.4 : 1) * howl, 0.04, now);
    g.intakeFilter.frequency.setTargetAtTime(p.intakeFreq[0] + (p.intakeFreq[1] - p.intakeFreq[0]) * rpmN, now, 0.05);
  }

  _onShift(gear, rpmN, throttle) {
    if (!this._live()) return;
    const prev = this._prevGear;
    const up = prev === null ? true : gear > prev;
    if (up && gear > 1) {
      this._cut = 0.11; // ignition / throttle cut while the dog rings engage
      this._shot('clunkUp', 0.3 + 0.1 * Math.random(), 0.95 + Math.random() * 0.1);
      if (rpmN > 0.55 && throttle > 0.6 && Math.random() < 0.75) {
        this._crackle(0.45 + 0.25 * rpmN, Math.random() < 0.6, 0.015);
      }
    } else if (!up) {
      this._shot('clunkDown', 0.3 + 0.1 * Math.random(), 0.95 + Math.random() * 0.1);
      if (throttle < 0.6 && gear >= 1) {
        this._blip = 1; // rev-matching blip
        if (Math.random() < 0.4) this._crackle(0.3 + 0.2 * Math.random(), false, 0.16);
      }
    } else {
      this._shot('clunkDown', 0.2, 1.05);
    }
    this._cool.shift = this.ctx.currentTime;
  }

  /** A real overrun crackle (or a multi-crackle "brap") with random pitch and level. */
  _crackle(intensity, brap = false, delay = 0) {
    intensity *= this._profile.crackle;
    if (intensity <= 0) return; // diesels do not pop
    if (!this._canPlay() || !bank.sfx || !this._cooldown('crackle', brap ? 0.12 : 0.045)) return;
    let name;
    if (brap) name = BRAPS[Math.floor(Math.random() * BRAPS.length)];
    else {
      let k = Math.floor(Math.random() * CRACKLES.length);
      if (k === this._lastCrackle) k = (k + 1) % CRACKLES.length;
      this._lastCrackle = k;
      name = CRACKLES[k];
    }
    this._shot(name, Math.min(0.8, (brap ? 0.5 : 0.42) * saturate(intensity) + 0.08), 0.85 + Math.random() * 0.35, delay);
  }

  /** Play a decoded one-shot. Returns false if it is not available. */
  _shot(name, vol, rate = 1, delay = 0) {
    if (!this._canPlay() || !bank.sfx) return false;
    const buffer = bank.sfx[name];
    if (!buffer) return false;
    try {
      const ctx = this.ctx;
      const t = ctx.currentTime + Math.max(0, delay);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.setValueAtTime(rate, t);
      const env = ctx.createGain();
      env.gain.setValueAtTime(Math.max(0, vol), t);
      src.connect(env);
      env.connect(this._g.sfxBus);
      src.onended = () => {
        try {
          src.disconnect();
          env.disconnect();
        } catch {
          // ignore
        }
      };
      src.start(t);
      return true;
    } catch {
      return false;
    }
  }

  /** Enveloped oscillator one-shot (UI cues only). */
  _tone({ freq, freqEnd, dur, vol, type = 'sine', when = 0, attack = 0.006 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env);
    env.connect(this._g.sfxBus);
    osc.onended = () => {
      try {
        osc.disconnect();
        env.disconnect();
      } catch {
        // ignore
      }
    };
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Enveloped, filtered noise one-shot (UI cues and the no-sample fallback). */
  _noise({ dur, vol, filter = 'lowpass', freq = 1000, freqEnd, q = 0.8, when = 0, attack = 0.004 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this._g.noiseBuffer;
    const biquad = ctx.createBiquadFilter();
    biquad.type = filter;
    biquad.Q.value = q;
    biquad.frequency.setValueAtTime(freq, t);
    if (freqEnd) biquad.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(biquad);
    biquad.connect(env);
    env.connect(this._g.sfxBus);
    src.onended = () => {
      try {
        src.disconnect();
        biquad.disconnect();
        env.disconnect();
      } catch {
        // ignore
      }
    };
    src.start(t, Math.random() * (NOISE_SECONDS - dur - 0.1 > 0 ? NOISE_SECONDS - dur - 0.1 : 0));
    src.stop(t + dur + 0.05);
  }
}

/** Soft-clipping curve (tanh) for the engine drive path. */
function makeDriveCurve(k) {
  const n = 1024;
  const curve = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}
