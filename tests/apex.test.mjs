import {ApexCircuitSurface} from '../src/render/ApexCircuitSurface.js';
import {DoubleSide,Raycaster,Group,Vector3,BufferGeometry,MeshBasicMaterial,Texture} from 'three';
import {ApexGrid} from '../src/game/ApexGrid.js';
import assert from 'node:assert/strict';
import {controlFlag,capUnderFlag} from '../src/game/apexControl.js';
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
// Menu initialization reads all road outlines before the first rendered frame.
const mapData = world.getMapData();
assert.equal(mapData.roads.length, world.roads.length);
for (const route of Object.values(world.routes)) {
  const road = mapData.roads.find(r => r.id === mapData.routeRoads[route.id]);
  assert(road && road.points.length >= 6 && road.heights.length * 2 === road.points.length);
  const pose = world.getSpawn(route.id, route.startS);
  const p = pose.position;
  assert(Math.abs(p.y - world.sampleGround(p.x,p.z,{},p.y+.45).y) < .001);
}
assert.equal(Object.keys(world.routes).length,6);
assert.deepEqual(Object.keys(world.routes).filter(k=>world.routes[k].pitPath).sort(),['bowl','gp','international','loop']);
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
// Sweep both triangles of every physical road section, including cuts through shared junctions.
let maxPavementError = 0;
for (const road of world.physicalRoads) {
  for (let i = 0; i < road.segments; i++) {
    const j = (i + 1) % road.count;
    for (const across of [-.99, -.5, 0, .5, .99]) {
      const d = across * road.halfWidth[i];
      const x = road.px[i] + d * road.rx[i], z = road.pz[i] + d * road.rz[i];
      const dx = road.px[j] + d * road.rx[j] - x, dz = road.pz[j] + d * road.rz[j] - z;
      assert(dx * road.tx[i] + dz * road.tz[i] > 0, road.name + ' folded pavement at ' + i);
      for (const along of [.05, .5, .95]) {
        const y = (1-along)*(road.py[i]+d*road.bank[i]) + along*(road.py[j]+d*road.bank[j]);
        const hit = world.sampleGround(x+along*dx,z+along*dz,{},y+.42);
        const error = Math.abs(y-hit.y);
        maxPavementError = Math.max(maxPavementError,error);
        assert(error < .085, road.name + ' tyre contact error ' + error + ' at section ' + i);
      }
    }
  }
}
console.log('Maximum sampled pavement/contact discrepancy',maxPavementError.toFixed(3),'m');
// Raycast the shipped triangle meshes where the branches meet, including both bridge decks.
{
  const geometry = Object.create(ApexCircuitSurface.prototype);
  geometry.world = world;
  geometry.group = new Group();
  geometry.geometries = [];
  for (const key of ['paint','tarmac','runoff']) geometry[key] = new MeshBasicMaterial({side:DoubleSide});
  for (const road of world.physicalRoads) geometry.build(road);
  geometry.group.updateMatrixWorld(true);
  const ray = new Raycaster(new Vector3(),new Vector3(0,-1,0),0,1.6);
  let worst = 0;
  for (const station of [1,2,6,12,13,14,27,28,29,40,41]) {
    for (let ds=-32;ds<=32;ds+=8) for (const d of [-5.7,-2,0,2,5.7]) {
      const f = main.frameAt(world.apex.stations[station]+ds,{});
      const x = f.x+f.rx*d, z = f.z+f.rz*d, y = f.y+f.ry*d;
      ray.ray.origin.set(x,y+.8,z);
      const surface = ray.intersectObjects(geometry.group.children,false)[0];
      assert(surface,'open pavement seam at station '+station);
      const tyre = world.sampleGround(x,z,{},y+.45);
      worst = Math.max(worst,Math.abs(surface.point.y-tyre.y));
    }
  }
  assert(worst<.085,'rendered junction height error '+worst);
  console.log('Maximum rendered junction/contact discrepancy',worst.toFixed(3),'m');
  for (const mesh of geometry.group.children) mesh.geometry.dispose();
  for (const key of ['paint','tarmac','runoff']) geometry[key].dispose();
}
// A long legal rejoin used to lock tracking until the car returned to its exit point.
{
  const mode={id:'limits',route:'loop',laps:1,limitGrace:.6},session=new RaceSession({world,mode});
  const at=(s,d=0)=>{const f=frame(main,s);return {position:{x:f.x+d*f.rx,y:f.y,z:f.z+d*f.rz},speed:30};};
  session.update(.1,at(70));session.update(.8,at(72,-55));
  assert(session.lapInvalid && session.trackWarnings===1);
  session.update(.1,at(155));assert(Math.abs(session._curD-155)<1 && session._legit);
  for(let i=0;i<2;i++){session.update(.8,at(160,-55));session.update(.1,at(164));}
  assert.equal(session.penaltySeconds,5);
  session.update(.8,at(175,-56));session.update(.1,at(session.cpD[0]+15));
  assert(!session._legit && session.nextGate===0,'skipping a timing gate must not count');
  session.getRespawnPose({position:{},quaternion:{}});session.addRespawn();session.update(.1,at(165));
  assert(session._legit);
  const p={speed:12,upsideDown:false},field=[{d:session.L+165-20,speed:22}];
  assert.equal(controlFlag(session,p,field,165,0),'BLUE');
  assert.equal(controlFlag(session,p,[],165,1.1),'FULL COURSE YELLOW');
  assert.equal(capUnderFlag(controlFlag(session,p,[],165,9)),0);
  const surface=world.apex.surfaceState,s=335,p0=frame(main,s),loc={};
  assert(main.locate(p0.x,p0.z,loc,p0.y));
  const grip=surface.grip(main,loc,0),wet=surface.grip(main,loc,.9);
  for(let i=0;i<30;i++)surface.deposit(p0);
  assert(surface.grip(main,loc,0)>grip && surface.grip(main,loc,.9)<wet);
  console.log('Track-limit recovery, invalid lap, missed gate, penalties, flag states and rubber-dependent grip passed');
}
{
  // The pit route crosses the timing line. It finishes a legitimate lap,
  // while repeated trips through the lane cannot substitute for the checkpoints.
  const lap=new RaceSession({world,mode:{id:'pit-check',route:'loop',laps:1}});
  const update=(s,pitLane=false)=>{const p=frame(pitLane?pit:main,s);lap.update(.1,{position:p,speed:30});};
  for(let d=-6;d<main.length-360;d+=3)update(d);
  for(let d=0;d<pit.length;d+=3)update(d,true);
  assert(lap.finished && lap.lapsDone===1 && !lap.hadInvalidLap,'legal pit finish');
  const cut=new RaceSession({world,mode:{id:'pit-cut',route:'loop',laps:1}});
  for(let i=0;i<2;i++)for(let d=0;d<pit.length;d+=3)cut.update(.1,{position:frame(pit,d),speed:30});
  assert(!cut.finished && cut.lapsDone===0,'pit shortcut');
}
{
  const player={position:new Vector3(-1790,40,-1790),speed:0};
  const game={world,scene:new Group(),atmosphere:{isNight:false},apexMeeting:{boxIndex:7,service:{limit:60}},
    vehicle:{getState:()=>player,velocity:new Vector3()},mode:{laps:2}};
  const grid=Object.assign(Object.create(ApexGrid.prototype),{game,field:[],lenses:[],template:new Group(),
    plates:Array.from({length:3},()=>new MeshBasicMaterial({map:new Texture()})),plateGeometry:new BufferGeometry()});
  for(const route of Object.values(world.routes)){
    game.session={route,_loc:{lateral:0}};
    grid.start(3,1);
    let steps=0;
    while(grid.field.some(b=>!b.done) && steps++<12000)grid.update(.1,-400);
    assert(grid.field.every(b=>b.done && b.bestLap>0 && Number.isFinite(b.car.quaternion.w)),'AI field failed '+route.id);
    assert(grid.field.every(b=>b.pitted===Boolean(route.pitPath)),'AI pit decision '+route.id);
    console.log(route.id,'three AI finished two laps; pit stops',grid.field.filter(b=>b.pitted).length);
  }
  game.session={route:world.routes.loop,_loc:{lateral:0}};grid.start(1,1);
  const bot=grid.field[0],f=frame(main,bot.d);
  player.position.copy(bot.car.position).addScaledVector(new Vector3(f.rx,0,f.rz),1.5);
  game.vehicle.velocity.set(-f.rx*7,0,-f.rz*7);const before=game.vehicle.velocity.clone();
  grid.contact(.05,player);assert(before.distanceTo(game.vehicle.velocity)>2,'AI body contact');
  grid.dispose();
}
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

