import { createDriftScene } from './driftScene.js';

const MAX_DPR = 1.5;

/**
 * The drifting-car background of the loading / title screen. Drawn in a worker through
 * OffscreenCanvas where the browser allows it (Chrome, Firefox, Safari 16.4+), so it keeps its frame
 * rate while the game loads on the main thread; otherwise drawn on the main thread.
 */
export class DriftBackground {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.worker = null;
    this.scene = null;
    this.running = false;
    this.handle = 0;
    this.started = false;
    this.still = Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }

  size() {
    const rect = this.canvas.getBoundingClientRect();
    return {
      width: Math.round(rect.width) || globalThis.innerWidth || 1280,
      height: Math.round(rect.height) || globalThis.innerHeight || 720,
      dpr: Math.min(globalThis.devicePixelRatio || 1, MAX_DPR),
    };
  }

  start() {
    if (!this.canvas) return;
    if (!this.started) {
      this.started = true;
      const { width, height, dpr } = this.size();
      if (this.canvas.transferControlToOffscreen && typeof Worker !== 'undefined') {
        try {
          const offscreen = this.canvas.transferControlToOffscreen();
          this.worker = new Worker(new URL('./driftWorker.js', import.meta.url), { type: 'module' });
          this.worker.postMessage({ type: 'init', canvas: offscreen, width, height, dpr, still: this.still }, [offscreen]);
        } catch {
          this.worker = null;
        }
      }
      if (!this.worker) {
        this.scene = createDriftScene(this.canvas.getContext('2d', { alpha: false }));
        this.scene.resize(width, height, dpr);
      }
      this.observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
      this.observer?.observe(this.canvas);
    }
    this.setRunning(true);
  }

  stop() {
    this.setRunning(false);
  }

  resize() {
    const { width, height, dpr } = this.size();
    if (this.worker) this.worker.postMessage({ type: 'resize', width, height, dpr });
    else this.scene?.resize(width, height, dpr);
    if (this.still && this.scene) this.settle();
  }

  setRunning(on) {
    if (this.running === on) return;
    this.running = on;
    if (this.worker) {
      if (!this.still) this.worker.postMessage({ type: 'run', on });
      return;
    }
    if (this.still) {
      if (on) this.settle();
      return;
    }
    if (on) {
      const tick = (now) => {
        if (!this.running) return;
        this.scene.frame(now);
        this.handle = requestAnimationFrame(tick);
      };
      this.handle = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(this.handle);
    }
  }

  /** Reduced motion on the main thread: one settled frame. */
  settle() {
    const t0 = performance.now();
    for (let t = 0; t < 3000; t += 16) this.scene.frame(t0 + t);
  }
}
