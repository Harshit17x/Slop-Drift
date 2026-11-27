// Executed in the browser by capture.mjs. Real animation-frame timestamps include
// presentation, simulation and GPU work without forcing a synchronous GPU finish.
export async function driveBenchmark(){
  const g=window.__SLOP_DRIFT__,meeting=g.apexMeeting,segments=[],tiers=[];
  const original=g.input.update,originalQuality=g.settings.quality;
  const raf=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  function percentile(values,p){
    return values[Math.min(values.length-1,Math.floor(values.length*p))];
  }
  try{
    for(const quality of ['Low','Medium','High','Ultra']){
      g.applySettings({...g.settings,quality},{save:false});
      g.scenery.update(g.cameraRig.camera.position,0,false);
      g.renderer.render(g.scene,g.cameraRig.camera);
      tiers.push({quality,trees:g.scenery.forestTiles.reduce((n,t)=>n+t.geometry.instanceCount,0),triangles:g.renderer.info.render.triangles});
    }
    g.applySettings({...g.settings,quality:'Medium'},{save:false});
    meeting.layout.value='loop';meeting.format.value='race';meeting.entries.value='3';
    for(const [section,s,weather] of [['Grid to pit exit',0,'clear'],['Summit Ascension',g.world.apex.stations[12],'light'],['Thunder Bowl',g.world.apex.stations[41],'clear'],['Summit · Low quality',g.world.apex.stations[12],'light']]){
      if(section.includes('Low quality'))g.applySettings({...g.settings,quality:'Low'},{save:false});
      meeting.weather.value=weather;meeting.startButton.click();g.updateCountdown(4);
      const road=g.world.apex.main,loc={},lead={},probe={};
      if(s){
        g.vehicle.teleport(g.world.getSpawn('loop',s));
        for(const bot of meeting.grid.field){bot.d=s+12+bot.index*8;meeting.grid.pose(bot);}
      }
      g.cameraRig.snap();
      g.input.update=function(){
        const input=original.call(this),st=g.vehicle.getState(),p=st.position;
        road.locate(p.x,p.z,loc,p.y);road.frameAt(loc.s+5+st.speed*.36,lead);
        const dx=lead.x-p.x,dz=lead.z-p.z;
        input.steer=Math.max(-1,Math.min(1,2.25*(st.right.x*dx+st.right.z*dz)/Math.max(2,st.forward.x*dx+st.forward.z*dz)));
        let k=.0001;for(let d=3;d<24+st.speed*1.5;d+=9)k=Math.max(k,Math.abs(road.frameAt(loc.s+d,probe).curvature));
        const target=Math.min(36,Math.sqrt(4.7/k));
        input.throttle=st.speed<target?.78:0;input.brake=st.speed>target+1?Math.min(.82,(st.speed-target)/6):0;
        return input;
      };
      let previous=await raf(),start=previous,measured=0;g.lastTime=previous;const samples=[];
      const begin=g.vehicle.getState().position.clone();
      while(measured<20000){
        const now=await raf();g.onFrame(now);cancelAnimationFrame(g.frameHandle);
        if(previous-start>=2000){samples.push(now-previous);measured+=now-previous;}previous=now;
      }
      const wall=samples.reduce((a,b)=>a+b,0);
      samples.sort((a,b)=>a-b);
      segments.push({section,quality:g.settings.quality,weather,renderWidth:g.canvas.width,renderHeight:g.canvas.height,frames:samples.length,wallSeconds:wall/1000,meanFps:1000*samples.length/wall,
        medianMs:percentile(samples,.5),p95Ms:percentile(samples,.95),displacement:begin.distanceTo(g.vehicle.getState().position)});
      if(segments.at(-1).displacement<20)throw Error('Drive benchmark car failed to move in '+section);
      g.input.update=original;g.enterMenu();
    }
    return {tiers,segments};
  }finally{
    g.input.update=original;g.applySettings({...g.settings,quality:originalQuality},{save:false});
  }
}
