// All cues are synthesized locally and pass through the game's master limiter.
const pitches={church:[196,491,807],rail:[220,277,330],wharf:[62,93],mine:[347,331],
  hospital:[911,893],garage:[100,150],fuel:[101,203],factory:[110,457,733],
  static:[1170,1530],scare:[127,1967,1051],tunnel:[215,430],step:[85,73],crow:[734,498],drip:[1240,2080],creak:[285,391],
  bats:[2100,2950,3700],cave:[46,69],bell:[196,392]};
export class HollowSound {
  constructor(engine,settings){
    this.engine=engine;this.settings=settings;this.nodes=[];this.phase=0;this.due=6;
    this.batDue=11;this.caveDue=4;this.bellDue=42;this.insideCave=false;
  }
  open(){
    const e=this.engine;if(this.bus || !e._canPlay())return;
    const c=e.ctx;
    const gain=(value,dest)=>{const n=c.createGain();n.gain.value=value;n.connect(dest);this.nodes.push(n);return n;};
    this.bus=gain(0,e._g.envBus);this.wind=gain(0,this.bus);this.pad=gain(0,this.bus);
    this.pan=c.createStereoPanner();this.pan.connect(this.bus);this.nodes.push(this.pan);
    const filter=c.createBiquadFilter();filter.type='bandpass';filter.frequency.value=370;filter.Q.value=.5;filter.connect(this.wind);this.nodes.push(filter);
    const noise=c.createBufferSource();noise.buffer=e._g.noiseBuffer;noise.loop=true;noise.connect(filter);noise.start();this.nodes.push(noise);
    for(const freq of [48.9,49.37,73.4,116.3]){
      const osc=c.createOscillator();osc.frequency.value=freq;osc.connect(this.pad);osc.start();this.nodes.push(osc);
    }
  }
  quiet(){if(this.bus)this.bus.gain.setTargetAtTime(0,this.engine.ctx.currentTime,.065);}
  update(dt,nearest,distance,state){
    this.open();if(!this.bus)return;
    const now=this.engine.ctx.currentTime;
    this.phase+=dt;this.due-=dt;
    this.engine._bed(this.bus.gain,1,.22,now);
    const breath=.55+.45*Math.sin(this.phase*.07);
    this.wind.gain.setTargetAtTime((.055+.09*breath)*this.settings.ambience,now,1);
    this.pad.gain.setTargetAtTime((.007+.009*breath)*this.settings.music,now,1.3);
    if(this.due<=0){
      this.due=8+Math.random()*14;
      const nearby=distance<160;
      const pan=nearby?((nearest.x-state.position.x)*state.right.x+(nearest.z-state.position.z)*state.right.z)/Math.max(1,distance):Math.sin(this.phase);
      const cue=nearby?(Math.random()<.73?nearest.id:nearest.id==='mine'||nearest.id==='hospital'?'drip':'creak'):
        Math.random()<.5?'crow':'step';
      this.play(cue,nearby?1/(1+distance/48):.25,pan);
    }
    // Bats chatter over the whole valley after dark. The cave adds its own
    // close drips and wood groans.
    this.batDue-=dt;
    if(this.batDue<=0){
      this.batDue=10+Math.random()*17;
      this.play('bats',.19,Math.random()*2-1);
    }
    this.bellDue-=dt;
    if(this.bellDue<=0){
      this.bellDue=78+Math.random()*90;
      this.play('bell',.17,Math.sin(this.phase)*.7);
    }
    this.caveDue-=dt;
    if(this.insideCave&&this.caveDue<=0){
      this.caveDue=3.5+Math.random()*6;
      this.play(Math.random()<.62?'drip':'creak',.32,(Math.random()-.5)*1.4);
    }
  }
  play(key,gain=1,pan=0,delay=0){
    this.open();const e=this.engine;if(!this.bus || !e._canPlay())return;
    const loud=gain*(key==='scare'?this.settings.scares:this.settings.effects);
    if(loud<=0)return;
    const target=this.pan, now=e.ctx.currentTime;
    target.pan.setTargetAtTime(Math.max(-1,Math.min(1,pan)),now,.06);
    const list=pitches[key]||pitches.step, sudden=key==='scare'||key==='factory';
    for(let i=0;i<list.length;i++){
      const freq=list[i]*(.992+.016*Math.random());
      const bat=key==='bats', bell=key==='bell';
      e._tone({freq,freqEnd:bat?freq*.52:bell?freq*.997:key==='crow'?freq*.65:key==='scare'?freq*.52:key==='drip'?freq*1.45:key==='creak'?freq*.74:freq*.988,
        type:['rail','wharf','crow','bell'].includes(key)?'triangle':'sine',
        dur:bat?.15:bell?4.4:sudden?.48:key==='drip'?.13:key==='static'?.18:1.8,
        vol:(bat?.055:bell?.045:.09)*loud/(i+1),
        attack:bat?.003:bell?.008:sudden?.008:key==='church'?.014:.08,
        when:delay+(bat?i*.05:bell?i*.018:key==='static'?i*.32:i*.06),target});
    }
    if(['static','scare','tunnel','step','bats'].includes(key)){
      for(let i=0;i<(key==='tunnel'?4:2);i++)e._noise({dur:key==='step'?.12:key==='bats'?.075:.35,
        filter:key==='bats'?'bandpass':'bandpass',freq:key==='step'?230:key==='bats'?4300:1800,
        freqEnd:key==='bats'?2400:370,vol:(key==='bats'?.1:.19)*loud/(i+1),when:delay+i*(key==='bats'?.07:.19),target});
    }
  }
  thunder(delay=0,gain=1,muffle=false){
    this.open();const e=this.engine;if(!this.bus || !e._canPlay())return;
    const loud=gain*this.settings.effects;if(loud<=0)return;
    const target=this.pan;
    e._noise({dur:muffle?1.9:2.9,filter:'lowpass',freq:muffle?150:95,freqEnd:muffle?60:34,q:.6,
      vol:.55*loud,attack:.02,when:delay,target});
    e._tone({freq:muffle?52:40,freqEnd:20,dur:2.5,type:'sine',vol:.24*loud,attack:.04,when:delay+.03,target});
    if(!muffle&&gain>.55)e._noise({dur:.32,filter:'highpass',freq:1800,freqEnd:700,vol:.14*loud,attack:.002,when:delay,target});
  }
  dispose(){for(const n of this.nodes){n.stop?.();n.disconnect();}this.nodes=[];}
}
