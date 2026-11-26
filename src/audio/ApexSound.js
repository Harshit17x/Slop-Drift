export class ApexSound{
  constructor(audio){this.audio=audio;this.nodes=[];}
  build(){
    const audio=this.audio,ctx=audio.ctx,graph=audio._g;
    if(!ctx||!graph)return false;
    const filter=(type,freq,q)=>{const n=ctx.createBiquadFilter();n.type=type;n.frequency.value=freq;n.Q.value=q;return n;};
    const bed=(src,f)=>{
      const gain=ctx.createGain();gain.gain.value=0;src.connect(f).connect(gain).connect(graph.envBus);src.start();this.nodes.push(src,f,gain);return gain;
    };
    const noise=()=>{const n=ctx.createBufferSource();n.buffer=graph.noiseBuffer;n.loop=true;return n;};
    this.rain=bed(noise(),filter('highpass',4200,.4));this.stands=bed(noise(),filter('bandpass',820,.6));
    this.air=bed(noise(),filter('lowpass',460,.6));this.tool=bed(noise(),filter('bandpass',1800,4));
    this.traffic=ctx.createOscillator();this.traffic.type='sawtooth';this.motor=bed(this.traffic,filter('lowpass',620,.5));
    this.delay=ctx.createDelay(.25);this.delay.delayTime.value=.087;
    this.echo=ctx.createGain();this.echo.gain.value=0;graph.engineBus.connect(this.delay).connect(this.echo).connect(graph.envBus);this.nodes.push(this.delay,this.echo);
    return true;
  }
  update(g,service,bots){
    if(!this.rain&&!this.build())return;
    const ctx=this.audio.ctx,now=ctx.currentTime,p=g.vehicle.getState().position,m=g.world.apex.main,f=m.frameAt(0,{}),u=m.frameAt(g.world.apex.under,{});
    const dist=Math.hypot(p.x-f.x,p.z-f.z),under=Math.hypot(p.x-u.x,p.z-u.z)<25 && Math.abs(p.y-u.y)<3;
    const fade=(node,value)=>node.gain.setTargetAtTime(value,now,.22);
    fade(this.rain,(g.world.apex.wetness||0)*.075);
    fade(this.stands,.05*Math.max(0,1-dist/300)*g.scenery.standsDensity*(.78+.22*Math.sin(now*1.7)));
    fade(this.air,.028*(.7+.3*Math.sin(now*.4)));
    fade(this.echo,under?.24:dist<170?.07:0);
    fade(this.tool,service.phase==='service'&&Math.sin(service.elapsed*8)>.3?.10:0);
    let nearest=Infinity,botSpeed=0;
    for(const b of bots){const d=b.car.position.distanceTo(p);if(d<nearest){nearest=d;botSpeed=b.speed;}}
    this.traffic.frequency.setTargetAtTime(48+botSpeed*2.3,now,.16);fade(this.motor,.045*Math.max(0,1-nearest/110)**2);
  }
  quiet(){if(!this.rain)return;for(const g of [this.rain,this.stands,this.air,this.echo,this.tool,this.motor])g.gain.setTargetAtTime(0,this.audio.ctx.currentTime,.06);}
  dispose(){if(this.delay)this.audio._g?.engineBus.disconnect(this.delay);for(const n of this.nodes){if(n.stop)n.stop();n.disconnect();}this.nodes=[];}
}

