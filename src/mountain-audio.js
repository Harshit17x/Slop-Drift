export class MountainAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.engineBus = null;
    this.sfxBus = null;
    this.engineOscillator = null;
    this.engineHarmonic = null;
    this.engineFilter = null;
    this.engineGain = null;
    this.windSource = null;
    this.windFilter = null;
    this.windGain = null;
    this.muted = false;
    this.started = false;
    this.lastPlayed = new Map();
    this.volume = { master: 0.72, engine: 0.62, sfx: 0.7 };
  }

  async unlock() {
    if (!this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return false;
      this.context = new Context();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume.master;
      this.master.connect(this.context.destination);
      this.engineBus = this.context.createGain();
      this.engineBus.gain.value = this.volume.engine;
      this.engineBus.connect(this.master);
      this.sfxBus = this.context.createGain();
      this.sfxBus.gain.value = this.volume.sfx;
      this.sfxBus.connect(this.master);
      this.createEngineSynth();
    }
    if (this.context.state === 'suspended') await this.context.resume();
    this.started = true;
    return true;
  }

  createEngineSynth() {
    const context = this.context;
    this.engineOscillator = context.createOscillator();
    this.engineOscillator.type = 'sawtooth';
    this.engineHarmonic = context.createOscillator();
    this.engineHarmonic.type = 'square';
    this.engineFilter = context.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 720;
    this.engineFilter.Q.value = 0.7;
    this.engineGain = context.createGain();
    this.engineGain.gain.value = 0.0001;
    this.engineOscillator.connect(this.engineFilter);
    this.engineHarmonic.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.engineBus);
    this.engineOscillator.start();
    this.engineHarmonic.start();
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 1.2), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    this.windSource = context.createBufferSource();
    this.windSource.buffer = buffer;
    this.windSource.loop = true;
    this.windFilter = context.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 680;
    this.windFilter.Q.value = 0.55;
    this.windGain = context.createGain();
    this.windGain.gain.value = 0.0001;
    this.windSource.connect(this.windFilter).connect(this.windGain).connect(this.engineBus);
    this.windSource.start();
  }

  updateEngine({ rpm = 900, speedMps = 0, throttle = 0, drifting = false, boost = false } = {}) {
    if (!this.context || !this.started || !this.engineOscillator) return;
    const now = this.context.currentTime;
    const normalizedRpm = Math.max(0, Math.min(1, (rpm - 700) / 7000));
    const frequency = 38 + normalizedRpm * 168;
    const harmonicFrequency = frequency * 2.01;
    const gain = 0.018 + normalizedRpm * 0.12 + throttle * 0.04 + (boost ? 0.045 : 0);
    const wind = Math.max(0, Math.min(0.12, speedMps * speedMps * 0.00032));
    this.engineOscillator.frequency.setTargetAtTime(frequency, now, 0.04);
    this.engineHarmonic.frequency.setTargetAtTime(harmonicFrequency, now, 0.04);
    this.engineFilter.frequency.setTargetAtTime(480 + normalizedRpm * 1500, now, 0.08);
    this.engineGain.gain.setTargetAtTime(this.muted ? 0.0001 : gain, now, 0.08);
    this.windFilter.frequency.setTargetAtTime(520 + speedMps * 28, now, 0.12);
    this.windGain.gain.setTargetAtTime(this.muted ? 0.0001 : wind + (drifting ? 0.012 : 0), now, 0.14);
  }

  setMuted(value) {
    this.muted = Boolean(value);
    if (!this.context || !this.master) return this.muted;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume.master, this.context.currentTime, 0.05);
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  setVolume(type, value) {
    if (!(type in this.volume)) return;
    this.volume[type] = Math.max(0, Math.min(1, Number(value) || 0));
    if (!this.context) return;
    if (type === 'master') this.master.gain.value = this.muted ? 0 : this.volume.master;
    if (type === 'engine') this.engineBus.gain.value = this.volume.engine;
    if (type === 'sfx') this.sfxBus.gain.value = this.volume.sfx;
  }

  play(name, { frequency = 440, duration = 0.14, volume = 0.16, type = 'sine', cooldown = 0 } = {}) {
    if (!this.context || !this.started || this.muted || !this.sfxBus) return;
    const now = this.context.currentTime;
    if (cooldown > 0 && now - (this.lastPlayed.get(name) || -Infinity) < cooldown) return;
    this.lastPlayed.set(name, now);
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(35, frequency), now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, frequency * 0.58), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.009);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.sfxBus);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }

  ui() {
    this.play('ui', { frequency: 720, duration: 0.06, volume: 0.08, type: 'sine', cooldown: 0.03 });
  }

  countdown(value) {
    const go = value === 'GO';
    this.play('countdown', { frequency: go ? 930 : 465, duration: go ? 0.26 : 0.16, volume: go ? 0.24 : 0.16, type: 'square' });
  }

  drift(intensity = 1) {
    this.play('drift', { frequency: 160 + intensity * 180, duration: 0.09, volume: 0.05 + intensity * 0.04, type: 'sawtooth', cooldown: 0.08 });
  }

  shift() {
    this.play('shift', { frequency: 125, duration: 0.18, volume: 0.18, type: 'square', cooldown: 0.05 });
  }

  respawn() {
    this.play('respawn', { frequency: 95, duration: 0.32, volume: 0.15, type: 'triangle' });
  }

  finish() {
    this.play('finish', { frequency: 560, duration: 0.25, volume: 0.18, type: 'sine' });
    globalThis.setTimeout(() => this.play('finish-high', { frequency: 840, duration: 0.32, volume: 0.16, type: 'sine' }), 150);
  }

  dispose() {
    try { this.engineOscillator?.stop(); } catch {}
    try { this.engineHarmonic?.stop(); } catch {}
    try { this.windSource?.stop(); } catch {}
    this.context?.close?.();
    this.context = null;
  }
}
