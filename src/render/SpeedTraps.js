// Speed traps on the fast straights of any map: glowing radar pylons on both edges of the road.
// Crossing at or above the trap's target km/h (or setting a new trap PB) pays XP, CR, and style callouts.

import * as THREE from 'three';
import { clamp } from '../core/math.js';

const IDLE = new THREE.Color(0x35e6ff);
const CLEAR = new THREE.Color(0xc7ff52);
const MISS = new THREE.Color(0xf2b01e);
const PYLONS = 2;

/**
 * Pick up to `count` straight sections (|curvature| < 1/120 for a ~60 m approach) spaced at least
 * `gap` metres apart along `road`. Returns trap descriptors with a deterministic `targetKmh`.
 */
export function findSpeedTraps(road, { count = 3, gap = 240, prefix = 'road' } = {}) {
  if (!road?.curvature || road.count < 20) return [];
  const win = Math.max(4, Math.round(55 / Math.max(0.25, road.spacing || 1)));
  const candidates = [];
  for (let i = win; i < road.count - 4; i += 3) {
    if (Math.abs(road.curvature[i]) >= 1 / 120) continue;
    let peak = 0;
    for (let k = -win; k <= 3; k += 1) {
      const idx = road.closed ? (i + k + road.count) % road.count : clamp(i + k, 0, road.count - 1);
      peak = Math.max(peak, Math.abs(road.curvature[idx]));
    }
    if (peak < 1 / 95) {
      // Score straightness; favor gentle downhill or flat fast stretches.
      const grade = Number.isFinite(road.grade?.[i]) ? road.grade[i] : 0;
      const straightScore = (1 / 95 - peak) * 1000 + Math.max(-0.08, Math.min(0.05, -grade)) * 15;
      candidates.push({ index: i, peak, straightScore });
    }
  }
  candidates.sort((a, b) => b.straightScore - a.straightScore);
  const picked = [];
  const along = (a, b) => {
    const d = Math.abs(a - b) * (road.spacing || 1);
    return road.closed ? Math.min(d, road.length - d) : d;
  };
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (picked.every((p) => along(c.index, p.index) >= gap)) picked.push(c);
  }
  return picked.sort((a, b) => a.index - b.index).map((c, n) => {
    const hw = Number.isFinite(road.halfWidth?.[c.index]) ? road.halfWidth[c.index] : 5;
    const rawTarget = 120 + (1 - Math.min(1, c.peak * 110)) * 35 + Math.max(0, hw - 4) * 4;
    const targetKmh = Math.round(clamp(rawTarget, 125, 190) / 5) * 5;
    return {
      key: `${prefix}:trap:${n + 1}`,
      name: `Speed Trap ${n + 1}`,
      index: c.index,
      x: road.px[c.index],
      z: road.pz[c.index],
      targetKmh,
    };
  });
}

export class SpeedTraps {
  constructor(road, options = {}) {
    this.traps = findSpeedTraps(road, options).map((trap) => ({
      ...trap, armed: true, glow: 0, hitColor: CLEAR,
    }));
    this.mesh = null;
    this.color = new THREE.Color();
    if (!this.traps.length) return;

    const geometry = new THREE.BoxGeometry(0.18, 2.7, 0.18).translate(0, 1.35, 0);
    this.mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ toneMapped: false }), this.traps.length * PYLONS);
    this.mesh.frustumCulled = false;
    const matrix = new THREE.Matrix4();
    let k = 0;
    for (const trap of this.traps) {
      const i = trap.index;
      const hw = Number.isFinite(road.halfWidth?.[i]) ? road.halfWidth[i] : 5;
      const py = road.py[i];
      const bank = road.bank?.[i] || 0;
      for (const side of [-1, 1]) {
        const off = side * (hw + 0.85);
        matrix.makeTranslation(road.px[i] + road.rx[i] * off, py + bank * off, road.pz[i] + road.rz[i] * off);
        this.mesh.setMatrixAt(k, matrix);
        this.mesh.setColorAt(k, IDLE);
        k += 1;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Check once per simulation frame; returns { key, name, speedKmh, targetKmh } when crossed at speed. */
  check(state) {
    if (!state?.position || !this.traps.length) return null;
    let triggered = null;
    for (const trap of this.traps) {
      const d = Math.hypot(state.position.x - trap.x, state.position.z - trap.z);
      if (d > 38) trap.armed = true;
      else if (trap.armed && d < 12 && (state.speedKmh || 0) >= 40) {
        trap.armed = false;
        const speedKmh = Math.round(state.speedKmh || 0);
        trap.hitColor = speedKmh >= trap.targetKmh ? CLEAR : MISS;
        trap.glow = 1;
        triggered = { key: trap.key, name: trap.name, speedKmh, targetKmh: trap.targetKmh };
      }
    }
    return triggered;
  }

  update(dt) {
    if (!this.mesh) return;
    let dirty = false;
    this.traps.forEach((trap, n) => {
      if (trap.glow <= 0) return;
      trap.glow = Math.max(0, trap.glow - dt * 0.55);
      this.color.copy(IDLE).lerp(trap.hitColor || CLEAR, Math.min(1, trap.glow * 1.6));
      for (let p = 0; p < PYLONS; p += 1) this.mesh.setColorAt(n * PYLONS + p, this.color);
      dirty = true;
    });
    if (dirty && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh?.geometry?.dispose();
    this.mesh?.material?.dispose();
  }
}
