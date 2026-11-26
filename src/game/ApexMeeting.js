import * as T from 'three';
import {ApexService,boxFor} from './apexSport.js';
import {ApexSound} from '../audio/ApexSound.js';
import {ApexSpray} from '../render/ApexSpray.js';
import {ApexGrid} from './ApexGrid.js';
import {APEX_LAYOUTS} from '../world/Apex.js';
import {createRandom} from '../world/noise.js';
import './apex.css';

function element(tag,cls,parent){const e=document.createElement(tag);e.className=cls;parent.append(e);return e;}
function choice(form,name,values){
  const label=element('label','',form);label.append(name);
  const select=element('select','',label);
  for(const [value,text] of values){const opt=document.createElement('option');opt.value=value;opt.text=text;select.add(opt);}
  return select;
}
const secs=v=>v==null?'—':v.toFixed(2)+' s';
export class ApexMeeting{
  constructor(game){
    this.g=game;this.sound=new ApexSound(game.audio);this.grid=new ApexGrid(game);this.tick=0;this.recorded=[];this.camera=new T.PerspectiveCamera(54,1,.15,6900);
    const list=game.root.querySelector('.sdh-events-right');
    this.panel=element('details','apx-setup',list);list.prepend(this.panel);
    element('summary','',this.panel).textContent='Race weekend setup';
    const form=element('div','apx-fields',this.panel);
    this.layout=choice(form,'Configuration',Object.entries(APEX_LAYOUTS));
    this.format=choice(form,'Session',[['race','Grid race'],['qualify','Qualifying'],['practice','Practice'],['cup','Three-round championship']]);
    this.laps=choice(form,'Race length',[[2,'2 laps'],[1,'1 lap'],[3,'3 laps'],[6,'6 laps']]);
    this.entries=choice(form,'Opponents',[[3,'3 cars'],[0,'Solo'],[1,'1 car'],[7,'7 cars']]);
    this.level=choice(form,'Difficulty',[[.94,'Club'],[1.06,'Professional'],[.80,'Novice']]);
    this.weather=choice(form,'Weather',[['clear','Clear'],['mist','Valley mist'],['overcast','Overcast'],['light','Light rain'],['rain','Heavy rain'],['drying','Post-rain drying'],['change','Changeable']]);
    this.time=choice(form,'Start time',[['day','Daylight'],['sunset','Sunset'],['night','Night'],['dawn','Dawn'],['cycle','Accelerated endurance cycle']]);
    this.limit=choice(form,'Pit limiter',[[60,'60 km/h'],[50,'50 km/h'],[80,'80 km/h']]);
    this.handling=choice(form,'Handling',[['gt','GT racing'],['current','Garage preset']]);
    this.profile=element('canvas','apx-profile',this.panel);this.profile.width=640;this.profile.height=112;
    this.summary=element('p','',this.panel);
    this.layout.onchange=()=>this.drawProfile();
    this.cup={round:0,points:0};
    try{const saved=JSON.parse(localStorage.getItem('slop-apex-cup'));if(saved && [0,1,2].includes(saved.round)&&Number.isFinite(saved.points))this.cup=saved;}catch{}
    this.startButton=element('button','apx-button',this.panel);const start=this.startButton;start.type='button';start.textContent='Start session';
    start.onclick=()=>{this.custom=true;game.beginRun('apex-meeting');};
    this.drawProfile();
    this.status=element('div','apx-race',game.root);this.status.hidden=true;
    this.flags=element('b','',this.status);this.readout=element('span','',this.status);
    this.pitUI=element('div','apx-pit',this.status);
    this.checks={};for(const name of ['fuel','tyres','repair']){
      const l=element('label','',this.pitUI),c=element('input','',l);c.type='checkbox';c.checked=true;l.append(name);this.checks[name]=c;
    }
    this.work=element('button','apx-button',this.pitUI);this.work.textContent='Service car';this.work.onclick=()=>this.service.start(Object.fromEntries(Object.entries(this.checks).map(([k,c])=>[k,c.checked])));
    this.photo=element('details','apx-photo',game.root);element('summary','',this.photo).textContent='Cameras';
    const tools=element('div','apx-fields',this.photo);
    this.view=choice(tools,'Camera',[['drive','Driving'],['broadcast','Trackside'],['summit','Skyline'],['pit','Pit lane'],['aerial','Aerial'],['replay','Last 20 seconds']]);
    this.fov=choice(tools,'Lens',[[48,'Standard'],[27,'Telephoto'],[72,'Wide']]);
    this.exposure=choice(tools,'Exposure',[[1,'Neutral'],[.77,'−⅓ EV'],[1.26,'+⅓ EV']]);
    const shutter=element('button','apx-button',this.photo);shutter.textContent='Save photo';shutter.onclick=()=>{const cam=this.photoCamera()||game.cameraRig.camera;game.renderer.render(game.scene,cam);const a=document.createElement('a');a.download='apex-grand-prix.png';a.href=game.canvas.toDataURL();a.click();};
    this.view.onchange=()=>{this.replayIndex=0;this.viewTime=performance.now();};
    this.weatherFX();this.spray=new ApexSpray(game.scene);this.spray.mesh.visible=false;
  }
  drawProfile(){
    const g=this.g,r=g.world.routes[this.layout.value],m=g.world.roads[r.roadId],ctx=this.profile.getContext('2d');
    ctx.clearRect(0,0,640,112);const minX=Math.min(...m.px),maxX=Math.max(...m.px),minZ=Math.min(...m.pz),maxZ=Math.max(...m.pz);
    const scale=Math.min(171/(maxX-minX),86/(maxZ-minZ));
    ctx.beginPath();for(let i=0;i<m.count;i+=3){const x=8+(m.px[i]-minX)*scale,y=9+(m.pz[i]-minZ)*scale;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();ctx.strokeStyle='#e1e4da';ctx.lineWidth=3;ctx.stroke();
    const min=Math.min(...m.py),max=Math.max(...m.py);ctx.beginPath();for(let i=0;i<m.count;i++){
      const f=m.frameAt(r.startS+i*m.spacing,{}),x=211+416*i/m.count,y=89-63*(f.y-min)/Math.max(1,max-min);i?ctx.lineTo(x,y):ctx.moveTo(x,y);
    }ctx.strokeStyle='#ed9670';ctx.stroke();
    this.summary.textContent=(r.metres/1000).toFixed(2)+' km  ·  '+Math.round(max-min)+' m elevation range  ·  3 sectors';
  }
  weatherFX(){
    const rnd=createRandom(61),v=[];for(let i=0;i<230;i++){const x=(rnd()-.5)*56,y=rnd()*25,z=(rnd()-.5)*56;v.push(x,y,z,x-.17,y-.9,z+.1);}
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(v,3));
    this.rain=new T.LineSegments(geo,new T.LineBasicMaterial({color:0xa9bdc4,transparent:true,opacity:.33,depthWrite:false}));
    this.rain.visible=false;this.g.scene.add(this.rain);
  }
  mode(){
    const cup=this.format.value==='cup',route=cup?['international','gp','loop'][this.cup.round]:this.layout.value;
    const laps=this.format.value==='practice'?0:this.format.value==='qualify'?1:Number(this.laps.value);
    return {id:'apex-meeting',label:cup?'APEX Cup · Round '+(this.cup.round+1):APEX_LAYOUTS[route]+' · '+this.format.selectedOptions[0].text,route,laps};
  }
  start(mode,party=false){
    const g=this.g;if(g.atmosphere.timeOfDay!==g.settings.timeOfDay)g.atmosphere.setTimeOfDay(g.settings.timeOfDay);this.custom=mode.id==='apex-meeting';this.view.value='drive';this.recorded.length=0;this.tick=0;
    this.boxIndex=Math.abs([...String(g.career.profile.id||'1')].reduce((n,c)=>n+c.charCodeAt(0),0))%40;
    this.service=new ApexService(g.world.apex.pit,boxFor(g.world,this.boxIndex),this.custom?Number(this.limit.value):60);
    this.sectorTime=null;this.lastSplit=0;this.prevGate=0;this.position=1;
    this.sky=this.custom?this.weather.value:'clear';this.timeBase=0;
    if(this.custom)g.applyTimeOfDay(this.time.value==='cycle'?'day':this.time.value);
    this.clockStage=0;g.world.apex.wetness=this.sky==='drying'?.9:0;
    this.gt=this.custom && this.handling.value==='gt';
    if(this.gt)g.vehicle.setAssists({driftAssist:0,abs:true,transmission:g.settings.transmission});
    const race=this.custom && ['race','cup'].includes(this.format.value) || mode.id==='circuit';
    this.grid.start(race && !party?(this.custom?Number(this.entries.value):3):0,this.custom?Number(this.level.value):.94);
    g.scenery.setEvent(race);this.lastWeather=-1;
    this.serviceBox?.removeFromParent();
    if(!this.serviceBox){
      this.serviceBox=new T.Mesh(new T.PlaneGeometry(5.8,2.65),new T.MeshBasicMaterial({color:0xdab756,transparent:true,opacity:.3,depthWrite:false,side:T.DoubleSide}));this.serviceBox.rotation.x=-Math.PI/2;
    }
    const p=this.service.box;this.serviceBox.position.set(p.x,p.y+.12,p.z);g.scene.add(this.serviceBox);
  }
  inputs(c,state){if(!this.service)return;
    this.service.controls(c,state);
    if(this.gt){c.boost=false;c.throttle*=Math.min(1,1.12-Math.abs(state.slipAngle)*.48);}
  }
  update(dt,state){
    const g=this.g,s=this.service;if(!s)return;
    const action=s.update(dt,state);if(action?.repair)g.damage.repair();
    if(action)g.hud.toast('Service complete · clear to leave','good');
    g.scenery.pitCrew?.(s);
    g.world.apex.tyreGrip=.82+.18*s.tyres;
    const elapsed=g.session.elapsed;
    g.scenery.skyLight=({sunset:.46,dawn:.70,night:.09,day:1.2})[g.atmosphere.timeOfDay];
    if(this.custom && this.time.value==='cycle'){
      const stage=Math.floor(elapsed/150)%4;
      if(stage!==this.clockStage){this.clockStage=stage;const time=['day','sunset','night','dawn'][stage];g.atmosphere.setTimeOfDay(time);g.terrain.setSun(g.atmosphere.sunDirection,g.atmosphere.sunColor,g.atmosphere.ambientColor);g.car.setHeadlights(time==='night');}
    }
    const target=this.sky==='rain'?.88:this.sky==='light'?.32:this.sky==='drying'?.9*Math.exp(-elapsed/99):this.sky==='change'?.45+.45*Math.sin(elapsed/35-.95):0;
    const wet=g.world.apex.wetness=(g.world.apex.wetness||0)+(target-(g.world.apex.wetness||0))*Math.min(1,dt*.35);
    g.roads.setWet(wet);this.rain.visible=wet>.14&&this.sky!=='drying';this.rain.position.set(state.position.x,state.position.y-5-(elapsed*11)%8,state.position.z);
    g.atmosphere.fog.density=g.atmosphere.preset.fogDensity*(1+wet*2.9+(this.sky==='mist'?2.7:this.sky==='overcast'?1.8:0));
    g.atmosphere.sun.intensity=g.atmosphere.preset.sunIntensity*(this.sky==='overcast'?.53:1-.5*wet);g.atmosphere.sky.material.uniforms.cloudCoverage.value=g.atmosphere.cloudsEnabled?(this.sky==='overcast'?.87:g.atmosphere.preset.clouds+wet*.5):0;
    this.sound.update(g,s,this.grid.field);
    if(g.session.nextGate!==this.prevGate){
      if([4,8,0].includes(g.session.nextGate)){const split=g.session.nextGate===0?g.session.lapStart:g.session.splits[g.session.lapsDone*11+g.session.nextGate-1];if(split!=null){this.sectorTime=split-this.lastSplit;this.lastSplit=split;}}
      this.prevGate=g.session.nextGate;
    }
    const L=g.session.roadLength,d=g.session._curD;
    const playerD=g.session.lapsDone*L+(g.session.nextGate===0 && d>L*.9?d-L:d);
    this.position=this.grid.update(dt,playerD);
    this.spray.update(dt,wet,state,this.grid.field);
    this.tick+=dt;if(this.tick<.125)return;this.tick=0;
    this.recorded.push([state.position.clone(),state.quaternion.clone()]);if(this.recorded.length>160)this.recorded.shift();
    const flag=g.session.wrongWay?'WRONG WAY':s.inLane?'PIT LANE':g.session.offRoad?'YELLOW':g.session.totalLaps>1&&g.session.lapsDone===g.session.totalLaps-1?'FINAL LAP':'GREEN';
    this.flags.textContent=flag;this.flags.dataset.flag=flag;
    const telemetry=[this.grid.field.length?'P'+this.position+'/'+(this.grid.field.length+1):null,'S'+(1+Math.floor(g.session.nextGate/4))+'  '+secs(this.sectorTime),Math.round(s.fuel)+' L',Math.round(s.tyres*100)+'% tyres',Math.round(s.brakes*100)+'% brakes'];
    if(s.inLane)telemetry.push('Box '+String(this.boxIndex+1).padStart(2,'0'),s.phase==='service'?Math.ceil(s.duration-s.elapsed)+' s service':s.phase==='released'?'Released':s.limit+' km/h');
    g.scenery.timing(elapsed,g.session.hud.lap,this.grid.field.length?this.position:0);
    this.readout.textContent=telemetry.filter(Boolean).join('   ·   ');
    this.pitUI.hidden=!s.inLane;this.work.disabled=s.phase!=='ready';
  }
  visibility(){
    const state=this.g.state;if(this.previousState!==state && state!=='running')this.sound.quiet();this.previousState=state;this.status.hidden=!['running','countdown'].includes(state)||!this.service;
    this.photo.hidden=!['paused','finished'].includes(state);
    if(this.photo.hidden){this.photo.open=false;this.view.value='drive';}
    this.g.scenery.setSignals(state,this.g.countdown);
  }
  photoCamera(){
    const g=this.g,c=this.camera,kind=this.view.value;
    if(this.photo.hidden || kind==='drive')return null;
    const a=g.world.apex,car=g.vehicle.getState(),rc=g.session?.route,road=g.world.roads[rc?.roadId??0],s=(rc?.startS??0)+(g.session?._curD??0);
    const f=kind==='pit'?a.main.frameAt(-44,{}):kind==='summit'?a.main.frameAt(a.stations[20],{}):road.frameAt(s+38,{});
    c.aspect=g.cameraRig.camera.aspect;c.fov=Number(this.fov.value);c.updateProjectionMatrix();
    const height=kind==='aerial'?175:kind==='pit'?10:6,side=kind==='aerial'?100:16;
    c.position.set(f.x+side*f.rx,f.y+height,f.z+side*f.rz);
    if(kind==='replay'&&this.recorded.length){
      const i=Math.floor((performance.now()-this.viewTime)/125)%this.recorded.length,[p,q]=this.recorded[i];g.car.group.position.copy(p);g.car.group.quaternion.copy(q);
      c.position.copy(p).add(new T.Vector3(-5,2.6,7).applyQuaternion(q));c.lookAt(p);
    }else if(kind==='pit'||kind==='summit'){const t=a.main.frameAt(kind==='pit'?80:a.stations[21],{});c.lookAt(t.x,t.y+1,t.z);}
    else c.lookAt(car.position);
    g.renderer.toneMappingExposure=g.atmosphere.preset.exposure*Number(this.exposure.value);
    return c;
  }
  finish(){if(!this.custom||this.format.value!=='cup')return;
    this.cup.points+=[12,9,7,5,4,3,2,1][this.position-1]||0;this.cup.round++;
    this.g.hud.toast('APEX Cup · '+this.cup.points+' points'+(this.cup.round===3?' · Championship complete':''),'good');
    if(this.cup.round===3)this.cup={round:0,points:0};
    try{localStorage.setItem('slop-apex-cup',JSON.stringify(this.cup));}catch{}
  }
  reset(){this.sound.quiet();this.g.scenery.pitCrew?.(null);this.grid.clear();this.service=null;this.g.world.apex.wetness=0;this.g.world.apex.tyreGrip=1;
    this.g.roads.setWet(0);this.g.atmosphere.fog.density=this.g.atmosphere.preset.fogDensity;this.rain.visible=false;this.spray.mesh.visible=false;this.serviceBox?.removeFromParent();
    this.g.vehicle.setAssists({driftAssist:this.g.settings.driftAssist,abs:this.g.settings.abs,transmission:this.g.settings.transmission});}
  dispose(){this.reset();this.grid.dispose();this.sound.dispose();this.spray.dispose();for(const e of [this.photo,this.status,this.panel])e.remove();this.rain.removeFromParent();this.rain.geometry.dispose();this.rain.material.dispose();this.serviceBox?.geometry.dispose();this.serviceBox?.material.dispose();}
}

