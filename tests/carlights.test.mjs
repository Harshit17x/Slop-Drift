// Car lights: `node tests/carlights.test.mjs` (exit code 1 on failure).
// Lamps are fitted where the model's lamp parts are; low beam dips, high beam reaches further; tails
// light with the headlights or at night; brake lamps are about 5x the tails; reversing lamps light white.
import * as THREE from 'three';
import { CarLights } from '../src/render/CarLights.js';

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  (${detail})` : ''}`);
}

// A stand-in car: a body box, two headlamp lenses at the front (-Z), two tail lamps at the rear (+Z).
const model = new THREE.Group();
model.chassis = new THREE.Group();
model.add(model.chassis);
const paint = new THREE.MeshStandardMaterial();
const lens = new THREE.MeshStandardMaterial({ emissiveIntensity: 0.4 });
const tail = new THREE.MeshStandardMaterial();
model.lensMaterials = [lens];
model.tailMaterial = tail;
model.reverseLampMaterial = new THREE.MeshStandardMaterial();
const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 4.2), paint);
body.position.y = 0.7;
model.chassis.add(body);
for (const side of [-1, 1]) {
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.05), lens);
  head.position.set(side * 0.62, 0.68, -2.12);
  const rear = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.05), tail);
  rear.position.set(side * 0.6, 0.85, 2.12);
  model.chassis.add(head, rear);
}

const lights = new CarLights(model, 'tokyo');
const [left, right] = lights.beams;
check('a beam sits at each headlamp', Math.abs(left.position.x + 0.62) < 0.05 && Math.abs(right.position.x - 0.62) < 0.05
  && Math.abs(left.position.y - 0.68) < 0.05 && left.position.z < -2.1, `${left.position.x.toFixed(2)}, ${left.position.y.toFixed(2)}, ${left.position.z.toFixed(2)}`);
check('a 90s car gets warm halogen beams', left.color.getHex() === 0xffe2b4);

const dt = 1 / 60;
const run = (state, seconds = 0.5) => { for (let t = 0; t < seconds; t += dt) lights.update(state, dt); };
const idle = { braking: false, reversing: false, night: false };

run(idle);
check('daytime, lamps off: beams dark, tails unlit', left.intensity === 0 && tail.emissiveIntensity < 0.3);
lights.setHeadlights(1);
run(idle);
const low = { intensity: left.intensity, angle: left.angle, distance: left.distance, dip: left.position.y - left.target.position.y };
check('low beam: on, aimed down', low.intensity > 0 && low.dip > 0.5, `dips ${low.dip.toFixed(2)} m over ${(left.position.z - left.target.position.z).toFixed(0)} m`);
check('tails light with the headlights', tail.emissiveIntensity > 0.8);
const tailOn = tail.emissiveIntensity;
lights.setHeadlights(2);
check('high beam: brighter, narrower, reaches further, near level', left.intensity > low.intensity && left.angle < low.angle
  && left.distance > low.distance && left.position.y - left.target.position.y < low.dip);
check('lens glows brighter on high beam', lens.emissiveIntensity > 3);
check('the switch cycles high -> off -> low', lights.cycle() === 0 && lights.cycle() === 1);

run({ ...idle, braking: true });
check('brake lamps about 5x the tails', tail.emissiveIntensity / tailOn > 4.5, `${(tail.emissiveIntensity / tailOn).toFixed(1)}x`);
check('the high-mounted stop lamp lights only when braking', lights.highStop.emissiveIntensity > 4);
check('braking throws red light behind the car', lights.tailGlow.intensity > 60);
run(idle);
check('brake released: back to tail level', Math.abs(tail.emissiveIntensity - tailOn) < 0.05 && lights.highStop.emissiveIntensity < 0.05);

run({ ...idle, reversing: true });
check('reversing lamps and white light behind when in reverse', lights.reverses.every((m) => m.emissiveIntensity > 3) && lights.reverseLight.intensity > 100);
run(idle);
lights.setHeadlights(0);
run({ ...idle, night: true });
check('at night the tails stay lit with the headlights off', tail.emissiveIntensity > 0.8);
lights.dispose();

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
