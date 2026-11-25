// All cues are synthesized locally and pass through the game's master limiter.
const pitches={church:[196,491,807],rail:[220,277,330],wharf:[62,93],mine:[347,331],
  hospital:[911,893],garage:[100,150],fuel:[101,203],factory:[110,457,733],
  static:[1170,1530],scare:[127,1967,1051],tunnel:[215,430],step:[85,73],crow:[734,498],drip:[1240,2080],creak:[285,391]};
export class HollowSound {
  constructor(engine,settings){this.engine=engine;this.settings=settings;this.nodes=[];this.phase=0;this.due=6;}
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
  }
  play(key,gain=1,pan=0){
    this.open();const e=this.engine;if(!this.bus || !e._canPlay())return;
    const loud=gain*(key==='scare'?this.settings.scares:this.settings.effects);
    if(loud<=0)return;
    const target=this.pan, now=e.ctx.currentTime;
    target.pan.setTargetAtTime(Math.max(-1,Math.min(1,pan)),now,.06);
    const list=pitches[key]||pitches.step, sudden=key==='scare'||key==='factory';
    for(let i=0;i<list.length;i++){
      const freq=list[i]*(.992+.016*Math.random());
      e._tone({freq,freqEnd:key==='crow'?freq*.65:key==='scare'?freq*.52:key==='drip'?freq*1.45:key==='creak'?freq*.74:freq*.988,
        type:['rail','wharf','crow'].includes(key)?'triangle':'sine',
        dur:sudden?.48:key==='drip'?.13:key==='static'?.18:1.8,vol:.09*loud/(i+1),
        attack:sudden?.008:key==='church'?.014:.08,when:key==='static'?i*.32:i*.06,target});
    }
    if(['static','scare','tunnel','step'].includes(key)){
      for(let i=0;i<(key==='tunnel'?4:2);i++)e._noise({dur:key==='step'?.12:.35,
        filter:'bandpass',freq:key==='step'?230:1800,freqEnd:370,vol:.19*loud/(i+1),when:i*.19,target});
    }
  }
  dispose(){for(const n of this.nodes){n.stop?.();n.disconnect();}this.nodes=[];}
}
