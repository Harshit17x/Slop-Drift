// Road traffic on every event except drift sessions: oncoming cars in the other lane and slower cars
// in yours to overtake, each at its own steady speed. Positions depend only on the run clock, so every
// attempt meets the same traffic (fair for leaderboards). Passing one close at speed is a near miss;
// hitting one is a crash.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCarModel } from '../render/ModelCar.js';
import { getPaint } from '../config.js';
import { createRandom } from '../world/noise.js';

/** Events that stay clear of traffic: scored drifting and the track-day meeting. */
export const NO_TRAFFIC_MODES = new Set(['drift', 'apex-meeting']);

const SPACING = 130; // metres of road per traffic car
const MAX_CARS = 16;
const MIN_SPEED = 15; // m/s (54 km/h)
const MAX_SPEED = 26; // m/s (94 km/h)
const ONCOMING_SHARE = 0.6;
const LANE = 1.9; // metres from the centreline
const DRAW_DISTANCE = 320; // cars further than this from the player are hidden
const HALF_LENGTH = 2.3;
const HALF_WIDTH = 0.95;
const NEAR_MISS_GAP = 1.6; // clear air beside the other car that still counts as close
const NEAR_MISS_SPEED = 22; // m/s (~80 km/h) the player must be doing
export const NEAR_MISS_BONUS = 250;
const MODELS = ['hatch', 'thar', 'tokyo'];
const PAINTS = ['pearl', 'ember', 'glacier', 'racing-green', 'midnight', 'saltline', 'summit'];

const frame = {};
const back = new THREE.Vector3();
const up = new THREE.Vector3();
const right = new THREE.Vector3();
const basis = new THREE.Matrix4();

/**
 * Where a traffic car is at `time` on the route: arc length and travel direction along the road.
 * Pure so tests can drive it. On an open road a car that runs off one end comes back at the other.
 */
export function trafficPose(road, route, car, time) {
  const dir = route.direction < 0 ? -1 : 1;
  const travel = car.oncoming ? -dir : dir;
  let s = car.s0 + travel * car.speed * time;
  if (road.closed) s = ((s % road.length) + road.length) % road.length;
  else {
    const lo = Math.min(route.startS, route.finishS) - 60;
    const hi = Math.max(route.startS, route.finishS) + 60;
    const span = hi - lo;
    s = lo + ((((s - lo) % span) + span) % span);
  }
  return { s, travel };
}

/** Spread cars along the route, seeded by the event so the layout never changes. */
export function spawnTraffic(route, roadLength, seed) {
  const random = createRandom(`traffic:${seed}`);
  const length = route.closed ? roadLength : Math.abs(route.finishS - route.startS);
  const count = Math.min(MAX_CARS, Math.floor(length / SPACING));
  const dir = route.direction < 0 ? -1 : 1;
  const cars = [];
  for (let i = 0; i < count; i += 1) {
    // Start ahead of the player (never on the grid), spaced with a little jitter.
    const d = 180 + (i + random() * 0.5) * ((length - 200) / Math.max(1, count));
    cars.push({
      s0: route.startS + dir * d,
      oncoming: random() < ONCOMING_SHARE,
      speed: MIN_SPEED + random() * (MAX_SPEED - MIN_SPEED),
      model: MODELS[Math.floor(random() * MODELS.length)],
      paint: PAINTS[Math.floor(random() * PAINTS.length)],
    });
  }
  return cars;
}

/**
 * Player position relative to a traffic car: `along` its length and `side` across it (metres).
 * Returns a near miss, a crash, or null.
 */
export function judgePass(along, side, playerSpeed) {
  if (Math.abs(along) > HALF_LENGTH + 1.2) return null;
  if (Math.abs(side) < HALF_WIDTH * 2) return 'crash';
  if (Math.abs(along) < HALF_LENGTH && Math.abs(side) < HALF_WIDTH * 2 + NEAR_MISS_GAP && playerSpeed >= NEAR_MISS_SPEED) return 'nearMiss';
  return null;
}

