import assert from 'node:assert/strict';
import {World} from '../src/world/World.js';
import {MAPS} from '../src/world/maps.js';
import {modesForWorld} from '../src/config.js';
import {Vehicle} from '../src/vehicle/Vehicle.js';
import {getCar} from '../src/vehicle/cars.js';
import {RaceSession} from '../src/game/RaceSession.js';
import {ApexService,boxFor} from '../src/game/apexSport.js';

const t=performance.now(),world=await new World(MAPS.apex.config).build(),{main,bridge,under,pit}=world.apex;
console.log('World build',Math.round(performance.now()-t),'ms');
const frame=(road,s)=>road.frameAt(s,{});
assert.equal(Object.keys(world.routes).length,6);
assert(Math.max(...main.py)-Math.min(...main.py)>143);
for(const s of [bridge,under]){
  const p=frame(main,s),q=world.sampleGround(p.x,p.z,{},p.y+.5);
  assert(Math.abs(q.y-p.y)<.12,'Deck height mismatch at '+s);
}
assert(frame(main,bridge).y-frame(main,under).y>9);
for(const [id,route] of Object.entries(world.routes)){
  const road=world.roads[route.roadId],mode=modesForWorld(world).find(m=>m.route===id && m.laps===1);
  assert(road.closed && route.metres>1000);
  const session=new RaceSession({world,mode});
  let worst=0,gates=0;
  for(let d=-6;d<road.length+6;d+=3){
    const p=frame(road,route.startS+d),loc=world.sampleGround(p.x,p.z,{},p.y+.4);
    worst=Math.max(worst,Math.abs(p.y-loc.y));
    for(const e of session.update(.1,{position:p,velocity:{x:p.tx*30,z:p.tz*30},speed:30})){if(e.type==='checkpoint')gates++;}
  }
  assert(session.finished && gates===11,id+' ordered gates');
  assert(worst<.85,id+' frame/contact discrepancy '+worst);
  console.log(id,route.metres.toFixed(1),'m, worst contact error',worst.toFixed(3),'m');
}
for(const r of world.physicalRoads){for(let i=0;i<r.count;i+=2){for(const side of [-.9,0,.9]){const d=side*r.halfWidth[i],y=r.py[i]+d*r.bank[i];assert(world.grid.heightAt(r.px[i]+d*r.rx[i],r.pz[i]+d*r.rz[i])<=y+.035,'terrain clips '+r.name+' at '+(i*r.spacing).toFixed(1));}}}
const box=boxFor(world,19),service=new ApexService(pit,box);
const parked={position:box,speed:0,throttle:0,slipAngle:0,brake:1};
service.fuel=32;service.tyres=.6;service.update(.1,parked);assert.equal(service.phase,'ready');
assert(service.start());let repaired;
for(let n=0;n<240;n++)repaired=service.update(.1,parked)||repaired;
assert(repaired.repair);assert.equal(service.stops,1);assert.equal(service.fuel,90);assert.equal(service.tyres,1);
const controls={throttle:1,brake:0};service.controls(controls,{speedKmh:76});assert.equal(controls.throttle,0);assert(controls.brake>0);
for(const [routeId,route] of Object.entries(world.routes)){
const road=world.roads[route.roadId],mode=modesForWorld(world).find(m=>m.route===routeId&&m.laps===1),session=new RaceSession({world,mode});
const car=new Vehicle({world,handling:'Balanced'});car.setHandling('Balanced',getCar('gt').tuning);car.teleport(world.getSpawn(routeId,route.startS-6));
let maxOffset=0,air=0;
const loc={},ahead={},probe={};
for(let i=0;i<60*840&&!session.finished;i++){
  const st=car.getState(),p=st.position;
  assert(road.locate(p.x,p.z,loc,p.y),'GT3 left the circuit near '+loc.s);
  maxOffset=Math.max(maxOffset,Math.abs(loc.lateral));
  assert(Math.abs(loc.lateral)<loc.halfWidth+1,'GT3 left the track at '+loc.s.toFixed(1));
  road.frameAt(loc.s+5+st.speed*.36,ahead);
  const dx=ahead.x-p.x,dz=ahead.z-p.z;
  const lateral=st.right.x*dx+st.right.z*dz,forward=st.forward.x*dx+st.forward.z*dz;
  let k=.0001;
  for(let d=3;d<24+st.speed*1.5;d+=6)k=Math.max(k,Math.abs(road.frameAt(loc.s+d,probe).curvature));
  const target=Math.min(37,Math.sqrt(4.8/k));
  const state=car.step(1/60,{steer:Math.max(-1,Math.min(1,2.25*lateral/Math.max(2,forward))),
    throttle:st.speed<target?.82:0,brake:st.speed>target+1?Math.min(.82,(st.speed-target)/6):0});
  if(state.airborne)air++;
  session.update(1/60,state);
}
assert(session.finished,'GT3 full lap failed at '+loc.s.toFixed(1));
console.log(routeId,'GT3 physics lap',session.result.time.toFixed(2),'s, max lateral',maxOffset.toFixed(2),'m, airborne frames',air);
}

