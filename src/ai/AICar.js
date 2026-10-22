import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Vehicle } from '../physics/Vehicle.js';

export class AICar extends Vehicle {
  constructor({ racingLine, difficulty = 'Medium', offset = 0, ...options } = {}) {
    super({ ...options, isAI: true, color: options.color ?? 0x2e86de });
    this.racingLine = racingLine;
    this.aiDifficulty = difficulty;
    this.lineOffset = offset;
    this.lookDistance = 34;
    this.targetSpeed = 32;
    this.aiProgress = Math.max(0, offset);
    this.mistakeTimer = 0;
    this.steerMemory = 0;
  }

  spawnAtDistance(distance) {
    const target = this.racingLine.sample(distance);
    const up = new THREE.Vector3(0, 1, 0);
    const lateral = new THREE.Vector3().crossVectors(target.tangent, up).normalize();
    const position = target.position.clone().addScaledVector(lateral, this.lineOffset);
    const forward = target.tangent.clone().setY(0).normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), forward);
    this.respawn({ position: position.addScaledVector(up, 0.32), rotation: quaternion });
    this.aiProgress = distance;
  }

  computeControls(dt, playerPose) {
    const pose = this.getPose();
    const nearest = this.racingLine.nearest(pose.position);
    const nextDistance = (nearest.index / Math.max(1, this.racingLine.points.length)) * this.racingLine.length + this.lookDistance + this.lineOffset * 0.5;
    const target = this.racingLine.sample(nextDistance);
    const localTarget = target.position.clone().sub(pose.position);
    const signed = localTarget.dot(new THREE.Vector3(1, 0, 0).applyQuaternion(pose.quaternion));
    const forward = localTarget.dot(pose.forward);
    const targetSteer = THREE.MathUtils.clamp(signed / Math.max(2, forward), -1, 1);
    const curvature = Math.abs(target.tangent.clone().sub(pose.forward).length());
    const difficultyFactor = this.aiDifficulty === 'Easy' ? 0.78 : this.aiDifficulty === 'Hard' ? 1.06 : 0.94;
    const desiredSpeed = (41 - curvature * 23) * difficultyFactor;
    const speedError = desiredSpeed - pose.speedMps;
    const throttle = THREE.MathUtils.clamp(speedError * 0.12 + 0.26, 0, 1);
    const brake = THREE.MathUtils.clamp(-speedError * 0.13, 0, 1);
    this.steerMemory += (targetSteer - this.steerMemory) * Math.min(1, dt * 4.5);
    if (Math.random() < 0.005 * dt * 60 && this.aiDifficulty !== 'Hard') this.mistakeTimer = 0.35;
    this.mistakeTimer = Math.max(0, this.mistakeTimer - dt);
    const mistake = this.mistakeTimer > 0 ? Math.sin(this.mistakeTimer * 40) * 0.25 : 0;
    const avoidPlayer = playerPose ? playerPose.position.clone().sub(pose.position) : null;
    let avoidance = 0;
    if (avoidPlayer && avoidPlayer.length() < 8 && avoidPlayer.dot(pose.forward) > 0) avoidance = avoidPlayer.dot(new THREE.Vector3(1, 0, 0).applyQuaternion(pose.quaternion)) > 0 ? -0.25 : 0.25;
    return {
      throttle,
      brake,
      steer: THREE.MathUtils.clamp(this.steerMemory + mistake + avoidance, -1, 1),
      handbrake: false,
      nitro: pose.speedMps < desiredSpeed * 0.82 && pose.nitro > 22,
      driftAssist: 0.9,
      headlights: false,
    };
  }

  stepAI(dt, playerPose) {
    const controls = this.computeControls(dt, playerPose);
    return this.step(dt, controls);
  }
}
