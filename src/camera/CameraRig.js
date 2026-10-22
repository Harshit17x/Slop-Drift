import * as THREE from 'three';
import { CONFIG } from '../config.js';

const MODES = ['chase', 'far', 'hood', 'cockpit'];

function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export class CameraRig {
  constructor(renderer, physicsWorld) {
    this.renderer = renderer;
    this.physicsWorld = physicsWorld;
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 30000);
    this.modeIndex = 0;
    this.mode = MODES[0];
    this.vehicle = null;
    this.position = new THREE.Vector3(0, 4, 8);
    this.lookAt = new THREE.Vector3();
    this.currentFov = 70;
    this.blend = null;
    this.freeLook = { x: 0, y: 0, active: false, lookBack: false };
    this.lastForward = new THREE.Vector3(0, 0, -1);
  }

  attachVehicle(vehicle) {
    this.vehicle = vehicle;
    if (vehicle?.inspection) {
      this.cockpitPoint = vehicle.getCockpitPosition?.() || null;
    }
  }

  get modeName() {
    return this.mode;
  }

  cycle() {
    const previous = this.mode;
    this.modeIndex = (this.modeIndex + 1) % MODES.length;
    this.mode = MODES[this.modeIndex];
    this.vehicle?.setCockpitMode?.(this.mode === 'cockpit');
    this.blend = { from: previous, to: this.mode, time: 0 };
    return this.mode;
  }

  setMode(mode) {
    const index = MODES.indexOf(mode);
    if (index < 0 || mode === this.mode) return;
    const previous = this.mode;
    this.modeIndex = index;
    this.mode = mode;
    this.vehicle?.setCockpitMode?.(this.mode === 'cockpit');
    this.blend = { from: previous, to: mode, time: 0 };
  }

  setFreeLook({ x = 0, y = 0, active = false, lookBack = false } = {}) {
    this.freeLook = { x, y, active, lookBack };
  }

  getVehiclePose() {
    if (!this.vehicle) return null;
    return this.vehicle.getPose();
  }

  computePose(mode, dt) {
    const pose = this.getVehiclePose();
    if (!pose) return { position: this.position.clone(), target: this.lookAt.clone(), fov: this.currentFov };
    const forward = pose.forward.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const speed = pose.speedMps;
    const driftAngle = Math.abs(pose.drift?.angleDeg || 0);
    const lookAhead = forward.clone().multiplyScalar(CONFIG.camera.lookAhead + speed * 0.12);
    const target = pose.position.clone().add(lookAhead).add(new THREE.Vector3(0, 0.72, 0));
    let desired;
    let fov;
    if (mode === 'far') {
      desired = pose.position.clone().addScaledVector(forward, -CONFIG.camera.farDistance).addScaledVector(up, CONFIG.camera.farHeight);
      fov = 68 + Math.min(10, speed * 0.04);
    } else if (mode === 'hood') {
      desired = pose.position.clone().addScaledVector(forward, 1.45).add(new THREE.Vector3(0, CONFIG.camera.hoodHeight, 0));
      fov = 72 + Math.min(12, speed * 0.06);
    } else if (mode === 'cockpit') {
      desired = this.vehicle.getCockpitPosition?.() || pose.position.clone().add(new THREE.Vector3(0, 1.0, 0.2));
      desired.add(new THREE.Vector3(0, Math.sin(pose.suspensionBob || 0) * 0.02, 0));
      fov = CONFIG.camera.interiorFov + Math.min(5, speed * 0.015);
    } else {
      const distance = CONFIG.camera.chaseDistance + Math.min(2.5, speed * 0.04) + Math.min(1.2, driftAngle * 0.014);
      const height = CONFIG.camera.chaseHeight + Math.min(1.2, speed * 0.015) + Math.min(0.6, driftAngle * 0.007);
      desired = pose.position.clone().addScaledVector(forward, -distance).addScaledVector(up, height);
      fov = THREE.MathUtils.lerp(CONFIG.camera.chaseFov[0], CONFIG.camera.chaseFov[1], Math.min(1, speed / 72));
    }

    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    const lookYaw = this.freeLook.active ? this.freeLook.x : 0;
    const lookPitch = this.freeLook.active ? this.freeLook.y : 0;
    const back = this.freeLook.lookBack ? Math.PI : 0;
    const lookDirection = forward.clone().applyAxisAngle(up, lookYaw + back).applyAxisAngle(right, lookPitch).normalize();
    const lookDistance = mode === 'cockpit' ? 12 : 16;
    const finalTarget = mode === 'cockpit' ? desired.clone().addScaledVector(lookDirection, lookDistance) : target;
    return { position: desired, target: finalTarget, fov };
  }

  collisionSafePosition(from, to) {
    if (!this.physicsWorld?.raycast || !this.vehicle?.body) return to;
    const direction = to.clone().sub(from);
    const distance = direction.length();
    if (distance < 0.001) return to;
    const hit = this.physicsWorld.raycast(from, direction.normalize(), distance, { excludeBody: this.vehicle.body });
    if (!hit) return to;
    return from.clone().lerp(hit.point, Math.max(0, (hit.toi - CONFIG.camera.collisionPadding) / distance));
  }

  update(dt) {
    const targetPose = this.computePose(this.mode, dt);
    if (this.blend) {
      this.blend.time += dt;
      const alpha = THREE.MathUtils.smootherstep(Math.min(1, this.blend.time / CONFIG.camera.blendSeconds), 0, 1);
      const from = this.computePose(this.blend.from, dt);
      targetPose.position.lerpVectors(from.position, targetPose.position, alpha);
      targetPose.target.lerpVectors(from.target, targetPose.target, alpha);
      targetPose.fov = THREE.MathUtils.lerp(from.fov, targetPose.fov, alpha);
      if (alpha >= 1) this.blend = null;
    }
    const position = this.collisionSafePosition(targetPose.target, targetPose.position);
    this.position.lerp(position, 1 - Math.exp(-8 * dt));
    this.lookAt.lerp(targetPose.target, 1 - Math.exp(-10 * dt));
    this.currentFov = damp(this.currentFov, targetPose.fov, 5, dt);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();
  }

  resize(width, height) {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }
}

export { MODES };
