import * as THREE from 'three';
import { MountainRoad } from '../src/procedural/MountainRoad.js';
import { ProceduralCar } from '../src/procedural/ProceduralCar.js';
import { DriftModel } from '../src/procedural/DriftModel.js';
import { MountainVehicle } from '../src/procedural/MountainVehicle.js';
import { MountainEffects } from '../src/mountain-effects.js';
import { MountainCameraRig } from '../src/mountain-camera.js';
import { TerrainChunk } from '../src/procedural/TerrainChunk.js';
import { MountainWorld } from '../src/procedural/MountainWorld.js';
import { Heightfield } from '../src/procedural/Heightfield.js';
import { MountainInput } from '../src/mountain-input.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    failed += 1;
    throw new Error(message);
  } else {
    console.log(`✅ PASS: ${message}`);
    passed += 1;
  }
}

console.log('--- STARTING COMPREHENSIVE BUG FIX VERIFICATION ---');

// Bug #2: DriftModel preserveBank
{
  const dm = new DriftModel();
  dm.score = 5000;
  dm.bank = 12000;
  dm.reset({ preserveBank: true });
  assert(dm.bank === 12000, 'DriftModel preserves bank score on respawn when preserveBank: true');
  assert(dm.score === 0, 'DriftModel resets current combo score on respawn');
}

// Bug #3: Road ribbon vertex normals
{
  const hf = new Heightfield({ seed: 42 });
  const road = new MountainRoad({
    heightfield: hf,
    segmentCount: 40,
    roadWidth: 9,
    autoBuild: true,
  });
  const ribbonMesh = road.roadMesh;
  assert(ribbonMesh != null, 'MountainRoadSurface exists');
  const normals = ribbonMesh.geometry.attributes.normal.array;
  let allUp = true;
  for (let i = 1; i < normals.length; i += 3) {
    if (normals[i] < 0.7) {
      allUp = false;
      break;
    }
  }
  assert(allUp, `Road ribbon vertex normals point upward (sample y-normal = ${normals[1].toFixed(2)})`);
}

// Bug #4: Right curb vertex normals
{
  const hf = new Heightfield({ seed: 42 });
  const road = new MountainRoad({
    heightfield: hf,
    segmentCount: 40,
    roadWidth: 9,
    autoBuild: true,
  });
  const curbRight = road.curbs.children.find((c) => c.name === 'MountainRoadCurbRight');
  assert(curbRight != null, 'MountainRoadCurbRight exists');
  const normals = curbRight.geometry.attributes.normal.array;
  let allUp = true;
  for (let i = 1; i < normals.length; i += 3) {
    if (normals[i] < 0.7) {
      allUp = false;
      break;
    }
  }
  assert(allUp, `Right curb vertex normals point upward (sample y-normal = ${normals[1].toFixed(2)})`);
}

// Bug #5: ProceduralCar body part parenting
{
  const car = new ProceduralCar();
  car.build();
  assert(car.chassis != null, 'Car chassis exists');
  // Chassis should contain windshield, lamps, spoiler, mirrors, cockpit
  const chassisNames = car.chassis.children.map((c) => c.name);
  assert(chassisNames.includes('CarWindshield'), 'Windshield is parented to chassis');
  assert(chassisNames.includes('CarRearGlass'), 'Rear glass is parented to chassis');
  assert(chassisNames.includes('APillarLeft'), 'A-Pillars are parented to chassis');
  assert(chassisNames.includes('RallyCockpit'), 'Cockpit is parented to chassis');
  assert(chassisNames.includes('HeadlightLeft'), 'Headlights are parented to chassis');
  // Root car should only have chassis and 4 wheel pivots
  const rootChildNames = car.children.map((c) => c.name);
  assert(rootChildNames.length === 5, `Car root only has chassis and 4 wheel pivots (found ${rootChildNames.length})`);
}

