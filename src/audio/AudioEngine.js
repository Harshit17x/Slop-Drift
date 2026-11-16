// Fully synthesized game audio on the Web Audio API (no audio files).
//
// Graph:
//   engine (5 detuned oscillators -> drive -> waveshaper -> low-pass -> amp -> rev-limiter gate)  -> engineBus
//   intake noise (band-pass tracking the firing frequency)                                         -> engine amp
//   tire squeal (band-passed noise + wobbling tone), surface rumble (low-pass noise), gravel crunch -> tireBus
//   wind (band-passed noise), nitro hiss (high-passed noise)                                        -> envBus
//   one-shots (beeps, impacts, landings, pops, turbo flutter)                                       -> sfxBus
//   buses -> mix -> glue compressor -> limiter -> output volume -> destination
//
// Continuous beds are built once in unlock(); update() only moves AudioParams with setTargetAtTime.
// Every bed gain also gets a scheduled fade-out a short time in the future that the next update() cancels,
// so if update() stops being called (tab hidden, game loop stalled) the beds fade out on their own.
// With no AudioContext, a context that failed to build, or after dispose(), every method is a silent no-op.

import { SURFACE, SURFACE_PROPS } from '../config.js';

const WATCHDOG = 0.3; // seconds after the last update() before beds fade out on their own
const NOISE_SECONDS = 2;
const EMPTY = Object.freeze([]);

// Engine oscillator layers relative to the firing frequency.
const ENGINE_LAYERS = [
  { type: 'sawtooth', mult: 1, detune: -7, level: 0.42 },
  { type: 'sawtooth', mult: 1, detune: 6, level: 0.42 },
  { type: 'square', mult: 0.5, detune: 0, level: 0.3 }, // crank-order rumble
  { type: 'sawtooth', mult: 2, detune: 4, level: 0.16 },
  { type: 'triangle', mult: 3, detune: -3, level: 0.08 },
];

