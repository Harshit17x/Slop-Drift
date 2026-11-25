const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--enable-unsafe-swiftshader','--no-first-run','--disable-background-networking','--remote-debugging-pipe','--window-size=960,600','--user-data-dir='+fs.mkdtempSync(path.join(os.tmpdir(),'monsoon-cdp-')),'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe'],windowsHide:true});
let pending=new Map(),id=0,buf='',sessionId;
function send(method,params={},session=sessionId){return new Promise((res,rej)=>{pending.set(++id,{res,rej});chrome.stdio[3].write(JSON.stringify({id,method,params,sessionId:session})+'\0')})}
chrome.stdio[4].on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\0'))>=0){let x=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);if(x.id){let p=pending.get(x.id);pending.delete(x.id);if(x.error)p.rej(x.error);else p.res(x.result)}else if(x.method==='Runtime.exceptionThrown')console.log(x.params.exceptionDetails.exception?.description)}});
async function evaluate(expression){let r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const {targetInfos}=await send('Target.getTargets');sessionId=(await send('Target.attachToTarget',{targetId:targetInfos.find(t=>t.type==='page').targetId,flatten:true})).sessionId;
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Network.setBlockedURLs',{urls:['https://*','wss://*']});
await send('Page.addScriptToEvaluateOnNewDocument',{source:"localStorage.setItem('slop-drift-settings-v2', JSON.stringify({map:'alpine',quality:'High',timeOfDay:'day'}))"});
await send('Page.navigate',{url:'http://127.0.0.1:5196/'});for(let i=0;i<110;i++){await wait(500);let s=await evaluate('document.querySelector(".fatal-error")?.innerText || globalThis.__SLOP_DRIFT__?.state');if(s==='menu')break;if(s && s!=='loading')throw Error(s)}
const info=await evaluate(`(async()=>{window.p=await import('/tests/autopilot.js');window.g=await p.ready();p.attach();p.start('sprint');g.setCar('gt');g.car.model.setPaint((await import('/src/config.js')).getPaint('pearl'));p.step(80);return [g.car.carId,g.car.model.bodyMesh?.name,g.car.model.chassis.children.map(c=>c.name)]})()`);
console.log(info);
const base='C:/Users/RIYAN/Desktop/Ex/GamEX/';
function save(name,data){fs.writeFileSync(base+name,Buffer.from(data.split(',')[1],'base64'))}
save('Porsche GT3 R - exterior.png',await evaluate(`(()=>{g.car.setInteriorView(false);const s=g.vehicle.getState(),c=g.cameraRig.camera;c.position.set(4.6,1.55,-5.6).applyQuaternion(s.quaternion).add(s.position);c.lookAt(s.position.clone().addScaledVector(s.up,.55));c.fov=29;c.updateProjectionMatrix();g.renderer.render(g.scene,c);return g.renderer.domElement.toDataURL()})()`));
save('Porsche GT3 R - cockpit.png',await evaluate(`(()=>{g.cameraRig.setMode('cockpit');p.step(80);g.car.setInteriorView(true);g.car.cockpit.update(g.vehicle.getState(),1/60);g.renderer.render(g.scene,g.cameraRig.camera);return g.renderer.domElement.toDataURL()})()`));
const cockpit=await evaluate(`(async()=>{const {GLTFExporter}=await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');const obj=g.car.cockpit;obj.name='GT3R_DriverCell';const bin=await new GLTFExporter().parseAsync(obj,{binary:true,maxTextureSize:1024});return await new Promise(yes=>{const reader=new FileReader();reader.onload=()=>yes(reader.result);reader.readAsDataURL(new Blob([bin]))})})()`);
save('gt3r-work-maps/driver-cell.glb',cockpit);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>chrome.kill());setTimeout(()=>{chrome.kill();process.exit(2)},210000).unref();