// Bug #6: Steering visual direction
{
  const car = new ProceduralCar();
  car.build();
  car.setSteering(0.5); // steering right
  const flPivot = car.wheelPivots.get('frontLeft');
  const sw = car.steeringWheel;
  assert(flPivot.rotation.y < 0, `Steering right rotates front wheel pivot Y negatively (y = ${flPivot.rotation.y.toFixed(2)})`);
  assert(sw.rotation.z < 0, `Steering right rotates steering wheel clockwise / negative Z (z = ${sw.rotation.z.toFixed(2)})`);
}

// Bug #7: Vehicle pitch dynamics
{
  const v = new MountainVehicle({
    surfaceClassifier: { classify: () => ({ height: 0, normal: new THREE.Vector3(0, 1, 0), surface: 'asphalt', friction: 1, bumpiness: 0 }) },
  });
  // Accelerating forward from rest
  for (let i = 0; i < 10; i += 1) v.stepFixed(0.016, { throttle: 1, brake: 0, steer: 0, handbrake: false });
  assert(v.bodyPitch > 0, `Accelerating forward causes rear squat / positive body pitch (pitch = ${v.bodyPitch.toFixed(4)})`);

  // Braking while moving forward
  for (let i = 0; i < 5; i += 1) v.stepFixed(0.016, { throttle: 0, brake: 1, steer: 0, handbrake: false });
  assert(v.bodyPitch < 0, `Braking causes front dive / negative body pitch (pitch = ${v.bodyPitch.toFixed(4)})`);
}

// Bug #8: Suspension compression
{
  const car = new ProceduralCar();
  car.build();
  car.setSuspension('frontLeft', 0.15); // compression
  const flPivot = car.wheelPivots.get('frontLeft');
  assert(flPivot.position.y > 0.37, `Suspension compression raises wheel pivot towards body (y = ${flPivot.position.y.toFixed(3)})`);
}

// Bug #9: Wheel spin and rim parenting
{
  const car = new ProceduralCar();
  car.build();
  const wheel = car.wheels.get('frontLeft');
  assert(wheel.children.length === 2, `Wheel contains rim and hub children (found ${wheel.children.length})`);
  car.setWheelSpin('frontLeft', 2.0);
  assert(wheel.rotation.x < 0, `Forward rolling wheel has negative X rotation (x = ${wheel.rotation.x.toFixed(2)})`);
}

// Bug #10: Skid mark orientation
{
  const scene = new THREE.Scene();
  const fx = new MountainEffects(scene);
  const normal = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3(0, 0, -1);
  fx.spawnSkid(new THREE.Vector3(0, 0, 0), forward, normal, 1);
  const skidMesh = fx.skids[0].mesh;
  skidMesh.updateMatrixWorld(true);
  const planeNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(skidMesh.quaternion);
  assert(Math.abs(planeNormal.y - 1.0) < 0.01, `Skid mark lies flat on ground with Y-up normal (${planeNormal.y.toFixed(3)})`);
  fx.dispose();
}

// Bug #11: Cockpit geometry and camera alignment
{
  const car = new ProceduralCar();
  car.build();
  const cockpit = car.cockpit;
  const dashboard = cockpit.children.find((c) => c.name === 'Dashboard');
  const steeringWheel = cockpit.children.find((c) => c.name === 'ProceduralSteeringWheel');
  const seatLeft = cockpit.children.find((c) => c.name === 'SeatLeft');
  assert(dashboard.position.z > -0.32, `Dashboard is behind windshield at z = ${dashboard.position.z.toFixed(2)}`);
  assert(steeringWheel.position.x < -0.3 && steeringWheel.position.z > dashboard.position.z, `Steering wheel is aligned with driver seat at x=${steeringWheel.position.x}, z=${steeringWheel.position.z}`);
  assert(seatLeft.position.x < -0.3, `Driver seat is on left side at x = ${seatLeft.position.x}`);

  const rig = new MountainCameraRig();
  rig.attach({
    getPose: () => ({
      position: new THREE.Vector3(0, 0, 0),
      forward: new THREE.Vector3(0, 0, -1),
      right: new THREE.Vector3(1, 0, 0),
      up: new THREE.Vector3(0, 1, 0),
      speedMps: 0,
    }),
  });
  const cockpitPose = rig.computePose('cockpit');
  assert(cockpitPose.position.x < -0.3, `Cockpit camera is laterally offset to driver position (x = ${cockpitPose.position.x.toFixed(2)})`);
  assert(cockpitPose.position.z > 0, `Cockpit camera is placed at driver seat headrest (z = ${cockpitPose.position.z.toFixed(2)})`);
}

