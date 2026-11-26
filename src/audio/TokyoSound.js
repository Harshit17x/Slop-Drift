// Original pentatonic phrases. The city, radio and tunnel returns share the game's mute/volume path.
const STATIONS = {
  'Neon FM': [146.83,.27,'triangle',[0,7,10,14,12,7,3,5]],
  'Tokyo Pulse': [110,.19,'triangle',[0,0,7,12,3,7,10,5]],
  'Midnight 86': [164.81,.33,'square',[0,3,5,7,10,7,5,3]],
  'After Hours': [130.81,.52,'sine',[0,7,12,14,10,7,5,3]],
};
export const stations=Object.keys(STATIONS);
export class TokyoSound{
  constructor(engine){this.engine=engine;this.beat=0;this.clock=0;this.ambient=0;}
  setup(){
    const e=this.engine;
    if(this.send||!e._g||!e.ctx)return;
    const c=e.ctx;
    this.send=c.createGain();this.send.gain.value=0;
    this.delay=c.createDelay();this.delay.delayTime.value=.146;
    this.filter=c.createBiquadFilter();this.filter.frequency.value=1850;
    e._g.engineBus.connect(this.delay);e._g.tireBus.connect(this.delay);
    this.delay.connect(this.filter);this.filter.connect(this.send);this.send.connect(e._g.envBus);
  }
  update(dt,room,station,district){
    this.setup();const e=this.engine;
    if(!this.send||e.muted||e.ctx.state!=='running')return;
    this.send.gain.setTargetAtTime(room,e.ctx.currentTime,.15);
    this.clock-=dt;this.ambient-=dt;
    if(this.ambient<=0){
      this.ambient=3.8;
      if(district==='Tokyo Bay')e._tone({freq:69,freqEnd:61,dur:1.6,vol:.035,type:'sine',target:e._g.envBus});
      else if(district==='Akihabara Electric Town')e._tone({freq:784,freqEnd:988,dur:.17,vol:.017,target:e._g.envBus});
      else e._noise({dur:1.4,vol:.018,freq:room?470:940,target:e._g.envBus});
    }
    if(this.clock>0||!STATIONS[station])return;
    const [base,interval,wave,melody]=STATIONS[station];
    this.clock=interval;const beat=this.beat++,n=melody[beat%melody.length];
    e._tone({freq:base*2**(n/12),dur:interval*.9,type:wave,vol:wave==='square'?.012:.047,target:e._g.envBus});
    if(beat%4===0)e._tone({freq:base*.5,freqEnd:base*.47,dur:interval*2.5,type:'sine',vol:.09,target:e._g.envBus});
    if(beat%2===1)e._noise({dur:.06,vol:.014,freq:4500,target:e._g.envBus});
  }
  quiet(){if(this.send)this.send.gain.setTargetAtTime(0,this.engine.ctx.currentTime,.07);}
  dispose(){
    if(!this.delay)return;
    const g=this.engine._g;g?.engineBus.disconnect(this.delay);g?.tireBus.disconnect(this.delay);
    for(const node of [this.delay,this.filter,this.send])node.disconnect();
  }
}
