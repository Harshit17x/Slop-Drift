import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clamp} from '../core/math.js';

const paints=[0xc8432e,0x3a6277,0xe2bc68,0x557963,0xcac5b6,0x80506c,0x587998,0xe58555];
const matrix=new T.Matrix4(),right=new T.Vector3(),up=new T.Vector3(),back=new T.Vector3();
export class ApexGrid{
  constructor(game){this.game=game;this.field=[];this.ready=new GLTFLoader().loadAsync(new URL('../assets/maps/apex-grid-gt.glb',import.meta.url).href).then(gltf=>{this.template=gltf.scene;});}
  start(count,pace){
    const g=this.game;this.clear();this.route=g.session.route;this.road=g.world.roads[this.route.roadId];this.pace=pace;
    // Local opponents use the same surveyed line and banking as the player.
    for(let i=0;i<count;i++){
      const car=this.template.clone(true);car.name='APEX entrant '+(i+1);
      car.traverse(n=>{if(n.isMesh && n.material.name==='Team enamel'){n.material=n.material.clone();n.material.color.setHex(paints[i]);n.userData.teamPaint=true;}});g.scene.add(car);
      const bot={car,index:i,d:6+Math.floor(i/2)*9,speed:0,lane:(i%2?1:-1)*2.1,wait:0,pitted:false,done:false};
      this.field.push(bot);this.pose(bot);
    }
  }
  pose(bot){
    const road=bot.inPit?this.game.world.apex.pit:this.road;
    const s=bot.inPit?bot.pitS:this.route.startS+bot.d;
    const f=road.frameAt(s,{}),d=bot.inPit?0:bot.lane;
    bot.car.position.set(f.x+d*f.rx,f.y+d*f.ry+.025,f.z+d*f.rz);
    right.set(f.rx,f.ry,f.rz);up.set(f.nx,f.ny,f.nz).normalize();back.crossVectors(right,up).normalize();
    matrix.makeBasis(right,up,back);bot.car.quaternion.setFromRotationMatrix(matrix);
  }
  update(dt,playerD){
    const {road,route,game}=this,park=game.world.apex,pit=park.pit;
    for(const bot of this.field){
      if(bot.done)continue;
      if(bot.inPit){
        const stall=260+8*bot.index;
        if(bot.pitS>=stall && bot.wait<6){bot.speed=0;bot.wait+=dt;}
        else{bot.speed=Math.min(14,bot.speed+3*dt);bot.pitS+=bot.speed*dt;}
        bot.d=bot.entryD+Math.min(680,bot.pitS/pit.length*680);
        if(bot.pitS>=pit.length){bot.inPit=false;bot.pitted=true;}
      }else{
        const s=route.startS+bot.d, f=road.frameAt(s,{});
        let curve=Math.abs(f.curvature);
        for(let j=12;j<32+bot.speed*1.5;j+=14)curve=Math.max(curve,Math.abs(road.frameAt(s+j,{}).curvature));
        const skill=this.pace*(.94+bot.index*.014),wet=1-.25*(park.wetness||0);
        let target=Math.min(54,Math.sqrt(8.2/Math.max(.0003,curve)))*skill*wet;
        let lane=clamp(f.curvature*82,-1,1)*2;
        const ahead=this.field.find(o=>o!==bot&&!o.inPit&&o.d>bot.d&&o.d-bot.d<13);
        if(ahead){lane=ahead.lane>=0?-2.7:2.7;if(ahead.d-bot.d<6 && Math.abs(bot.lane-ahead.lane)<2.1)target=Math.min(target,ahead.speed);}
        if(playerD>bot.d && playerD-bot.d<14)lane=game.session._loc.lateral>0?-2.8:2.8;
        bot.lane+=clamp(lane-bot.lane,-dt*2,dt*2);
        bot.speed+=clamp(target-bot.speed,-8*dt,4.7*dt);
        const previous=bot.d;bot.d+=dt*bot.speed;
        const entry=road.length-360;
        if(road===park.main && game.mode.laps>1 && !bot.pitted && previous<entry && bot.d>=entry){
          bot.inPit=true;bot.pitS=0;bot.entryD=entry;
        }
        if(bot.d>=road.length*game.mode.laps){bot.done=true;bot.d=road.length*game.mode.laps;bot.car.visible=false;}
      }
      this.pose(bot);
      const p=game.vehicle.getState().position;
      bot.car.visible=!bot.done && bot.car.position.distanceToSquared(p)<600**2;
    }
    return 1+this.field.filter(bot=>bot.d>playerD).length;
  }
  dispose(){this.clear();const owned=new Set();this.template?.traverse(n=>{if(n.isMesh){owned.add(n.material);owned.add(n.geometry);}});for(const a of owned)a.dispose();}
  clear(){for(const {car} of this.field){car.removeFromParent();car.traverse(n=>{if(n.userData.teamPaint)n.material.dispose();});}this.field.length=0;}
}

