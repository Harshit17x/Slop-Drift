import * as T from 'three';
import {ApexService,boxFor} from './apexSport.js';
import {daylight} from './apexDaylight.js';
import {getCar} from '../vehicle/cars.js';
import {ApexSound} from '../audio/ApexSound.js';
import {ApexSpray} from '../render/ApexSpray.js';
import {loadLocalGhost,saveLocalGhost} from '../ghost/ghostStore.js';
import {ApexAcademy} from './ApexAcademy.js';
import {ApexReplay} from './ApexReplay.js';
import {controlFlag,capUnderFlag} from './apexControl.js';
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
    this.g=game;this.sound=new ApexSound(game.audio);this.grid=new ApexGrid(game);this.school=new ApexAcademy(game);this.tick=0;this.phase=0;this.camera=new T.PerspectiveCamera(54,1,.15,6900);
    const list=game.root.querySelector('.sdh-events-right');
    this.panel=element('details','apx-setup',list);list.prepend(this.panel);
    element('summary','',this.panel).textContent='Race weekend setup';
    const form=element('div','apx-fields',this.panel);
    this.layout=choice(form,'Configuration',Object.entries(APEX_LAYOUTS));
    this.format=choice(form,'Session',[['weekend','Practice → qualifying → race'],['race','Grid race'],['qualify','Qualifying'],['timeTrial','Time trial'],['school','Academy driving school'],['practice','Practice'],['cup','Three-round championship']]);
    this.format.value='race';
    this.rules=choice(form,'Track limits',[[.65,'Club'],[.2,'Strict'],[1.25,'Relaxed']]);
    this.laps=choice(form,'Race length',[[2,'2 laps'],[1,'1 lap'],[3,'3 laps'],[6,'6 laps'],[12,'12 laps'],[24,'24 laps']]);
    this.entries=choice(form,'Opponents',[[3,'3 cars'],[0,'Solo'],[1,'1 car'],[7,'7 cars']]);
    this.level=choice(form,'Difficulty',[[.94,'Club'],[1.06,'Professional'],[.80,'Novice']]);
    this.weather=choice(form,'Weather',[['clear','Clear'],['clouds','Partly cloudy'],['mist','Valley mist'],['overcast','Overcast'],['light','Light rain'],['rain','Heavy rain'],['drying','Post-rain drying'],['change','Changeable']]);
    this.time=choice(form,'Start time',[['day','Daylight'],['sunset','Sunset'],['night','Night'],['dawn','Dawn'],['cycle','Accelerated endurance cycle']]);
    this.limit=choice(form,'Pit limiter',[[60,'60 km/h'],[50,'50 km/h'],[80,'80 km/h']]);
    this.ambience=choice(form,'Trackside sound',[[1,'Full'],[.5,'Reduced'],[0,'Off']]);
    this.radio=choice(form,'Race radio',[['text','Messages'],['voice','Messages and voice']]);
    this.resolution=choice(form,'Race resolution',[['adaptive','Adaptive'],['fixed','Fixed']]);
    this.handling=choice(form,'Handling',[['gt','GT racing'],['current','Garage setup']]);
    this.profile=element('canvas','apx-profile',this.panel);this.profile.width=640;this.profile.height=112;
    this.summary=element('p','',this.panel);
    this.layout.onchange=()=>this.drawProfile();
    this.format.onchange=()=>{this.layout.disabled=this.format.value==='school';if(this.layout.disabled)this.layout.value='academy';this.drawProfile();};
    this.cup={round:0,points:0};
    try{const saved=JSON.parse(localStorage.getItem('slop-apex-cup'));if(saved && [0,1,2].includes(saved.round)&&Number.isFinite(saved.points))this.cup=saved;}catch{}
    this.startButton=element('button','apx-button',this.panel);const start=this.startButton;start.type='button';start.textContent='Start session';
    start.onclick=()=>{this.phase=0;this.gridOrder=null;game.beginRun('apex-meeting');};
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
    this.view=choice(tools,'Camera',[['drive','Driving'],['broadcast','Trackside'],['summit','Skyline'],['pit','Pit lane'],['aerial','Aerial'],['replay','Race replay'],['low','Track-level'],['stadium','Thunder Bowl'],['carousel','The Carousel'],['vortex','The Vortex'],['ascent','Summit Ascension'],['lake','Lakeside'],['podium','Winners’ podium']]);
    this.fov=choice(tools,'Lens',[[48,'Standard'],[27,'Telephoto'],[72,'Wide']]);
    this.exposure=choice(tools,'Exposure',[[1,'Neutral'],[.77,'−⅓ EV'],[1.26,'+⅓ EV']]);
    this.aperture=choice(tools,'Depth of field',[['0','Deep focus'],['.00006','Shallow focus']]);
    this.hudView=choice(tools,'Interface',[['on','Show menus'],['off','Hide menus']]);
    this.scrub=element('input','apx-seek',this.photo);this.scrub.type='range';this.scrub.min=0;this.scrub.max=0;this.scrub.step=.125;
    this.scrub.setAttribute('aria-label','Replay time');
    this.scrub.oninput=()=>{this.viewTime=performance.now()-Number(this.scrub.value)*1000;};
    this.aperture.onchange=async()=>{if(Number(this.aperture.value) && !this.optics){
      this.opticsLoad??=import('./apexOptics.js').then(({photoOptics})=>photoOptics(game,this.camera));
      const optics=await this.opticsLoad;if(this.disposed)optics.dispose();else this.optics=optics;
    }};
    const shutter=element('button','apx-button',this.photo);shutter.textContent='Save photo';shutter.onclick=()=>{const cam=this.photoCamera()||game.cameraRig.camera;if(!this.renderPhoto(cam))game.renderer.render(game.scene,cam);const a=document.createElement('a');a.download='apex-grand-prix.png';a.href=game.canvas.toDataURL();a.click();};
    this.view.onchange=()=>{this.scrub.hidden=this.view.value!=='replay';this.viewTime=performance.now();};
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
  trialKey(route){
    const revision = ['gp','international','bowl'].includes(route) ? '.v2' : '';
    return 'apex.trial.' + route + revision;
  }
  trialRecords(route){
    const key=this.trialKey(route);
    try {const records=JSON.parse(localStorage.getItem(key+'.timing'));return {'apex-meeting':records||{}};}catch{return {};}
  }
  announce(text){
    const synth=globalThis.speechSynthesis;
    if(!synth || this.radio.value!=='voice' || this.g.audio.muted || !this.g.audio.volume)return;
    const voice=synth.getVoices().find(v=>v.localService && v.lang.startsWith('en'));
    if(!voice || synth.speaking)return;
    const message=new SpeechSynthesisUtterance(text);message.voice=voice;message.rate=1.05;message.volume=this.g.audio.volume*.65;
    this.announcement=message;message.onend=()=>{if(this.announcement===message)this.announcement=null;};synth.speak(message);
  }
  beginTrial(){
    if(!this.custom || this.sessionType!=='timeTrial')return;
    const {meta,career,session}=this.g,key=this.trialKey(session.routeKey);
    const ghost=loadLocalGhost(key);
    meta.recorder.start(key,career.profile.name,career.profile.cosmetics.paint);
    meta.setGhost(ghost?{data:ghost,kind:'pb',playerId:career.profile.id}:null);
  }
  get sessionType(){return this.format.value==='weekend'?['practice','qualify','race'][this.phase]:this.format.value;}
  setLight(time){
    const g=this.g,a=g.atmosphere;
    if(a.timeOfDay!==time || this.lightBlended)a.setTimeOfDay(time);
    else{a.fog.density=a.preset.fogDensity;a.sun.intensity=a.preset.sunIntensity;a.applyClouds();}
    this.lightBlended=false;
    g.terrain.setSun(a.sunDirection,a.sunColor,a.ambientColor);
    if(a.isNight)g.water.setSun(a.sunDirection,a.sunColor,a.ambientColor);else g.water.setSun();
    g.car.setHeadlights(a.isNight||g.headlightsWanted);
  }
  mode(){
    const cup=this.format.value==='cup',route=cup?['international','gp','loop'][this.cup.round]:this.format.value==='school'?'academy':this.layout.value;
    const kind=this.sessionType;
    const laps=kind==='school'?0:kind==='practice'?(this.format.value==='weekend'?1:0):kind==='qualify'||kind==='timeTrial'?1:Number(this.laps.value);
    return {id:'apex-meeting',label:cup?'APEX Cup · Round '+(this.cup.round+1):APEX_LAYOUTS[route]+' · '+({school:'Driving school',practice:'Practice',qualify:'Qualifying',race:'Grid race',timeTrial:'Time trial'})[kind],route,laps,practice:kind==='practice'&&!laps,limitGrace:Number(this.rules.value)};
  }
  start(mode,party=false){
    const g=this.g;this.custom=mode.id==='apex-meeting';this.view.value='drive';this.photo.open=false;this.hudView.value='on';this.tick=0;this.sampleClock=0;this.rubberTick=0;this.hazardSeconds=0;this.recoverySeconds=0;this.flag='GREEN';this.previousFlag=null;this.g.root.classList.remove('apx-clean');
    this.boxIndex=Math.abs([...String(g.career.profile.id||'1')].reduce((n,c)=>n+c.charCodeAt(0),0))%40;
    this.school.start(this.custom && this.sessionType==='school');
    this.service=new ApexService(g.world.apex.pit,boxFor(g.world,this.boxIndex),this.custom?Number(this.limit.value):60);
    this.sectorTime=null;this.sectorDelta=null;this.lastSplit=0;this.prevGate=0;this.position=1;
    this.sky=this.custom?this.weather.value:'clear';this.timeBase=0;
    this.setLight(this.custom?(this.time.value==='cycle'?'day':this.time.value):g.settings.timeOfDay);
    this.resetResolution();this.baseDpr=g.renderer.getPixelRatio();this.pixelScale=1;this.windowFrames=0;this.windowTime=0;
    this.clockStage=0;g.world.apex.wetness=this.sky==='drying'?.9:0;
    this.gt=this.custom && this.handling.value==='gt';
    if (this.gt) g.vehicle.setTuning(getCar('gt').tuning);
    const race=this.custom && ['race','cup'].includes(this.sessionType) || mode.id==='circuit';
    const qualify=this.custom && this.sessionType==='qualify';
    this.grid.start((race||qualify) && !party?(this.custom?Number(this.entries.value):3):0,this.custom?Number(this.level.value):.94,race && this.format.value==='weekend'?this.gridOrder:null);
    this.replay=new ApexReplay(1+this.grid.field.length);
    if(this.grid.field.length){
      const slot=this.grid.order.indexOf(-1),r=g.session.route,road=g.world.roads[r.roadId],s=r.startS-12-slot*4;
      const pose=g.world.getSpawn(mode.route,s,g.pose),f=road.frameAt(s,{}),side=(slot%2?1:-1)*3;
      pose.position.x+=side*f.rx;pose.position.z+=side*f.rz;
      pose.position.y=g.world.sampleGround(pose.position.x,pose.position.z,{},pose.position.y+side*f.ry+.45).y;
      g.vehicle.teleport(pose);
      g.session._curD=g.session._prevD=g.session._lastValidD=g.session._dOf(s);
    }
    this.grid.resetReplay=false;
    this.resultGrid=null;
    g.scenery.setEvent(race?1:qualify?.68:.32);this.lastWeather=-1;
    this.serviceBox?.removeFromParent();
    if(!this.serviceBox){
      this.serviceBox=new T.Mesh(new T.PlaneGeometry(5.8,2.65),new T.MeshBasicMaterial({color:0xdab756,transparent:true,opacity:.3,depthWrite:false,side:T.DoubleSide}));this.serviceBox.rotation.x=-Math.PI/2;
    }
    const p=this.service.box;this.serviceBox.position.set(p.x,p.y+.12,p.z);g.scene.add(this.serviceBox);
  }
  resetResolution(){
    if(this.baseDpr && this.pixelScale!==1)this.g.renderer.setPixelRatio(this.baseDpr);
    this.pixelScale=1;
  }
  adaptResolution(dt){
    if(!this.custom || this.resolution.value!=='adaptive' || !['Low','Medium','Auto'].includes(this.g.settings.quality) || dt<=0)return;
    this.windowTime+=dt;this.windowFrames++;
    if(this.windowTime<2)return;
    const fps=this.windowFrames/this.windowTime;this.windowFrames=0;this.windowTime=0;
    const next=fps<53?Math.max(.70,this.pixelScale-.10):fps>59.5?Math.min(1,this.pixelScale+.025):this.pixelScale;
    if(Math.abs(next-this.pixelScale)>.001){this.pixelScale=next;this.g.renderer.setPixelRatio(this.baseDpr*next);}
  }
  inputs(c,state){if(!this.service)return;
    this.service.controls(c,state);
    const cap=capUnderFlag(this.flag);
    if(state.speed>=cap){c.throttle=0;c.boost=false;c.brake=Math.max(c.brake,Math.min(1,(state.speed-cap)*.3+.15));}
    if(this.gt)c.boost=false;
  }
  update(dt,state){
    const g=this.g,s=this.service;if(!s)return;
    this.adaptResolution(dt);
    const action=s.update(dt,state);if(action?.repair)g.damage.repair();
    if(action){g.hud.toast('Service complete · clear to leave','good');this.announce('Service complete. Clear to leave.');}
    g.scenery.pitCrew?.(s);
    const roadTemp=(({day:32,sunset:23,dawn:15,night:13})[g.atmosphere.timeOfDay] ?? 28)-8*(g.world.apex.wetness||0);
    const slick = g.vehicle.tuning.tire.slickThermal;
    if (slick) {
      g.vehicle.roadTemperature = roadTemp;
      if (action?.tyres) for (const wheel of g.vehicle.wheels) wheel.temperature = slick.initial;
      s.tyreTemp = g.vehicle.wheels.reduce((sum, wheel) => sum + wheel.temperature, 0) / 4;
    }
    g.world.apex.tyreGrip = .82 + .18 * s.tyres;
    const elapsed=g.session.elapsed;
    g.scenery.skyLight=({sunset:.46,dawn:.70,night:.09,day:1.2})[g.atmosphere.timeOfDay];
    const sunPower=this.custom && this.time.value==='cycle'?daylight(this,elapsed):g.atmosphere.preset.sunIntensity;
    const target=this.sky==='rain'?.88:this.sky==='light'?.32:this.sky==='drying'?.9*Math.exp(-elapsed/99):this.sky==='change'?.45+.45*Math.sin(elapsed/35-.95):0;
    const wet=g.world.apex.wetness=(g.world.apex.wetness||0)+(target-(g.world.apex.wetness||0))*Math.min(1,dt*.35);
    g.roads.setWet(wet);this.rain.visible=wet>.14&&this.sky!=='drying';this.rain.position.set(state.position.x,state.position.y-5-(elapsed*11)%8,state.position.z);
    g.atmosphere.fog.density=g.atmosphere.preset.fogDensity*(1+wet*2.9+(this.sky==='mist'?2.7:this.sky==='overcast'?1.8:0));
    g.atmosphere.sun.intensity=sunPower*(this.sky==='overcast'?.53:1-.5*wet);g.atmosphere.sky.material.uniforms.cloudCoverage.value=g.atmosphere.cloudsEnabled?(this.sky==='overcast'?.87:this.sky==='clouds'?.60:this.sky==='clear'?.13:g.atmosphere.preset.clouds+wet*.5):0;
    this.sound.update(g,s,this.grid.field);
    if(g.session.nextGate!==this.prevGate){
      if([4,8,0].includes(g.session.nextGate)){const split=g.session.nextGate===0?g.session.lapStart:g.session.splits[g.session.lapsDone*11+g.session.nextGate-1];if(split!=null){this.sectorTime=split-this.lastSplit;this.lastSplit=split;
          const best=g.session.records[g.mode.id],gate=g.session.nextGate,i=gate===0?11:gate-1;
          const finish=i===11?best?.time:best?.splits?.[i],start=i===3?0:best?.splits?.[i-4];
          this.sectorDelta=Number.isFinite(finish)&&Number.isFinite(start)?this.sectorTime-(finish-start):null;}}
      this.prevGate=g.session.nextGate;
    }
    const L=g.session.roadLength,d=g.session._curD;
    const playerD=g.session.lapsDone*L+(g.session.nextGate===0 && d>L*.9?d-L:d);
    this.hazardSeconds=state.upsideDown && !s.inLane?this.hazardSeconds+dt:0;
    if(this.hazardSeconds>=1.7)this.recoverySeconds=4;
    else this.recoverySeconds=Math.max(0,this.recoverySeconds-dt);
    this.flag=controlFlag(g.session,state,this.grid.field,playerD,this.recoverySeconds?2:this.hazardSeconds);
    if(this.previousFlag!==this.flag && ['FULL COURSE YELLOW','RED','BLUE'].includes(this.flag))
      g.hud.toast(this.flag==='RED'?'Red flag · recovery in progress':this.flag==='BLUE'?'Blue flag · faster car approaching':'Full course yellow · 80 km/h','warn');
    if(this.previousFlag!==this.flag && this.custom && this.previousFlag)this.announce(({GREEN:'Track clear. Green flag.',BLUE:'Blue flag. Faster traffic behind.',RED:'Red flag. Stop safely.',YELLOW:'Local yellow. Caution ahead.'})[this.flag]||this.flag);
    this.previousFlag=this.flag;
    this.school.update(dt,g.session,state);
    this.position=this.grid.update(dt,playerD,this.flag);
    this.grid.contact(dt,state);
    this.sampleClock+=dt;this.replay.record(this.sampleClock,state,this.grid.field);
    this.rubberTick+=dt;
    if(this.rubberTick>=.25){
      this.rubberTick=0;const surface=g.world.apex.surfaceState;
      if(state.speed>4&&!s.inLane)surface.deposit(state.position);
      for(const bot of this.grid.field)if(!bot.done&&!bot.inPit&&bot.speed>4)surface.deposit(bot.car.position);
    }
    g.scenery.marshalSignal(this.flag,state.position);
    this.spray.update(dt,wet,state,this.grid.field);
    this.tick+=dt;if(this.tick<.125)return;this.tick=0;
    const flag=g.session.wrongWay?'WRONG WAY':s.inLane?'PIT LANE':this.flag;
    this.flags.textContent=flag;this.flags.dataset.flag=flag;
    const telemetry=[this.grid.field.length?'P'+this.position+'/'+(this.grid.field.length+1):null,'S'+(1+Math.floor(g.session.nextGate/4))+'  '+secs(this.sectorTime),Math.round(s.fuel)+' L',Math.round(s.tyres*100)+'% tyres',Math.round(s.brakes*100)+'% brakes'];
    if(this.school.group.visible)telemetry.unshift(this.school.instruction);
    if(g.session.lapInvalid)telemetry.push('Lap invalid');
    if(g.session.penaltySeconds)telemetry.push('+'+g.session.penaltySeconds+' s');
    if(slick)telemetry.push(Math.round(s.tyreTemp)+' °C tyres');
    if(g.vehicle.wheels.some(w=>w.tcActive))telemetry.push('TC');
    if(state.brake>.05 && g.vehicle.wheels.some(w=>w.absActive))telemetry.push('ABS');
    if(this.sectorDelta!=null)telemetry.push('Δ '+(this.sectorDelta>=0?'+':'')+secs(this.sectorDelta));
    if(s.inLane)telemetry.push('Box '+String(this.boxIndex+1).padStart(2,'0'),s.phase==='service'?Math.ceil(s.duration-s.elapsed)+' s service':s.phase==='released'?'Released':s.limit+' km/h');
    g.scenery.telecast(elapsed,g.session.route,state.position,this.grid.field);
    g.scenery.timing(elapsed,g.session.hud.lap,this.grid.field.length?this.position:0);
    this.readout.textContent=telemetry.filter(Boolean).join('   ·   ');
    this.pitUI.hidden=!s.inLane;this.work.disabled=s.phase!=='ready';
  }
  visibility(){
    const state=this.g.state;if(state==='paused'||state==='finished')this.resetResolution();if(this.previousState!==state && state!=='running')this.sound.quiet();this.previousState=state;this.status.hidden=!['running','countdown'].includes(state)||!this.service;
    this.photo.hidden=!['paused','finished'].includes(state);
    if(this.photo.hidden){this.photo.open=false;this.view.value='drive';}
    this.g.root.classList.toggle('apx-clean',!this.photo.hidden && this.photo.open && this.hudView.value==='off');
    this.scrub.hidden=this.view.value!=='replay';
    if(this.grid.resetReplay && this.view.value!=='replay'){
      for(const bot of this.grid.field){this.grid.pose(bot);bot.car.visible=!bot.done&&bot.car.position.distanceToSquared(this.g.vehicle.getState().position)<600**2;}
      this.grid.resetReplay=false;
    }
    this.g.scenery.setSignals(state,this.g.countdown);
  }
  photoCamera(){
    const g=this.g,c=this.camera,kind=this.view.value;
    if(this.photo.hidden || kind==='drive'){
      if(g.state==='countdown' && this.custom && ['race','cup'].includes(this.sessionType) && g.countdown>1.3){
        const r=g.session.route,road=g.world.roads[r.roadId],f=road.frameAt(r.startS-8,{}),pan=(3.5-g.countdown)*4;
        c.aspect=g.cameraRig.camera.aspect;c.fov=47;c.updateProjectionMatrix();
        c.position.set(f.x+(12-pan*.5)*f.rx+pan*f.tx,f.y+4.2,f.z+(12-pan*.5)*f.rz+pan*f.tz);
        c.lookAt(g.vehicle.getState().position);return c;
      }
      return null;
    }
    const a=g.world.apex,car=g.vehicle.getState(),rc=g.session?.route,road=g.world.roads[rc?.roadId??0],s=(rc?.startS??0)+(g.session?._curD??0);
    const f=kind==='pit'?a.main.frameAt(-44,{}):kind==='summit'?a.main.frameAt(a.stations[20],{}):road.frameAt(s+38,{});
    c.aspect=g.cameraRig.camera.aspect;c.fov=Number(this.fov.value);c.updateProjectionMatrix();
    const height=kind==='aerial'?175:kind==='pit'?10:kind==='low'?.65:6,side=kind==='aerial'?100:16;
    c.position.set(f.x+side*f.rx,f.y+height,f.z+side*f.rz);
    if(kind==='replay'&&this.replay?.frames){
      const duration=this.replay.duration,t=duration?(performance.now()-this.viewTime)/1000%duration:0;
      this.scrub.max=duration;this.scrub.value=t;this.replay.apply(t,0,g.car.group);
      this.grid.field.forEach((bot,i)=>this.replay.apply(t,i+1,bot.car));this.grid.resetReplay=true;
      const {position:p,quaternion:q}=g.car.group;c.position.set(-4,2.2,6).applyQuaternion(q).add(p);c.lookAt(p);
    }else if(['stadium','carousel','vortex','ascent'].includes(kind)){
      const i={stadium:7,carousel:3,vortex:4,ascent:1}[kind],s=a.sections[i].start;
      const p=a.main.frameAt(s+16,{}),target=a.main.frameAt(s+65,{});
      c.position.set(p.x+p.rx*9,p.y+3,p.z+p.rz*9);c.lookAt(target.x,target.y+1,target.z);
    }else if(kind==='lake'){c.position.set(1190,g.world.grid.heightAt(1190,-710)+45,-710);c.lookAt(854,20,-373);
    }else if(kind==='podium'){const p=a.main.frameAt(0,{});c.position.set(p.x+112*p.tx+68*p.rx,p.y+3,p.z+112*p.tz+68*p.rz);c.lookAt(p.x+115*p.tx+81*p.rx,p.y+1.9,p.z+115*p.tz+81*p.rz);
    }else if(kind==='pit'||kind==='summit'){const t=a.main.frameAt(kind==='pit'?80:a.stations[21],{});c.lookAt(t.x,t.y+1,t.z);}
    else c.lookAt(car.position);
    g.renderer.toneMappingExposure=g.atmosphere.preset.exposure*Number(this.exposure.value);
    return c;
  }
  renderPhoto(cam){
    if(!this.optics || !Number(this.aperture.value) || this.photo.hidden || this.view.value==='drive')return false;
    this.optics.render(cam,Number(this.aperture.value),cam.position.distanceTo(this.g.car.group.position));return true;
  }
  showClassification(){
    const body=this.g.root.querySelector('.sdh-finish-body');if(!body)return;
    const title=body.querySelector('.sdh-eyebrow');if(title)title.textContent='APEX Grand Prix · '+this.g.mode.label;
    if(!this.custom)return;
    const type=this.sessionType,session=this.g.session;
    const wrap=element('div','apx-classification',body);
    if(type==='qualify' || type==='race' || type==='cup'){
      const rows=this.grid.field.map(bot=>({id:bot.index,name:'#'+String(bot.index+11)+' · '+bot.team,time:type==='qualify'?bot.bestLap:bot.finishTime,d:bot.d}));
      rows.push({id:-1,name:'You',time:type==='qualify'?session.sessionBestLap:session.result.time,d:session.roadLength*session.totalLaps});
      rows.sort((a,b)=>(a.time??Infinity)-(b.time??Infinity)||b.d-a.d);
      if(type==='qualify')this.gridOrder=rows.map(r=>r.id);
      element('strong','',wrap).textContent=type==='qualify'?'Qualifying classification':'Race classification';
      for(const [i,row] of rows.entries())element('div','',wrap).textContent=(i+1)+'   '+row.name+'   '+(row.time!=null?secs(row.time):type==='qualify'?'No valid time':'On track');
    }
    if(type==='cup' && this.cupTable){
      element('strong','',wrap).textContent='Championship standings';
      for(const [id,points] of Object.entries(this.cupTable).sort((a,b)=>b[1]-a[1]))
        element('div','',wrap).textContent=(id==='-1'?'You':'Car '+(Number(id)+11))+'   '+points+' pts';
    }
    if(session.penaltySeconds)element('div','',wrap).textContent='Track limits · '+session.penaltySeconds+' s added';
    if(this.format.value==='weekend' && this.phase<2){
      const next=element('button','apx-button',wrap);next.textContent=this.phase===0?'Continue to qualifying':'Start race from qualifying grid';
      next.onclick=()=>{next.disabled=true;this.phase++;this.g.beginRun('apex-meeting');};
    }
  }
  finish(){
    this.flag='CHEQUERED';this.g.scenery.marshalSignal(this.flag,this.g.vehicle.getState().position);
    if(this.custom && this.sessionType==='timeTrial'){
      const g=this.g,key=this.trialKey(g.session.routeKey),record=g.session.records[g.mode.id];
      if(g.session.result.isRecord){
        g.meta.recorder.sample(g.session.result.time,g.vehicle.getState());
        const ghost=g.meta.recorder.finish(g.session.result.time);
        if(ghost)saveLocalGhost(key,ghost);
        try{localStorage.setItem(key+'.timing',JSON.stringify(record));}catch{}
      }else g.meta.recorder.discard();
    }
    if(!this.custom||this.format.value!=='cup')return;
    const table=[12,9,7,5,4,3,2,1],field=[...this.grid.field].sort((a,b)=>(a.finishTime??Infinity)-(b.finishTime??Infinity)||b.d-a.d);
    field.splice(this.position-1,0,{index:-1});
    this.cup.scores??={};this.cup.scores[-1]=this.cup.points;
    for(const [i,entry] of field.entries())this.cup.scores[entry.index]=(this.cup.scores[entry.index]||0)+(table[i]||0);
    this.cup.points=this.cup.scores[-1];this.cup.round++;this.cupTable={...this.cup.scores};
    this.g.hud.toast('APEX Cup · '+this.cup.points+' points'+(this.cup.round===3?' · Championship complete':''),'good');
    if(this.cup.round===3)this.cup={round:0,points:0};
    try{localStorage.setItem('slop-apex-cup',JSON.stringify(this.cup));}catch{}
  }
  reset(){if(this.announcement){globalThis.speechSynthesis?.cancel();this.announcement=null;}this.resetResolution();this.sound.quiet();this.g.scenery.pitCrew?.(null);this.grid.clear();this.school.start(false);this.service=null;this.g.world.apex.wetness=0;this.g.world.apex.tyreGrip=1;
    this.g.roads.setWet(0);this.setLight(this.g.settings.timeOfDay);this.g.scenery.marshalSignal('GREEN');this.g.scenery.setEvent(.32);this.g.root.classList.remove('apx-clean');this.rain.visible=false;this.spray.mesh.visible=false;this.serviceBox?.removeFromParent();
    this.gt=false;this.g.applyActiveVehicleTuning();}
  dispose(){this.disposed=true;this.optics?.dispose();this.reset();this.grid.dispose();this.school.dispose();this.sound.dispose();this.spray.dispose();for(const e of [this.photo,this.status,this.panel])e.remove();this.rain.removeFromParent();this.rain.geometry.dispose();this.rain.material.dispose();this.serviceBox?.geometry.dispose();this.serviceBox?.material.dispose();}
}