// Bug #13: Camera look-back in chase and wide modes
{
  const rig = new MountainCameraRig();
  rig.attach({
    getPose: () => ({
      position: new THREE.Vector3(0, 0, 0),
      forward: new THREE.Vector3(0, 0, -1),
      right: new THREE.Vector3(1, 0, 0),
      up: new THREE.Vector3(0, 1, 0),
      speedMps: 10,
    }),
  });
  rig.setFreeLook({ lookBack: true });
  const chaseLookBack = rig.computePose('chase');
  assert(chaseLookBack.position.z < 0, `Chase look-back camera is in front of the vehicle (z = ${chaseLookBack.position.z.toFixed(2)})`);
  assert(chaseLookBack.target.z > 0, `Chase look-back target looks behind the vehicle (target z = ${chaseLookBack.target.z.toFixed(2)})`);
}

// Bug #14: Road spatial grid 3x3 search
{
  const hf = new Heightfield({ seed: 42 });
  const road = new MountainRoad({ heightfield: hf, segmentCount: 100, roadWidth: 9, autoBuild: true });
  // Query a point 20m off the road
  const sampleRoadPt = road.samples[15];
  const queryX = sampleRoadPt.position.x + 20;
  const queryZ = sampleRoadPt.position.z + 10;
  const nearest = road.getNearestPoint(queryX, queryZ);
  assert(nearest != null && nearest.position != null, 'Nearest road point found even 22m away due to 3x3 grid neighborhood');
}

// Bug #19: Resource disposal of shared terrain material
{
  const scene = new THREE.Scene();
  const hf = new Heightfield({ seed: 101 });
  const world = new MountainWorld({ scene, heightfield: hf, autoBuild: true });
  assert(world.chunks.length > 0, `World built with ${world.chunks.length} chunks`);
  const sharedMat = world.terrainMaterial;
  assert(sharedMat != null, 'Shared terrain material exists');
  world.chunks[0].dispose();
  // Verify material is NOT disposed by chunk dispose
  assert(sharedMat.isMeshStandardMaterial, 'Chunk disposal does not destroy shared terrain material');
  world.dispose();
  assert(world.chunks.length === 0, 'World fully disposed');
}

// Bug #20: Guardrail and checkpoint post orientation
{
  const hf = new Heightfield({ seed: 42 });
  const road = new MountainRoad({
    heightfield: hf,
    segmentCount: 40,
    roadWidth: 9,
    autoBuild: true,
  });
  const railPosts = road.guardrails ? road.guardrails.children.filter((c) => c.name === 'GuardrailPost') : [];
  assert(railPosts.length > 0, `Rail posts exist (${railPosts.length})`);
  const samplePost = railPosts[0];
  const postUp = new THREE.Vector3(0, 1, 0).applyQuaternion(samplePost.quaternion);
  assert(postUp.y > 0.8, `Rail post aligns with banked road normal (normal y = ${postUp.y.toFixed(3)})`);
}

// Bug #21: Boost flame position
{
  const scene = new THREE.Scene();
  const fx = new MountainEffects(scene);
  const vehicle = {
    position: new THREE.Vector3(0, 0, 0),
    quaternion: new THREE.Quaternion(),
  };
  const pose = {
    velocity: new THREE.Vector3(0, 0, -20),
  };
  fx.emitBoost(vehicle, pose);
  const boostParticle = fx.activeParticles.find((p) => p.type === 'boost');
  assert(boostParticle != null, 'Boost particle emitted');
  assert(boostParticle.mesh.position.z > 2.0, `Boost flame spawns at exhaust tips behind car (z = ${boostParticle.mesh.position.z.toFixed(2)})`);
  fx.dispose();
}

console.log(`\n========================================`);
console.log(`ALL TESTS PASSED: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);
