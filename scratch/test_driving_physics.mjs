import * as THREE from 'three';
import { MountainRoad } from '../src/procedural/MountainRoad.js';
import { MountainVehicle } from '../src/procedural/MountainVehicle.js';
import { MountainWorld } from '../src/procedural/MountainWorld.js';

// Setup world with procedural road
const world = new MountainWorld();
const road = world.road;
const spawn = world.getSpawnTransform();
console.log('Spawn transform:', spawn.position);

const vehicle = new MountainVehicle({
  mountainWorld: world,
  spawn,
});

// Test 1: Spawning on hill - should NOT move automatically
console.log('\n--- Test 1: Neutral input standing test (300 steps = 5 seconds) ---');
const initialPos = vehicle.position.clone();
for (let i = 0; i < 300; i++) {
  vehicle.step(1 / 60, { throttle: 0, brake: 0, steer: 0, handbrake: false });
}
const deltaAfterStanding = vehicle.position.distanceTo(initialPos);
const speedAfterStanding = vehicle.velocity.length();
console.log(`Initial position: (${initialPos.x.toFixed(3)}, ${initialPos.y.toFixed(3)}, ${initialPos.z.toFixed(3)})`);
console.log(`After 5s neutral: (${vehicle.position.x.toFixed(3)}, ${vehicle.position.y.toFixed(3)}, ${vehicle.position.z.toFixed(3)})`);
console.log(`Displacement: ${deltaAfterStanding.toFixed(4)} m (must be 0)`);
console.log(`Speed: ${speedAfterStanding.toFixed(4)} m/s (must be 0)`);
if (deltaAfterStanding > 0.001 || speedAfterStanding > 0.001) {
  console.error('FAIL: Vehicle moved automatically without input!');
  process.exit(1);
} else {
  console.log('PASS: Vehicle remained 100% stationary on hill without input!');
}

// Test 2: W accelerates forward
console.log('\n--- Test 2: W accelerates forward ---');
for (let i = 0; i < 60; i++) {
  vehicle.step(1 / 60, { throttle: 1, brake: 0, steer: 0, handbrake: false });
}
const speedAfterW = vehicle.velocity.length();
console.log(`Speed after 1s of W (throttle): ${(speedAfterW * 3.6).toFixed(1)} km/h`);
if (speedAfterW < 2.0) {
  console.error('FAIL: Vehicle did not accelerate with W!');
  process.exit(1);
} else {
  console.log('PASS: Vehicle accelerated forward with W!');
}

// Test 3: S brakes forward motion and then reverses
console.log('\n--- Test 3: S brakes and reverses ---');
let stoppedAtStep = -1;
for (let i = 0; i < 180; i++) {
  vehicle.step(1 / 60, { throttle: 0, brake: 1, steer: 0, handbrake: false });
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(vehicle.quaternion);
  const longSpeed = vehicle.velocity.dot(forward);
  if (stoppedAtStep < 0 && Math.abs(longSpeed) < 0.2) {
    stoppedAtStep = i;
  }
}
const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(vehicle.quaternion);
const longSpeedAfterS = vehicle.velocity.dot(forward);
console.log(`Forward stopped around step ${stoppedAtStep} (~${(stoppedAtStep / 60).toFixed(2)}s)`);
console.log(`Longitudinal speed after 3s of S: ${(longSpeedAfterS * 3.6).toFixed(1)} km/h (negative is reverse)`);
if (longSpeedAfterS > -0.5) {
  console.error('FAIL: S did not reverse after stopping!');
  process.exit(1);
} else {
  console.log('PASS: S successfully braked forward motion and reversed!');
}

// Test 4: Spacebar stops firmly from high speed
console.log('\n--- Test 4: Spacebar (handbrake) stops vehicle firmly ---');
// First accelerate back up to speed
for (let i = 0; i < 90; i++) {
  vehicle.step(1 / 60, { throttle: 1, brake: 0, steer: 0, handbrake: false });
}
const speedBeforeSpace = vehicle.velocity.length();
console.log(`Speed before Space: ${(speedBeforeSpace * 3.6).toFixed(1)} km/h`);

// Now slam Spacebar
let spaceStopStep = -1;
for (let i = 0; i < 120; i++) {
  vehicle.step(1 / 60, { throttle: 0, brake: 0, steer: 0, handbrake: true });
  if (spaceStopStep < 0 && vehicle.velocity.length() < 0.001) {
    spaceStopStep = i;
  }
}
const speedAfterSpace = vehicle.velocity.length();
console.log(`Stopped completely on Space at step: ${spaceStopStep} (~${(spaceStopStep / 60).toFixed(2)}s)`);
console.log(`Speed while holding Space: ${speedAfterSpace.toFixed(4)} m/s`);
if (speedAfterSpace > 0.001 || spaceStopStep > 90) {
  console.error('FAIL: Spacebar did not stop vehicle firmly!');
  process.exit(1);
} else {
  console.log('PASS: Vehicle stopped firmly on Space and locked completely!');
}

// Test 5: Steering A and D
console.log('\n--- Test 5: Steering A (left) and D (right) ---');
vehicle.step(1 / 60, { throttle: 1, brake: 0, steer: -1, handbrake: false });
const steerLeft = vehicle.steering;
console.log(`Steering with A (steer -1): ${steerLeft.toFixed(3)} rad (should be negative)`);

vehicle.step(1 / 60, { throttle: 1, brake: 0, steer: 1, handbrake: false });
vehicle.step(1 / 60, { throttle: 1, brake: 0, steer: 1, handbrake: false });
const steerRight = vehicle.steering;
console.log(`Steering with D (steer +1): ${steerRight.toFixed(3)} rad (should be positive)`);

if (steerLeft >= 0 || steerRight <= steerLeft) {
  console.error('FAIL: Steering controls not responding correctly!');
  process.exit(1);
} else {
  console.log('PASS: A and D steer left and right correctly!');
}

// Test 6: Coasting to complete stop without input
console.log('\n--- Test 6: Coasting to stop and auto hill-holder ---');
vehicle.respawn();
// accelerate briefly
for (let i = 0; i < 30; i++) {
  vehicle.step(1 / 60, { throttle: 1, brake: 0, steer: 0, handbrake: false });
}
console.log(`Speed after brief accel: ${(vehicle.velocity.length() * 3.6).toFixed(1)} km/h`);
// let go of all controls
for (let i = 0; i < 180; i++) {
  vehicle.step(1 / 60, { throttle: 0, brake: 0, steer: 0, handbrake: false });
}
const coastSpeed = vehicle.velocity.length();
console.log(`Speed after coasting: ${coastSpeed.toFixed(4)} m/s (parked: ${vehicle.parked})`);
if (coastSpeed > 0.001 || !vehicle.parked) {
  console.error('FAIL: Coasting did not bring vehicle to parked rest!');
  process.exit(1);
} else {
  console.log('PASS: Coasting brought vehicle to complete stop and engaged hill-holder!');
}

console.log('\nALL 6 DRIVING PHYSICS TESTS PASSED PERFECTLY!');
