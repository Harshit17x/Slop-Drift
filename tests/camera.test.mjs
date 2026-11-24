// Headless camera-rig tests: node tests/camera.test.mjs
import * as THREE from 'three';
import { CameraRig } from '../src/render/CameraRig.js';

let passes = 0;
let failures = 0;

function check(name, ok, detail = '') {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  (${detail})` : ''}`);
}

const world = { heightAt: () => 0 };
const FLAT = new THREE.Vector3(0, 1, 0);

/**
 * A VehicleState-shaped object. `slip` is the nose's angle to the right of the velocity
 * vector (radians), `gLat` is lateral acceleration in g.
 */
function makeState({
  x = 0, y = 0, z = 0, speed = 0, yaw = 0, slip = 0, vy = 0,
  gLat = 0, yawRate = 0, boosting = false,
} = {}) {
  const quaternion = new THREE.Quaternion().setFromAxisAngle(FLAT, yaw);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
  const travel = yaw - slip;
  const velocity = new THREE.Vector3(Math.sin(travel) * speed, vy, -Math.cos(travel) * speed);
  return {
    position: new THREE.Vector3(x, y, z),
    quaternion,
    forward,
    right,
    up,
    velocity,
    speed,
    speedKmh: speed * 3.6,
    forwardSpeed: velocity.dot(forward),
    lateralSpeed: velocity.dot(right),
    slipAngle: slip,
    yawRate,
    steerAngle: 0,
    throttle: 1,
    brake: 0,
    handbrake: false,
    boosting,
    rpm: 5000,
    rpmMax: 7200,
    gear: 4,
    shifted: false,
    wheelsOnGround: 4,
    airborne: false,
    surface: 0,
    gLong: 0,
    gLat,
    impact: 0,
    landing: 0,
    scrape: 0,
    upsideDown: false,
    wheels: [],
  };
}

function settle(rig, state, seconds = 2.4, dt = 1 / 60) {
  for (let i = 0; i < Math.round(seconds / dt); i += 1) rig.follow(dt, state);
  return rig;
}

function cameraYaw(rig) {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(rig.camera.quaternion);
  return Math.atan2(forward.x, -forward.z);
}

function flatDistance(rig, state) {
  return Math.hypot(rig.camera.position.x - state.position.x, rig.camera.position.z - state.position.z);
}

// ------------------------------------------------------------------ framing

{
  const rig = new CameraRig({ world });
  const state = makeState({ speed: 30 });
  settle(rig, state);
  const dist = flatDistance(rig, state);
  const behind = state.forward.dot(new THREE.Vector3(
    rig.camera.position.x - state.position.x,
    0,
    rig.camera.position.z - state.position.z,
  ));
  check('chase camera sits 6-9 m behind at speed', dist > 6.5 && dist < 9, `${dist.toFixed(2)} m`);
  check('chase camera is behind the car', behind < -5, behind.toFixed(2));
  check('chase camera is above the car', rig.camera.position.y > state.position.y + 1, rig.camera.position.y.toFixed(2));
  check('no NaN in the camera after settling', Number.isFinite(rig.camera.position.x) && Number.isFinite(cameraYaw(rig)));
}

// ------------------------------------------------------------------ speed and nitro

{
  const slow = settle(new CameraRig({ world }), makeState({ speed: 0 }));
  const fast = settle(new CameraRig({ world }), makeState({ speed: 42 }));
  const boosted = settle(new CameraRig({ world }), makeState({ speed: 42, boosting: true }));
  check('field of view opens with speed', fast.fov > slow.fov + 7, `${slow.fov.toFixed(1)} -> ${fast.fov.toFixed(1)} deg`);
  check('nitro adds a visible FOV kick', boosted.fov > fast.fov + 3, `${fast.fov.toFixed(1)} -> ${boosted.fov.toFixed(1)} deg`);
  check('field of view stays in a usable range', boosted.fov > 60 && boosted.fov < 90, boosted.fov.toFixed(1));
  check('camera pulls back with speed', flatDistance(fast, makeState({ speed: 42 })) > flatDistance(slow, makeState({ speed: 0 })) + 1.2);
}

