import * as THREE from 'three';

export class RacingLine {
  constructor(points = []) {
    this.points = points.map((point) => point.clone());
    this.length = 0;
    this.cumulative = [];
    this.rebuild();
  }

  rebuild() {
    this.length = 0;
    this.cumulative = [0];
    for (let i = 0; i < this.points.length; i += 1) {
      const next = this.points[(i + 1) % this.points.length];
      this.length += this.points[i].distanceTo(next);
      this.cumulative.push(this.length);
    }
  }

  sample(distance) {
    if (!this.points.length) return { position: new THREE.Vector3(), tangent: new THREE.Vector3(0, 0, -1), index: 0 };
    const wrapped = ((distance % this.length) + this.length) % this.length;
    let index = 0;
    while (index < this.points.length - 1 && this.cumulative[index + 1] < wrapped) index += 1;
    const a = this.points[index];
    const b = this.points[(index + 1) % this.points.length];
    const span = Math.max(0.001, this.cumulative[index + 1] - this.cumulative[index]);
    const t = (wrapped - this.cumulative[index]) / span;
    const position = a.clone().lerp(b, t);
    const tangent = b.clone().sub(a).normalize();
    return { position, tangent, index };
  }

  nearest(position) {
    let best = { distance: Infinity, index: 0, point: this.points[0] || new THREE.Vector3(), tangent: new THREE.Vector3(0, 0, -1) };
    this.points.forEach((point, index) => {
      const distance = point.distanceToSquared(position);
      if (distance < best.distance) {
        const next = this.points[(index + 1) % this.points.length] || point;
        best = { distance, index, point, tangent: next.clone().sub(point).normalize() };
      }
    });
    return best;
  }

  toLineObject(color = 0x76f7b2) {
    const geometry = new THREE.BufferGeometry().setFromPoints([...this.points, this.points[0]].filter(Boolean));
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 });
    return new THREE.Line(geometry, material);
  }
}
