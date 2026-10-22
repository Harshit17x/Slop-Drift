export class EngineAudio {
  constructor(context, master) {
    this.context = context;
    this.master = master;
    this.started = false;
    this.throttle = 0;
    this.rpm = 900;
    this.muffled = false;
    this.nodes = null;
  }

  start() {
    if (this.started) return;
    const ctx = this.context;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(this.master);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;
    filter.Q.value = 0.8;
    filter.connect(gain);
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const oscC = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscB.type = 'square';
    oscC.type = 'triangle';
    const gainA = ctx.createGain();
    const gainB = ctx.createGain();
    const gainC = ctx.createGain();
    gainA.gain.value = 0.32;
    gainB.gain.value = 0.08;
    gainC.gain.value = 0.18;
    oscA.connect(gainA).connect(filter);
    oscB.connect(gainB).connect(filter);
    oscC.connect(gainC).connect(filter);
    oscA.start(); oscB.start(); oscC.start();
    this.nodes = { gain, filter, oscA, oscB, oscC, gainA, gainB, gainC };
    this.started = true;
  }

  update({ rpm = 900, throttle = 0, nitro = false, cockpit = false } = {}) {
    if (!this.started) return;
    this.rpm = rpm;
    this.throttle = throttle;
    const t = this.context.currentTime;
    const base = 38 + rpm * 0.018;
    this.nodes.oscA.frequency.setTargetAtTime(base, t, 0.025);
    this.nodes.oscB.frequency.setTargetAtTime(base * 2.01, t, 0.025);
    this.nodes.oscC.frequency.setTargetAtTime(base * 0.5, t, 0.025);
    this.nodes.filter.frequency.setTargetAtTime(cockpit ? 720 : 1600 + throttle * 900 + (nitro ? 500 : 0), t, 0.08);
    this.nodes.gain.gain.setTargetAtTime(0.018 + throttle * 0.07 + Math.min(0.05, rpm / 7500 * 0.04), t, 0.05);
  }

  stop() {
    if (!this.started) return;
    this.nodes.gain.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.1);
  }
}