// ------------------------------------------------------------------ drift framing

{
  const rig = new CameraRig({ world });
  const state = makeState({ speed: 25, slip: 25 * Math.PI / 180, gLat: 1.2, yawRate: 0.5 });
  settle(rig, state);
  const travelYaw = -state.slipAngle;
  const yaw = cameraYaw(rig);
  const noseShare = (yaw - travelYaw) / state.slipAngle;
  check('drift camera frames the car between travel and nose', yaw > travelYaw + 0.02 && yaw < 0.15,
    `camera ${yaw.toFixed(3)} rad, travel ${travelYaw.toFixed(3)}, nose 0`);
  check('drift angle stays readable (15-42% nose in frame)', noseShare > 0.15 && noseShare < 0.42, noseShare.toFixed(2));
  check('drift camera banks into the slide', rig.roll > 0.005, `${(rig.roll * 57.3).toFixed(2)} deg`);
  check('drift camera pulls back a little', rig.distance > 6.5, `${rig.distance.toFixed(2)} m`);

  const gripRig = settle(new CameraRig({ world }), makeState({ speed: 25 }));
  check('drift framing differs from grip framing', Math.abs(rig.yaw - gripRig.yaw) > 0.1,
    `${rig.yaw.toFixed(3)} vs ${gripRig.yaw.toFixed(3)}`);
}

{
  // The travel blend fades in from zero slip, so the camera never pops as the car starts to slide.
  const a = settle(new CameraRig({ world }), makeState({ speed: 20, slip: 0.08 }));
  const b = settle(new CameraRig({ world }), makeState({ speed: 20, slip: 0.12 }));
  const diff = Math.abs(a.yaw - b.yaw);
  check('tiny slip changes framing continuously', diff > 0.005 && diff < 0.05, diff.toFixed(4));
}

// ------------------------------------------------------------------ framerate independence

{
  const run = (hz) => {
    const dt = 1 / hz;
    const rig = new CameraRig({ world });
    const steps = Math.round(2 / dt);
    let state;
    for (let i = 0; i < steps; i += 1) {
      const t = (i + 1) * dt;
      const yaw = 0.55 * t;
      state = makeState({
        x: Math.sin(yaw) * 24 * t,
        z: -Math.cos(yaw) * 24 * t,
        speed: 24,
        yaw,
        slip: 0.12,
        gLat: 0.7,
        yawRate: 0.55,
      });
      rig.follow(dt, state);
    }
    return { rig, state };
  };
  const a = run(60);
  const b = run(144);
  const yawDiff = Math.abs(Math.atan2(
    Math.sin(cameraYaw(a.rig) - cameraYaw(b.rig)),
    Math.cos(cameraYaw(a.rig) - cameraYaw(b.rig)),
  ));
  const posDiff = a.rig.camera.position.distanceTo(b.rig.camera.position);
  check('camera yaw is framerate independent', yawDiff < 0.03, `${(yawDiff * 57.3).toFixed(2)} deg`);
  check('camera position is framerate independent', posDiff < 0.2, `${posDiff.toFixed(3)} m`);
  check('camera FOV is framerate independent', Math.abs(a.rig.fov - b.rig.fov) < 0.3,
    `${a.rig.fov.toFixed(2)} vs ${b.rig.fov.toFixed(2)}`);
}

// ------------------------------------------------------------------ snap and orbit

