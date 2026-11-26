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
