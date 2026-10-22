import * as THREE from 'three';
import { CONFIG, clamp } from './mountain-config.js';

export const CAMERA_MODES = Object.freeze(['chase', 'wide', 'hood', 'cockpit']);

function smoothFactor(lambda, dt) {
  return 1 - Math.exp(-lambda * Math.max(0, dt));
}

export class MountainCameraRig {
  constructor({ vehicle = null, blendSeconds = CONFIG.camera.blendSeconds } = {}) {
    this.vehicle = vehicle;
    this.blendSeconds = blendSeconds;
    this.cameras = Object.fromEntries(CAMERA_MODES.map((mode) => [mode, new THREE.PerspectiveCamera(70, 1, 0.08, 2400)]));
    Object.entries(this.cameras).forEach(([mode, camera]) => { camera.name = `MountainCamera_${mode}`; });
    this.activeMode = 'chase';
    this.renderCamera = this.cameras.chase;
    this.position = new THREE.Vector3(0, 4, 8);
    this.target = new THREE.Vector3();
    this.currentFov = 70;
    this.freeLook = { x: 0, y: 0, active: false, lookBack: false };
    this.blend = null;
    this.aspect = 1;
    this.cameraLabel = 'CHASE';
  }

  attach(vehicle) {
    this.vehicle = vehicle;
    return this;
  }

  get mode() {
    return this.activeMode;
  }

  get modeName() {
    return this.cameraLabel;
  }

  setMode(mode) {
    if (!CAMERA_MODES.includes(mode) || mode === this.activeMode) return this.activeMode;
    const previousCamera = this.renderCamera;
    this.activeMode = mode;
    this.cameraLabel = mode.toUpperCase();
    this.renderCamera = this.cameras[mode];
    this.blend = {
      position: previousCamera.position.clone(),
      quaternion: previousCamera.quaternion.clone(),
      target: this.target.clone(),
      fov: previousCamera.fov,
      time: 0,
    };
    return this.activeMode;
  }

  cycle() {
    const index = CAMERA_MODES.indexOf(this.activeMode);
    return this.setMode(CAMERA_MODES[(index + 1) % CAMERA_MODES.length]);
  }

  setFreeLook({ x = 0, y = 0, active = false, lookBack = false } = {}) {
    this.freeLook = { x, y, active, lookBack };
  }

  getPose() {
    return this.vehicle?.getPose?.() || null;
  }

  computePose(mode) {
    const pose = this.getPose();
    if (!pose) return { position: this.position.clone(), target: this.target.clone(), fov: this.currentFov };
    const position = pose.position.clone();
    const forward = pose.forward.clone().normalize();
    const right = pose.right.clone().normalize();
    const up = pose.up.clone().normalize();
    const speed = pose.speedMps || 0;
    const driftAngle = Math.abs(pose.drift?.angleDeg || 0);
    const ahead = CONFIG.camera.lookAhead + speed * 0.12;
    const target = position.clone().addScaledVector(forward, ahead).addScaledVector(up, 0.7);

    // Realistic drift look-ahead anticipation: camera frames the exit of the drift
    const driftAngleRad = pose.drift?.angle || 0;
    if (Math.abs(driftAngleRad) > 0.08 && speed > 5) {
      const driftLookOffset = -Math.sin(driftAngleRad) * Math.min(3.8, speed * 0.085);
      target.addScaledVector(right, driftLookOffset);
    }

    let desired = position.clone();
    let fov = 70;
    if (mode === 'wide') {
      desired.addScaledVector(forward, -(CONFIG.camera.farDistance + Math.min(2.5, speed * 0.04)));
      desired.addScaledVector(up, CONFIG.camera.farHeight + Math.min(1.4, speed * 0.02));
      fov = 66 + Math.min(10, speed * 0.045);
    } else if (mode === 'hood') {
      desired.addScaledVector(forward, 1.45).addScaledVector(up, 1.02);
      fov = 72 + Math.min(10, speed * 0.055);
    } else if (mode === 'cockpit') {
      desired.addScaledVector(forward, 0.22).addScaledVector(up, CONFIG.camera.cockpitHeight);
      fov = 74 + Math.min(5, speed * 0.02);
    } else {
      const distance = CONFIG.camera.chaseDistance + Math.min(2.4, speed * 0.045) + Math.min(1.2, driftAngle * 0.014);
      const height = CONFIG.camera.chaseHeight + Math.min(1.1, speed * 0.018) + Math.min(0.6, driftAngle * 0.008);
      desired.addScaledVector(forward, -distance).addScaledVector(up, height);
      fov = THREE.MathUtils.lerp(64, 88, clamp(speed / 60, 0, 1));
    }

    // High speed / rough surface vibration
    if (speed > 22 || (pose.surface && pose.surface !== 'asphalt')) {
      const shakeIntensity = (pose.surface !== 'asphalt' ? 0.032 : 0.01) * Math.min(1.4, speed / 30);
      desired.x += (Math.random() - 0.5) * shakeIntensity;
      desired.y += (Math.random() - 0.5) * shakeIntensity;
    }

    const lookYaw = this.freeLook.active ? this.freeLook.x : 0;
    const lookPitch = this.freeLook.active ? this.freeLook.y : 0;
    const lookBack = this.freeLook.lookBack ? Math.PI : 0;
    const lookDirection = forward.clone().applyAxisAngle(up, lookYaw + lookBack).applyAxisAngle(right, lookPitch).normalize();
    const finalTarget = mode === 'cockpit' ? desired.clone().addScaledVector(lookDirection, 14) : target;
    return { position: desired, target: finalTarget, fov };
  }

  update(dt, input = null) {
    if (input) this.setFreeLook({ ...input.freeLook, lookBack: input.lookBack });
    const desired = this.computePose(this.activeMode);
    let targetPosition = desired.position;
    let targetLook = desired.target;
    let targetFov = desired.fov;
    if (this.blend) {
      this.blend.time += dt;
      const alpha = THREE.MathUtils.smootherstep(clamp(this.blend.time / this.blendSeconds, 0, 1), 0, 1);
      targetPosition = this.blend.position.clone().lerp(desired.position, alpha);
      targetLook = this.blend.target.clone().lerp(desired.target, alpha);
      targetFov = THREE.MathUtils.lerp(this.blend.fov, desired.fov, alpha);
      if (alpha >= 1) this.blend = null;
    }
    this.position.lerp(targetPosition, smoothFactor(8, dt));
    this.target.lerp(targetLook, smoothFactor(10, dt));
    this.currentFov = THREE.MathUtils.lerp(this.currentFov, targetFov, smoothFactor(5, dt));
    const camera = this.renderCamera;
    camera.position.copy(this.position);
    camera.lookAt(this.target);
    camera.fov = this.currentFov;
    camera.aspect = this.aspect;
    camera.updateProjectionMatrix();
    return camera;
  }

  resize(width, height) {
    this.aspect = width / Math.max(1, height);
    Object.values(this.cameras).forEach((camera) => {
      camera.aspect = this.aspect;
      camera.updateProjectionMatrix();
    });
  }

  getCamera() {
    return this.renderCamera;
  }
}
