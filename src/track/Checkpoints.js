import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class Checkpoints {
  constructor(points = []) {
    this.gates = points.map((position, index) => {
      const next = points[(index + 1) % points.length] || position;
      const tangent = next.clone().sub(position).normalize();
      return { index, position: position.clone(), tangent, passed: false };
    });
    this.current = 0;
    this.lap = 1;
    this.laps = CONFIG.race.laps;
    this.totalPassed = 0;
    this.wrongWay = false;
    this.lastTime = performance.now();
    this.lapStart = this.lastTime;
    this.lastLap = 0;
    this.bestLap = Number(localStorage.getItem('best-lap-ms') || 0);
  }

  reset() {
    this.current = 0;
    this.lap = 1;
    this.totalPassed = 0;
    this.wrongWay = false;
    this.lastTime = performance.now();
    this.lapStart = this.lastTime;
    this.lastLap = 0;
  }

  update(position, velocity, now = performance.now()) {
    const target = this.gates[this.current];
    if (!target) return this.snapshot(now);
    const toTarget = target.position.clone().sub(position);
    const distance = toTarget.length();
    const forwardDot = velocity.lengthSq() > 0.25 ? velocity.clone().normalize().dot(target.tangent) : 1;
    this.wrongWay = forwardDot < -0.35;
    if (distance < CONFIG.race.checkpointGateWidth * 0.65 && forwardDot > -0.2) {
      const passedIndex = this.current;
      this.totalPassed += 1;
      this.current = (this.current + 1) % this.gates.length;
      if (passedIndex === 0 && this.totalPassed > 1) {
        const lapTime = now - this.lapStart;
        this.lastLap = lapTime;
        if (!this.bestLap || lapTime < this.bestLap) {
          this.bestLap = lapTime;
          localStorage.setItem('best-lap-ms', String(Math.round(lapTime)));
        }
        this.lap += 1;
        this.lapStart = now;
      }
    }
    return this.snapshot(now);
  }

  snapshot(now = performance.now()) {
    return {
      lap: Math.min(this.lap, this.laps),
      laps: this.laps,
      current: this.current,
      total: this.gates.length,
      lapTime: now - this.lapStart,
      lastLap: this.lastLap,
      bestLap: this.bestLap,
      wrongWay: this.wrongWay,
      finished: this.lap > this.laps,
    };
  }

  createDebugObject() {
    const group = new THREE.Group();
    this.gates.forEach((gate) => {
      const geometry = new THREE.TorusGeometry(6, 0.045, 6, 24);
      const material = new THREE.MeshBasicMaterial({ color: gate.index === 0 ? 0xffd166 : 0x72f1b8, transparent: true, opacity: 0.7 });
      const ring = new THREE.Mesh(geometry, material);
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(gate.position).add(new THREE.Vector3(0, 0.2, 0));
      group.add(ring);
    });
    return group;
  }
}
