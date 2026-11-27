import { hollowMissions,HollowJournal } from './hollowMissions.js';
import { HollowEncounters } from './HollowEncounters.js';
import { HollowSound } from '../audio/HollowSound.js';
import { HollowRadio } from '../ui/HollowRadio.js';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export class HollowAdventure {
  constructor(game){
    this.game=game;this.sites=Object.values(game.world.sites);
    let storage;try{storage=globalThis.localStorage;}catch{}
    this.journal=new HollowJournal(storage);this.missions=hollowMissions(game.world);
    this.sound=new HollowSound(game.audio,this.journal.settings);
    this.events=new HollowEncounters(game,this.sound,this.journal);
    this.radio=new HollowRadio(game.root,this.missions,this.journal,id=>this.accept(id),()=>this.takePhoto());
    this.roadLocation={};this.lastRoad=null;this.offMapTime=0;this.boundsCheck=0;
    this.refreshMap();this.clock=0;this.nextRead=0;this.saveAt=0;
  }
  takePhoto(){
    const g=this.game;g.renderer.render(g.scene,g.cameraRig.camera);
    g.canvas.toBlob(blob=>{
      if(!blob)return;
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='Hollow Creek - '+new Date().toISOString().replace(/[:.]/g,'-')+'.png';
      link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
    },'image/png');
  }
  get active(){return this.journal.active;}
  get def(){return this.active && this.missions.find(m=>m.id===this.active.id);}
  accept(id){
    const def=this.missions.find(m=>m.id===id);if(!def)return;
    this.readTime=0;this.events.clear();this.journal.active={id,index:0,points:0,elapsed:0};this.journal.save();
    if(def.race){
      this.dispatched=true;this.game.beginRun(def.race);
      if(id==='ghost'&&!this.game.meta.ghost)this.game.hud.toast('Record a baseline lap, then return to race its ghost.','info');
    }else this.game.hud.toast(def.instruction,'info');
  }
  runStart(mode){
    this.lastRoad=null;this.offMapTime=0;this.boundsCheck=0;
    this.events.clear();this.sound.quiet();this.nextRead=0;
    this.game.world.mineOpen=this.game.scenery.exitKnown=mode==='roam' && this.journal.exitKnown;
    // A timed dispatch may only finish the race started from the radio.
    this.racing=this.def?.race===mode && this.dispatched===true;
    this.dispatched=false;
  }
  finishRace(){
    if(!this.racing)return;
    if(this.def?.id==='ghost'&&!this.game.meta.ghost){this.notice('Baseline recorded. Accept Ghost Circuit again to race it.');return;}
    this.complete();
  }
  notice(message){this.journal.active=null;this.racing=false;this.journal.save();this.radio.refresh();this.game.refreshMapQuests?.();this.game.hud.toast(message,'info');}
  complete(){
    const def=this.def;if(!def)return;
    const first=!this.journal.completed.has(def.id);this.journal.completed.add(def.id);
    if(def.id==='route')this.journal.exitKnown=true;
    if(first){this.game.career.addXp(65,def.name);this.game.career.save();}
    this.notice(def.name+' complete'+(first?' · 65 XP':''));
  }
  questsSummary(){
    return {
      title:'Hollow Creek Dispatches',
      eyebrow:'GARAGE RADIO LOGBOOK',
      summary:`${this.journal.found.size}/8 sites · ${this.journal.completed.size}/${this.missions.length} completed`,
      items:this.missions.map((m)=>({
        id:m.id,
        title:m.name,
        detail:m.instruction,
        done:this.journal.completed.has(m.id),
        active:this.journal.active?.id===m.id,
        locked:false,
      })),
    };
  }
  launchQuest(id){
    const def=this.missions.find((m)=>m.id===id);
    if(!def)return;
    if(!def.race&&(this.game.state!=='running'||this.game.mode?.id!=='roam')){
      this.game.beginRun('roam');
    }
    this.accept(id);
    this.game.refreshMapQuests?.();
  }
  refreshMap(){
    const map=this.game.world.getMapData();
    map.labels.push(...this.game.world.landmarkLabels.filter(p=>this.journal.found.has(p.id)));
    this.game.hud.setTrack(map);
  }
  discover(site){
    this.journal.found.add(site.id);this.journal.save();
    if(site.id==='fuel')this.game.career.unlockAchievement('hollow-pumps');
    if(this.journal.found.size===8)this.game.career.unlockAchievement('hollow-cartographer');
    this.game.career.save();this.radio.refresh();this.game.refreshMapQuests?.();this.game.hud.toast(site.name+' · '+site.story,'info');
    this.refreshMap();this.sound.play(site.id,.6);
  }
  goal(def,pos){
    if(def.anyOrder)return def.goals.filter(s=>!this.journal.found.has(s.id)).sort((a,b)=>distance(a,pos)-distance(b,pos))[0];
    return def.goals[this.active.index];
  }
  advance(def,goal){
    this.active.index++;this.active.points=0;this.readTime=0;
    if(goal.clue)this.game.hud.toast(goal.clue,'info');
    this.sound.play(def.id==='transmission'||def.id==='driver'?'static':goal.id,.65);
    if(this.active.index>=def.goals.length)this.complete();
    else this.journal.save();
  }
  update(dt,state,drift){
    const g=this.game,roam=g.mode.id==='roam',pos=state.position;
    this.clock+=dt;g.scenery.weatherStrength=this.journal.settings.weather;
    let nearest=this.sites[0],near=Infinity;
    for(const s of this.sites){const d=distance(s,pos);if(d<near){near=d;nearest=s;}}
    this.sound.update(dt,nearest,near,state);
    const def=this.def;
    const mist=this.racing && def?.id==='mist' ? Math.min(1,(g.session.nextGate||0)/Math.max(1,g.session.cpCount)) : 0;
    const base=g.atmosphere.isNight?.0095:.0074;
    const target=base+.0009*Math.sin(this.clock*.047)+.0025*Math.max(0,1-near/110)+.008*mist;
    g.atmosphere.fog.density+=(target-g.atmosphere.fog.density)*(1-Math.exp(-dt*.65));
    if(!roam)return;
    const result=this.events.update(dt,state,def);
    if(near<(nearest.id==='factory'?22:16)&&!this.journal.found.has(nearest.id))this.discover(nearest);
    if(!def||def.race){this.radio.nav.textContent='';return;}
    const a=this.active,goal=this.goal(def,pos);
    if(def.anyOrder&&!goal){this.complete();return;}
    if(def.id==='pursuit'&&a.chasing){
      if(!this.events.path&&!result){a.chasing=false;this.journal.save();return;}
      if(result==='arrived'){this.complete();return;}
      if(result==='lost'){a.chasing=false;this.journal.save();g.hud.toast('Signal lost. Return to the turnoff.','warn');}
      else {this.nav(this.events.pos,'Phantom tail lights',state);return;}
    }
    if(!goal)return;
    if(def.limit && a.index>0){
      a.elapsed+=dt;
      if(a.elapsed>=def.limit){this.notice('Delivery window closed. Dispatch has another parcel.');return;}
      if(this.clock>=this.saveAt){this.saveAt=this.clock+2;this.journal.save();}
    }
    this.nav(goal,goal.name,state,def.score?' · '+a.points+'/'+def.score+' pts':def.limit&&a.index?' · '+Math.ceil(def.limit-a.elapsed)+' s':'');
    if(distance(goal,pos)>goal.radius || def.anyOrder){this.readTime=0;return;}
    if(def.hold){
      this.readTime=state.speed<1.5 ? (this.readTime||0)+dt : 0;
      const remaining=Math.max(0,Math.ceil(def.hold-this.readTime));
      const prompt=state.speed<1.5?'Reading log · '+remaining+' s':'Stop beside '+goal.name;
      if(this.radio.nav.textContent!==prompt)this.radio.nav.textContent=prompt;
      if(this.readTime<def.hold)return;
    }
    if(def.score){
      if(drift.event!=='drift_end')return;
      a.points+=drift.lastDriftScore;this.journal.save();if(a.points<def.score)return;
    }
    if(def.id==='pursuit'){if(!a.chasing){this.events.guide(def.pursuitPath,true);a.chasing=true;this.journal.save();}return;}
    this.advance(def,goal);
  }
  nav(goal,label,state,extra=''){
    if(this.clock<this.nextRead)return;this.nextRead=this.clock+.22;
    const dx=goal.x-state.position.x,dz=goal.z-state.position.z;
    const angle=Math.atan2(dx*state.right.x+dz*state.right.z,dx*state.forward.x+dz*state.forward.z);
    const arrow=['↑','↗','→','↘','↓','↙','←','↖'][(Math.round(angle/(Math.PI/4))+8)%8];
    this.radio.nav.textContent=arrow+' '+label+' · '+Math.round(Math.hypot(dx,dz))+' m'+extra;
  }
  checkBounds(dt,state){
    this.boundsCheck+=dt;
    if(this.boundsCheck<.24)return;
    const elapsed=this.boundsCheck;this.boundsCheck=0;
    const p=state.position,w=this.game.world;
    const loc=w.locate(p.x,p.z,this.roadLocation);
    if(loc.roadId>=0 && !loc.beyondEnd && loc.distance<loc.halfWidth-.3 && state.wheelsOnGround>=2){
      const direction=state.forward.x*loc.tx+state.forward.z*loc.tz>=0?1:-1;
      this.lastRoad={id:loc.roadId,s:loc.s,direction};
    }
    const inside=loc.roadId>=0 && loc.distance<=36 ||
      this.sites.some(site=>distance(site,p)<48) || w.depots.some(d=>distance(d,p)<48);
    if(inside){this.offMapTime=0;return;}
    this.offMapTime+=elapsed;
    if(this.offMapTime>=4){
      this.offMapTime=0;
      this.game.respawn();
      this.game.hud.toast('Beyond the town boundary · back on the road','info');
    }
  }
  recoveryPose(out){
    if(!this.lastRoad || this.game.mode.id!=='roam')return null;
    const {id,s,direction}=this.lastRoad;
    return this.game.world.roadSpawn(id,s,direction,out);
  }
  visibility(){
    const g=this.game,run=g.state==='running';
    this.radio.panel.hidden=!(run&&g.mode.id==='roam');
    if(!run && this.wasRunning){this.journal.save();}
    this.wasRunning=run;
    if(!run)this.sound.quiet();
  }
  dispose(){this.journal.save();this.events.dispose();this.radio.dispose();this.sound.dispose();}
}
