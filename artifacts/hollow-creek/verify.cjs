const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
fs.mkdirSync(path.resolve('node_modules/.cache'),{recursive:true});
const chrome=spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--autoplay-policy=no-user-gesture-required','--enable-unsafe-swiftshader','--no-first-run','--disable-background-networking','--remote-debugging-pipe','--window-size=960,600','--user-data-dir='+fs.mkdtempSync(path.resolve('node_modules/.cache/creek-cdp-')),'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe'],windowsHide:true});
let server;let pending=new Map(),id=0,buf='',sessionId;
function send(method,params={},session=sessionId){return new Promise((res,rej)=>{pending.set(++id,{res,rej});chrome.stdio[3].write(JSON.stringify({id,method,params,sessionId:session})+'\0')})}
chrome.stdio[4].on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\0'))>=0){let x=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);if(x.id){let p=pending.get(x.id);pending.delete(x.id);if(x.error)p.rej(x.error);else p.res(x.result)}else if(x.method==='Runtime.exceptionThrown')console.log(x.params.exceptionDetails.exception?.description)}});
async function evaluate(expression){let r=await send('Runtime.evaluate',{expression,userGesture:true,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{server=await (await import('vite')).createServer({server:{host:'127.0.0.1',port:0}});await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;const {targetInfos}=await send('Target.getTargets');sessionId=(await send('Target.attachToTarget',{targetId:targetInfos.find(t=>t.type==='page').targetId,flatten:true})).sessionId;
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['https://*','wss://*']});
await send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('slop-drift-settings-v2', JSON.stringify({map:'hollow',quality:'Low',startGate:false,timeOfDay:'day'}))"});
await send('Page.navigate',{url:origin});for(let i=0;i<110;i++){await wait(500);let s=await evaluate('document.querySelector(".fatal-error")?.innerText || globalThis.__SLOP_DRIFT__?.state');if(s==='menu')break;if(i===109)throw Error('Boot timeout '+await evaluate('document.body.innerText.slice(0,700)'));if(s && s!=='loading')throw Error(s)}
console.log(await evaluate(`(async()=>{window.p=await import('/tests/autopilot.js');window.g=await p.ready();p.attach();p.start('roam');g.hud.loadingActive=false;return {map:g.map.id,missions:g.adventure.missions.length,found:[...g.adventure.journal.found],gpu:g.renderer.getContext().getParameter(g.renderer.getContext().getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL || g.renderer.getContext().RENDERER)}})()`));
for(const [name,road,s,opts] of [['residential',0,215,{}],['downtown',0,890,{}],['station',0,1558,{side:-2,lookSide:11}],['clock-square',1,434,{lookSide:-12,up:2.3}],['mine',2,2480,{}],['waterfront',0,2320,{lookSide:-24}],['factory',2,4950,{lookSide:-24}],['lost-coupe',2,4970,{side:-39,up:1.7,look:24,lookSide:-34}],['forest',2,5520,{}]]){
  const data=await evaluate(`(()=>{p.view(${road},${s},${JSON.stringify(opts)});g.renderer.render(g.scene,g.cameraRig.camera);return g.renderer.domElement.toDataURL('image/jpeg',.9)})()`);
  fs.writeFileSync(path.join(__dirname,name+'.jpg'),Buffer.from(data.split(',')[1],'base64'));
}
console.log(await evaluate(`(async()=>{p.view(0,600);let elapsed=[],last=performance.now();for(let i=0;i<40;i++){await new Promise(requestAnimationFrame);p.view(0,600+i*1.5);g.renderer.getContext().finish();let now=performance.now();elapsed.push(now-last);last=now}elapsed.sort((a,b)=>a-b);return {medianMs:elapsed[20],p95Ms:elapsed[38],draw:g.renderer.info.render.calls,triangles:g.renderer.info.render.triangles,size:[g.canvas.width,g.canvas.height]}})()`));
console.log('Driving frame sample',await evaluate(`(async()=>{
  p.start('sprint');const times=[];let last=performance.now();
  for(let i=0;i<190;i++){await new Promise(requestAnimationFrame);p.step(1);g.renderer.getContext().finish();const now=performance.now();if(i>=10)times.push(now-last);last=now;}
  times.sort((a,b)=>a-b);return {samples:times.length,median:times[90],p95:times[171],kmh:g.vehicle.getState().speedKmh};
})()`));
const verification=await evaluate(`(async()=>{
  p.start('roam');const A=g.adventure,J=A.journal,S=g.vehicle.getState();
  await g.audio.unlock();p.step(4);
  const point=(o)=>{S.position.set(o.x,o.y+.5,o.z);};
  const tick=(goal,drift={})=>{point(goal);A.update(1/60,S,drift);};
  const tested=[];
  for(const m of A.missions.filter(m=>!m.race && !m.pursuitPath)){
    A.accept(m.id);
    for(const q of m.goals)tick(q,{event:'drift_end',lastDriftScore:130});
    if(!J.completed.has(m.id))throw Error('Incomplete '+m.id);
    tested.push(m.id);
  }
  A.accept('pursuit');tick(A.def.goals[0]);
  for(let i=0;i<18000 && A.def?.id==='pursuit';i++){S.position.copy(A.events.pos);A.update(.05,S,{});}
  if(!J.completed.has('pursuit'))throw Error('Pursuit did not finish');tested.push('pursuit');
  const laps=[];
  for(const mode of ['sprint','quarter','vanishing']){
    p.start(mode);let frames=0;while(g.state==='running' && frames<60000){p.step(300);frames+=300;}
    laps.push([mode,g.state,frames,g.session.nextGate,g.session.cpCount,Math.round(g.session.hud.elapsed)]);
    if(g.state!=='finished')throw Error('Drive failed '+JSON.stringify(laps));
  }
  for(const id of ['ghost','mist']){
    p.start('roam');A.accept(id);p.step(200);let frames=0;
    if(id==='ghost'&&!g.meta.ghost)throw Error('Missing actual recorded ghost');
    while(g.state==='running'&&frames<60000){p.step(300);frames+=300;}
    if(!J.completed.has(id))throw Error('Race dispatch failed '+id);tested.push(id);
  }
  p.start('roam');let E=A.events;
  A.journal.active=null;E.cool.clear();let played=[];
  const play=A.sound.play.bind(A.sound);A.sound.play=(k,...args)=>{played.push(k);play(k,...args)};
  const f=g.world.roads[0].frameAt(650,{});const mover={...S,speed:12};
  function roll(key){let seq=[0,(key+.1)/5,0,0];E.random=()=>seq.shift()??0;E.next=0;point(f);E.update(.05,mover,null);}
  roll(0);if(!E.watcher.visible)throw Error('Watcher failed to spawn');
  point(E.watcher.position);E.update(.1,mover,null);if(E.watcher.visible)throw Error('Watcher failed to fade');
  roll(1);if(g.scenery.outage<=0)throw Error('Blackout did not trigger');
  roll(2);if(!played.includes('static'))throw Error('Radio interference failed');
  roll(3);if(!E.path||!E.phantom.visible)throw Error('Ambient phantom failed');
  E.clear();roll(4);if(!played.includes('scare'))throw Error('Missing stinger');
  let levels=[];const tone=g.audio._tone.bind(g.audio);g.audio._tone=o=>{levels.push(o.vol);tone(o)};
  J.settings.scares=0;A.sound.play('scare');if(levels.length)throw Error('Stinger mute failed');J.settings.scares=.6;
  J.exitKnown=false;E.random=()=>0;E.visits=1;E.inside=false;
  point(g.world.roads[2].frameAt(2474,{}));E.update(.1,mover,null);
  if(!J.exitKnown||!g.world.mineOpen)throw Error('Alternate exit failed');
  if(!g.career.setCosmetic('paint','saltline'))throw Error('Livery cannot be equipped');g.meta.applyLook(g.car);p.step(2);
  const journal=new J.constructor(localStorage);if(journal.completed.size!==12||journal.found.size!==8)throw Error('Journal did not survive reload');
  return {encounters:['watcher','blackout','frequency','phantom','stinger mute','tunnel reveal'],missions:tested,found:[...J.found],laps,audio:g.audio.ctx?.state,completed:J.completed.size,paint:g.career.profile.achievements['hollow-pumps']>0};
})()`);
console.log(JSON.stringify(verification));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{chrome.kill();await server?.close()});setTimeout(()=>{chrome.kill();process.exit(2)},240000).unref();
