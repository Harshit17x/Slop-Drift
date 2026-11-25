// Crash damage tests: `node tests/damage.test.mjs` (exit code 1 on failure).
// A hard hit dents the body near the contact, fills the right damage zone, throws debris that lands
// and settles on the ground, and repair puts every vertex back.
import * as THREE from 'three';
import { CarDamage } from '../src/render/CarDamage.js';

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  (${detail})` : ''}`);
}

const world = { sampleGround(x, z, out) { out.y = 0; out.normal.y = 1; return out; } };

function makeCar() {
  const model = new THREE.Group();
  model.chassis = new THREE.Group();
  model.color = new THREE.Color(0x3366cc);
  model.add(model.chassis);
  // A 1.9 x 1.2 x 4.4 m body, finely divided so it can dent.
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.2, 4.4, 8, 6, 20), new THREE.MeshBasicMaterial());
  body.position.y = 0.7;
  model.chassis.add(body);
  model.updateWorldMatrix(true, true);
  return { model, cockpit: null, body };
}

function state(impact, point, normal) {
  return {
    impact,
    impactPoint: point,
    impactNormal: normal,
    position: new THREE.Vector3(0, 0, 0),
    quaternion: new THREE.Quaternion(),
    velocity: new THREE.Vector3(0, 0, -14),
  };
}

const scene = new THREE.Scene();
const damage = new CarDamage({ scene, world });
const car = makeCar();
const shared = car.body.geometry;
const before = Float32Array.from(shared.attributes.position.array);
damage.attach(car);

// Small knock below the crush threshold: nothing happens.
damage.update(1 / 60, state(2, { x: 0, y: 0.7, z: -2.2 }, { x: 0, z: 1 }));
check('tiny knock leaves the body alone', car.body.geometry === shared && damage.level === 0);

// 50 km/h into a wall nose first (wall normal points back at the car, +z).
damage.update(1 / 60, state(14, { x: 0, y: 0.7, z: -2.2 }, { x: 0, z: 1 }));
const pos = car.body.geometry.attributes.position;
let maxMove = 0;
let farMove = 0;
for (let i = 0; i < pos.count; i++) {
  const d = Math.hypot(pos.getX(i) - before[i * 3], pos.getY(i) - before[i * 3 + 1], pos.getZ(i) - before[i * 3 + 2]);
  if (before[i * 3 + 2] < -1.6) maxMove = Math.max(maxMove, d);
  if (before[i * 3 + 2] > 1.5) farMove = Math.max(farMove, d);
}
check('nose crushes 0.25-0.6 m at 50 km/h', maxMove > 0.25 && maxMove <= 0.62, `${maxMove.toFixed(2)} m`);
check('the tail is untouched', farMove === 0, `${farMove}`);
check('shared template geometry is not modified', shared.attributes.position.array.every((v, i) => v === before[i]));
check('front zone takes the damage', damage.zones.front > 0.3 && damage.zones.rear === 0, JSON.stringify(damage.zones));
check('damage costs power', damage.powerFactor < 1 && damage.powerFactor >= 0.7, damage.powerFactor.toFixed(2));

const pieces = Object.values(damage.debris.pools).reduce((n, p) => n + p.items.length, 0);
check('the hit throws debris', pieces >= 8, `${pieces} pieces`);
check('a big nose hit drops the bumper', damage.lost.has('frontBumper'));

// Let the debris fly and settle.
for (let t = 0; t < 8; t += 1 / 60) damage.update(1 / 60, null);
let below = 0;
let moving = 0;
for (const pool of Object.values(damage.debris.pools)) {
  for (const it of pool.items) {
    if (it.pos.y < -0.01) below++;
    if (it.vel.length() > 0.5) moving++;
  }
}
check('debris stays on top of the ground', below === 0, `${below} below`);
check('debris comes to rest within 8 s', moving === 0, `${moving} still moving`);

// Side swipe on the left: the left zone and a mirror.
damage.update(1 / 60, state(9, { x: -0.95, y: 0.9, z: -0.3 }, { x: 1, z: 0 }));
check('side hit damages the left', damage.zones.left > 0, damage.zones.left.toFixed(2));
check('side hit knocks the mirror off', damage.lost.has('mirror-left'));
check('left damage pulls the steering left', damage.steerPull > 0, damage.steerPull.toFixed(3));

damage.repair();
check('repair restores the original geometry', car.body.geometry === shared && damage.level === 0 && damage.lost.size === 0);
damage.reset();
check('reset sweeps the road', Object.values(damage.debris.pools).every((p) => p.items.length === 0));
damage.dispose();

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
