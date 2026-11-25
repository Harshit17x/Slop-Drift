import assert from 'node:assert/strict';
import { World } from '../src/world/World.js';
import { MAPS } from '../src/world/maps.js';
import { SURFACE, modesForWorld } from '../src/config.js';
import { HollowJournal, hollowMissions } from '../src/game/hollowMissions.js';

const w=new World(MAPS.hollow.config);
await w.build();
const measured=w.roads.slice(0,3).map(road=>{
  let length=0;
  for(let i=0;i<road.count;i++){
    const j=(i+1)%road.count;
    length+=Math.hypot(road.px[j]-road.px[i],road.py[j]-road.py[i],road.pz[j]-road.pz[i]);
    const sample=w.sampleGround(road.px[i],road.pz[i],{});
    assert.ok(Math.abs(sample.y-road.py[i])<.6,'Continuous driveable road bed');
  }
  return length;
});
for(const [i,length] of measured.entries())assert.ok(Math.abs(length/[5000,3000,7000][i]-1)<.02);
for(const branch of w.roads.slice(3)){
  for(const s of [0,branch.length]){
    const tip=branch.frameAt(s,{});
    assert.ok(w.roads.slice(0,3).some(rd=>{
      const l={};return rd.locate(tip.x,tip.z,l)&&l.distance<.5 && Math.abs(l.y-tip.y)<.4;
    }),branch.name+' joins a circuit at road height');
  }
}
const surface=(road,s)=>{const f=w.roads[road].frameAt(s,{});return w.sampleGround(f.x,f.z,{}).surface;};
assert.equal(surface(0,40),SURFACE.ASPHALT);assert.equal(surface(1,400),SURFACE.COBBLE);
assert.equal(surface(2,1850),SURFACE.WOOD);assert.equal(surface(2,3400),SURFACE.MUD);
assert.equal(surface(2,5300),SURFACE.GRAVEL);
const gate=w.mineGate,collide=()=>w.collideBarrier(gate.x,gate.y+.45,gate.z,.72,{}).hit;
assert.equal(collide(),true);w.mineOpen=true;assert.equal(collide(),false);
assert.equal(w.sampleGround(w.dock.x,w.dock.z,{}).surface,SURFACE.WOOD);
assert.equal(w.sampleGround(w.creek.x,w.creek.z,{}).surface,SURFACE.WATER);
assert.equal(modesForWorld(w)[0].label,'Hollow Creek Circuit');
const defs=hollowMissions(w);assert.equal(new Set(defs.map(d=>d.id)).size,12);
assert.equal(Object.keys(w.sites).length,8);assert.equal(defs.find(d=>d.id==='transmission').goals.length,5);
for(const def of defs)for(const p of def.goals)assert.ok(Number.isFinite(p.x+p.y+p.z));
const memory=new Map(),storage={setItem:(k,v)=>memory.set(k,v),getItem:k=>memory.get(k)};
const j=new HollowJournal(storage);
j.found.add('garage');j.completed.add('pursuit');j.active={id:'transmission',index:3};j.exitKnown=true;j.settings.scares=0;j.save();
const reload=new HollowJournal(storage);assert.deepEqual([...reload.found],['garage']);
assert.ok(reload.completed.has('pursuit'));assert.equal(reload.active.index,3);assert.ok(reload.exitKnown);assert.equal(reload.settings.scares,0);
console.log('Hollow Creek survey, seams, ground surfaces, mine gate, mission data and journal passed. 3D loop distances (main / inner / outer):',measured.map(Math.round));
