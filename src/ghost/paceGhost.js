// A rival's car for duels: a ghost generated (not recorded) that drives an event's route and crosses
// the line at exactly the rival's time. It slows for corners by their curvature, accelerates and
// brakes within limits, then the whole speed profile is scaled to hit the target time. The result is
// ordinary GhostData, so GhostPlayer, GhostCar and the live split delta work on it unchanged.
import * as THREE from 'three';
import { GHOST_VERSION } from './ghostCodec.js';

const STEP = 2; // metres between speed-profile samples
const LAT_ACCEL = 9; // m/s^2 cornering
const ACCEL = 5; // m/s^2 accelerating
const BRAKE = 9; // m/s^2 braking
const MAX_SPEED = 60; // m/s on straights before scaling

const frame = {};
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const back = new THREE.Vector3();
const basis = new THREE.Matrix4();
const quat = new THREE.Quaternion();

/** Length of one run of `route` (all laps). Mirrors RouteProgress. */
export function routeLength(road, route, laps = 1) {
  if (route.closed) return road.length * Math.max(1, laps | 0);
  const span = (route.finishS - route.startS) * (route.direction < 0 ? -1 : 1);
  return span > 0 ? span : route.length;
}

/**
 * @param {{roads:object[]}} world
 * @param {object} route   A world route ({roadId, closed, direction, startS, finishS, length}).
 * @param {number} laps
 * @param {number} targetTime  Seconds from the start to the finish line.
 * @param {{name?:string, paint?:string, modeId?:string, rate?:number, lane?:number, height?:number}} [options]
 *   `lane` metres left of the centreline (positive = left of travel), `height` above the road surface (vehicle poses sit on it).
 */
export function buildPaceGhost(world, route, laps, targetTime, { name = '', paint = '', modeId = '', rate = 10, lane = 1.6, height = 0 } = {}) {
  const road = world.roads[route.roadId];
  const dir = route.direction < 0 ? -1 : 1;
  const total = routeLength(road, route, laps);
  if (!road || !(total > 0) || !(targetTime > 0)) return null;
  const sAt = (d) => {
    const s = route.startS + dir * d;
    return route.closed ? ((s % road.length) + road.length) % road.length : s;
  };

  // Speed limit by curvature, then acceleration (forward pass from a standing start) and braking (backward pass).
  const n = Math.max(2, Math.ceil(total / STEP) + 1);
  const v = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const index = Math.min(road.count - 1, Math.max(0, Math.round(sAt(Math.min(total, i * STEP)) / road.spacing)));
    v[i] = Math.min(MAX_SPEED, Math.sqrt(LAT_ACCEL / Math.max(1e-4, Math.abs(road.curvature[index]))));
  }
  v[0] = 0;
  for (let i = 1; i < n; i += 1) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * ACCEL * STEP));
  for (let i = n - 2; i >= 0; i -= 1) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * BRAKE * STEP));

  // Time at each sample, then scale the clock so the last sample lands on the target time.
  const t = new Float64Array(n);
  for (let i = 1; i < n; i += 1) {
    const span = Math.min(STEP, total - (i - 1) * STEP);
    t[i] = t[i - 1] + span / Math.max(0.5, (v[i - 1] + v[i]) / 2);
  }
  const scale = targetTime / t[n - 1];

  const count = Math.ceil(targetTime * rate) + 1;
  const positions = new Float32Array(count * 3);
  const rotations = new Int16Array(count * 4);
  const steer = new Int8Array(count);
  let i = 0;
  let last = null;
  for (let j = 0; j < count; j += 1) {
    const time = Math.min(targetTime, j / rate) / scale;
    while (i < n - 2 && t[i + 1] < time) i += 1;
    const u = Math.max(0, Math.min(1, (time - t[i]) / Math.max(1e-9, t[i + 1] - t[i])));
    const d = Math.min(total, (i + u) * STEP);
    road.frameAt(sAt(d), frame);
    const side = -lane * dir; // frame's right vector points right of increasing s
    positions[j * 3] = frame.x + frame.rx * side + frame.nx * height;
    positions[j * 3 + 1] = frame.y + frame.ry * side + frame.ny * height;
    positions[j * 3 + 2] = frame.z + frame.rz * side + frame.nz * height;
    // Car basis: +X right, +Y up, +Z back (the car faces -Z).
    up.set(frame.nx, frame.ny, frame.nz);
    back.set(-frame.tx * dir, -frame.ty * dir, -frame.tz * dir);
    right.crossVectors(up, back).normalize();
    basis.makeBasis(right, up, back);
    quat.setFromRotationMatrix(basis);
    if (last && last.dot(quat) < 0) quat.set(-quat.x, -quat.y, -quat.z, -quat.w);
    last = (last || new THREE.Quaternion()).copy(quat);
    rotations[j * 4] = Math.round(quat.x * 32767);
    rotations[j * 4 + 1] = Math.round(quat.y * 32767);
    rotations[j * 4 + 2] = Math.round(quat.z * 32767);
    rotations[j * 4 + 3] = Math.round(quat.w * 32767);
  }
  return { version: GHOST_VERSION, modeId, name, time: targetTime, score: 0, rate, count, positions, rotations, steer, paint };
}
