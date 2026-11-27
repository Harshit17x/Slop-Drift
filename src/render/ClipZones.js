// Clipping zones for the procedural mountain roads: glowing posts on the outside of the tightest
// corners. A drift that passes the apex pays a bonus, the same rule as Fujimi's authored zones.

import * as THREE from 'three';

const IDLE = new THREE.Color(0x35e6ff);
const HIT = new THREE.Color(0xf2b01e);
export const CLIP_BONUS = 250;
const POSTS = 3;

/**
 * The `count` tightest corners of a road (radius under 55 m), at least `gap` metres apart.
 * Each zone sits on the centreline at the apex; `side` is +1 when the outside edge is the road's right.
 */
export function findApexes(road, count = 8, gap = 90) {
  const order = [...road.curvature.keys()].filter((i) => Math.abs(road.curvature[i]) > 1 / 55)
    .sort((a, b) => Math.abs(road.curvature[b]) - Math.abs(road.curvature[a]));
  const picked = [];
  const along = (a, b) => {
    const d = Math.abs(a - b) * road.spacing;
    return road.closed ? Math.min(d, road.length - d) : d;
  };
  for (const i of order) {
    if (picked.length >= count) break;
    if (picked.every((j) => along(i, j) >= gap)) picked.push(i);
  }
  // Positive curvature turns right, so the outside is the left (-right vector).
  return picked.sort((a, b) => a - b).map((i, n) => ({
    name: `Clip ${n + 1}`, index: i, x: road.px[i], z: road.pz[i], side: road.curvature[i] > 0 ? -1 : 1,
  }));
}

export class ClipZones {
  constructor(road) {
    this.zones = findApexes(road).map((zone) => ({ ...zone, armed: true, glow: 0 }));
    const geometry = new THREE.CylinderGeometry(0.11, 0.11, 1.3, 6).translate(0, 0.65, 0);
    this.mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ toneMapped: false }), this.zones.length * POSTS);
    this.mesh.frustumCulled = false;
    const m = new THREE.Matrix4();
    const step = Math.max(1, Math.round(6 / road.spacing));
    let k = 0;
    for (const zone of this.zones) {
      for (let p = -1; p <= 1; p += 1) {
        const i = road.closed ? (zone.index + p * step + road.count) % road.count : Math.min(road.count - 1, Math.max(0, zone.index + p * step));
        const off = zone.side * (road.halfWidth[i] + 0.7);
        m.makeTranslation(road.px[i] + road.rx[i] * off, road.py[i] + road.bank[i] * off, road.pz[i] + road.rz[i] * off);
        this.mesh.setMatrixAt(k, m);
        this.mesh.setColorAt(k, IDLE);
        k += 1;
      }
    }
    this.color = new THREE.Color();
  }

  /** Once per simulation step: returns { name, bonus } on the frame a drift passes an armed apex. */
  check(state, drift) {
    let paid = null;
    for (const zone of this.zones) {
      const d = Math.hypot(state.position.x - zone.x, state.position.z - zone.z);
      if (d > 26) zone.armed = true;
      else if (zone.armed && d < 10 && drift?.active) {
        zone.armed = false;
        zone.glow = 1;
        paid = { name: zone.name, bonus: CLIP_BONUS };
      }
    }
    return paid;
  }

  update(dt) {
    let dirty = false;
    this.zones.forEach((zone, n) => {
      if (zone.glow <= 0) return;
      zone.glow = Math.max(0, zone.glow - dt * 0.6);
      this.color.copy(IDLE).lerp(HIT, Math.min(1, zone.glow * 1.5));
      for (let p = 0; p < POSTS; p += 1) this.mesh.setColorAt(n * POSTS + p, this.color);
      dirty = true;
    });
    if (dirty) this.mesh.instanceColor.needsUpdate = true;
  }
}
