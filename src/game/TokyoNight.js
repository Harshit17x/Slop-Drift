import * as T from 'three';
import { FLOOR_NAMES, FLOOR_RISE } from '../world/Tokyo.js';
import { GhostCar } from '../render/GhostCar.js';
import { TokyoSound, stations } from '../audio/TokyoSound.js';


const weatherOptions=['Clear','Rain','After rain','Passing showers'];
const key='slop-tokyo-passport-v1';
const jobs={
  stamps:['After Hours Stamp Rally','Stop by the signed counters at Shibuya Crossing, Electric Town, Shinjuku and the Midnight Auto Meet. Collect a stamp at each counter.'],
  explorer:['City Explorer','Visit the eight named districts.'],
  photographer:['Midnight Photographer','Stop at a district and frame a photograph. Collect four different districts.'],
  tower:['Tokyo Tower Tour','Use the Tower skyline camera in Minato, on 7F and at the Minato expressway overlook.'],
  hunter:['Garage Hunter','Find the workshops near Shinjuku, Akihabara and the car meet.'],
  parkade:['Midnight Parkade Championship','Bank a drift on each of the eight lower levels to unlock Rooftop Legends.'],
  basement:['Basement Drift Challenge','Bank 250 drift points in B2 within 90 seconds.'],
  parkTandem:['Tandem Parking Drift','Stay alongside the pace car and accumulate eight seconds of drifting on the ascent.'],
  rooftop:['Rooftop Legends','After mastering the lower decks, bank a drift on 7F.'],
  gymkhana:['Tokyo Bay Gymkhana','Link the three marked dockside sectors and bank a drift in each.'],
  rival:['Midnight Rivals','Race the Akatsuki team on the 5 km main circuit.'],
  tandem:['Tandem Masters','Accumulate eight seconds of drifting within 28 metres of the pace car.'],
};
const unique=(arr,v)=>{if(arr.includes(v))return false;arr.push(v);return true;};
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z,a.y-b.y);