/**
 * A car model as a handful of static meshes, one per material: traffic never steers, spins wheels or
 * opens doors, and a full model is 30-70 draw calls (plus its shadow pass) per car.
 */
export function flattenCar(model) {
  model.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const byMaterial = new Map();
  model.traverseVisible((node) => {
    if (!node.isMesh || node.isInstancedMesh || Array.isArray(node.material)) return;
    const geometry = node.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld));
    for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
    if (!geometry.index) geometry.setIndex([...Array(geometry.attributes.position.count).keys()]);
    if (!byMaterial.has(node.material)) byMaterial.set(node.material, []);
    byMaterial.get(node.material).push(geometry);
  });
  const flat = new THREE.Group();
  flat.name = 'TrafficCar';
  for (const [material, parts] of byMaterial) {
    const withUv = parts.every((g) => g.attributes.uv);
    if (!withUv) for (const g of parts) g.deleteAttribute('uv');
    const merged = parts.length > 1 ? mergeGeometries(parts, false) : parts[0];
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    flat.add(mesh);
    for (const g of parts) if (g !== merged) g.dispose();
  }
  return flat;
}

export class Traffic {
  constructor(scene, wheelLayout = null) {
    this.scene = scene;
    this.wheelLayout = wheelLayout;
    this.group = new THREE.Group();
    this.group.name = 'Traffic';
    scene.add(this.group);
    this.cars = [];
  }

  /** Fill the route for this event, or clear it when the event has no traffic. */
  start(world, mode, seed) {
    this.clear();
    const route = mode && !NO_TRAFFIC_MODES.has(mode.id) ? world.routes?.[mode.route] : null;
    if (!route) return;
    this.road = world.roads[route.roadId];
    this.route = route;
    for (const spec of spawnTraffic(route, this.road.length, seed)) {
      const full = createCarModel(spec.model, { color: getPaint(spec.paint).color, name: 'Traffic', wheelLayout: this.wheelLayout });
      full.setLook?.({ paint: getPaint(spec.paint) });
      const model = flattenCar(full);
      this.group.add(model);
      this.cars.push({ ...spec, model, armed: true, along: 0, side: 0 });
    }
  }

  clear() {
    for (const car of this.cars) {
      this.group.remove(car.model);
      car.model.traverse((node) => node.geometry?.dispose());
    }
    this.cars = [];
    this.road = null;
  }

  /**
   * Move the cars to `time` and judge the player against each. Returns 'crash', 'nearMiss' or null
   * (a crash wins if both happen in one step).
   */
  update(time, state) {
    if (!this.road) return null;
    let outcome = null;
    for (const car of this.cars) {
      const { s, travel } = trafficPose(this.road, this.route, car, time);
      this.road.frameAt(s, frame);
      const side = Math.min(LANE, frame.halfWidth * 0.45) * -travel; // keep to the left of its own direction
      const x = frame.x + frame.rx * side;
      const z = frame.z + frame.rz * side;
      const far = Math.hypot(state.position.x - x, state.position.z - z) > DRAW_DISTANCE;
      car.model.visible = !far;
      if (far) {
        car.armed = true;
        continue;
      }
      car.model.position.set(x, frame.y + frame.ry * side, z);
      up.set(frame.nx, frame.ny, frame.nz);
      back.set(-frame.tx * travel, -frame.ty * travel, -frame.tz * travel);
      right.crossVectors(up, back).normalize();
      basis.makeBasis(right, up, back);
      car.model.quaternion.setFromRotationMatrix(basis);

      // Player in this car's frame: forward is -back.
      const dx = state.position.x - x;
      const dz = state.position.z - z;
      const along = -(dx * back.x + dz * back.z);
      const across = dx * right.x + dz * right.z;
      if (Math.hypot(dx, dz) > 20) {
        car.armed = true;
        continue;
      }
      const verdict = judgePass(along, across, state.speed);
      if (verdict === 'crash') {
        if (car.armed) outcome = 'crash';
        car.armed = false;
      } else if (verdict === 'nearMiss' && car.armed && outcome !== 'crash') {
        car.armed = false;
        outcome = 'nearMiss';
      }
    }
    return outcome;
  }
}
