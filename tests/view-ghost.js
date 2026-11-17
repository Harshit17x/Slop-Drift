// Ghost replay check: builds the world, records a scripted drive headlessly (no rendering), encodes and
// decodes it, then replays it as a GhostCar under the game's chase camera, with an opaque ProceduralCar
// alongside (one lane over) for comparison.
// URL parameters: route=loop|climb|descent, seconds (recorded length, default 60), start (s offset on
// the route), side (metres the opaque car sits to the right, default 3.2; 0 hides it), paint (paint id),
// time=dawn|day|sunset|night, focus=1 (fade the ghost as if the twin were the player), auto=0 (no requestAnimationFrame loop; drive it with __ghostView.frame()).
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Vehicle } from '../src/vehicle/Vehicle.js';
import { TerrainView } from '../src/render/TerrainView.js';
import { RoadView } from '../src/render/RoadView.js';
import { Scenery } from '../src/render/Scenery.js';
import { Atmosphere } from '../src/render/Atmosphere.js';
import { WaterView } from '../src/render/WaterView.js';
import { CameraRig } from '../src/render/CameraRig.js';
import { ProceduralCar } from '../src/render/ProceduralCar.js';
import { GhostCar } from '../src/render/GhostCar.js';
import { GhostRecorder } from '../src/ghost/GhostRecorder.js';
import { GhostPlayer } from '../src/ghost/GhostPlayer.js';
import { encodeGhost, decodeGhost } from '../src/ghost/ghostCodec.js';
import { getPaint, getQualityPreset } from '../src/config.js';

const info = document.getElementById('info');
const params = new URLSearchParams(location.search);
const routeId = params.get('route') || 'loop';
const seconds = Number(params.get('seconds') || 60);
const side = Number(params.get('side') ?? 3.2);
const paintId = params.get('paint') || 'ember';
const DEG = Math.PI / 180;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();

const world = new World();
await world.build((fraction, label) => { info.textContent = `${Math.round(fraction * 100)}% ${label}`; });
const quality = getQualityPreset('High');
const terrain = new TerrainView({ world, quality });
const water = new WaterView({ world });
const roads = new RoadView({ world, quality });
const scenery = new Scenery({ world, quality });
scene.add(terrain.group, water.group, roads.group, scenery.group);
const atmosphere = new Atmosphere({ scene, renderer, world, quality });
atmosphere.setTimeOfDay(params.get('time') || 'day');
const route = world.routes[routeId];
roads.setRoute(route);
const cameraRig = new CameraRig({ world });
const camera = cameraRig.camera;

// ---------------------------------------------------------------- headless scripted drive
const t0 = performance.now();
const road = world.roads[route.roadId];
const vehicle = new Vehicle({ world });
vehicle.setAssists({ driftAssist: 0.6, abs: true, transmission: 'auto' });
let state = vehicle.teleport(world.getSpawn(routeId, route.startS + Number(params.get('start') || 0) * route.direction));
const loc = {};
const frame = {};
const controls = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, shift: 0 };
function autopilot(st) {
  world.locate(st.position.x, st.position.z, loc, route.roadId);
  road.frameAt(loc.s + route.direction * 5, frame);
  const h1 = Math.atan2(frame.tx, frame.tz);
  road.frameAt(loc.s + route.direction * 30, frame);
  const h2 = Math.atan2(frame.tx, frame.tz);
  const turn = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)));
  const vTarget = Math.min(26, Math.sqrt(0.6 * 9.81 * (25 / Math.max(turn, 1e-3))));
  road.frameAt(loc.s + route.direction * (9 + st.speed * 0.2), frame);
  const dx = frame.x - st.position.x;
  const dz = frame.z - st.position.z;
  const lx = dx * st.right.x + dz * st.right.z;
  const lf = dx * st.forward.x + dz * st.forward.z;
  const delta = Math.atan((2 * 2.55 * Math.sin(Math.atan2(lx, lf))) / Math.max(4, Math.hypot(dx, dz)));
  const lock = Math.max(6, 34 / (1 + Math.abs(st.forwardSpeed) / 18)) * DEG;
  const err = vTarget - st.forwardSpeed;
  controls.throttle = err > 0 ? Math.min(1, err * 0.5 + 0.2) : 0;
  controls.brake = err < -1.5 ? Math.min(1, -err * 0.3) : 0;
  controls.steer = Math.max(-1, Math.min(1, delta / lock));
  return controls;
}
const recorder = new GhostRecorder({ rate: 10 });
recorder.start(routeId, 'Autopilot', paintId);
for (let k = 0; k <= seconds * 60; k += 1) {
  recorder.sample(k / 60, state);
  state = vehicle.step(1 / 60, autopilot(state));
}
const encoded = encodeGhost(recorder.finish(seconds, 0));
const ghostData = decodeGhost(encoded);
const player = new GhostPlayer(ghostData);
const recordMs = performance.now() - t0;

