import * as T from 'three';

// A cone slalom and stopping exercise use the Academy's actual road frame.
export class ApexAcademy{
  constructor(game){
    this.game=game;this.group=new T.Group();game.scene.add(this.group);this.group.visible=false;
    const route=game.world.routes.academy;this.road=game.world.roads[route.roadId];
    this.gates=[35,53,71,89,107];
    const cone=new T.ConeGeometry(.23,.68,12),mat=new T.MeshStandardMaterial({color:0xe46523});
    this.cones=new T.InstancedMesh(cone,mat,this.gates.length+4);
    const xform=new T.Object3D();let n=0;
    const place=(s,d)=>{
      const f=this.road.frameAt(route.startS+s,{});
      xform.position.set(f.x+d*f.rx,f.y+d*f.ry+.34,f.z+d*f.rz);
      xform.updateMatrix();this.cones.setMatrixAt(n++,xform.matrix);
    };
    for(const s of this.gates)place(s,0);
    for(const s of [132,142])for(const d of [-2.2,2.2])place(s,d);
    this.group.add(this.cones);
  }
  start(enabled){this.group.visible=enabled;this.index=0;this.passed=0;this.last=-6;this.hold=0;this.done=false;}
  update(dt,session,state){
    if(!this.group.visible || this.done)return;
    const s=session._curD>session.roadLength-30?session._curD-session.roadLength:session._curD;
    const lane=session._loc.lateral;
    if(this.index<this.gates.length && s>=this.gates[this.index] && this.last<this.gates[this.index]){
      const side=this.index%2?-1:1,ok=session._loc.roadId===session.roadId && lane*side>.95 && state.speedKmh<62;
      this.passed+=Number(ok);this.index++;
      this.game.hud.toast(ok?'Gate cleared':'Gate missed',ok?'good':'warn');
    }
    if(this.index===this.gates.length && s>=132 && s<=142 && Math.abs(lane)<2.2 && state.speed<.35){
      this.hold+=dt;
      if(this.hold>=1){this.done=true;this.game.hud.toast('Braking box complete · '+this.passed+'/5 slalom gates','good');}
    }else this.hold=0;
    this.last=s;
  }
  get instruction(){
    if(this.done)return 'School complete · '+this.passed+'/5 gates';
    if(this.index===this.gates.length)return 'Stop between the four cones';
    return 'Gate '+(this.index+1)+'/5 · pass '+(this.index%2?'left':'right')+' below 62 km/h';
  }
  dispose(){this.group.removeFromParent();this.cones.geometry.dispose();this.cones.material.dispose();this.cones.dispose();}
}
