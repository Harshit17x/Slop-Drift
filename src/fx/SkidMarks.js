import * as THREE from 'three';

export class SkidMarks {
  constructor(scene, { max = 600 } = {}) {
    this.scene = scene;
    this.pool = [];
    this.cursor = 0;
    const geometry = new THREE.PlaneGeometry(0.2, 1.1);
    for (let i = 0; i < max; i += 1) {
      const material = new THREE.MeshBasicMaterial({ color: 0x11151b, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, life: 0 });
    }
  }

  add(point, forward, slip = 1) {
    const item = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    item.mesh.visible = true;
    item.mesh.position.copy(point).add(new THREE.Vector3(0, 0.012, 0));
    item.mesh.rotation.y = Math.atan2(forward.x, forward.z);
    item.mesh.scale.set(0.7 + Math.min(1.4, slip), 0.45 + Math.min(1, slip), 1);
    item.mesh.material.opacity = Math.min(0.65, 0.18 + slip * 0.28);
    item.life = 6;
  }

  update(dt) {
    this.pool.forEach((item) => {
      if (!item.mesh.visible) return;
      item.life -= dt;
      if (item.life <= 0) { item.mesh.visible = false; return; }
      item.mesh.material.opacity = Math.min(item.mesh.material.opacity, item.life / 2.4 * 0.6);
    });
  }
}
