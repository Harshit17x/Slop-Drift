import * as T from 'three';
import { GhostCar } from '../render/GhostCar.js';
import { createRandom } from '../world/noise.js';
import { anchor } from '../world/hollowSites.js';

const up=new T.Vector3(0,1,0);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export class HollowEncounters {
  constructor(game,sound,journal,seed=Date.now()){
    this.game=game;this.world=game.world;this.sound=sound;this.journal=journal;
    this.random=createRandom(seed);this.time=0;this.next=14;this.cool=new Map();
    this.watcher=new T.Group();this.ink=new T.MeshBasicMaterial({color:0x0b171c,transparent:true,opacity:.9});
    const body=new T.Mesh(new T.ConeGeometry(.38,1.65,9),this.ink);body.position.y=.85;
    const head=new T.Mesh(new T.SphereGeometry(.19,9,8),this.ink);head.position.y=1.82;
    this.watcher.add(body,head);game.scene.add(this.watcher);this.watcher.visible=false;
    this.phantom=new GhostCar({paintColor:0x9abbb9,name:'',wheelLayout:game.vehicle.wheelLayout});
    this.phantom.tag.sprite.visible=false;this.phantom.setVisible(false);game.scene.add(this.phantom.group);
    this.pos=new T.Vector3();this.rot=new T.Quaternion();this.frame={};this.loc={};this.visits=0;
  }
  clear(){
    this.watcher.visible=false;this.phantom.setVisible(false);this.path=null;this.insideCave=false;this.atMine=false;
    this.game.scenery.outage=0;this.game.scenery.townBlackout=false;
  }
  trigger(key,chance,seconds,action){
    if(this.time<(this.cool.get(key)||0))return false;
    this.cool.set(key,this.time+seconds*(.8+.4*this.random()));
    if(this.random()>=chance)return false;
    action();return true;
  }
  guide(path,mission=false){
    this.path=path;this.leg=0;this.along=0;this.mission=mission;this.absent=0;
    this.phantom.setVisible(true);this.placeCar();
  }
  placeCar(){
    const [id,a,b]=this.path[this.leg],dir=Math.sign(b-a);
    const f=this.world.roads[id].frameAt(a+dir*this.along,this.frame);
    this.pos.set(f.x,f.y+.54,f.z);this.rot.setFromAxisAngle(up,Math.atan2(-dir*f.tx,-dir*f.tz));
    this.phantom.setPose(this.pos,this.rot,0,this.time);
  }
  follow(dt,state){
    if(!this.path)return;
    const gap=distance(state.position,this.pos);
    this.absent=gap>130?this.absent+dt:0;
    if(this.absent>17){this.path=null;this.phantom.setVisible(false);return 'lost';}
    const [,a,b]=this.path[this.leg];
    this.along+=dt*(gap<18?18:gap>58?4:12);
    if(this.along>=Math.abs(b-a)){
      if(this.leg===this.path.length-1){
        this.along=Math.abs(b-a);
        if(gap<30){this.path=null;this.phantom.setVisible(false);return 'arrived';}
      }else{this.leg++;this.along=0;}
    }
    this.placeCar();this.phantom.update(this.game.cameraRig.camera,state.position);
  }
  update(dt,state,def){
    this.time+=dt;
    const p=state.position,world=this.world,town=this.game.scenery;
    const loc=world.locate(p.x,p.z,this.loc);
    town.townBlackout=def?.id==='light';
    if(town.townBlackout)town.outage=15;
    if(this.watcher.visible){
      this.ink.opacity=Math.max(0,Math.min(.9,(distance(p,this.watcher.position)-12)/23,(this.watchEnd-this.time)/2));
      if(this.ink.opacity<=.01)this.watcher.visible=false;
    }
    const cave=world.cave;
    const inCave=cave&&loc.roadId===cave.roadId&&!loc.beyondEnd&&loc.distance<cave.shellHalf+2.5&&loc.s>cave.s0&&loc.s<cave.s1;
    if(inCave&&!this.insideCave){
      this.caveVisits=(this.caveVisits||0)+1;town.cavePhase=this.caveVisits;
    }
    this.insideCave=inCave;
    // The mine cutting forks off long before the cave. Reveal it on the mine
    // approach, where the driver can actually see the old service road.
    const approach=loc.roadId===2&&!loc.beyondEnd&&loc.distance<12&&loc.s>2360&&loc.s<2520;
    if(approach&&!this.atMine){
      this.visits++;
      const reveal=()=>{this.journal.exitKnown=true;this.journal.save();this.game.hud.toast('A green service lamp reveals the mine cutting on your right.','info');};
      if(!this.journal.exitKnown && (def?.id==='route'||this.visits>1 && this.random()<.28))reveal();
    }
    this.atMine=approach;
    town.exitKnown=this.journal.exitKnown||def?.id==='route';world.mineOpen=town.exitKnown;
    if(this.time>=this.next && state.speed>2 && loc.roadId>=0){
      this.next=this.time+11+this.random()*15;
      const rd=world.roads[loc.roadId],dir=(state.forward.x*loc.tx+state.forward.z*loc.tz)<0?-1:1;
      const rail=world.sites.rail;
      if(distance(p,rail)<130)this.trigger('train',.82,80,()=>{this.sound.play('rail');town.trainUntil=town.clock+5;});
      const keys=['watch','black','radio','driver','impact'];const key=keys[Math.floor(this.random()*keys.length)];
      this.trigger(key,.78,85,()=>{
        if(key==='watch'){
          const f=anchor(world,rd.id,loc.s+dir*56,rd.config.halfWidth+1.6);
          this.watcher.position.set(f.x,f.y,f.z);this.watcher.visible=true;this.watchEnd=this.time+14;
        }else if(key==='black' && loc.roadId!==2){
          town.outage=29;town.outageX=p.x;town.outageZ=p.z;this.sound.play('garage',.55);
        }else if(key==='radio'){
          const choices=Object.values(world.sites).filter(s=>!this.journal.found.has(s.id));
          const dest=choices[Math.floor(this.random()*choices.length)]||world.sites.mine;
          this.sound.play('static');this.game.hud.toast('… carrier 03:17 … '+dest.name+' … grid '+Math.round(dest.x)+' / '+Math.round(dest.z),'info');
        }else if(key==='driver'&&!this.path && def?.id!=='pursuit' && rd.closed){
          let best=null;
          for(const site of Object.values(world.sites)){
            if(site.roadId!==rd.id)continue;
            const dist=((dir*(site.s-loc.s))%rd.length+rd.length)%rd.length;
            if(dist>85&&(!best||dist<best.dist))best={dist,site};
          }
          if(best){this.wildDestination=best.site;this.guide([[rd.id,loc.s+dir*48,loc.s+dir*best.dist]]);}
        }else if(key==='impact')this.sound.play('scare',.68,this.random()<.5?-.7:.7);
      });
    }
    const result=this.follow(dt,state);
    if(result==='arrived'&&!this.mission)this.game.hud.toast('The tail lights fade outside '+this.wildDestination.name+'.','info');
    return result;
  }
  dispose(){this.phantom.dispose();this.watcher.removeFromParent();this.watcher.children.forEach(o=>o.geometry.dispose());this.ink.dispose();}
}