{
  const rig = settle(new CameraRig({ world }), makeState({ speed: 30 }));
  const teleported = makeState({ x: 500, y: 30, z: -400, speed: 18, yaw: 1.2 });
  rig.snap();
  rig.follow(1 / 60, teleported);
  const jump = Math.hypot(rig.camera.position.x - 500, rig.camera.position.z + 400);
  check('snap puts the camera at the respawn without a swing', jump > 4 && jump < 10, `${jump.toFixed(2)} m`);
  check('snap clears the blend', rig.blendTime === 1);

  rig.orbit(1 / 60, new THREE.Vector3(0, 5, 0), { radius: 9, height: 3.2, speed: 0.12 });
  const orbitDistance = Math.hypot(rig.camera.position.x, rig.camera.position.z);
  check('orbit holds its radius', Math.abs(orbitDistance - 9) < 0.3, orbitDistance.toFixed(2));
  check('orbit looks at the focus height', rig.camera.position.y > 8, rig.camera.position.y.toFixed(2));
}

// ------------------------------------------------------------------ look-back and free-look

{
  const rig = new CameraRig({ world });
  const state = makeState({ speed: 28 });
  settle(rig, state);
  const ahead = (r) => (
    r.camera.position.x - state.position.x
  ) * state.forward.x + (r.camera.position.z - state.position.z) * state.forward.z;
  check('chase camera is behind before look-back', ahead(rig) < -4, ahead(rig).toFixed(2));

  for (let i = 0; i < 90; i += 1) rig.follow(1 / 60, state, { lookBack: true });
  const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(rig.camera.quaternion);
  check('look-back puts the camera in front of the car', ahead(rig) > 4, ahead(rig).toFixed(2));
  check('look-back looks back down the road', camForward.dot(state.forward) < -0.7,
    camForward.dot(state.forward).toFixed(2));
  check('look-back does not bank the camera', Math.abs(rig.roll) < 1e-3, rig.roll.toFixed(4));
}

{
  const plain = settle(new CameraRig({ world }), makeState({ speed: 26 }));
  const looked = new CameraRig({ world });
  settle(looked, makeState({ speed: 26 }));
  for (let i = 0; i < 30; i += 1) looked.follow(1 / 60, makeState({ speed: 26 }), { freeLook: { x: 0.4, y: 0, active: true } });
  const diff = Math.abs(Math.atan2(
    Math.sin(cameraYaw(plain) - cameraYaw(looked)),
    Math.cos(cameraYaw(plain) - cameraYaw(looked)),
  ));
  check('free-look turns the view without moving the rig yaw', diff > 0.35 && diff < 0.45,
    `${(diff * 57.3).toFixed(1)} deg`);
}

// ------------------------------------------------------------------ modes, ground and shake

{
  const rig = new CameraRig({ world });
  const state = makeState({ speed: 26 });
  settle(rig, state);
  const chaseDistance = flatDistance(rig, state);
  rig.setMode('far');
  rig.follow(1 / 60, state);
  check('a camera-mode change starts a blend', rig.blendTime < 0.2, rig.blendTime.toFixed(2));
  settle(rig, state, 1.4);
  check('far mode sits farther back than chase', flatDistance(rig, state) > chaseDistance + 2,
    `${chaseDistance.toFixed(1)} -> ${flatDistance(rig, state).toFixed(1)} m`);
  check('the blend completes', rig.blendTime === 1);

  const high = new CameraRig({ world: { heightAt: () => 10 } });
  const uphill = makeState({ speed: 10 });
  high.snap();
  high.follow(1 / 60, uphill);
  check('camera stays above the ground', high.camera.position.y >= 10.85, high.camera.position.y.toFixed(2));

  const calm = settle(new CameraRig({ world }), makeState({ speed: 30 }));
  const shaken = new CameraRig({ world });
  shaken.shakeEnabled = false;
  settle(shaken, makeState({ speed: 30 }));
  shaken.addShake(1);
  shaken.follow(1 / 60, makeState({ speed: 30 }));
  check('the shake toggle really stops the shake',
    shaken.camera.position.distanceTo(calm.camera.position) < 0.05,
    shaken.camera.position.distanceTo(calm.camera.position).toFixed(3));
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
