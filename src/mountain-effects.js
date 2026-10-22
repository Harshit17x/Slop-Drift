import * as THREE from 'three';

const PARTICLE_STYLES = Object.freeze({
  smoke: Object.freeze({ color: 0xb8c1ca, size: 0.26, life: 0.82, gravity: 0.22, opacity: 0.45 }),
  dust: Object.freeze({ color: 0xb18c66, size: 0.23, life: 0.66, gravity: 0.48, opacity: 0.5 }),
  sparks: Object.freeze({ color: 0xffc857, size: 0.09, life: 0.28, gravity: 3.3, opacity: 0.9 }),
  boost: Object.freeze({ color: 0xff7048, size: 0.18, life: 0.24, gravity: -0.16, opacity: 0.85 }),
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class MountainEffects {
  constructor(scene, { particles = 240, skids = 360 } = {}) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'MountainEffects';
    this.scene.add(this.root);
    this.particleGeometry = new THREE.SphereGeometry(1, 6, 4);
    this.skidGeometry = new THREE.PlaneGeometry(0.22, 1.14);
    this.particles = [];
    this.activeParticles = [];
    this.skids = [];
    this.skidCursor = 0;
    this.enabled = true;
    this.emissionScale = 1;
    const types = Object.keys(PARTICLE_STYLES);
    types.forEach((type) => {
      const style = PARTICLE_STYLES[type];
      const count = Math.max(1, Math.ceil(particles / types.length));
      for (let index = 0; index < count; index += 1) {
        const material = new THREE.MeshBasicMaterial({ color: style.color, transparent: true, opacity: style.opacity, depthWrite: false, blending: type === 'sparks' || type === 'boost' ? THREE.AdditiveBlending : THREE.NormalBlending });
        const mesh = new THREE.Mesh(this.particleGeometry, material);
        mesh.visible = false;
        this.root.add(mesh);
        this.particles.push({ type, mesh, velocity: new THREE.Vector3(), life: 0, maxLife: 0 });
      }
    });
    for (let index = 0; index < skids; index += 1) {
      const material = new THREE.MeshBasicMaterial({ color: 0x101318, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
      const mesh = new THREE.Mesh(this.skidGeometry, material);
      mesh.visible = false;
      this.root.add(mesh);
      this.skids.push({ mesh, life: 0, maxLife: 0 });
    }
  }

  setQuality(profile) {
    this.emissionScale = clamp(Number(profile?.effects ?? 1), 0, 1.5);
    this.enabled = this.emissionScale > 0;
  }

  obtainParticle(type) {
    return this.particles.find((particle) => !particle.mesh.visible && particle.type === type) || null;
  }

  spawn(type, position, velocity = new THREE.Vector3(), intensity = 1) {
    if (!this.enabled) return null;
    const style = PARTICLE_STYLES[type] || PARTICLE_STYLES.smoke;
    const particle = this.obtainParticle(type);
    if (!particle) return null;
    const amount = Math.max(0.15, intensity * this.emissionScale);
    particle.mesh.visible = true;
    particle.mesh.position.copy(position);
    particle.mesh.scale.setScalar(style.size * (0.75 + Math.random() * 0.85) * amount);
    particle.mesh.material.opacity = style.opacity * (0.76 + Math.random() * 0.28);
    particle.velocity.copy(velocity).multiplyScalar(0.45 + Math.random() * 0.7);
    particle.velocity.x += (Math.random() - 0.5) * amount * 1.5;
    particle.velocity.y += (0.25 + Math.random()) * amount;
    particle.velocity.z += (Math.random() - 0.5) * amount * 1.5;
    particle.maxLife = style.life * (0.75 + Math.random() * 0.55);
    particle.life = particle.maxLife;
    this.activeParticles.push(particle);
    return particle;
  }

  spawnSkid(position, forward, normal = new THREE.Vector3(0, 1, 0), intensity = 1) {
    if (!this.enabled || !this.skids.length) return;
    const item = this.skids[this.skidCursor];
    this.skidCursor = (this.skidCursor + 1) % this.skids.length;
    item.mesh.visible = true;
    item.mesh.position.copy(position).addScaledVector(normal, 0.025);
    item.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal.clone().normalize());
    item.mesh.rotateOnAxis(normal.clone().normalize(), Math.atan2(forward.x, -forward.z));
    item.mesh.scale.set(0.65 + Math.min(1.5, intensity), 0.5 + Math.min(0.9, intensity), 1);
    item.mesh.material.opacity = Math.min(0.62, 0.14 + intensity * 0.28);
    item.life = 5.5;
    item.maxLife = item.life;
  }

  wheelWorldPosition(vehicle, wheel) {
    return wheel.local.clone().applyQuaternion(vehicle.quaternion).add(vehicle.position);
  }

  emitVehicle(vehicle, pose, dt) {
    if (!this.enabled || !vehicle || !pose) return;
    vehicle.__mountainEffectTimer = (vehicle.__mountainEffectTimer || 0) - dt;
    vehicle.__mountainSkidTimer = (vehicle.__mountainSkidTimer || 0) - dt;
    const speed = pose.speedMps || 0;
    if (speed < 4 || vehicle.__mountainEffectTimer > 0) return;
    const rearWheels = vehicle.wheels?.filter((wheel) => !wheel.steer) || [];
    const intensity = clamp(speed / 28, 0.3, 1.7) * (pose.drift?.drifting ? 1.2 : 0.6);
    const surface = pose.surface === 'asphalt' || pose.surface === 'shoulder' ? 'smoke' : 'dust';
    rearWheels.forEach((wheel) => {
      const point = this.wheelWorldPosition(vehicle, wheel);
      const sample = vehicle.sampleSurface?.(point.x, point.z);
      if (sample) point.y = sample.height + 0.05;
      this.spawn(surface, point, pose.velocity.clone().multiplyScalar(-0.035), intensity);
      if (pose.drift?.drifting && vehicle.__mountainSkidTimer <= 0) this.spawnSkid(point, pose.forward, sample?.normal ? new THREE.Vector3(sample.normal.x, sample.normal.y, sample.normal.z) : undefined, intensity);
    });
    vehicle.__mountainEffectTimer = pose.drift?.drifting ? 0.045 : 0.085;
    if (pose.drift?.drifting && vehicle.__mountainSkidTimer <= 0) vehicle.__mountainSkidTimer = 0.055;
    if (pose.handbrake && speed > 18 && Math.random() > 0.55) {
      const point = this.wheelWorldPosition(vehicle, rearWheels[0] || { local: new THREE.Vector3() });
      this.spawn('sparks', point, pose.velocity.clone().multiplyScalar(-0.08), intensity * 0.75);
    }
  }

  emitBoost(vehicle, pose) {
    if (!vehicle || !pose) return;
    const point = this.wheelWorldPosition(vehicle, { local: new THREE.Vector3(0, 0.35, 1.55) });
    this.spawn('boost', point, pose.velocity.clone().multiplyScalar(-0.1), 1.1);
  }

  update(dt) {
    for (let index = this.activeParticles.length - 1; index >= 0; index -= 1) {
      const particle = this.activeParticles[index];
      const style = PARTICLE_STYLES[particle.type] || PARTICLE_STYLES.smoke;
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.mesh.visible = false;
        this.activeParticles.splice(index, 1);
        continue;
      }
      particle.velocity.y -= style.gravity * dt;
      particle.mesh.position.addScaledVector(particle.velocity, dt);
      const age = 1 - particle.life / particle.maxLife;
      particle.mesh.scale.multiplyScalar(1 + dt * (particle.type === 'smoke' || particle.type === 'dust' ? 1.25 : 0.3));
      particle.mesh.material.opacity = style.opacity * Math.max(0, 1 - age * 0.86);
    }
    this.skids.forEach((item) => {
      if (!item.mesh.visible) return;
      item.life -= dt;
      if (item.life <= 0) {
        item.mesh.visible = false;
        return;
      }
      item.mesh.material.opacity = Math.min(item.mesh.material.opacity, item.life / item.maxLife * 0.55);
    });
  }

  dispose() {
    this.particles.forEach((particle) => { particle.mesh.material.dispose(); this.root.remove(particle.mesh); });
    this.skids.forEach((item) => { item.mesh.material.dispose(); this.root.remove(item.mesh); });
    this.particleGeometry.dispose();
    this.skidGeometry.dispose();
    this.scene.remove(this.root);
    this.particles = [];
    this.skids = [];
    this.activeParticles = [];
  }
}
