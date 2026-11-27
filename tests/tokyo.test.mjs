import assert from 'node:assert/strict';
import { World } from '../src/world/World.js';
import { MAPS } from '../src/world/maps.js';
import { modesForWorld } from '../src/config.js';
import { RaceSession } from '../src/game/RaceSession.js';
import { Vehicle } from '../src/vehicle/Vehicle.js';

const w=await new World(MAPS.tokyo.config).build();
for(const [id,target] of Object.entries({loop:5000,shibuya:3000,express:9000,bay:4000,tour:15000})){
  const r=w.roads[w.routes[id].roadId];
  let length=0;
  for(let i=0;i<r.segments;i++){
    const j=(i+1)%r.count;length+=Math.hypot(r.px[i]-r.px[j],r.py[i]-r.py[j],r.pz[i]-r.pz[j]);
  }
  assert.ok(Math.abs(length-target)<target*.02,id+' centreline length');
  console.log(id,Math.round(length)+' m');
}

// A roof above a tunnel and the underside of a crossing flyover both
// consume part of the vertical gap. Include both road edges in the check.
for(const [upper,lower,station] of [[1,6,1329],[6,2,11055],[10,6,540]]){
  const top=w.roads[upper],bottom=w.roads[lower];
  for(const offset of [-6,0,6]){
    const f=top.frameAt(station,{}),x=f.x+offset*f.rx,z=f.z+offset*f.rz,q={};
    assert.ok(bottom.locate(x,z,q) && f.y-q.y>7.9,'grade separation '+upper+'/'+lower);
  }
}

const decks=w.roads[4],mode=modesForWorld(w).find(m=>m.id==='parkade');
assert.ok(decks.length>2000&&decks.length<3000);
for(let s=3;s<decks.length-3;s+=2){
  const f=decks.frameAt(s,{}),sample=w.sampleGround(f.x,f.z,{},f.y+.6);
  assert.ok(Math.abs(sample.y-f.y)<.17,'incorrect garage floor at '+s);
  const loc=w.locate(f.x,f.z,{},4,f.y+.6);
  assert.ok(Math.abs(loc.s-s)<1,'incorrect floor progress at '+s);
}
for(const d of [0,1,2,3,4,5,6,7,8]){
  const f=decks.frameAt(28+268*d,{}),v=new Vehicle({world:w});
  v.teleport(w.getSpawn(mode.route,28+268*d));
  for(let i=0;i<120;i++)v.step(1/60,{throttle:0,steer:0,brake:1});
  assert.ok(Math.abs(v.getState().position.y-f.y)<1.6 && v.getState().wheelsOnGround>=3,'settling wheels on floor '+d);
}
// Probe the corner, both faces, and interior of a rotated building across a
// spatial hash cell boundary. Stacked roads above it must stay unobstructed.
const c=Math.SQRT1_2;
w.tokyoSolids=[{p:{x:32,y:0,z:32},h:8,box:{tx:c,tz:c,length:10,width:5}}];
w.indexTokyoSolids();
for(const [u,v,y,hit] of [[9.9,4.9,1,true],[10.4,5.3,1,true],[0,0,1,true],
  [-10.4,-2,1,true],[0,-5.4,1,true],[10.8,5.8,1,false],[0,0,12,false]]){
  const contact=w.collideObstacle(32+c*(u-v),y,32+c*(u+v),.7,{});
  assert.equal(contact.hit,hit);
  if(hit)assert.ok(Math.abs(Math.hypot(contact.nx,contact.nz)-1)<1e-6);
}

// The raised pavement beside a street-level road is a real driving surface:
// contact follows the +0.155 m platform instead of the -0.35 m city fill.
const pav=w.roads[0].frameAt(600,{});
for(const [off,want] of [[0,0],[9.1,0],[9.4,.155],[10.4,.155],[12.6,.155],[13.7,.155]]){
  const x=pav.x+pav.rx*off,z=pav.z+pav.rz*off,y=w.heightAt(x,z,pav.y+.5);
  assert.ok(Math.abs(y-pav.y-want)<.035,'pavement at '+off+' m: '+y);
}
for(const off of [20,26]){
  const x=pav.x+pav.rx*off,z=pav.z+pav.rz*off;
  assert.ok(w.heightAt(x,z,pav.y+.5)<-.2,'city fill beyond pavement at '+off+' m');
}

const express=w.roads[2];
const verge=express.frameAt(1800,{});
for(const side of [-1,1]){
  const offset=side*(verge.halfWidth+.30);
  const x=verge.x+offset*verge.rx,z=verge.z+offset*verge.rz;
  assert.ok(Math.abs(w.heightAt(x,z,verge.y+.8)-verge.y)<.2,'flyover shoulder support');
}

// Drive sideways into the actual world collider at 144 km/h.
const f=w.roads[0].frameAt(500,{}),car=new Vehicle({world:w});
w.tokyoSolids=[{p:{x:f.x+12*f.rx,y:f.y,z:f.z+12*f.rz},h:14,
  box:{tx:f.tx,tz:f.tz,length:8,width:3}}];w.indexTokyoSolids();
car.teleport(w.roadSpawn(0,500,1,{position:{},quaternion:{}}));
car.velocity.set(40*f.rx,0,40*f.rz);
let furthest=0;
for(let i=0;i<120;i++){
  car.step(1/120,{throttle:0,steer:0,brake:0});
  const p=car.getState().position;
  furthest=Math.max(furthest,(p.x-f.x)*f.rx+(p.z-f.z)*f.rz);
}
assert.ok(furthest>5 && furthest<9,'car entered the building or missed the wall: '+furthest);

for(const m of modesForWorld(w).filter(m=>m.laps)){
  const session=new RaceSession({world:w,mode:m}),r=w.roads[session.roadId],route=session.route;
  let s=route.startS-6*route.direction,seconds=0;
  session.getStartPose({position:{},quaternion:{}});
  while(!session.finished&&seconds<(route.length*(m.laps||1)+70)/30){
    const f=r.frameAt(s,{});
    session.update(.1,{position:{x:f.x,y:f.y+.55,z:f.z},speed:30,velocity:{x:f.tx*30*route.direction,z:f.tz*30*route.direction}},null);
    s+=3*route.direction;seconds+=.1;
  }
  assert.equal(session.finished,true,m.id+' ordered checkpoints');
}
console.log('Tokyo route lengths, nine suspension landings, stacked surfaces and all scheduled race gates passed.');
