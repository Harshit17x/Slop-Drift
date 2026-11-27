import { spawn } from 'node:child_process';
import { mkdtemp,rm } from 'node:fs/promises';
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
  const report = await ev(`(async () => {
    const g = window.__SLOP_DRIFT__;
    g.enterMenu();
    const modes = g.modes.map(m => m.id);
    g.beginRun('sprint');
    g.updateCountdown(4);
    await new Promise(r => setTimeout(r,3500));
    const times = [];
    const warm = await new Promise(requestAnimationFrame);
    const finish = warm + 7000;
    let last = warm;
    while (performance.now() < finish) {
      const now = await new Promise(requestAnimationFrame);
      times.push(now - last);
      last = now;
    }
    const stats = {modes, fps: 1000 * times.length / times.reduce((a,b)=>a+b,0),
      viewport:[g.canvas.width,g.canvas.height], calls:g.renderer.info.render.calls, triangles:g.renderer.info.render.triangles,
      geometry:g.renderer.info.memory.geometries,textures:g.renderer.info.memory.textures};
    if (g.apexPractice) {
      const input = g.input.update;
      const start = g.vehicle.getState().position.clone();
      const driving = [];
      g.input.update = function() {
        const c = input.call(this);
        c.throttle = g.vehicle.getState().speed < 24 ? .7 : 0;
        return c;
      };
      try {
        let last = await new Promise(requestAnimationFrame);
        const end = last + 7000;
        while (last < end) {
          const now = await new Promise(requestAnimationFrame);
          driving.push(now-last); last = now;
        }
      } finally { g.input.update = input; }
      stats.drivingFps = 1000*driving.length/driving.reduce((a,b)=>a+b,0);
      stats.distance = start.distanceTo(g.vehicle.getState().position);
      if (stats.distance < 20) throw Error('Solo driving sample did not move');
      const events = g.modes.filter(mode => mode.laps === 1);
      if (events.length !== 3 || g.apexMeeting) throw Error('Unexpected Apex events');
      for (const mode of events) {
        g.enterMenu();g.hud.setHubTab('events');
        const card = document.querySelector('.sdh-mode-card[data-mode="'+mode.id+'"]');
        if (!card) throw Error('Missing event card for '+mode.id);
        card.click();
        for (let n=0; n<60 && !g.session; n++) await new Promise(requestAnimationFrame);
        g.updateCountdown(4);
        if (g.session.route.id !== mode.route || g.atmosphere.timeOfDay !== 'day') throw Error(mode.id);
      }
      const pit = g.apexPractice, state = g.vehicle.getState();
      const stationary = {...state,position:pit.boxes[0],speed:0};
      pit.wear=.4;
      for (let i=0;i<60;i++) pit.update(.1,stationary);
      if (pit.wear !== 0 || pit.phase !== 'released') throw Error('Tyre change failed');
    }
    return stats;
  })()`);
  console.log(JSON.stringify({report,errors}));
  if(errors.length)process.exitCode=1;
}finally{
  if(production)await new Promise(resolve=>server.httpServer.close(resolve));else await server.close();await send('Browser.close').catch(()=>{});await delay(300);child.kill();await rm(profile,{recursive:true,force:true,maxRetries:3}).catch(()=>{});
}

