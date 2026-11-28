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
// Contact checks at car radius catch a visible rail that cannot stop the car.
const outer=w.roads[2], guard=w.config.road;
const coverage=outer.railLeft.reduce((sum,flag)=>sum+flag,0)/outer.count;
assert.ok(coverage>.95 && coverage<1,'Outer guardrail covers the perimeter with access gaps');
let tested=0;
for(let i=1;i<outer.count-1;i++){
  if(!outer.railLeft[i-1]||!outer.railLeft[i]||!outer.railLeft[i+1])continue;
  const edge=outer.halfWidth[i]+guard.shoulder+guard.railOffset-.25;
  const hit=w.collideBarrier(outer.px[i]-edge*outer.rx[i],outer.py[i]+.35,outer.pz[i]-edge*outer.rz[i],.7,{});
  assert.ok(hit.hit && hit.nx*outer.rx[i]+hit.nz*outer.rz[i]>.8,'Rail resolves contact toward the road');
  tested++;
}
assert.ok(tested>2000);
for(const entry of [...Object.values(w.sites),...w.depots]){
  const rd=w.roads[entry.roadId??entry.road],f=rd.frameAt(entry.s,{});
  const side=entry.side??Math.sign(entry.offset),edge=side*(f.halfWidth+guard.shoulder+guard.railOffset);
  assert.equal(w.collideBarrier(f.x+edge*f.rx,f.y+.4,f.z+edge*f.rz,.75,{}).hit,false,entry.id+' has an open approach');
}
for(const rd of w.roads.slice(3)){
  for(const s of [3,6,9,12,rd.length-12,rd.length-9,rd.length-6,rd.length-3]){
    const tip=rd.frameAt(s,{});
    assert.equal(w.collideBarrier(tip.x,tip.y+.4,tip.z,.75,{}).hit,false,rd.name+' turning apron');
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
// The cave is a real bore through a solid massif: the terrain closes over the
// carriageway instead of leaving an open trench, and the approach stays open.
assert.ok(w.cave && w.cave.s1-w.cave.s0>=500,'cave is at least 500 m');
for(const s of [w.cave.s0+20,(w.cave.s0+w.cave.s1)/2,w.cave.s1-20]){
  const f=w.roads[w.cave.roadId].frameAt(s,{});
  assert.ok(w.grid.heightAt(f.x,f.z)-f.y>15,'massif closes over the cave at '+Math.round(s));
}
const approach=w.roads[w.cave.roadId].frameAt(w.cave.s0-45,{});
assert.ok(w.grid.heightAt(approach.x,approach.z)-approach.y<8,'cave approach stays open');
assert.ok(w.cave.shellHalf>=9&&w.cave.shellHeight>=11,'cave bore clears the carriageway');
const defs=hollowMissions(w);assert.equal(new Set(defs.map(d=>d.id)).size,14);
assert.equal(Object.keys(w.sites).length,8);assert.equal(defs.find(d=>d.id==='transmission').goals.length,5);
for(const def of defs)for(const p of def.goals)assert.ok(Number.isFinite(p.x+p.y+p.z));
const memory=new Map(),storage={setItem:(k,v)=>memory.set(k,v),getItem:k=>memory.get(k)};
const j=new HollowJournal(storage);
j.found.add('garage');j.completed.add('pursuit');j.active={id:'transmission',index:3};j.exitKnown=true;j.settings.scares=0;j.save();
const reload=new HollowJournal(storage);assert.deepEqual([...reload.found],['garage']);
assert.ok(reload.completed.has('pursuit'));assert.equal(reload.active.index,3);assert.ok(reload.exitKnown);assert.equal(reload.settings.scares,0);
console.log('Hollow Creek survey, seams, ground surfaces, cave massif, mine gate, mission data and journal passed. 3D loop distances (main / inner / outer):',measured.map(Math.round));
