import { EngineAudio } from './EngineAudio.js';

export class AudioManager {
  constructor() {
    this.context = null;
    this.master = null;
    this.engine = null;
    this.muted = false;
    this.volume = { master: 0.8, engine: 0.8, sfx: 0.75 };
    this.lastSfx = new Map();
  }

  async unlock() {
    if (!this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      this.context = new Context();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume.master;
      this.master.connect(this.context.destination);
      const engineBus = this.context.createGain();
      engineBus.gain.value = this.volume.engine;
      engineBus.connect(this.master);
      this.engine = new EngineAudio(this.context, engineBus);
    }
    if (this.context.state === 'suspended') await this.context.resume();
    this.engine?.start();
  }

  updateEngine(data = {}) {
    this.engine?.update(data);
  }

  setMuted(value) {
    this.muted = Boolean(value);
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume.master, this.context.currentTime, 0.05);
  }

  toggleMute() { this.setMuted(!this.muted); return this.muted; }

  setVolume(type, value) {
    this.volume[type] = value;
    if (type === 'master' && this.master && this.context) this.master.gain.value = this.muted ? 0 : value;
  }

  play(name, { frequency = 440, duration = 0.12, volume = 0.15, type = 'sine', cooldown = 0 } = {}) {
    if (!this.context || this.muted) return;
    const now = this.context.currentTime;
    if (cooldown && now - (this.lastSfx.get(name) || -Infinity) < cooldown) return;
    this.lastSfx.set(name, now);
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(45, frequency * 0.55), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume * this.volume.sfx, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  engineShift() { this.play('shift', { frequency: 130, duration: 0.2, volume: 0.22, type: 'square' }); }
  collision(intensity = 1) { this.play('collision', { frequency: 70, duration: 0.32, volume: 0.28 * intensity, type: 'triangle', cooldown: 0.08 }); }
  tireSqueal(intensity = 1) { this.play('squeal', { frequency: 180 + intensity * 200, duration: 0.08, volume: 0.08 * intensity, type: 'sawtooth', cooldown: 0.06 }); }
  nitro() { this.play('nitro', { frequency: 80, duration: 0.45, volume: 0.23, type: 'sawtooth', cooldown: 0.32 }); }
  countdown(value) { this.play('countdown', { frequency: value === 'GO' ? 920 : 440, duration: 0.16, volume: 0.2, type: 'square' }); }
  ui() { this.play('ui', { frequency: 650, duration: 0.055, volume: 0.08, type: 'sine' }); }
}
