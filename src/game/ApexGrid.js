import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {boxFor} from './apexSport.js';
import {capUnderFlag} from './apexControl.js';
import {clamp} from '../core/math.js';

const paints=[0xc8432e,0x3a6277,0xe2bc68,0x557963,0xcac5b6,0x80506c,0x587998,0xe58555];
const teams=['Kestrel Racing','Northline GT','Solstice Corse','Vale Motorsport','Carrick Works','Alba Engineering','Meridian GT'];
function doorPlate(index){
  const canvas=document.createElement('canvas');canvas.width=192;canvas.height=104;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#eeeee4';ctx.fillRect(0,0,192,104);
  ctx.fillStyle='#171e22';ctx.fillRect(0,0,192,21);ctx.fillStyle='#f8ede2';ctx.font='bold 16px Arial';ctx.textAlign='center';
  ctx.fillText(teams[index].toUpperCase(),96,16,182);ctx.fillStyle='#172027';ctx.font='bold italic 78px Arial';ctx.fillText(String(index+11),79,91);
  ctx.fillStyle='#b94d2f';ctx.fillRect(151,22,41,82);ctx.fillStyle='white';ctx.font='bold 19px Arial';ctx.fillText('GT',172,70);
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
  return new T.MeshStandardMaterial({map:texture,roughness:.61,side:T.DoubleSide});
}
const matrix=new T.Matrix4(),right=new T.Vector3(),up=new T.Vector3(),back=new T.Vector3();
export class ApexGrid{
  constructor(game){this.game=game;this.field=[];this.plates=[];
    const positions=[],uv=[],indices=[];
    for(const side of [-1,1]){
      const first=positions.length/3;
      for(const [u,v] of [[0,0],[1,0],[1,1],[0,1]]){
        positions.push(side*.987,.298+v*.30,-side*(u-.5)*.63);
        uv.push(u,v);
      }
      indices.push(first,first+1,first+2,first,first+2,first+3);
    }
    this.plateGeometry=new T.BufferGeometry();this.plateGeometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));this.plateGeometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));this.plateGeometry.setIndex(indices);this.plateGeometry.computeVertexNormals();
    const loader=new GLTFLoader();this.lenses=[];
    this.ready=Promise.all([new URL('../assets/maps/apex-grid-gt.glb',import.meta.url),new URL('../assets/maps/apex-grid-distant.glb',import.meta.url)].map(url=>loader.loadAsync(url.href))).then(([near,far])=>{
      this.template=new T.LOD();this.template.addLevel(near.scene,0);this.template.addLevel(far.scene,52,.14);
      this.template.traverse(n=>{if(n.isMesh && n.material.name==='Headlamp')this.lenses.push(n.material);});
    });
  }
  start(count,pace,order){
    this.order=order || [...Array(count).keys(),-1];
    this.clock=0;
    const g=this.game;this.clear();this.route=g.session.route;this.road=g.world.roads[this.route.roadId];this.pace=pace;
    // Local opponents use the same surveyed line and banking as the player.
    for(let i=0;i<count;i++){
      const car=this.template.clone(true);car.name='APEX entrant '+(i+1);
      car.traverse(n=>{if(n.isMesh && n.material.name==='Team enamel'){n.material=n.material.clone();n.material.color.setHex(paints[i]);n.userData.teamPaint=true;}});g.scene.add(car);
      this.plates[i]??=doorPlate(i);car.add(new T.Mesh(this.plateGeometry,this.plates[i]));
      const slot=this.order.indexOf(i);
      const bot={car,index:i,team:teams[i],d:-12-slot*4,speed:0,lane:(slot%2?1:-1)*3,wait:0,pitted:false,done:false,lapStarted:null,bestLap:null};
      const stall=boxFor(g.world,(g.apexMeeting.boxIndex+i+1)%40),where={};
      g.world.apex.pit.locate(stall.x,stall.z,where,stall.y);
      bot.stall=where.s;bot.stallOffset=where.lateral;this.field.push(bot);this.pose(bot);
    }
  }
  pose(bot){
    const road=bot.inPit?this.game.world.apex.pit:this.road;
    const s=bot.inPit?bot.pitS:this.route.startS+bot.d;
    const f=road.frameAt(s,{}),d=bot.inPit?bot.stallOffset*clamp(1-Math.abs(bot.pitS-bot.stall)/26,0,1):bot.lane;
    bot.car.position.set(f.x+d*f.rx,f.y+d*f.ry+.025,f.z+d*f.rz);
    up.set(f.nx,f.ny,f.nz);
    if(road.id>=this.game.world.physicalRoads.length){
      const p=bot.car.position,surface=this.game.world.sampleGround(p.x,p.z,bot.contactSurface??={},p.y+.6);
      p.y=surface.y+.025;up.set(surface.nx,surface.ny,surface.nz);
    }
    up.normalize();back.set(-f.tx,-f.ty,-f.tz);right.crossVectors(up,back).normalize();back.crossVectors(right,up).normalize();
    matrix.makeBasis(right,up,back);bot.car.quaternion.setFromRotationMatrix(matrix);
  }
  update(dt,playerD,flag='GREEN'){
    this.clock+=dt;
    for(const m of this.lenses)m.emissiveIntensity=this.game.atmosphere.isNight?2.8:.18;
    const {road,route,game}=this,park=game.world.apex,pit=park.pit;
    for(const bot of this.field){
      if(bot.done)continue;
      if(bot.inPit){
        const stall=bot.stall;
        if(flag==='RED'){bot.speed=0;}
        else if(bot.pitS>=stall && bot.wait<6){bot.speed=0;bot.wait+=dt;}
        else{bot.speed=Math.min(game.apexMeeting.service.limit/3.6,bot.speed+3*dt);bot.pitS+=bot.speed*dt;}
        bot.d=bot.entryD+Math.min(route.pitPath.span,bot.pitS/pit.length*route.pitPath.span);
        if(bot.pitS>=pit.length){bot.inPit=false;bot.pitted=true;}
      }else{
        const s=route.startS+bot.d, f=road.frameAt(s,{});
        let curve=Math.abs(f.curvature);
        for(let j=12;j<32+bot.speed*1.5;j+=14)curve=Math.max(curve,Math.abs(road.frameAt(s+j,{}).curvature));
        const skill=this.pace*(.94+bot.index*.014),wet=1-.25*(park.wetness||0);
        let target=Math.min(54,Math.sqrt(8.2/Math.max(.0003,curve)))*skill*wet;
        const groove=clamp(f.curvature*33,-.5,.5)*f.halfWidth;
        const variation=(bot.index%3-1)*.45;
        let lane=groove+variation;
        if(park.wetness>.18) lane+=((bot.index%2?1:-1)*2.1-groove*.75)*park.wetness;
        if(bot.d<25)lane=bot.lane;
        target=Math.min(target,capUnderFlag(flag));
        if(flag==='YELLOW' && Math.abs(bot.d-playerD)<95)target=Math.min(target,17);
        const ahead=this.field.find(o=>o!==bot&&!o.inPit&&o.d>bot.d&&o.d-bot.d<13);
        if(ahead){lane=ahead.lane>=0?-2.7:2.7;if(ahead.d-bot.d<6 && Math.abs(bot.lane-ahead.lane)<2.1)target=Math.min(target,ahead.speed);}
        const gap=((playerD-bot.d+road.length*1.5)%road.length)-road.length*.5;
        if(gap>0 && gap<18){
          lane=game.session._loc.lateral>0?-2.8:2.8;
          if(gap<8 && Math.abs(bot.lane-game.session._loc.lateral)<2.4)target=Math.min(target,game.vehicle.getState().speed);
        }
        lane=clamp(lane,-f.halfWidth+1.45,f.halfWidth-1.45);
        bot.lane+=clamp(lane-bot.lane,-dt*2,dt*2);
        bot.speed+=clamp(target-bot.speed,-8*dt,4.7*dt);
        const previous=bot.d;bot.d+=dt*bot.speed;
        const entry=route.pitPath?.entry;
        if(entry!=null && game.mode.laps>1 && !bot.pitted && previous<entry && bot.d>=entry){
          bot.inPit=true;bot.pitS=0;bot.entryD=entry;
        }

      }
      const lap=Math.floor(bot.d/road.length);
      if(lap>=0 && lap!==(bot.lap??-1)){
        if(bot.lapStarted!=null){const time=this.clock-bot.lapStarted;bot.bestLap=Math.min(bot.bestLap??Infinity,time);}
        bot.lapStarted=lap===0?0:this.clock;bot.lap=lap;
      }
      if(game.mode.laps>0 && bot.d>=road.length*game.mode.laps){
        bot.done=true;bot.finishTime=this.clock;bot.d=road.length*game.mode.laps;
      }
      this.pose(bot);
      const p=game.vehicle.getState().position;
      bot.car.visible=!bot.done && bot.car.position.distanceToSquared(p)<600**2;
    }
    return 1+this.field.filter(bot=>bot.done || bot.d>playerD).length;
  }
  contact(dt,state){
    const body=this.game.vehicle;
    for(const bot of this.field){
      if(bot.done || bot.inPit || Math.abs(state.position.y-bot.car.position.y)>1.8)continue;
      const dx=state.position.x-bot.car.position.x,dz=state.position.z-bot.car.position.z;
      if(dx*dx+dz*dz>24)continue;
      const f=this.road.frameAt(this.route.startS+bot.d,{});
      const x=dx*f.rx+dz*f.rz,z=dx*f.tx+dz*f.tz;
      const overlapX=1.88-Math.abs(x),overlapZ=4.15-Math.abs(z);
      if(overlapX<=0 || overlapZ<=0)continue;
      const side=overlapX<overlapZ,sign=Math.sign(side?x:z)||1;
      const nx=sign*(side?f.rx:f.tx),nz=sign*(side?f.rz:f.tz);
      const approach=(body.velocity.x-f.tx*bot.speed)*nx+(body.velocity.z-f.tz*bot.speed)*nz;
      const impulse=Math.max(0,-approach)*.56+Math.min(side?overlapX:overlapZ,.45)*dt*13;
      body.velocity.x+=nx*impulse;body.velocity.z+=nz*impulse;
      bot.speed=clamp(bot.speed-(nx*f.tx+nz*f.tz)*impulse,0,65);
      if(side)bot.lane=clamp(bot.lane-sign*dt*1.8,-f.halfWidth+1.2,f.halfWidth-1.2);
    }
  }
  dispose(){this.clear();this.plateGeometry.dispose();for(const m of this.plates){m.map.dispose();m.dispose();}const owned=new Set();this.template?.traverse(n=>{if(n.isMesh){owned.add(n.material);owned.add(n.geometry);}});for(const a of owned)a.dispose();}
  clear(){for(const {car} of this.field){car.removeFromParent();car.traverse(n=>{if(n.userData.teamPaint)n.material.dispose();});}this.field.length=0;}
}