function saturate(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function finite(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function isLoose(surface) {
  return surface === SURFACE.GRAVEL || surface === SURFACE.DIRT || surface === SURFACE.ROCK || surface === SURFACE.SNOW;
}

export class AudioEngine {
  constructor({ volume = 0.8 } = {}) {
    this.ctx = null;
    this._g = null; // graph nodes
    this._volume = saturate(finite(volume, 0.8));
    this._muted = false;
    this._disposed = false;
    this._cool = Object.create(null);
    this._shiftDip = 0;
    this._limiterNext = 0;
    this._prevThrottle = 0;
    this._prevBoost = false;
    this._onVisibility = null;
  }

  get muted() {
    return this._muted;
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

  setVolume(value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    this._volume = saturate(v);
    this._applyOutput();
  }

  setMuted(value) {
    this._muted = Boolean(value);
    this._applyOutput();
    return this._muted;
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

  /** Fade the engine, tire, wind and nitro beds to zero (menus, pause). */
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

  shift() {
    if (!this._canPlay() || !this._cooldown('shift', 0.06)) return;
    this._safe(() => {
      this._noise({ dur: 0.05, vol: 0.1, filter: 'lowpass', freq: 900, attack: 0.002 });
      this._tone({ freq: 150, freqEnd: 90, dur: 0.07, vol: 0.09, type: 'triangle', attack: 0.002 });
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

  /** Collision. strengthMps: closing speed in m/s. */
  impact(strengthMps) {
    const strength = finite(strengthMps, 0);
    if (strength < 0.5 || !this._canPlay() || !this._cooldown('impact', 0.07)) return;
    this._safe(() => {
      const s = saturate((strength - 0.5) / 14);
      this._noise({ dur: 0.1 + 0.2 * s, vol: 0.08 + 0.32 * s, filter: 'lowpass', freq: 900 + 2200 * s, freqEnd: 300, attack: 0.002 });
      this._tone({ freq: 95, freqEnd: 38, dur: 0.18 + 0.1 * s, vol: 0.1 + 0.3 * s, type: 'sine', attack: 0.002 });
      if (s > 0.2) this._noise({ dur: 0.08 + 0.1 * s, vol: 0.1 * s, filter: 'bandpass', freq: 3200, freqEnd: 2200, q: 5, attack: 0.002 });
    });
  }

  /** Suspension bottoming out on touchdown. strengthMps: vertical speed absorbed. */
  landing(strengthMps) {
    const strength = finite(strengthMps, 0);
    if (strength < 1 || !this._canPlay() || !this._cooldown('landing', 0.12)) return;
    this._safe(() => {
      const s = saturate((strength - 1) / 10);
      this._tone({ freq: 72, freqEnd: 34, dur: 0.22, vol: 0.12 + 0.3 * s, type: 'sine', attack: 0.003 });
      this._noise({ dur: 0.14, vol: 0.05 + 0.15 * s, filter: 'lowpass', freq: 500, freqEnd: 180, attack: 0.003 });
    });
  }

  dispose() {
    this._disposed = true;
    this._teardown();
  }

  // ------------------------------------------------------------------ internals

  _live() {
    return !this._disposed && this.ctx !== null && this._g !== null && this.ctx.state !== 'closed';
  }

  /** One-shots only while the context is actually running, so nothing piles up while suspended. */
  _canPlay() {
    return this._live() && !this._muted && this.ctx.state === 'running';
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
      g.setTargetAtTime(this._muted ? 0 : this._volume, now, 0.05);
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
    const output = gain(this._muted ? 0 : this._volume, ctx.destination);
    const limiter = compressor(-2, 0, 20, 0.002, 0.12, output);
    const glue = compressor(-16, 10, 3.5, 0.006, 0.2, limiter);
    const mix = gain(0.85, glue);
    const engineBus = gain(0.8, mix);
    const tireBus = gain(0.75, mix);
    const envBus = gain(0.6, mix);
    const sfxBus = gain(0.85, mix);

    // Shared white noise.
    const length = Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS));
    const noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const noiseSource = (to) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      src.connect(to);
      src.start(0, Math.random() * NOISE_SECONDS * 0.9); // offsets decorrelate the beds
      sources.push(src);
      return src;
    };

    // Engine.
    const limiterGate = gain(1, engineBus);
    const engineAmp = gain(0, limiterGate);
    const engineFilter = filter('lowpass', 600, 1, engineAmp);
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDriveCurve(2.2);
    shaper.oversample = '2x';
    shaper.connect(engineFilter);
    const engineDrive = gain(1, shaper);
    const engineMix = gain(0.6, engineDrive);
    const engineOscs = [];
    for (const layer of ENGINE_LAYERS) {
      const osc = ctx.createOscillator();
      osc.type = layer.type;
      osc.frequency.value = 30 * layer.mult;
      osc.detune.value = layer.detune;
      osc.connect(gain(layer.level, engineMix));
      osc.start();
      sources.push(osc);
      engineOscs.push(osc);
    }
    const intakeGain = gain(0, engineAmp);
    const intakeFilter = filter('bandpass', 400, 1.6, intakeGain);
    noiseSource(intakeFilter);

    // Tire squeal: band-passed noise plus a tone whose pitch wobbles.
    const squealGain = gain(0, tireBus);
    const squealFilter = filter('bandpass', 900, 7, squealGain);
    noiseSource(squealFilter);
    const squealTone = ctx.createOscillator();
    squealTone.type = 'triangle';
    squealTone.frequency.value = 820;
    squealTone.connect(gain(0.35, squealGain));
    const wobble = ctx.createOscillator();
    wobble.type = 'sine';
    wobble.frequency.value = 7.3;
    const wobbleDepth = gain(28, squealTone.frequency);
    wobble.connect(wobbleDepth);
    squealTone.start();
    wobble.start();
    sources.push(squealTone, wobble);

    // Surface rumble and loose-surface crunch.
    const rumbleGain = gain(0, tireBus);
    const rumbleFilter = filter('lowpass', 160, 0.8, rumbleGain);
    noiseSource(rumbleFilter);
    const crunchGain = gain(0, tireBus);
    const crunchFilter = filter('bandpass', 1500, 0.9, crunchGain);
    noiseSource(crunchFilter);

    // Wind and nitro.
    const windGain = gain(0, envBus);
    const windFilter = filter('bandpass', 400, 0.6, windGain);
    noiseSource(windFilter);
    const nitroGain = gain(0, envBus);
    const nitroFilter = filter('highpass', 2600, 0.7, nitroGain);
    noiseSource(nitroFilter);

    beds.push(engineAmp.gain, intakeGain.gain, squealGain.gain, rumbleGain.gain, crunchGain.gain, windGain.gain, nitroGain.gain);

    this._g = {
      output,
      sfxBus,
      noiseBuffer,
      sources,
      beds,
      limiterGate,
      engineAmp,
      engineFilter,
      engineDrive,
      engineOscs,
      intakeGain,
      intakeFilter,
      squealGain,
      squealFilter,
      squealTone,
      rumbleGain,
      rumbleFilter,
      crunchGain,
      crunchFilter,
      windGain,
      windFilter,
      nitroGain,
    };
  }

  /** Bed gain: move toward value now, and schedule a fade-out in case update() stops arriving. */
  _bed(param, value, tc, now) {
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, tc);
    param.setTargetAtTime(0, now + WATCHDOG, 0.12);
  }

  _update(dt, state, options) {
    if (!state || options.paused) {
      this.silence();
      return;
    }
    const g = this._g;
    const now = this.ctx.currentTime;
    dt = finite(dt, 0);
    if (dt < 0) dt = 0;
    if (dt > 0.25) dt = 0.25;

    // ---- engine
    const rpmMax = finite(state.rpmMax, 0) > 1000 ? state.rpmMax : 7500;
    const idle = Math.min(900, rpmMax * 0.15);
    const rpm = Math.max(0, finite(state.rpm, idle));
    const rpmN = saturate((rpm - idle) / (rpmMax - idle));
    const throttle = saturate(finite(state.throttle, 0));
    const speed = Math.max(0, finite(state.speed, 0));
    const boosting = options.boosting !== undefined ? Boolean(options.boosting) : Boolean(state.boosting);

    if (state.shifted) this._shiftDip = 1;
    else this._shiftDip = Math.max(0, this._shiftDip - dt / 0.16);
    const dip = this._shiftDip;

    const firing = Math.max(16, (rpm / 60) * 2) * (1 - 0.1 * dip); // 4-cylinder: two firings per revolution
    for (let i = 0; i < g.engineOscs.length; i += 1) {
      g.engineOscs[i].frequency.setTargetAtTime(firing * ENGINE_LAYERS[i].mult, now, dip > 0 ? 0.015 : 0.03);
    }
    const load = throttle * (1 - 0.85 * dip);
    g.engineDrive.gain.setTargetAtTime(0.8 + 2.2 * load + 0.6 * rpmN, now, 0.05);
    const cutoff = 260 + 1400 * rpmN + 2600 * load * (0.4 + 0.6 * rpmN) + (boosting ? 600 : 0);
    g.engineFilter.frequency.setTargetAtTime(cutoff, now, 0.05);
    g.engineFilter.Q.setTargetAtTime(1 + 2 * load * rpmN, now, 0.08);
    const amp = (0.1 + 0.16 * rpmN) * (0.5 + 0.5 * load) * (1 - 0.35 * dip);
    this._bed(g.engineAmp.gain, amp, 0.04, now);
    g.intakeFilter.frequency.setTargetAtTime(Math.min(4000, Math.max(200, firing * 4)), now, 0.05);
    this._bed(g.intakeGain.gain, 0.05 * load * (0.3 + rpmN), 0.05, now);

    // Rev limiter: chop the engine output in short bursts near the redline.
    if (rpm >= rpmMax * 0.975 && throttle > 0.5) {
      if (now >= this._limiterNext || this._limiterNext - now > 1) {
        const gate = g.limiterGate.gain;
        gate.cancelScheduledValues(now);
        gate.setTargetAtTime(0.15, now, 0.005);
        gate.setTargetAtTime(1, now + 0.035, 0.012);
        this._limiterNext = now + 0.075 + Math.random() * 0.025;
        if (Math.random() < 0.2) this._pop(0.5);
      }
    }

    // Lift-off: turbo flutter after boost or high revs, then the occasional overrun crackle.
    if (this._prevThrottle > 0.7 && throttle < 0.2 && (this._prevBoost || rpmN > 0.6)) this._flutter();
    if (throttle < 0.1 && rpmN > 0.55 && speed > 8 && Math.random() < dt * 4 * rpmN) this._pop(0.25 + 0.3 * Math.random());
    this._prevThrottle = throttle;
    this._prevBoost = boosting;

    // ---- tires and surfaces
    const wheels = Array.isArray(state.wheels) ? state.wheels : EMPTY;
    let squeal = 0;
    let asphaltContact = 0;
    let rough = 0;
    let crunch = 0;
    for (let i = 0; i < wheels.length; i += 1) {
      const w = wheels[i];
      if (!w || !w.contact) continue;
      const surface = finite(w.surface, SURFACE.ASPHALT) | 0;
      const props = SURFACE_PROPS[surface] || SURFACE_PROPS[SURFACE.ASPHALT];
      const slip = Math.max(0, finite(w.slip, 0));
      if (surface === SURFACE.ASPHALT) {
        asphaltContact += 1;
        squeal += saturate((slip - 1) / 1.2);
      } else {
        rough += props.roughness;
        if (isLoose(surface)) crunch += props.roughness * (1 + saturate(slip - 0.5));
      }
    }
    let squealAmt = saturate(squeal / 2); // two wheels well past the limit = full squeal
    if (options.drifting && asphaltContact > 0 && squealAmt < 0.25) squealAmt = 0.25;
    const speedGate = saturate((speed - 2) / 8);
    const squealLevel = 0.2 * Math.pow(squealAmt, 0.8) * speedGate;
    const squealPitch = 720 + 480 * squealAmt + Math.min(240, speed * 3);
    g.squealFilter.frequency.setTargetAtTime(squealPitch, now, 0.06);
    g.squealTone.frequency.setTargetAtTime(squealPitch * 0.92, now, 0.06);
    this._bed(g.squealGain.gain, squealLevel, 0.05, now);

    const roughAmt = saturate(rough / 4 / 0.5);
    this._bed(g.rumbleGain.gain, 0.3 * roughAmt * saturate(speed / 25), 0.08, now);
    g.rumbleFilter.frequency.setTargetAtTime(110 + Math.min(260, speed * 5), now, 0.1);
    this._bed(g.crunchGain.gain, 0.14 * saturate(crunch / 4 / 0.4) * saturate(speed / 20), 0.06, now);
    g.crunchFilter.frequency.setTargetAtTime(1100 + Math.min(1600, speed * 30), now, 0.1);

    // ---- wind and nitro
    const windN = saturate(speed / 70);
    this._bed(g.windGain.gain, 0.2 * windN * windN, 0.15, now);
    g.windFilter.frequency.setTargetAtTime(280 + speed * 18, now, 0.15);
    this._bed(g.nitroGain.gain, boosting ? 0.08 : 0, boosting ? 0.04 : 0.12, now);

    // ---- per-step events from the vehicle
    const impact = finite(state.impact, 0);
    if (impact > 1.5) this.impact(impact);
    const landing = finite(state.landing, 0);
    if (landing > 2) this.landing(landing);
  }

  _pop(intensity) {
    if (!this._canPlay() || !this._cooldown('pop', 0.09)) return;
    this._noise({ dur: 0.05, vol: 0.14 * intensity, filter: 'lowpass', freq: 1300, freqEnd: 400, attack: 0.001 });
    this._tone({ freq: 130 + Math.random() * 40, freqEnd: 40, dur: 0.07, vol: 0.16 * intensity, type: 'triangle', attack: 0.001 });
  }

  _flutter() {
    if (!this._canPlay() || !this._cooldown('flutter', 0.5)) return;
    const chirps = [1720, 1360, 1080, 840];
    for (let i = 0; i < chirps.length; i += 1) {
      this._noise({ dur: 0.05, vol: 0.07 * Math.pow(0.7, i), filter: 'bandpass', freq: chirps[i], freqEnd: chirps[i] * 0.75, q: 4, when: i * 0.065, attack: 0.008 });
    }
  }

  /** Enveloped oscillator one-shot. */
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

  /** Enveloped, filtered noise one-shot. */
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

/** Soft-clipping curve (tanh) for the engine waveshaper. */
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