// ---------------------------------------------------------------- the ghost and its opaque twin
// Construct and dispose once first, to exercise dispose().
const throwaway = new GhostCar({ paintColor: paintId, name: 'temp' });
scene.add(throwaway.group);
throwaway.dispose();
const throwawayDisposed = throwaway.group.parent === null;

const ghost = new GhostCar({ paintColor: paintId, name: 'Autopilot', detail: 'PB 1:02.4', wheelLayout: vehicle.wheelLayout });
scene.add(ghost.group);
const twin = new ProceduralCar({ color: getPaint(paintId).color });
twin.visible = side !== 0;
scene.add(twin);

// A VehicleState-shaped object for CameraRig.follow, derived from the ghost's motion.
const pose = new THREE.Vector3();
const quat = new THREE.Quaternion();
const fake = {
  position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(),
  forward: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(),
  speed: 0, forwardSpeed: 0, speedKmh: 0, steerAngle: 0, impact: 0, landing: 0, airborne: false, wheels: [],
};
const lastPose = new THREE.Vector3();
let playTime = 0;
let first = true;
const stats = { frames: 0, maxStep: 0, poses: [] };

function frameAt(dt) {
  playTime += dt;
  const t = playTime % (player.duration + 1.5);
  const result = player.poseAt(t, pose, quat);
  ghost.setPose(pose, quat, result.steer, t);
  if (!first && dt > 0) {
    fake.velocity.subVectors(pose, lastPose).divideScalar(dt);
    stats.maxStep = Math.max(stats.maxStep, pose.distanceTo(lastPose));
  }
  lastPose.copy(pose);
  fake.position.copy(pose);
  fake.quaternion.copy(quat);
  fake.forward.set(0, 0, -1).applyQuaternion(quat);
  fake.right.set(1, 0, 0).applyQuaternion(quat);
  fake.up.set(0, 1, 0).applyQuaternion(quat);
  fake.speed = fake.velocity.length();
  fake.forwardSpeed = fake.velocity.dot(fake.forward);
  fake.speedKmh = fake.speed * 3.6;
  fake.steerAngle = result.steer;
  // Opaque twin one lane to the right, same pose and wheel state.
  twin.position.copy(pose).addScaledVector(fake.right, side);
  twin.quaternion.copy(quat);
  twin.setSteering(result.steer);
  for (const key of ['frontLeft', 'frontRight', 'rearLeft', 'rearRight']) twin.setWheelSpin(key, ghost.spin);
  if (first) cameraRig.snap();
  cameraRig.follow(Math.max(dt, 1e-3), fake, null);
  first = false;
  atmosphere.update(dt, camera, pose);
  terrain.update(camera.position);
  scenery.update(camera.position);
  water.update(dt, camera);
  // focus=1 treats the opaque twin as the player's car, to see the overlap fade.
  ghost.update(camera, params.get('focus') === '1' ? twin.position : null);
  renderer.render(scene, camera);
  stats.frames += 1;
  info.textContent = `${routeId}: recorded ${seconds} s in ${recordMs.toFixed(0)} ms, ${ghostData.count} samples, ${(encoded.length / 1024).toFixed(1)} KB\n`
    + `t ${t.toFixed(2)} / ${player.duration.toFixed(1)} s  ${(fake.speed * 3.6).toFixed(0)} km/h  steer ${(result.steer / DEG).toFixed(1)} deg\n`
    + `ghost fade ${ghost.fade.toFixed(2)}  wheel spin ${ghost.spin.toFixed(2)} rad  calls ${renderer.info.render.calls}`;
}

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  cameraRig.resize?.(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let last = performance.now();
function loop(now) {
  frameAt(Math.min(0.05, (now - last) / 1000));
  last = now;
  requestAnimationFrame(loop);
}
if (params.get('auto') !== '0') requestAnimationFrame(loop);
else frameAt(0);

globalThis.__ghostView = {
  ghost, twin, player, ghostData, encoded, stats, camera, cameraRig, throwawayDisposed, renderer, scene, terrain, scenery,
  /** Re-render the current pose from an arbitrary camera position (world coords), looking at the ghost. */
  lookFrom(x, y, z) {
    camera.position.set(x, y, z);
    camera.lookAt(ghost.group.position.x, ghost.group.position.y + 0.8, ghost.group.position.z);
    terrain.update(camera.position, true);
    scenery.update(camera.position);
    atmosphere.update(0, camera, ghost.group.position);
    ghost.update(camera);
    renderer.render(scene, camera);
    return ghost.fade;
  },
  /** Advance `n` frames of `dt` seconds (works with the tab hidden); returns the info text. */
  frame(n = 1, dt = 1 / 60) {
    for (let i = 0; i < n; i += 1) frameAt(dt);
    return info.textContent;
  },
  seek(t) {
    playTime = t;
    first = true;
    frameAt(0);
    return info.textContent;
  },
};
