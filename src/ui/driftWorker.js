// Runs the drift background (driftScene.js) off the main thread, so terrain generation and shader
// compiles on the main thread never stall it. Messages: init {canvas, width, height, dpr, still},
// resize {width, height, dpr}, run {on}.
import { createDriftScene } from './driftScene.js';

let scene = null;
let running = false;
let handle = 0;
let still = false;

function settle() {
  const t0 = performance.now();
  for (let t = 0; t < 3000; t += 16) scene.frame(t0 + t);
}
const raf = self.requestAnimationFrame
  ? (fn) => self.requestAnimationFrame(fn)
  : (fn) => setTimeout(() => fn(performance.now()), 16);
const cancel = self.cancelAnimationFrame ? (id) => self.cancelAnimationFrame(id) : (id) => clearTimeout(id);

function tick(now) {
  if (!running) return;
  scene.frame(now);
  handle = raf(tick);
}

self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    scene = createDriftScene(data.canvas.getContext('2d', { alpha: false }));
    scene.resize(data.width, data.height, data.dpr);
    still = Boolean(data.still);
    if (still) {
      settle(); // reduced motion: one settled frame, no loop
      return;
    }
  } else if (data.type === 'resize' && scene) {
    scene.resize(data.width, data.height, data.dpr);
    if (still) settle();
    return;
  }
  if (data.type === 'run' || data.type === 'init') {
    const on = data.type === 'init' ? true : Boolean(data.on);
    if (on && !running) {
      running = true;
      handle = raf(tick);
    } else if (!on && running) {
      running = false;
      cancel(handle);
    }
  }
};
