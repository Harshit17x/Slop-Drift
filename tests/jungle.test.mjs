import assert from 'node:assert/strict';
import { Vehicle } from '../src/vehicle/Vehicle.js';
import { WASHOUT, RIDGE } from '../src/world/jungleStage.js';
import { SURFACE } from '../src/config.js';
import { World } from '../src/world/World.js';
import { MAPS } from '../src/world/maps.js';
import { BRIDGE } from '../src/world/Jungle.js';

const world = await new World(MAPS.jungle.config).build();
const road = world.roads[0];
const bridge = world.bridge;
const ground = (s, offset = 0) => {
  const f = road.frameAt(s, {});
  return world.sampleGround(f.x + offset * f.rx, f.z + offset * f.rz, {});
};
assert.ok(road.closed && Math.abs(road.length - 5000) < 10);
const tightestRadius = 1 / Math.max(...road.curvature.map(Math.abs));
assert.ok(tightestRadius > 12 && tightestRadius < 20, 'the return leg has a tight, drivable braking corner');
let samples = 0, firm = 0, deep = 0, splitGrip = 0;
for (let s = 0; s < road.length; s += 5) {
  if (s >= BRIDGE.start && s < BRIDGE.end) continue;
  const crossSection = [-2,-1,0,1,2].map(offset => ground(s,offset));
  for (const sample of crossSection) {
    samples++;
    if (sample.surface === SURFACE.HARDPACK) firm++;
    if (sample.grip < 0.60 && sample.rolling > 0.026) deep++;
  }
  if (crossSection.some(p => p.surface === SURFACE.MUD) && crossSection.some(p => p.surface === SURFACE.HARDPACK)) splitGrip++;
}
assert.ok(firm/samples > 0.70 && deep/samples > 0.04 && deep/samples < 0.18);
assert.ok(splitGrip > 100, 'Drivers can choose a firmer line alongside mud patches');
const middle = bridge.centreS;
assert.equal(ground(middle).surface, SURFACE.WOOD);
assert.equal(ground(middle, BRIDGE.halfWidth + 1).surface, SURFACE.WATER);

function cross(speed) {
  const dt = 1/60;
  for (let s = BRIDGE.start; s < BRIDGE.end; s += speed*dt) {
    const frame = road.frameAt(s, {});
    bridge.step(dt, { position: frame, speed, slipAngle: 0 }, { handbrake: false });
  }
}
cross(10);
assert.equal(bridge.broken, false);
cross(23);
assert.ok(bridge.broken && bridge.falling);
assert.equal(ground(middle).surface, SURFACE.WATER);
assert.ok(ground(middle).y < world.waterLevel - 1);
assert.ok([SURFACE.MUD, SURFACE.HARDPACK].includes(ground(BRIDGE.recovery).surface));
bridge.reset();
assert.equal(ground(middle).surface, SURFACE.WOOD);
console.log('Jungle circuit, wet tyre ruts, safe crossing, collapse, water and recovery passed.');
// Drive from rest on the actual retry mark. Assert flight and a settled
// landing, so the gap cannot silently turn back into a drivable road.
function attemptWashout(kmh) {
  const car=new Vehicle({world,spawn:world.getSpawn('loop',WASHOUT.retry)});
  const location={}, ahead={}, dt=1/120;
  world.washout.reset();
  let airborne=0, launchSpeed=0, landed=false, notified=false;
  for(let tick=0;tick<4000;tick++){
    const state=car.getState(), pos=state.position;
    world.locate(pos.x,pos.z,location,0);
    if(world.washout.missed) break;
    if(location.s>WASHOUT.bank+25){
      landed=state.wheelsOnGround>=2 && !state.upsideDown;
      break;
    }
    road.frameAt(location.s+8+state.speed*0.34,ahead);
    const dx=ahead.x-pos.x,dz=ahead.z-pos.z;
    const side=dx*state.right.x+dz*state.right.z;
    const forward=dx*state.forward.x+dz*state.forward.z;
    const target=kmh/3.6;
    car.step(dt,{
      steer:Math.max(-1,Math.min(1,2.4*side/Math.max(2,forward))),
      throttle:state.speed<target?1:0,
      brake:Math.min(1,Math.max(0,state.speed-target-0.1)),
    });
    const note=world.washout.update(dt,car.getState());
    notified ||= note==='Flood Cut cleared';
    if(location.s<WASHOUT.lip)launchSpeed=state.speedKmh;
    if(location.s>=WASHOUT.lip && location.s<WASHOUT.bank && state.airborne)airborne+=dt;
  }
  return {landed,missed:world.washout.missed,airborne,launchSpeed,notified};
}
const slow=attemptWashout(95), fast=attemptWashout(WASHOUT.targetKmh);
assert.ok(slow.missed && !slow.landed,JSON.stringify(slow));
assert.ok(fast.landed && fast.notified && !fast.missed && fast.airborne>0.45,JSON.stringify(fast));
assert.ok(road.frameAt(RIDGE,{}).y-road.frameAt(RIDGE-460,{}).y>20);
console.log('Flood Cut and Cloud Ridge passed', {slow,fast});
