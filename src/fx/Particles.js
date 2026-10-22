import * as THREE from 'three';

const PARTICLE_TYPES = {
  smoke: { color: 0xaab4bf, size: 0.28, life: 0.8, gravity: 0.32 },
  dust: { color: 0xc4a272, size: 0.22, life: 0.7, gravity: 0.45 },
  sparks: { color: 0xffc857, size: 0.1, life: 0.35, gravity: 3.4 },
  flame: { color: 0xff6b35, size: 0.2, life: 0.22, gravity: -0.18 },
};

export class Particles {
  constructor(scene, { max = 450 } = {}) {
    this.scene = scene;
    this.pool = [];
    this.active = [];
    const geometry = new THREE.SphereGeometry(1, 5, 4);
    Object.entries(PARTICLE_TYPES).forEach(([type, style]) => {
      const material = new THREE.MeshBasicMaterial({ color: style.color, transparent: true, opacity: type === 'sparks' ? 0.95 : 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
      for (let i = 0; i < Math.ceil(max / Object.keys(PARTICLE_TYPES).length); i += 1) {
        const mesh = new THREE.Mesh(geometry, material.clone());
        mesh.visible = false;
        mesh.userData.type = type;
        scene.add(mesh);
        this.pool.push({ mesh, velocity: new THREE.Vector3(), life: 0, maxLife: 0, type, seed: Math.random() });
      }
    });
  }

  obtain(type) {
    const particle = this.pool.find((item) => !item.mesh.visible && item.type === type);
    if (!particle) return null;
    particle.mesh.visible = true;
    return particle;
  }

  spawn(type, position, velocity = new THREE.Vector3(), intensity = 1) {
    const style = PARTICLE_TYPES[type] || PARTICLE_TYPES.smoke;
    const particle = this.obtain(type);
    if (!particle) return;
    particle.mesh.position.copy(position);
    particle.mesh.scale.setScalar(style.size * (0.7 + Math.random() * 0.8) * intensity);
    particle.mesh.material.opacity = type === 'sparks' ? 0.95 : 0.42 + Math.random() * 0.2;
    particle.velocity.copy(velocity).multiplyScalar(0.5 + Math.random() * 0.7);
    particle.velocity.x += (Math.random() - 0.5) * intensity * 1.4;
    particle.velocity.y += (0.3 + Math.random()) * intensity;
    particle.velocity.z += (Math.random() - 0.5) * intensity * 1.4;
    particle.maxLife = style.life * (0.7 + Math.random() * 0.6);
    particle.life = particle.maxLife;
    this.active.push(particle);
  }

  spawnSmoke(position, intensity = 1, surface = 'asphalt') {
    this.spawn(surface === 'grass' || surface === 'gravel' ? 'dust' : 'smoke', position, new THREE.Vector3(0, 0.8, 0), intensity);
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const particle = this.active[i];
      const style = PARTICLE_TYPES[particle.type] || PARTICLE_TYPES.smoke;
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.mesh.visible = false;
        this.active.splice(i, 1);
        continue;
      }
      particle.velocity.y -= style.gravity * dt;
      particle.mesh.position.addScaledVector(particle.velocity, dt);
      const age = 1 - particle.life / particle.maxLife;
      particle.mesh.scale.multiplyScalar(1 + dt * (particle.type === 'smoke' ? 1.4 : 0.35));
      particle.mesh.material.opacity *= Math.max(0, 1 - dt * (0.8 + age));
    }
  }

  dispose() {
    this.pool.forEach(({ mesh }) => { mesh.geometry.dispose(); mesh.material.dispose(); this.scene.remove(mesh); });
  }
}
