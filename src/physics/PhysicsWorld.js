import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const UP = { x: 0, y: 1, z: 0 };

export class PhysicsWorld {
  constructor() {
    this.ready = false;
    this.world = null;
    this.RAPIER = RAPIER;
    this.fixedDt = 1 / 120;
    this.accumulator = 0;
    this.trackColliders = [];
  }

  async init() {
    if (!this.ready) {
      await RAPIER.init();
      this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      this.world.timestep = this.fixedDt;
      this.ready = true;
    }
    return this;
  }

  addTrimeshCollider({ vertices, indices, userData = {} }) {
    if (!this.ready || !vertices?.length || !indices?.length) return null;
    const descriptor = RAPIER.ColliderDesc.trimesh(vertices, indices);
    descriptor.setFriction(1.05);
    descriptor.setRestitution(0.04);
    const collider = this.world.createCollider(descriptor);
    collider.userData = userData;
    this.trackColliders.push(collider);
    return collider;
  }

  addGroundFallback(y = 0) {
    const descriptor = RAPIER.ColliderDesc.cuboid(5000, 0.2, 5000).setTranslation(0, y - 0.2, 0);
    descriptor.setFriction(1.05);
    const collider = this.world.createCollider(descriptor);
    collider.userData = { surface: 'asphalt', fallback: true };
    return collider;
  }

  addStaticBox({ position, halfExtents, rotation = new THREE.Quaternion(), userData = {} }) {
    const descriptor = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
    descriptor.setFriction(1.05);
    descriptor.setRestitution(0.04);
    const collider = this.world.createCollider(descriptor);
    collider.userData = userData;
    this.trackColliders.push(collider);
    return collider;
  }

  createVehicleBody(spawn = { position: new THREE.Vector3(0, 3, 0), rotation: new THREE.Quaternion() }) {
    const p = spawn.position || new THREE.Vector3();
    const q = spawn.rotation || new THREE.Quaternion();
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(CONFIG.car.linearDamping)
      .setAngularDamping(CONFIG.car.angularDamping)
      .setCanSleep(false);
    const body = this.world.createRigidBody(bodyDesc);
    const half = CONFIG.car.bodyCollider.halfExtents;
    const colliderDesc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(0, CONFIG.car.bodyCollider.offsetY, 0)
      .setFriction(0.35)
      .setRestitution(0.06);
    const collider = this.world.createCollider(colliderDesc, body);
    collider.userData = { type: 'vehicle' };
    // Keep the arcade body upright while still allowing yaw for steering/drifting.
    if (typeof body.setEnabledRotations === 'function') body.setEnabledRotations(false, true, false, true);
    if (typeof body.setAdditionalMassProperties === 'function') {
      body.setAdditionalMassProperties(
        CONFIG.car.mass,
        { x: 0, y: CONFIG.car.centerOfMassY, z: 0 },
        { x: CONFIG.car.mass * 0.9, y: CONFIG.car.mass * 0.7, z: CONFIG.car.mass * 1.1 },
        { x: 0, y: 0, z: 0, w: 1 },
        true,
      );
    } else if (typeof body.setAdditionalMass === 'function') body.setAdditionalMass(CONFIG.car.mass, true);
    else if (typeof body.setMass === 'function') body.setMass(CONFIG.car.mass, true);
    return { body, collider };
  }

  raycast(origin, direction, length, { excludeBody = null } = {}) {
    if (!this.ready) return null;
    const dir = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    let hit = null;
    try {
      hit = this.world.castRay(ray, length, true);
    } catch {
      hit = null;
    }
    if (!hit) return null;
    if (excludeBody && hit.collider?.parent()?.handle === excludeBody.handle) return null;
    const point = ray.pointAt(hit.toi);
    return {
      toi: hit.toi,
      point: new THREE.Vector3(point.x, point.y, point.z),
      normal: new THREE.Vector3(0, 1, 0),
      collider: hit.collider,
      userData: hit.collider?.userData || {},
    };
  }

  step(realDt) {
    if (!this.ready) return 0;
    this.accumulator += Math.min(0.1, realDt);
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < 10) {
      this.world.timestep = this.fixedDt;
      this.world.step();
      this.accumulator -= this.fixedDt;
      steps += 1;
    }
    return steps;
  }

  setBodyTransform(body, position, rotation, wake = true) {
    if (!body) return;
    body.setTranslation({ x: position.x, y: position.y, z: position.z }, wake);
    body.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }, wake);
    body.setLinvel({ x: 0, y: 0, z: 0 }, wake);
    body.setAngvel({ x: 0, y: 0, z: 0 }, wake);
  }

  dispose() {
    if (this.world) this.world.free();
    this.world = null;
    this.ready = false;
  }
}
