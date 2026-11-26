import { spawn } from 'node:child_process';
import { mkdtemp,writeFile,mkdir,rm } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// Capture the actual game renderer using a temporary, isolated Chromium profile.
const profile=await mkdtemp(path.join(tmpdir(),'apex-capture-'));
const chrome=process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const {createServer}=await import('vite');
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});
await server.listen();const url=server.resolvedUrls.local[0];
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
try{
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  session=(await send('Target.attachToTarget',{targetId,flatten:true})).sessionId;
  await call('Runtime.enable');await call('Page.enable');
  await call('Page.addScriptToEvaluateOnNewDocument',{source:"const orig=console.error;console.error=(...args)=>orig(...args,new Error().stack);localStorage.setItem('slop-drift-settings-v2',JSON.stringify({map:'apex',timeOfDay:'day',quality:'Medium',startGate:false}));"});
  await call('Page.navigate',{url});
  let ready=false;
  for(let i=0;i<150;i++){await delay(700);ready=await ev("!!window.__SLOP_DRIFT__?.frameHandle");if(ready || await ev("!!document.querySelector('.fatal-error')"))break;}
  if(!ready)throw Error('Load failed: '+errors.join('\n')+' '+await ev('document.body.innerText.slice(-600)'));
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
    g.enterMenu();return result;})()`);
  await writeFile(path.join(destination,'browser-check.json'),JSON.stringify({stats,weekend,errors},null,2));console.log(JSON.stringify({stats,weekend,errors},null,2));
  if(errors.length)process.exitCode=1;
}finally{
  await server.close();await send('Browser.close').catch(()=>{});await delay(300);child.kill();await rm(profile,{recursive:true,force:true,maxRetries:3}).catch(()=>{});
}

