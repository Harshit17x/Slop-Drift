import * as THREE from 'three';
import { MountainRoad } from '../src/procedural/MountainRoad.js';
import { MountainVehicle } from '../src/procedural/MountainVehicle.js';
import { MountainWorld } from '../src/procedural/MountainWorld.js';

const world = new MountainWorld();
const road = world.road;
const spawn = world.getSpawnTransform();
const vehicle = new MountainVehicle({ mountainWorld: world, spawn });

console.log('--- Testing High-Speed Drive into Guardrail with New Physics ---');
let maxOuterPenetration = 0;
let railContacts = 0;

// Drive full speed and steer hard right into guardrail
for (let step = 0; step < 300; step++) {
  vehicle.step(1 / 60, { throttle: 1, brake: 0, steer: 1, handbrake: false });
  const nearest = road.getNearestPoint(vehicle.position.x, vehicle.position.z, vehicle.position.y);
  const limits = vehicle.getRoadLimits(nearest);
  const carForward = new THREE.Vector3(0, 0, -1).applyQuaternion(vehicle.quaternion);
  const carRight = new THREE.Vector3(1, 0, 0).applyQuaternion(vehicle.quaternion);
  const roadRight = new THREE.Vector3(nearest.right.x, 0, nearest.right.z).normalize();
  const carLateralRadius = Math.abs(carRight.dot(roadRight)) * 0.95 + Math.abs(carForward.dot(roadRight)) * 2.15;
  const outerDist = Math.abs(nearest.signedDistance) + carLateralRadius;
  if (vehicle.railImpact > 0.01) railContacts++;
  const penetration = outerDist - limits.railLimit;
  if (penetration > maxOuterPenetration) maxOuterPenetration = penetration;
}

console.log(`Rail contacts detected: ${railContacts}`);
console.log(`Max outer guardrail penetration: ${maxOuterPenetration.toFixed(4)} m`);
if (maxOuterPenetration > 0.01) {
  console.error('FAIL: Guardrail penetration occurred!');
  process.exit(1);
} else {
  console.log('PASS: Guardrail containment holds perfectly!');
}
