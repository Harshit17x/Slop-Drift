// Dynamic resolution: render at a fraction of the preset's pixel ratio when frames run slow, and
// creep back up once they are steady. Most of this game's frame time is GPU fill (pixels x shadowed,
// fogged, physical materials), so resolution is the cheapest knob that keeps motion smooth.

export const RENDER_SCALE = Object.freeze({
  min: 0.6,          // never below 60% of the preset's pixel ratio
  max: 1,
  slowMs: 20,        // a one-second window averaging over 20 ms (under 50 fps) steps down
  fastMs: 17.5,      // windows under 17.5 ms (vsync-bound at 60 Hz or better) count as calm
  window: 1,         // seconds per measurement window
  calmStart: 4,      // calm windows needed before stepping back up
  calmMax: 32,
});

export function createRenderScale() {
  return { scale: 1, time: 0, frames: 0, sum: 0, calm: 0, calmNeeded: RENDER_SCALE.calmStart, sinceUp: Infinity };
}

/**
 * Feed one frame's duration. Returns true when `state.scale` changed and the renderer should be resized.
 * Stalls over 250 ms (tab switches, loading hitches) are ignored.
 */
export function stepRenderScale(state, dtMs) {
  if (!(dtMs > 0) || dtMs > 250) return false;
  state.time += dtMs / 1000;
  state.sinceUp += dtMs / 1000;
  state.frames += 1;
  state.sum += dtMs;
  if (state.time < RENDER_SCALE.window) return false;
  const avg = state.sum / state.frames;
  state.time = 0;
  state.frames = 0;
  state.sum = 0;
  if (avg > RENDER_SCALE.slowMs) {
    state.calm = 0;
    if (state.scale <= RENDER_SCALE.min) return false;
    // Stepping straight back down after a step up: wait twice as long before trying again.
    if (state.sinceUp < 3) state.calmNeeded = Math.min(RENDER_SCALE.calmMax, state.calmNeeded * 2);
    state.scale = Math.max(RENDER_SCALE.min, Math.round(state.scale * 0.85 * 100) / 100);
    return true;
  }
  if (avg >= RENDER_SCALE.fastMs || state.scale >= RENDER_SCALE.max) {
    state.calm = 0;
    return false;
  }
  state.calm += 1;
  if (state.calm < state.calmNeeded) return false;
  state.calm = 0;
  state.sinceUp = 0;
  state.scale = Math.min(RENDER_SCALE.max, Math.round((state.scale + 0.1) * 100) / 100);
  return true;
}
