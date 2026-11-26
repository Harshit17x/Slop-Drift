import { spawn } from 'node:child_process';
import { mkdtemp,writeFile,mkdir,rm } from 'node:fs/promises';
import {driveBenchmark} from './drive-benchmark.mjs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// Capture the actual game renderer using a temporary, isolated Chromium profile.
const profile=await mkdtemp(path.join(tmpdir(),'apex-capture-'));
const chrome=process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const {createServer,preview}=await import('vite'),production=process.argv.includes('--production');
const server=production?await preview({preview:{host:'127.0.0.1',port:0},logLevel:'error'}):await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
if(!production)await server.listen();const url=server.resolvedUrls.local[0];
const child=spawn(chrome,['--headless=new','--no-first-run','--disable-extensions','--remote-debugging-pipe','--disable-background-timer-throttling','--disable-renderer-backgrounding','--window-size=1280,800','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe'],windowsHide:true});
const pending=new Map(),errors=[];let next=0,buffer='';
child.on('error',e=>console.error(e));child.on('exit',(c)=>{for(const fn of pending.values())fn.reject(new Error('Chromium exited '+c));});
child.stdio[4].on('data',data=>{buffer+=data;let n;while((n=buffer.indexOf('\0'))!==-1){const msg=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);
  if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);if(msg.error)p.reject(Error(msg.error.message));else p.resolve(msg.result);}
  else if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text);
  else if(msg.method==='Runtime.consoleAPICalled' && msg.params.type==='error')errors.push(msg.params.args.map(a=>a.value||a.description).join(' '));
}});
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});child.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0');});}
let session;
const call=(method,params)=>send(method,params,session);
async function ev(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function gridPhoto(){
  const lineup=await ev(`(()=>{const meet=g.apexMeeting;meet.layout.value='loop';meet.format.value='race';meet.time.value='day';meet.entries.value='3';meet.startButton.click();
    const bot=meet.grid.field[0],p=bot.car.position,road=g.world.apex.main,f=road.frameAt(-12,{}),c=g.cameraRig.camera;
    c.position.set(p.x+f.rx*5+f.tx*6,p.y+1.45,p.z+f.rz*5+f.tz*6);c.lookAt(p.x,p.y+.55,p.z);
    c.fov=44;c.updateProjectionMatrix();c.updateMatrixWorld(true);g.terrain.update(c,true);g.scenery.update(c.position,0,false,c.position,c);g.atmosphere.update(0,c,p);g.renderer.render(g.scene,c);
    const image=g.canvas.toDataURL('image/jpeg',.9).split(',')[1];g.enterMenu();meet.time.value='day';return image;})()`);
  await writeFile('artifacts/apex/qualifying-grid.jpg',Buffer.from(lineup,'base64'));
}
try{
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  session=(await send('Target.attachToTarget',{targetId,flatten:true})).sessionId;
  await call('Runtime.enable');await call('Page.enable');
  const bootstrap=await call('Page.addScriptToEvaluateOnNewDocument',{source:"const orig=console.error;console.error=(...args)=>orig(...args,new Error().stack);localStorage.setItem('slop-drift-settings-v2',JSON.stringify({map:'apex',timeOfDay:'day',quality:'Medium',startGate:false}));"});
  await call('Page.navigate',{url});
  let ready=false;
  for(let i=0;i<150;i++){await delay(700);ready=await ev("!!window.__SLOP_DRIFT__?.frameHandle");if(ready || await ev("!!document.querySelector('.fatal-error')"))break;}
  await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:bootstrap.identifier});
  if(!ready)throw Error('Load failed: '+errors.join('\n')+' '+await ev('document.body.innerText.slice(-600)'));
  if(process.argv.includes('--smoke-maps')){
    await ev("window.g=window.__SLOP_DRIFT__;cancelAnimationFrame(g.frameHandle);");await gridPhoto();
    await call('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});
    await call('Emulation.setTouchEmulationEnabled',{enabled:true});
    await ev("window.g=window.__SLOP_DRIFT__;g.enterMenu();g.hud.setHubTab?.('events');g.apexMeeting.panel.open=true;");
    const mobile=await ev(`(()=>{const m=g.apexMeeting;m.startButton.scrollIntoView({block:'center'});const b=m.startButton.getBoundingClientRect();
      if(b.width<50 || b.height<15)throw Error('Phone setup button hidden');m.startButton.click();if(!g.session||g.mode.id!=='apex-meeting')throw Error('Phone race setup failed');
      return {viewport:[innerWidth,innerHeight],buttonWidth:b.width,course:g.session.route.id};})()`);
    const maps=[];
    for(const map of ['tokyo','hollow','apex']){
      await ev("window.g=window.__SLOP_DRIFT__;g.enterMenu();setTimeout(()=>g.selectMap("+JSON.stringify(map)+"),30);true");
      let loaded=false;
      for(let i=0;i<180;i++){await delay(500);try{loaded=await ev("window.__SLOP_DRIFT__?.map?.id==="+JSON.stringify(map)+" && !!window.__SLOP_DRIFT__?.frameHandle");}catch{}if(loaded)break;}
      if(!loaded)throw Error('Map switch failed '+map+' '+errors.join(' '));
      const entry=await ev("window.g=window.__SLOP_DRIFT__;g.beginRun('roam');({id:g.map.id,state:g.state})");maps.push(entry);
    }
    await writeFile('artifacts/apex/map-smoke.json',JSON.stringify({mobile,maps,errors},null,2));
    console.log(JSON.stringify({mobile,maps,errors}));if(errors.length)process.exitCode=1;
  }else{
  const destination='artifacts/apex';await mkdir(destination,{recursive:true});
  await ev("window.g=window.__SLOP_DRIFT__; cancelAnimationFrame(g.frameHandle);g.hud.hideLoading();g.beginRun('roam');cancelAnimationFrame(g.frameHandle);");
  const names=await ev("g.world.apex.sections.map(v=>v.name)");
  const shots=[
    ['pit-straight','day',-64,0,2.5,80],['main-stadium','sunset',-89,35,22,104],
    ['night-grid','night',-64,-1,3,110],['paddock','day',-176,100,32,94],
    ...names.map((name,i)=>[name.toLowerCase().replaceAll(' ','-'),'day','section'+i,i===2?9:-3,i===2?10:3.2,65]),
    ['garage-bays','day',-94,19,1.8,24],['lake','day','lake',0,0,0],['crossover','day','bridge',-19,13,35],['landscape','sunset','ridge',-40,68,270]
  ];
  for(const [name,time,s,side,up,look] of shots){
    const data=await ev(`(()=>{const a=g.world.apex, m=a.main;g.atmosphere.setTimeOfDay(${JSON.stringify(time)});g.car.setHeadlights(g.atmosphere.isNight);
      g.terrain.setSun(g.atmosphere.sunDirection,g.atmosphere.sunColor,g.atmosphere.ambientColor);
      const arg=${JSON.stringify(s)},pos=typeof arg==='number'?arg:arg==='bridge'?a.under-38:arg==='ridge'?a.stations[20]:a.sections[Number(arg.slice(7))].start+22;
      const f=m.frameAt(pos,{}),t=m.frameAt(pos+${look},{}),c=g.cameraRig.camera;
      g.scenery.skyLight=({night:.09,sunset:.42,dawn:.68,day:1.18})[g.atmosphere.timeOfDay];
      c.position.set(f.x+f.rx*${side},f.y+${up},f.z+f.rz*${side});
      c.lookAt(t.x,t.y+1,t.z);if(arg==='lake'){const y=g.world.grid.heightAt(1190,-710);c.position.set(1190,y+45,-710);c.lookAt(854,20,-373);}if(${JSON.stringify(name)}==='garage-bays')c.lookAt(t.x+t.rx*38,t.y+3,t.z+t.rz*38);c.fov=59;c.updateProjectionMatrix();c.updateMatrixWorld(true);
      g.terrain.update(c,true);g.scenery.update(c.position,0,g.atmosphere.isNight,c.position,c);
      g.atmosphere.update(0,c,c.position);g.renderer.render(g.scene,c);
      return g.canvas.toDataURL('image/jpeg',.89).split(',')[1];})()`);
    await writeFile(path.join(destination,name+'.jpg'),Buffer.from(data,'base64'));
  }
  const stats=await ev(`(async()=>{const gl=g.renderer.getContext(),dbg=gl.getExtension('WEBGL_debug_renderer_info'),samples=[];
    for(let i=0;i<31;i++){const t=performance.now();g.renderer.render(g.scene,g.cameraRig.camera);gl.finish();if(i)samples.push(performance.now()-t);await new Promise(r=>setTimeout(r,0));}
    samples.sort((a,b)=>a-b);return {gpu:dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),viewport:[g.canvas.width,g.canvas.height],quality:g.settings.quality,rendererOnlyMs:{median:samples[15],p95:samples[28]},draw:g.renderer.info.render,memory:g.renderer.info.memory,loadStagesMs:g.loadTimings};})()`);
  const weekend=await ev(`(async()=>{
    const meeting=g.apexMeeting;g.enterMenu();g.hud.setHubTab?.('events');
    meeting.panel.open=true;meeting.layout.value='gp';meeting.layout.dispatchEvent(new Event('change'));meeting.format.value='race';meeting.weather.value='rain';meeting.entries.value='3';
    meeting.startButton.click();
    if(g.session.route.id!=='gp'||meeting.grid.field.length!==3)throw Error('weekend form did not start a GP race');
    const st=g.vehicle.getState();for(let i=0;i<180;i++)meeting.update(1/60,st);
    const wetness=g.world.apex.wetness,aiMetres=meeting.grid.field[0].d;
    const p=meeting.service.box,pose=g.world.getSpawn('loop',0);Object.assign(pose.position,p);g.vehicle.teleport(pose);meeting.service.fuel=32;meeting.service.tyres=.6;
    meeting.update(.15,g.vehicle.getState());meeting.work.click();
    for(let i=0;i<800;i++)meeting.update(1/60,g.vehicle.getState());
    if(meeting.service.stops!==1||meeting.service.fuel<89.9)throw Error('pit UI failed service');
    const result={wetness,aiMetres,serviceStops:meeting.service.stops,fuel:meeting.service.fuel,layout:g.session.route.id,opponents:meeting.grid.field.length,gridTimings:[]};
    for(const n of [0,3,7]){meeting.entries.value=String(n);meeting.startButton.click();const samples=[];
      g.hud.hideLoading();g.updateCountdown(4);g.cameraRig.snap();
      for(let i=0;i<65;i++){const before=performance.now();g.onFrame((g.lastTime||performance.now())+16.67);cancelAnimationFrame(g.frameHandle);g.renderer.getContext().finish();if(i>=5)samples.push(performance.now()-before);await new Promise(r=>setTimeout(r,0));}
      samples.sort((a,b)=>a-b);result.gridTimings.push({n,median:samples[30],p95:samples[56],triangles:g.renderer.info.render.triangles,calls:g.renderer.info.render.calls});}
    g.enterMenu();meeting.layout.value='academy';meeting.entries.value='3';meeting.format.value='weekend';meeting.laps.value='1';meeting.startButton.click();
    // Drive surveyed positions through the real checkpoint and results handlers.
    // The separate physics test executes all six laps with live tyre/suspension physics.
    async function completeStage(){
      await new Promise(r=>setTimeout(r,1150));
      const session=g.session,r=session.route,road=g.world.roads[r.roadId],car=g.vehicle.getState();
      g.updateCountdown(4);
      for(let d=-6;d<road.length+8&&!session.finished;d+=4){
        const f=road.frameAt(r.startS+d,{}),p={...car,position:car.position.clone().set(f.x,f.y+.3,f.z),speed:30,velocity:car.velocity.clone().set(f.tx*30,0,f.tz*30)};
        if(g.meta.recorder.active)g.meta.recorder.sample(session.elapsed,p);
        const dt=4/(meeting.sessionType==='qualify'?16:30);
        const events=[...session.update(dt,p)];meeting.update(dt,p);
        for(const e of events)g.handleSessionEvent(e);
      }
      if(!session.finished||g.state!=='finished')throw Error('Stage failed: '+g.mode.label);
    }
    await completeStage();document.querySelector('.apx-classification button').click();
    if(meeting.sessionType!=='qualify')throw Error('Practice did not advance');
    await completeStage();const order=[...meeting.gridOrder];
    document.querySelector('.apx-classification button').click();
    if(meeting.sessionType!=='race'||JSON.stringify(meeting.grid.order)!==JSON.stringify(order))throw Error('Race grid order mismatch');
    await completeStage();meeting.visibility();
    meeting.photo.open=true;meeting.view.value='replay';meeting.view.dispatchEvent(new Event('change'));
    const cam=meeting.photoCamera();
    if(!cam || meeting.replay.duration<21 || meeting.replay.stride!==32)throw Error('Full-field replay missing');
    meeting.aperture.value='.00006';await meeting.aperture.onchange();if(!meeting.renderPhoto(cam))throw Error('Photo depth failed');
    result.program={grid:order,stages:3,replaySeconds:meeting.replay.duration,recordedCars:meeting.replay.stride/8,finishFlag:meeting.flag};
    g.enterMenu();meeting.format.value='timeTrial';meeting.startButton.click();await completeStage();
    if(!g.session.result.isRecord)throw Error('First clean time trial did not set a record');
    g.enterMenu();meeting.startButton.click();
    if(!g.meta.ghost||!g.session.hud.bestLap)throw Error('Time trial failed to reload the personal best and ghost');
    result.timeTrial={ghost:g.meta.ghost.data.count,best:g.session.hud.bestLap};g.enterMenu();
    meeting.format.value='school';meeting.format.dispatchEvent(new Event('change'));meeting.startButton.click();
    const school=meeting.school,session=g.session,state=g.vehicle.getState();
    for(const [i,d] of school.gates.entries()){session._curD=d;session._loc.roadId=session.roadId;session._loc.lateral=i%2?-1.6:1.6;school.update(.1,session,state);}
    session._curD=136;session._loc.lateral=0;school.update(1.1,session,state);
    if(!school.done || school.passed!==5)throw Error('Driving school targets failed');
    result.academy=school.instruction;g.enterMenu();meeting.format.value='race';meeting.format.dispatchEvent(new Event('change'));
    return result;})()`);
  await gridPhoto();
  const drive=process.argv.includes('--drive')?await ev('('+driveBenchmark.toString()+')()'):undefined;
  const report={build:production?'production':'development',stats,weekend,drive,errors};
  await writeFile(path.join(destination,'browser-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  if(errors.length)process.exitCode=1;
  }
}finally{
  if(production)await new Promise(resolve=>server.httpServer.close(resolve));else await server.close();await send('Browser.close').catch(()=>{});await delay(300);child.kill();await rm(profile,{recursive:true,force:true,maxRetries:3}).catch(()=>{});
}

