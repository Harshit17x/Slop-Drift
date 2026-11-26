const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
fs.mkdirSync(path.resolve('node_modules/.cache'),{recursive:true});
const chrome=spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--autoplay-policy=no-user-gesture-required','--enable-unsafe-swiftshader','--no-first-run','--disable-background-networking','--remote-debugging-pipe','--window-size=960,600','--user-data-dir='+fs.mkdtempSync(path.resolve('node_modules/.cache/tokyo-cdp-')),'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe'],windowsHide:true});
let server;let pending=new Map(),id=0,buf='',sessionId;
function send(method,params={},session=sessionId){return new Promise((res,rej)=>{pending.set(++id,{res,rej});chrome.stdio[3].write(JSON.stringify({id,method,params,sessionId:session})+'\0')})}
chrome.stdio[4].on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\0'))>=0){let x=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);if(x.id){let p=pending.get(x.id);pending.delete(x.id);if(x.error)p.rej(x.error);else p.res(x.result)}else if(x.method==='Runtime.exceptionThrown')console.log(x.params.exceptionDetails.exception?.description)}});
async function evaluate(expression){let r=await send('Runtime.evaluate',{expression,userGesture:true,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{server=await (await import('vite')).createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;const {targetInfos}=await send('Target.getTargets');sessionId=(await send('Target.attachToTarget',{targetId:targetInfos.find(t=>t.type==='page').targetId,flatten:true})).sessionId;
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['https://*','wss://*']});
await send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('slop-drift-settings-v2', JSON.stringify({map:'tokyo',quality:'Low',startGate:false,timeOfDay:'night'}))"});
await send('Page.navigate',{url:origin});for(let i=0;i<220;i++){await wait(500);let s=await evaluate('document.querySelector(".fatal-error")?.innerText || globalThis.__SLOP_DRIFT__?.state');if(s==='menu')break;if(i===100)throw Error('Boot timeout '+await evaluate('JSON.stringify([location.href, document.readyState,document.title, document.body.innerText.slice(0,700),performance.getEntriesByType("resource").slice(-5).map(r=>r.name)])'));if(s && s!=='loading')throw Error(s)}
console.log(await evaluate(`(async()=>{window.p=await import('/tests/autopilot.js');window.g=await p.ready();p.attach();p.start('roam');g.hud.loadingActive=false;return {map:g.map.id,parked:g.scenery.parkSolids.length,programs:g.renderer.info.programs.length}})()`));
const clearance=await evaluate(`(()=>{let hits=[];for(const r of g.world.roads){let last=-40;for(let s=5;s<r.length-(r.id===4?4:0);s+=4){const f=r.frameAt(s,{});if([-2,0,2].some(l=>g.world.collideObstacle(f.x+f.rx*l,f.y+.65,f.z+f.rz*l,1.15,{}).hit)&&s-last>35){hits.push([r.id,Math.round(s)]);last=s;}}}return JSON.stringify(hits)})()`);if(clearance!=='[]')throw Error('Obstacles on driving lines '+clearance);
const scenes=[['shibuya',0,0,{back:21,look:48}],['minato',0,840,{look:90,lookSide:63,lookUp:48}],['akihabara',0,1720,{}],['shinjuku',1,1780,{}],['expressway',2,1800,{}],['tunnel',2,7400,{}],['bay',3,825,{lookSide:15}],['meet',0,3730,{lookSide:-15}],['lantern-counter',1,await evaluate('g.scenery.stops[2].station'),{side:-3,up:2,back:6,look:1,lookSide:-9}],['arcade-counter',0,await evaluate('g.scenery.stops[0].station'),{up:2,back:9,look:1,lookSide:-11}]];
for(let i=0;i<9;i++)scenes.push([['b2','b1','1f','2f','3f','4f','5f','6f','roof'][i],4,28+i*268,{up:1.75,back:0,look:18}]);
for(const [name,road,s,opts] of scenes){
 const data=await evaluate(`(()=>{p.view(${road},${s},${JSON.stringify(opts)});g.renderer.render(g.scene,g.cameraRig.camera);return g.canvas.toDataURL('image/jpeg',.87)})()`);
 fs.writeFileSync(path.join(__dirname,name+'.jpg'),Buffer.from(data.split(',')[1],'base64'));
}
for(const benchmark of ['parkade','roam'])console.log(await evaluate(`(async()=>{p.start('${benchmark}');const times=[];let last=performance.now();for(let i=0;i<95;i++){await new Promise(requestAnimationFrame);p.step(1);g.renderer.getContext().finish();const now=performance.now();if(i>=5)times.push(now-last);last=now;}times.sort((a,b)=>a-b);return {area:g.mode.id,samples:times.length,medianMs:times[45],p95Ms:times[85],draws:g.renderer.info.render.calls,triangles:g.renderer.info.render.triangles,renderer:g.renderer.getContext().getParameter(g.renderer.getContext().getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),size:[g.canvas.width,g.canvas.height]}})()`));
const postcard=await evaluate(`(()=>{const r=g.world.roads[0],f=r.frameAt(24,{});g.vehicle.teleport(g.world.getSpawn('loop',24,g.pose));g.car.sync(g.vehicle.getState(),1/60);const eye=[f.x-6.1*f.tx+3.3*f.rx,1.8,f.z-6.1*f.tz+3.3*f.rz],target=[f.x+6.3*f.tx,2.25,f.z+6.3*f.tz];p.look(eye,target);return g.canvas.toDataURL('image/jpeg',.93)})()`);
fs.writeFileSync(path.join(__dirname,'night-drive.jpg'),Buffer.from(postcard.split(',')[1],'base64'));
if(process.env.TOKYO_ACTIVITIES){
 const result=await evaluate(`(async()=>{
   p.start('roam'); const a=g.adventure,w=g.world,S=g.vehicle.getState(),hit={event:'drift_end',lastDriftScore:250};
   const traffic=g.scenery.life.cabs,car=traffic[0],phase=car.phase;
   if(traffic.length!==4)throw Error('Missing ambient service traffic');
   g.scenery.life.update(.2,S.position,false,false,true,S.position);
   if(car.phase===phase)throw Error('Service taxi did not move');
   g.scenery.life.update(.2,S.position,false,false,false,S.position);
   if(traffic.some(c=>c.cab.visible))throw Error('Traffic visible in competition');
   const simClock=a.clock;a.log.weather='Passing showers';
   for(const [t,weather] of [[0,'Clear'],[65,'Rain'],[130,'After rain']]){
     a.clock=t;a.weather();if(g.scenery.weather!==weather)throw Error('Weather cycle failed');
   }
   a.clock=simClock;a.nextScan=simClock;a.log.weather='After rain';a.weather();
   const tick=(f,drift={})=>{const state={...S,position:S.position.clone().set(f.x,f.y+.45,f.z),speed:0};a.update(.2,state,drift);};
   const visit=stop=>{
     w.roadSpawn(stop.road,stop.station,1,g.pose);
     const f=w.roads[stop.road].frameAt(stop.station,{});
     Object.assign(g.pose.position,stop.point);g.pose.position.x+=3*f.rx;g.pose.position.z+=3*f.rz;g.pose.position.y+=.5;g.vehicle.teleport(g.pose);
     tick(stop.point);if(a.kiosk.hidden)throw Error('Unreachable counter '+stop.name);
     a.stamp.click();
   };
   const stops=g.scenery.stops;
   for(const stop of stops)visit(stop);
   visit(stops[2]);a.action.click();a.clock+=14;visit(stops[3]);a.action.click();
   if(!a.log.courierBest||a.log.stamps.length!==4)throw Error('Street interactions failed');
   for(const z of g.scenery.driftSectors){
     const r=w.roads[z.road],f=r.frameAt(z.s,{});
     a.update(.25,{...S,position:S.position.clone().set(f.x,f.y+.5,f.z),speed:20,impact:0,wheelsOnGround:4},{active:true,angleDeg:30});
     tick(r.frameAt(z.s+120,{}));if(!a.log.sectorRecords[z.name])throw Error('Unscored sector '+z.name);
   }
   const camera=w.roads[2].frameAt(1520,{});
   a.update(.25,{...S,position:S.position.clone().set(camera.x,camera.y+.5,camera.z),speed:30},{});
   if(a.log.speedBest!==108)throw Error('Speed camera failed');
   for(const f of w.tokyoSites)tick(f);
   a.start('hunter');for(const i of [4,5,6])tick(w.tokyoSites[i]);
   a.start('gymkhana');for(const s of [45,120,195])tick(w.gymkhana.frameAt(s,{}),hit);
   a.start('parkade');for(let i=0;i<8;i++)tick(w.roads[4].frameAt(30+268*i,{}),hit);
   a.start('rooftop');tick(w.roads[4].frameAt(2178,{}),hit);
   a.start('basement');tick(w.roads[4].frameAt(30,{}),hit);
   const click=HTMLAnchorElement.prototype.click;let photos=0;HTMLAnchorElement.prototype.click=function(){if(!this.href.startsWith('data:image/jpeg'))throw Error('empty photo');photos++};
   try{
     a.angle='Tower skyline';
     const shoot=(road,s)=>{w.roadSpawn(road,s,1,g.pose);g.vehicle.teleport(g.pose);tick(w.roads[road].frameAt(s,{}));a.photo();};
     for(const i of [0,2,3,4,5]){const f=w.tokyoSites[i];shoot(f.id,f.s);}
     shoot(2,180);shoot(4,2180);
   }finally{HTMLAnchorElement.prototype.click=click}
   await g.audio.unlock();a.log.station='Neon FM';tick(w.roads[2].frameAt(7200,{}));
   if(!a.sound.send||a.sound.send.gain.value<0)throw Error('tunnel audio unavailable');
   for(const id of ['tandem','parkTandem']){
     a.start(id);p.step(190);const route=g.session.route;
     for(let i=0;i<55;i++){const f=w.roads[route.roadId].frameAt(route.startS+(a.clock+.2)*(id==='parkTandem'?14:a.pace()),{});tick(f,{active:true});}
   }
   a.start('rival');p.step(190);let frames=0;while(g.state==='running'&&frames<26000){p.step(240);frames+=240;}
   if(g.state!=='finished'||a.log.complete.length!==12)throw Error('Activity checks failed '+JSON.stringify(a.log));
   return {photos,completed:a.log.complete,save:JSON.parse(localStorage.getItem('slop-tokyo-passport-v1')).complete.length};
 })()`);console.log('Activity verification',result);
}
if(process.env.TOKYO_DRIVE){
 for(const id of (process.env.TOKYO_ROUTES||'parkade,parkdown,underground,sprint,shibuya,bay,express,tour').split(',')){
   const drive=await evaluate(`(()=>{p.start('${id}');let n=0;while(g.state==='running'&&n<58000){p.step(240);n+=240}return {id:g.mode.id,state:g.state,t:g.session.elapsed,gates:g.session.nextGate,total:g.session.cpCount,kmh:g.vehicle.getState().speedKmh,pos:g.vehicle.getState().position.toArray(),respawns:g.session.respawns,debug:g.state==='finished'?undefined:(()=>{const v=g.vehicle.getState(),p=v.position,w=g.world;return {throttle:g.controls.throttle,steer:g.controls.steer,impacts:v.impact,damage:g.damage.powerFactor,forward:v.forward.toArray(),ground:v.wheelsOnGround,near:w.tokyoSolids.filter(a=>Math.hypot(a.p.x-p.x,a.p.z-p.z)<a.r+12).map(a=>[a.p.toArray(),a.r,a.h]),progress:w.locate(p.x,p.z,{},g.session.roadId,p.y)}})()}})()`);
   console.log(JSON.stringify(drive));
   if(drive.state!=='finished'||drive.respawns!==0)throw Error('Unfinished race '+id);
 }
}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{chrome.kill();await server?.close()});