export class TokyoNight{
  constructor(game){
    this.styles=document.createElement('link');this.styles.rel='stylesheet';this.styles.href=new URL('../ui/tokyoNight.css',import.meta.url).href;document.head.append(this.styles);
    this.g=game;this.sound=new TokyoSound(game.audio);this.loc={};this.clock=0;
    this.frame={};this.ghostPos=new T.Vector3();this.ghostQuat=new T.Quaternion();
    this.pose={position:new T.Vector3(),quaternion:new T.Quaternion()};
    let raw={};try{raw=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}
    this.log={};for(const k of ['found','photos','views','shops','floors','complete','stamps'])this.log[k]=Array.isArray(raw[k])?raw[k]:[];
    this.log.sectorRecords={...raw.sectorRecords};
    this.log.speedBest=Number(raw.speedBest)||0;
    this.log.courierBest=Number(raw.courierBest)||0;
    this.log.station=stations.includes(raw.station)?raw.station:'Off';
    this.log.weather=weatherOptions.includes(raw.weather)?raw.weather:'After rain';
    this.log.density=[.25,.5,.8].includes(raw.density)?raw.density:.5;
    this.job=jobs[raw.job]?raw.job:'explorer';
    this.sites=game.world.tokyoSites;
    this.panel=document.createElement('aside');this.panel.className='tokyo-night';this.panel.hidden=true;
    this.panel.innerHTML='<button class="tn-open" aria-expanded="false">東京 · Night guide</button><output></output><section hidden><label>Activity <select class="tn-job"></select></label><p></p><button class="tn-start">Start activity</button> <details class="tn-camera"><summary>Photo camera</summary><label>Angle <select class="tn-angle"></select></label><label>Lens <input class="tn-lens" type="range" min="25" max="75" value="48" aria-label="Field of view"></label><label>Exposure <input class="tn-exposure" type="range" min="0.65" max="1.7" step="0.05" value="1"></label><button class="tn-photo">Save photograph</button></details><label>Radio <select class="tn-radio"></select></label><label>Weather <select class="tn-weather"></select></label><label>Parked cars <select class="tn-density"></select></label><small></small></section>';
    game.root.append(this.panel);
    this.body=this.panel.querySelector('section');this.out=this.panel.querySelector('output');
    const select=(cl,options,value,fn)=>{
      const el=this.panel.querySelector(cl);
      for(const [id,label] of options)el.add(new Option(label,id));
      el.value=value;el.onchange=()=>fn(el.value);return el;
    };
    this.jobSelect=select('.tn-job',Object.entries(jobs).map(([id,[name]])=>[id,name]),this.job,v=>this.explain(v));
    this.explain(this.job);
    select('.tn-radio',['Off',...stations].map(v=>[v,v]),this.log.station,v=>{this.log.station=v;this.save()});
    select('.tn-weather',weatherOptions.map(v=>[v,v]),this.log.weather,v=>{this.log.weather=v;this.weather();this.save()});
    select('.tn-density',[['0.25','Sparse'],['0.5','Normal'],['0.8','Full']],String(this.log.density),v=>{this.log.density=Number(v);game.scenery.setParking(true,this.log.density);this.save()});
    this.panel.querySelector('.tn-open').onclick=e=>{this.body.hidden=!this.body.hidden;e.currentTarget.setAttribute('aria-expanded',String(!this.body.hidden));};
    this.panel.querySelector('.tn-start').onclick=()=>this.start(this.jobSelect.value);
    this.photoCamera=new T.PerspectiveCamera();this.photoTarget=new T.Vector3();
    this.angle='Front quarter';
    select('.tn-angle',['Front quarter','Rear quarter','Side tracking','Tower skyline','Driving view'].map(v=>[v,v]),this.angle,v=>this.angle=v);
    this.lens=this.panel.querySelector('.tn-lens');this.exposure=this.panel.querySelector('.tn-exposure');
    this.cameraTools=this.panel.querySelector('.tn-camera');
    this.panel.querySelector('.tn-photo').onclick=()=>this.photo();
    this.kiosk=document.createElement('div');this.panel.append(this.kiosk);
    this.kiosk.hidden=true;
    this.stamp=document.createElement('button');this.kiosk.append(this.stamp);
    this.stamp.onclick=()=>{
      const stop=this.currentStop();
      if(!stop)return;
      if(unique(this.log.stamps,stop.name)){
        stop.litUntil=this.g.scenery.time+4;this.save();
        this.g.hud.toast(stop.name+' stamp · '+this.log.stamps.length+'/4','good');
        if(this.log.stamps.length===4)this.complete('stamps');
      }
    };
    this.action=document.createElement('button');this.kiosk.append(this.action);
    this.action.onclick=()=>{
      const stop=this.currentStop();
      if(stop?.name==='Lantern Alley' && this.deliveryStart==null){
        this.deliveryStart=this.clock;this.g.hud.toast('Deliver the order to the Midnight Auto Meet in 180 s','info');
      }else if(stop?.name==='Pit Lane'){
        if(this.deliveryStart==null){this.start('rival');return}
        const seconds=Math.ceil(this.clock-this.deliveryStart);this.deliveryStart=null;
        if(seconds>180)return;
        this.log.courierBest=this.log.courierBest?Math.min(seconds,this.log.courierBest):seconds;
        this.save();this.g.hud.toast('Order delivered · '+seconds+' s · best '+this.log.courierBest+' s','good');
      }
    };
    this.refresh();this.weather();
  }
  save(){try{localStorage.setItem(key,JSON.stringify({...this.log,job:this.job}));}catch{}}
  explain(id){this.panel.querySelector('p').textContent=jobs[id][1];}
  refresh(){
    const l=this.log;
    this.panel.querySelector('small').textContent=l.found.length+'/8 districts · '+l.floors.length+'/8 decks · '+l.complete.length+'/'+Object.keys(jobs).length+' activities';
    this.g?.refreshMapQuests?.();
  }
  questsSummary(){
    const parkadeDone=this.log.complete.includes('parkade');
    return {
      title:'Tokyo Night Guide',
      eyebrow:'TOKYO AFTER HOURS',
      summary:`${this.log.found.length}/8 districts · ${this.log.floors.length}/8 decks · ${this.log.complete.length}/${Object.keys(jobs).length} done`,
      items:Object.entries(jobs).map(([id,[title,detail]])=>({
        id,
        title,
        detail,
        done:this.log.complete.includes(id),
        active:this.job===id,
        locked:id==='rooftop'&&!parkadeDone,
      })),
    };
  }
  launchQuest(id){
    if(!jobs[id])return;
    if(id==='rooftop'&&!this.log.complete.includes('parkade')){this.g.hud.toast('Complete the eight lower decks first','info');return;}
    if(!['rival','tandem','parkTandem'].includes(id)&&(this.g.state!=='running'||this.g.mode?.id!=='roam')){
      this.g.beginRun('roam');
    }
    this.start(id);
    this.g?.refreshMapQuests?.();
  }
  weather(){
    let w=this.g.mode?.id==='roam'?this.log.weather:'After rain';
    if(w==='Passing showers')w=weatherOptions[Math.floor(this.clock/65)%3];
    this.g.scenery.weather=w;
    this.g.scenery.reflect.opacity=w==='Clear'?.05:w==='Rain'?.30:.16;
    // Even in the rain the asphalt stays diffuse; the wet read comes from the
    // puddle films and neon spill, never from a mirror-smooth carriageway.
    this.g.roads.streetMaterial.roughness=w==='Clear'?.9:w==='Rain'?.62:.72;
  }
  start(id){
    if(id==='rooftop'&&!this.log.complete.includes('parkade')){this.g.hud.toast('Complete the eight lower decks first','info');return}
    this.job=id;this.save();this.body.hidden=true;this.panel.querySelector('.tn-open').setAttribute('aria-expanded','false');
    this.dockIndex=0;this.tandemTime=0;this.basementPoints=0;this.basementDeadline=this.clock+90;
    if(id==='rival'||id==='tandem'||id==='parkTandem'){
      this.dispatch=id;this.g.beginRun(id==='parkTandem'?'parkade':'sprint');
    }else{
      const target=id==='parkade'||id==='basement'?['parkade',22]:id==='gymkhana'?['bay',805]:id==='rooftop'?['parkade',2180]:null;
      if(target)this.g.vehicle.teleport(this.g.world.getSpawn(...target,this.pose));
      this.g.hud.toast(jobs[id][1],'info');
    }
  }
  driftSector(dt,state,drift){
    const zone=this.g.scenery.driftSectors.find(z=>z.road===this.road &&
      Math.abs(this.loc.s-z.s)<75 && this.loc.distance<this.loc.halfWidth);
    if(zone!==this.zone){
      if(this.zone){
        const points=Math.floor(this.zoneScore);
        this.zone.lights.color.setHex(0xefab48);
        if(points>0){
          const records=this.log.sectorRecords;
          records[this.zone.name]=Math.max(records[this.zone.name]||0,points);this.save();
          this.g.hud.toast(this.zone.name+' · '+points+' pts · best '+records[this.zone.name],'good');
        }
      }
      this.zone=zone;this.zoneScore=0;
      if(zone)this.g.hud.toast(zone.name+' · drift between the amber marks','info');
    }
    if(!zone)return;
    if(state.impact>5)this.zoneScore=0;
    else if(drift.active&&state.wheelsOnGround>=2){
      this.zoneScore+=dt*Math.min(65,state.speed)*Math.min(1,Math.abs(drift.angleDeg||0)/35);
    }
    zone.lights.color.setHex(drift.active?0x38f0dd:0xefab48);
    this.out.textContent=zone.name+' · '+Math.floor(this.zoneScore)+' pts';
  }
  currentStop(){
    const g=this.g;
    if(g.mode?.id!=='roam'||g.state!=='running')return null;
    const state=g.vehicle.getState();
    return state.speed<2.3?g.scenery.stops.find(s=>s.point.distanceToSquared(state.position)<10**2):null;
  }
  streetEvents(state,loc){
    const stop=this.currentStop();
    this.kiosk.hidden=!stop;
    if(stop){
      this.stamp.disabled=this.log.stamps.includes(stop.name);
      this.stamp.textContent=(this.stamp.disabled?'Stamped · ':'Collect stamp · ')+stop.name;
      this.action.hidden=stop.name!=='Lantern Alley'&&stop.name!=='Pit Lane';
      this.action.disabled=stop.name==='Lantern Alley'&&this.deliveryStart!=null;
      this.action.textContent=stop.name==='Lantern Alley'?'Pick up ramen order':this.deliveryStart!=null?'Deliver order':'Challenge Akatsuki';
    }
    if(this.deliveryStart!=null){
      const left=180-Math.floor(this.clock-this.deliveryStart);
      if(left<=0){this.deliveryStart=null;this.g.hud.toast('Order expired · return to Lantern Alley','info');}
      else return 'Ramen delivery → Midnight Auto Meet · '+left+' s';
    }
    const inTrap=loc.roadId===2&&Math.abs(loc.s-1520)<14&&loc.distance<loc.halfWidth;
    if(inTrap&&!this.inTrap){
      const kmh=Math.round(state.speed*3.6);
      this.log.speedBest=Math.max(this.log.speedBest,kmh);this.save();
      this.g.hud.toast('Expressway speed camera · '+kmh+' km/h · best '+this.log.speedBest,'info');
    }
    this.inTrap=inTrap;
    if(this.job==='stamps')return this.log.stamps.length+'/4 stamps · '+(this.g.scenery.stops.find(s=>!this.log.stamps.includes(s.name))?.name||'rally complete');
    return '';
  }
  runStart(mode){
    if(this.zone)this.zone.lights.color.setHex(0xefab48);
    this.zone=null;this.zoneScore=0;this.deliveryStart=null;this.inTrap=false;this.kiosk.hidden=true;
    this.lastRoad=null;this.outside=0;
    this.racing=this.dispatch;this.dispatch=null;this.clock=0;this.nextScan=0;this.tandemTime=0;this.basementDeadline=90;this.basementPoints=0;
    if(this.racing){
      if(!this.rival){this.rival=new GhostCar({name:'Akatsuki',paintColor:'ember',wheelLayout:this.g.vehicle.wheelLayout});this.g.scene.add(this.rival.group)}
      this.rival.setVisible(true);
    }else this.rival?.setVisible(false);
    this.g.scenery.setParking(mode==='roam',mode==='roam'?this.log.density:.5);
    this.weather();
  }
  complete(id){
    if(!unique(this.log.complete,id))return;
    this.g.hud.toast(jobs[id][0]+' complete','good');
    if(id==='explorer'||id==='tower'||id==='parkade')this.g.career.unlockAchievement('tokyo-'+id);
    this.refresh();this.save();
  }
  finishRace(){
    if(this.racing==='rival'&&this.g.session.elapsed<this.g.world.routes.loop.length/this.pace())this.complete('rival');
    else if(this.racing==='rival')this.g.hud.toast('Akatsuki finished first','info');
    this.rival?.setVisible(false);this.racing=null;
  }
  pace(){return this.log.complete.includes('rival')?26:20;}
  update(dt,state,drift){
    this.clock+=dt;const g=this.g,w=g.world,p=state.position;
    if(this.racing){
      const route=g.session.route,road=w.roads[route.roadId];
      const s=route.startS+this.clock*(this.racing==='parkTandem'?14:this.pace()),f=road.frameAt(s,this.frame);
      w.roadSpawn(road.id,s,1,this.pose);
      this.ghostPos.set(f.x+1.65*f.rx,f.y,f.z+1.65*f.rz);
      this.ghostQuat.copy(this.pose.quaternion);this.rival.setPose(this.ghostPos,this.ghostQuat,f.curvature*10,this.clock);
      this.rival.update(g.cameraRig.camera,p);
      if((this.racing==='tandem'||this.racing==='parkTandem')&&drift.active && Math.abs(this.ghostPos.y-p.y)<2 && this.ghostPos.distanceTo(p)<28){this.tandemTime+=dt;if(this.tandemTime>=8)this.complete(this.racing);}
    }
    if(this.clock>=this.nextScan){
      this.nextScan=this.clock+.16;
      if(this.log.weather==='Passing showers'&&g.mode.id==='roam')this.weather();
      const loc=w.locate(p.x,p.z,this.loc,-1,p.y);
      this.road=loc.roadId;this.floor=this.road===4?Math.max(0,Math.min(8,Math.round(loc.y/FLOOR_RISE)+2)):-1;
      this.nearest=this.sites.reduce((best,v)=>dist(v,p)<dist(best,p)?v:best,this.sites[0]);
      this.near=dist(this.nearest,p);
      if(this.road>=0 && !loc.beyondEnd && loc.distance<loc.halfWidth-.15 && state.wheelsOnGround>=2)
        this.lastRoad={id:loc.roadId,s:loc.s,dir:state.forward.x*loc.tx+state.forward.z*loc.tz>=0?1:-1};
      if(g.mode.id==='roam' && this.near<45 && unique(this.log.found,this.nearest.name)){
        g.hud.toast(this.nearest.jp+' · '+this.nearest.name,'info');this.refresh();this.save();
        if(this.log.found.length===8)this.complete('explorer');
      }
      const district=this.floor>=0?'Midnight Parkade · '+FLOOR_NAMES[this.floor]:this.road>=0?w.roads[this.road].name:'Service street';
      let detail=this.near<150?this.nearest.name:'';
      if(g.mode.id==='roam'){
        if(this.job==='gymkhana')detail='Drift gate '+Math.min(3,(this.dockIndex||0)+1)+'/3 · Shibaura Dock Arena';
        if(this.job==='basement'&&!this.log.complete.includes('basement')){
          detail=this.basementDeadline>this.clock?this.basementPoints+'/250 pts · '+Math.ceil(this.basementDeadline-this.clock)+' s':'Time expired · restart in Night guide';
        }
        if(this.job==='hunter'&&this.near<52&&[4,5,6].some(i=>this.nearest===this.sites[i])&&state.speed<2){
          if(unique(this.log.shops,this.nearest.name)){this.save();g.hud.toast('Workshop discovered','good');}
          if(this.log.shops.length===3)this.complete('hunter');
        }
      }
      if(g.mode.id==='roam')detail=this.streetEvents(state,loc)||detail;
      this.out.textContent=detail&&detail!==district?district+' · '+detail:district;
    }
    if(g.mode.id==='roam')this.driftSector(dt,state,drift);
    this.sound.update(dt,this.floor>=0?(this.floor===8?0:this.floor<2?.29:.16):p.y<-2?.34:0,this.log.station,this.nearest?.name);
    if(g.mode.id!=='roam'||drift.event!=='drift_end'||drift.lastDriftScore<35)return;
    if(this.job==='basement'&&this.floor===0&&this.clock<this.basementDeadline){
      this.basementPoints+=drift.lastDriftScore;
      if(this.basementPoints>=250)this.complete('basement');
    }
    if(this.job==='parkade'&&this.floor>=0&&this.floor<8&&unique(this.log.floors,this.floor)){
      g.hud.toast(FLOOR_NAMES[this.floor]+' mastered','good');this.refresh();this.save();
      if(this.log.floors.length===8)this.complete('parkade');
    }
    if(this.job==='rooftop'&&this.floor===8&&this.log.complete.includes('parkade'))this.complete('rooftop');
    if(this.job==='gymkhana'&&this.road===w.gymkhana.id&&Math.abs(this.loc.s-[45,120,195][this.dockIndex||0])<32){
      this.dockIndex=(this.dockIndex||0)+1;g.hud.toast('Dock sector '+this.dockIndex+'/3','good');
      if(this.dockIndex===3)this.complete('gymkhana');
    }
  }
  frameCamera(state){
    const camera=this.photoCamera,base=this.g.cameraRig.camera;
    camera.position.copy(base.position);camera.quaternion.copy(base.quaternion);
    camera.near=base.near;camera.far=base.far;camera.aspect=base.aspect;camera.fov=Number(this.lens.value);
    if(this.angle!=='Driving view'){
      const towerView=this.angle==='Tower skyline',offset=this.angle==='Rear quarter'?-5.8:this.angle==='Side tracking'?0:5.4;
      camera.position.copy(state.position).addScaledVector(state.forward,offset).addScaledVector(state.right,this.angle==='Side tracking'?5.2:2.8);
      camera.position.y+=this.angle==='Side tracking'?.96:1.25;
      this.photoTarget.copy(state.position);this.photoTarget.y+=.71;
      if(towerView){const t=this.g.world.tower;this.photoTarget.set(t.x,46,t.z);}
      camera.lookAt(this.photoTarget);
    }
    camera.updateProjectionMatrix();return camera;
  }
  previewCamera(state){
    return this.g.state==='running'&&this.g.mode.id==='roam'&&!this.body.hidden&&this.cameraTools.open&&state.speed<2?this.frameCamera(state):null;
  }
  photo(){
    const g=this.g,p=g.vehicle.getState();
    if(p.speed>2){g.hud.toast('Stop to frame a photograph','info');return;}
    const view=this.floor===8?'rooftop':this.road===2&&p.position.y>4&&Math.hypot(p.position.x-g.world.tower.x,p.position.z-g.world.tower.z)<700?'expressway':this.nearest===this.sites[2]&&this.near<130?'minato':null;
    const camera=this.frameCamera(p),renderer=g.renderer,prior=renderer.toneMappingExposure;
    renderer.toneMappingExposure=g.atmosphere.preset.exposure*Number(this.exposure.value);
    renderer.render(g.scene,camera);renderer.toneMappingExposure=prior;
    const link=document.createElement('a');link.download='Tokyo After Hours - '+(view||this.nearest?.name||'city')+'.jpg';link.href=g.canvas.toDataURL('image/jpeg',.94);link.click();
    if(this.near<100)unique(this.log.photos,this.nearest.name);
    if(view&&this.angle==='Tower skyline')unique(this.log.views,view);
    if(this.log.views.length===3)this.complete('tower');
    if(this.log.photos.length>=4)this.complete('photographer');
    this.save();this.refresh();
  }
  checkBounds(dt,state){
    if(this.road>=0&&this.loc.distance<34){this.outside=0;return}
    this.outside=(this.outside||0)+dt;
    if(this.outside>3){this.g.respawn();this.outside=0;}
  }
  recoveryPose(out){const r=this.lastRoad;return r&&this.g.mode.id==='roam'?this.g.world.roadSpawn(r.id,r.s,r.dir,out):null;}
  visibility(){
    const run=this.g.state==='running';
    this.panel.hidden=!run;this.panel.querySelector('.tn-open').hidden=this.g.mode?.id!=='roam';
    if(this.g.mode?.id!=='roam')this.body.hidden=true;
    if(!run&&this.wasRunning)this.sound.quiet();this.wasRunning=run;
  }
  dispose(){this.sound.dispose();this.rival?.dispose();this.panel.remove();this.styles.remove();}
}
