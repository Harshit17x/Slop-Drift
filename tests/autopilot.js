// Browser test helper. In the console of the running game:
//   const t = await import('/tests/autopilot.js'); await t.ready();
//   t.attach();            // autopilot drives whenever a run is active
//   t.start('sprint');     // begin a run
//   t.step(600);           // advance 600 frames at 60 Hz without rendering (fast, deterministic)
//   t.view(road, s, side, back, up)  // park a still camera beside a road for screenshots
// Stepping by hand also works when the tab is hidden and requestAnimationFrame is throttled.
import * as THREE from 'three';

const location = {};
const ahead = {};
const probe = {};

export function game() {
  return globalThis.__SLOP_DRIFT__;
}

/** Resolve once the game has finished loading. */
export function ready() {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const g = game();
      // frameHandle is set as the very last step of Game.init, after the loading overlay is hidden.
      if (g && g.state !== 'loading' && g.frameHandle !== undefined) {
        clearInterval(timer);
        cancelAnimationFrame(g.frameHandle);
        resolve(g);
      }
    }, 100);
  });
}

/** Pure-pursuit driver on the active route. Tunables live on g.__auto. */
export function attach({ targetSpeed = 32, lateralAccel = 8.5 } = {}) {
  const g = game();
  if (g.__autoAttached) return g.__auto;
  g.__auto = { enabled: true, targetSpeed, lateralAccel, override: null };
  const realUpdate = g.input.update.bind(g.input);
  g.input.update = () => {
    const input = realUpdate();
    const auto = g.__auto;
    if (!auto.enabled || g.state !== 'running') return input;
    if (auto.override) return Object.assign(input, auto.override(g.vehicle.getState()));
    const state = g.vehicle.getState();
    const route = g.world.routes[g.mode.route];
    const road = g.world.roads[route.roadId];
    g.world.locate(state.position.x, state.position.z, location, route.roadId, state.position.y);
    const frame = road.frameAt(location.s + route.direction * (7 + state.speed * 0.45), ahead);
    const dx = frame.x - state.position.x;
    const dz = frame.z - state.position.z;
    const lx = dx * state.right.x + dz * state.right.z;
    const lz = dx * state.forward.x + dz * state.forward.z;
    let curvature = 0;
    for (let k = 5; k <= 25 + state.speed * 1.6; k += 5) {
      curvature = Math.max(curvature, Math.abs(road.frameAt(location.s + route.direction * k, probe).curvature));
    }
    const vmax = Math.min(auto.targetSpeed, Math.sqrt(auto.lateralAccel / Math.max(curvature, 1e-4)));
    input.steer = Math.max(-1, Math.min(1, (2.4 * lx) / Math.max(2, lz)));
    input.throttle = state.speed < vmax ? 1 : 0;
    input.brake = state.speed > vmax + 1.5 ? Math.min(1, (state.speed - vmax) / 5) : 0;
    return input;
  };
  const realRender = g.renderer.render.bind(g.renderer);
  g.__draw = true;
  g.renderer.render = (scene, camera) => {
    if (g.__draw) realRender(scene, camera);
  };
  g.__autoAttached = true;
  return g.__auto;
}

/** Advance `frames` frames of 1/60 s. `probe(i)` runs after each. The last frame is rendered. */
export function step(frames, each = null) {
  const g = game();
  g.__draw = false;
  for (let i = 0; i < frames; i += 1) {
    g.__clock = (g.__clock ?? performance.now()) + 1000 / 60;
    g.onFrame(g.__clock);
    cancelAnimationFrame(g.frameHandle);
    each?.(i);
  }
  g.__draw = true;
  g.__clock += 1000 / 60;
  g.onFrame(g.__clock);
  cancelAnimationFrame(g.frameHandle);
}

export function start(modeId) {
  const g = game();
  g.beginRun(modeId);
  step(CountdownFrames());
  return g.state;
}

function CountdownFrames() {
  return Math.ceil(60 * 3.1);
}

/**
 * Render one still frame from beside a road: `side` metres right of the centreline (negative = left),
 * `back` metres behind distance `s`, `up` metres above the road, looking along the road toward s + look.
 */
export function view(roadId, s, { side = 0, back = 10, up = 3, look = 25, lookSide = 0, lookUp = 0 } = {}) {
  const g = game();
  const road = g.world.roads[roadId];
  const from = road.frameAt(s - back, {});
  const to = road.frameAt(s + look, {});
  const rightLength = Math.hypot(from.rx, from.rz) || 1;
  const toRight = Math.hypot(to.rx, to.rz) || 1;
  const camera = g.cameraRig.camera;
  camera.position.set(from.x + (from.rx / rightLength) * side, from.y + up, from.z + (from.rz / rightLength) * side);
  camera.lookAt(new THREE.Vector3(to.x + (to.rx / toRight) * lookSide, to.y + 1 + lookUp, to.z + (to.rz / toRight) * lookSide));
  camera.updateProjectionMatrix();
  return renderStill();
}

/** Render one frame from an arbitrary pose. */
export function look(position, target) {
  const g = game();
  const camera = g.cameraRig.camera;
  camera.position.set(position[0], position[1], position[2]);
  camera.lookAt(target[0], target[1], target[2]);
  return renderStill();
}

function renderStill() {
  const g = game();
  const camera = g.cameraRig.camera;
  g.terrain?.update(camera.position, true);
  g.scenery.update(camera.position);
  g.atmosphere.update(0, camera, camera.position);
  g.renderer.render(g.scene, camera);
  const info = g.renderer.info.render;
  return { calls: info.calls, triangles: info.triangles };
}
