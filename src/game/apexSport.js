import {clamp} from '../core/math.js';

// The touring-car controls still pass through the game's regular tyre and
// suspension model. This session owns consumables and timed service only.
export class ApexService{
  constructor(pit,box,limit=60){
    this.pit=pit;this.box=box;this.limit=limit;this.fuel=64;this.tyres=1;this.brakes=1;
    this.elapsed=0;this.duration=0;this.phase='track';this.loc={};this.stops=0;
    this.tasks={fuel:true,tyres:true,repair:true};
  }
  sample(p){
    const l=this.loc;
    this.inLane=this.pit.locate(p.x,p.z,l,p.y) && !l.beyondEnd && l.distance<=this.pit.halfWidth[l.index]+.55 && Math.abs(l.y-p.y)<2.5 && l.s>77 && l.s<this.pit.length-74;
    return this.inLane;
  }
  controls(input,state){
    if(this.fuel<=0)input.throttle=0;
    input.brake*=.72+.28*this.brakes;
    if(this.phase==='service'){input.throttle=0;input.brake=1;input.boost=false;}
    else if(this.inLane && state.speedKmh>=this.limit-1){input.throttle=0;input.brake=Math.max(input.brake,clamp((state.speedKmh-this.limit)/7,0,.9));input.boost=false;}
  }
  update(dt,state){
    const metres=Math.max(0,state.speed*dt);
    this.fuel=Math.max(0,this.fuel-metres*(.00025+.00035*state.throttle));
    this.tyres=Math.max(.15,this.tyres-metres*(.0000025+.000016*Math.min(1,Math.abs(state.slipAngle))));
    this.brakes=Math.max(.15,this.brakes-metres*state.brake*.000011);
    if(!this.sample(state.position)){this.phase='track';this.elapsed=0;return;}
    const dx=state.position.x-this.box.x,dz=state.position.z-this.box.z;
    this.atBox=Math.hypot(dx,dz)<3.9;
    if(this.phase==='released' && this.atBox)return;
    if(this.phase==='service'){
      if(!this.atBox || state.speed>1){this.phase='lane';this.elapsed=0;return;}
      this.elapsed+=dt;
      if(this.elapsed<this.duration)return;
      if(this.plan.fuel)this.fuel=90;
      if(this.plan.tyres)this.tyres=1;
      if(this.plan.repair)this.brakes=1;
      this.phase='released';this.stops++;return this.plan;
    }
    this.phase=this.atBox && state.speed<.6?'ready':'lane';
  }
  start(tasks=this.tasks){if(this.phase!=='ready'||!Object.values(tasks).some(Boolean))return false;
    this.plan={...tasks};this.duration=1.6+Math.max(tasks.fuel?(90-this.fuel)*.12:0,tasks.tyres?5.2:0,tasks.repair?4:0);
    this.elapsed=0;this.phase='service';return true;}
}
export function boxFor(world,index){
  const f=world.apex.main.frameAt(0,{}),u=-156+8*index;
  return {x:f.x+u*f.tx+22*f.rx,y:f.y,z:f.z+u*f.tz+22*f.rz};
}

