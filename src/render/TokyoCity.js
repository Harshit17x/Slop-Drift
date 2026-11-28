import * as T from 'three';
import { buildStreetStops, buildDriftSectors } from './TokyoStreetStops.js';
import { TokyoLife } from './TokyoLife.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createRandom } from '../world/noise.js';
import { FLOOR_NAMES, FLOOR_RISE } from '../world/Tokyo.js';
import { CityBatch, cityColors, reflectionTexture, signTexture } from './tokyoKit.js';

const towerUrl=new URL('../assets/maps/tokyo-tower.glb',import.meta.url).href;
const facades={
  grill:new URL('../assets/maps/tokyo-grill.webp',import.meta.url).href,
  gamehall:new URL('../assets/maps/tokyo-gamehall.webp',import.meta.url).href,
  workshop:new URL('../assets/maps/tokyo-workshop.webp',import.meta.url).href,
  flats:new URL('../assets/maps/tokyo-flats.webp',import.meta.url).href,

  office: new URL('../assets/maps/tokyo-office.webp',import.meta.url).href,
  shops: new URL('../assets/maps/tokyo-shops.webp',import.meta.url).href,
  ramen: new URL('../assets/maps/tokyo-ramen.webp',import.meta.url).href,
  market: new URL('../assets/maps/tokyo-market.webp',import.meta.url).href,
  ad0: new URL('../assets/maps/tokyo-ad0.webp',import.meta.url).href,
  ad1: new URL('../assets/maps/tokyo-ad1.webp',import.meta.url).href,
  ad2: new URL('../assets/maps/tokyo-ad2.webp',import.meta.url).href,
  ad3: new URL('../assets/maps/tokyo-ad3.webp',import.meta.url).href,
};
const shopColors=['#982b32','#13559d','#9b4522','#16736c','#9e2563','#70451e','#29498f','#812a40'];
const levelColors=[0x70caff,0xffdb94,0xb4f9da,0xd6f1ff,0xff5655,0xc2e7f5,0xffc16b,0x81abff,0xe4b4ff];
const at=(f,along,side,up=0)=>new T.Vector3(f.x+along*f.tx+side*f.rx,f.y+up,f.z+along*f.tz+side*f.rz);
const yawOf=f=>Math.atan2(-f.tz,f.tx);

// Weathered concrete-block walls for the service alleys and corner compounds.
// Cinder courses, damp staining and a couple of patched panels keep the backs
// of the city from reading as untextured grey slabs.
function wallTexture(){
  const c=document.createElement('canvas');c.width=256;c.height=256;
  const ctx=c.getContext('2d'),rand=createRandom(3187);
  ctx.fillStyle='#55544f';ctx.fillRect(0,0,256,256);
  const rows=8,bh=32;
  for(let y=0;y<rows;y++){
    const off=y%2?16:0;
    for(let x=-1;x<9;x++){
      const v=83+Math.floor(rand()*20),warm=rand()>.65?3:0;
      ctx.fillStyle=`rgb(${v+warm},${v+1},${v-warm})`;
      ctx.fillRect(x*32+off+1,y*bh+1,30,bh-2);
      if(rand()>.86){ctx.fillStyle='rgba(38,40,39,.32)';ctx.fillRect(x*32+off+3,y*bh+3,26,bh-6);}
    }
  }
  // Damp rising from the pavement and horizontal formwork stains.
  const damp=ctx.createLinearGradient(0,256,0,150);
  damp.addColorStop(0,'rgba(20,25,24,.5)');damp.addColorStop(1,'rgba(20,25,24,0)');
  ctx.fillStyle=damp;ctx.fillRect(0,150,256,106);
  for(let i=0;i<7;i++){
    const y=24+rand()*200;
    ctx.fillStyle=`rgba(30,31,29,${.05+rand()*.08})`;
    ctx.fillRect(0,y,256,1+rand()*3);
  }
  for(let i=0;i<26;i++){
    const x=rand()*256,y=rand()*256;
    ctx.fillStyle=`rgba(${rand()>.5?190:32},${rand()>.5?190:32},${rand()>.5?190:32},.06)`;
    ctx.fillRect(x,y,1+rand()*3,1+rand()*8);
  }
  const tex=new T.CanvasTexture(c);
  tex.colorSpace=T.SRGBColorSpace;tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.anisotropy=4;
  return tex;
}

// Tokyo Bay at night: a near-black tidal surface broken by long horizontal
// reflections from the far shore. The sheet is tileable in both axes so the
// basin fill never shows a seam, and the streaks run across it rather than
// reading as painted slabs when the camera looks along the quay.
function waterTexture(){
  const c=document.createElement('canvas');c.width=512;c.height=512;
  const ctx=c.getContext('2d'),rand=createRandom(90210);
  ctx.fillStyle='#1d3447';ctx.fillRect(0,0,512,512);
  const palette=['#f4c87f','#ffdfa9','#8dcbe4','#ef8f7d','#9fd6c3','#f7f0d9','#ffc46e','#74cdec'];
  for(let i=0;i<320;i++){
    const x=rand()*512,y=rand()*512,w=8+rand()*120,h=1+rand()*2.2;
    ctx.globalAlpha=.05+rand()*.24;
    ctx.fillStyle=palette[Math.floor(rand()*palette.length)];
    ctx.fillRect(x,y,w,h);
    if(x+w>512)ctx.fillRect(x-512,y,w,h);
    if(rand()>.62){
      ctx.globalAlpha=.16+rand()*.26;
      ctx.fillRect(rand()*512,rand()*512,4+rand()*24,1.4);
      ctx.globalAlpha=.05+rand()*.24;
    }
    if(rand()>.55){
      ctx.globalAlpha*=.66;
      const y2=y+2+rand()*5;
      ctx.fillRect(x+w*.18,y2,w*.46,h);
      if(x+w>512)ctx.fillRect(x-512+w*.18,y2,w*.46,h);
    }
  }
  // A few broad pools of shore light give the surface a sense of distance.
  for(let i=0;i<22;i++){
    const x=rand()*512,y=rand()*512,r=26+rand()*80;
    const g=ctx.createRadialGradient(x,y,0,x,y,r);
    g.addColorStop(0,`rgba(255,196,132,${.03+rand()*.05})`);
    g.addColorStop(1,'rgba(255,196,132,0)');
    ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);
    if(x+r>512)ctx.fillRect(x-r-512,y-r,r*2,r*2);
    if(y+r>512)ctx.fillRect(x-r,y-r-512,r*2,r*2);
  }
  ctx.globalAlpha=1;
  for(let y=0;y<512;y+=2){
    ctx.fillStyle=`rgba(168,205,230,${.018+rand()*.03})`;
    ctx.fillRect(0,y,512,1);
  }
  const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;
  tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.anisotropy=8;
  return tex;
}

// Interlocking concrete pavers with grime in the joints and a few wet patches.
// One texture covers a 9 m street section, so each paver reads about 55 cm.
function pavementTexture(){
  const c=document.createElement('canvas');c.width=512;c.height=256;
  const ctx=c.getContext('2d'),rand=createRandom(4471);
  ctx.fillStyle='#585754';ctx.fillRect(0,0,512,256);
  const cols=16,rows=8,tw=512/cols,th=256/rows;
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
    const v=92+Math.floor(rand()*22),warm=rand()>.5?3:0;
    ctx.fillStyle=`rgb(${v+warm},${v+1},${v-warm+1})`;
    ctx.fillRect(x*tw+1.4,y*th+1.4,tw-2.8,th-2.8);
    if(rand()>.78){
      ctx.fillStyle='rgba(28,28,26,.5)';
      ctx.fillRect(x*tw+tw*.16,y*th+th*.68,tw*.6,th*.1);
    }
  }
  // Damp sheets and tyre grime keep the pavers from tiling cleanly.
  for(let i=0;i<9;i++){
    const x=rand()*512,y=rand()*256,r=22+rand()*70;
    const g=ctx.createRadialGradient(x,y,0,x,y,r);
    g.addColorStop(0,`rgba(20,24,28,${.12+rand()*.14})`);g.addColorStop(1,'rgba(20,24,28,0)');
    ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);
  }
  for(let i=0;i<1600;i++){
    const l=rand()>.5?206:28;
    ctx.fillStyle=`rgba(${l},${l},${l},${.04+rand()*.09})`;
    ctx.fillRect(rand()*512,rand()*256,1.2,1.2);
  }
  const tex=new T.CanvasTexture(c);
  tex.colorSpace=T.SRGBColorSpace;tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.anisotropy=4;
  return tex;
}


export class TokyoCity {
  constructor({world,quality}){
    this.world=world;this.group=new T.Group();this.group.name='Tokyo After Hours';
    this.kit=new CityBatch(this.group);this.rand=createRandom(81086);
    this.materials=[];this.textures=[];this.sources=[];this.slots=[];this.solid=[];this.time=0;
    this.lots=new Map();this.junctionSites=[];this.gapStats={sealed:0,cross:0,corners:0,signals:0,crossings:0,shops:0,wide:0,shopMiss:0};
    this.world.tokyoPavements=[];
    this.concrete=this.material({color:0xffffff,roughness:.78});
    this.steel=this.material({color:0xffffff,roughness:.39,metalness:.54});
    this.lit=this.material({color:0xffffff},true);
    this.reflect=this.material({map:this.texture(reflectionTexture()),transparent:true,depthWrite:false,
      blending:T.AdditiveBlending,opacity:.51,polygonOffset:true,polygonOffsetFactor:-2},true);
    // Standing water after the rain: a smooth, environment-lit film that picks
    // up the skyline plate rather than a flat painted highlight.
    this.puddle=this.material({color:0x0d141d,map:this.texture(reflectionTexture()),roughness:.28,metalness:.12,
      transparent:true,opacity:.5,envMapIntensity:1.0,depthWrite:false,
      polygonOffset:true,polygonOffsetFactor:-1});
    // The harbour basin itself. Unlike the asphalt, this is deliberately
    // unlit: at night the bay only carries the reflected shore, and a
    // standard material with three point lights turns it into a grey slab.
    const bayTex=this.texture(waterTexture());
    this.bayTex=bayTex;
    this.bayLevel=-1.40;
    this.bayPoly=null;
    this.bay=this.material({map:bayTex,color:0xa9bccb},true);
    this.pavement=this.material({map:this.texture(pavementTexture()),roughness:.6,metalness:.06,envMapIntensity:.95});
    // The working pier is floodlit all night; a faint emissive lift keeps its
    // apron from collapsing into the same black as the water at distance.
    this.pierDeck=this.material({color:0x5a6067,roughness:.9,metalness:.03,
      emissive:0x20262c,emissiveIntensity:.8});
    const wallTex=this.texture(wallTexture());
    this.wall=this.material({map:wallTex,color:0xd6d2c8,emissive:0xffffff,emissiveMap:wallTex,
      emissiveIntensity:.30,roughness:.86,metalness:.02,envMapIntensity:.3});
    // Road paint is not a light source. A matte standard material keeps zebra
    // bars reading as worn thermoplastic under the streetlights instead of
    // glowing white slabs that fight the neon.
    this.paint=this.material({color:0xffffff,roughness:.72,metalness:.02,envMapIntensity:.45,
      polygonOffset:true,polygonOffsetFactor:-1});
    this.signs=new Map();this.skin={};
    for(const [key,url] of Object.entries(facades)){
      const tex=this.texture(new T.TextureLoader().load(url));
      tex.colorSpace=T.SRGBColorSpace;tex.anisotropy=4;
      this.skin[key]=this.material({map:tex,emissiveMap:tex,emissive:0xffffff,
        emissiveIntensity:key==='office'?.68:.85,roughness:.52,metalness:.11});
    }
    this.advertTextures=Array.from({length:4},(_,i)=>this.skin['ad'+i].map);
    const panorama=this.texture(new T.TextureLoader().load(new URL('../assets/maps/tokyo-skyline.webp',import.meta.url).href));
    panorama.colorSpace=T.SRGBColorSpace;panorama.wrapS=T.RepeatWrapping;panorama.repeat.x=3;
    this.panorama=panorama;
    const horizon=this.material({map:panorama,side:T.BackSide,fog:false,depthWrite:false,toneMapped:false},true);
    this.horizon=new T.Mesh(new T.CylinderGeometry(850,850,520,64,1,true),horizon);
    this.horizon.renderOrder=-10;this.group.add(this.horizon);
    this.parked=new T.Group();this.group.add(this.parked);
    this.setQuality(quality);
    this.buildSky();
    this.buildGround();
    this.buildStreets();
    this.kit.layered=true;
    this.buildParkade();
    this.kit.layered=false;
    this.buildLandmarks();
    this.stops=buildStreetStops(this);
    this.driftSectors=buildDriftSectors(this);
    this.buildStreetDetail();
    this.buildLampHalos();
    this.life=new TokyoLife(this);
    this.kit.flush();
    this.setParking(false);
    this.world.setObstacles([]);
    this.lights=Array.from({length:3},()=>{
      const l=new T.PointLight(0xffffff,0,38,2);this.group.add(l);return l;
    });
    this.towerReady=new GLTFLoader().loadAsync(towerUrl).then(({scene})=>{
      if(this.disposed){scene.traverse(n=>{n.geometry?.dispose();n.material?.dispose()});return}
      scene.position.set(world.tower.x,0,world.tower.z);this.group.add(scene);this.tower=scene;
    });
  }
  material(params,basic=false){
    const m=basic?new T.MeshBasicMaterial(params):new T.MeshStandardMaterial(params);
    this.materials.push(m);return m;
  }
  texture(t){this.textures.push(t);return t;}
  sign(id,vertical=false,custom=null,bg){
    const key=(custom?.join('|')||id)+'/'+vertical;
    if(!this.signs.has(key))this.signs.set(key,this.material({map:this.texture(signTexture(id,bg||shopColors[id%8],vertical,custom))},true));
    return this.signs.get(key);
  }
  part(f,along,side,up,w,h,d,mat=this.concrete,tint=0xffffff,shape='box',turn=0){
    const p=at(f,along,side,up);
    this.kit.put(shape,mat,p.x,p.y,p.z,w,h,d,yawOf(f)+turn,tint);
  }
  glow(f,along,side,up,color,power=50,kind=null){
    const p=at(f,along,side,up);
    this.sources.push({p,color,power,kind});
  }
  buildSky(){
    // A deep navy dome behind the skyline plate: Tokyo's night sky is never
    // black, it carries the city's own light pollution up to about 25 degrees.
    const dome=document.createElement('canvas');dome.width=32;dome.height=512;
    const dc=dome.getContext('2d'),dg=dc.createLinearGradient(0,0,0,512);
    dg.addColorStop(0,'#01030a');dg.addColorStop(.45,'#03091a');dg.addColorStop(.72,'#071226');
    dg.addColorStop(.9,'#0e1a33');dg.addColorStop(1,'#1e2238');
    dc.fillStyle=dg;dc.fillRect(0,0,32,512);
    const domeTex=new T.CanvasTexture(dome);domeTex.colorSpace=T.SRGBColorSpace;this.texture(domeTex);
    this.skyDome=new T.Mesh(new T.SphereGeometry(1600,24,12),
      new T.MeshBasicMaterial({map:domeTex,side:T.BackSide,depthWrite:false,depthTest:false,fog:false,toneMapped:false}));
    this.skyDome.renderOrder=-1000;this.skyDome.frustumCulled=false;this.group.add(this.skyDome);

    // Additive haze sits inside the skyline plate, warming the horizon band
    // without washing out the tower windows.
    const glow=document.createElement('canvas');glow.width=512;glow.height=512;
    const gc=glow.getContext('2d'),gg=gc.createLinearGradient(0,512,0,0);
    gg.addColorStop(0,'rgba(60,35,40,.18)');gg.addColorStop(.2,'rgba(120,62,56,.22)');
    gg.addColorStop(.3,'rgba(255,132,86,.34)');gg.addColorStop(.4,'rgba(160,80,120,.16)');
    gg.addColorStop(.58,'rgba(40,55,120,.05)');gg.addColorStop(1,'rgba(0,0,0,0)');
    gc.fillStyle=gg;gc.fillRect(0,0,512,512);
    const rand=createRandom(8192);
    for(let i=0;i<16;i++){
      const x=rand()*512,y=300+rand()*95,r=38+rand()*92;
      const rg=gc.createRadialGradient(x,y,0,x,y,r);
      rg.addColorStop(0,'rgba(255,172,126,.06)');rg.addColorStop(1,'rgba(255,172,126,0)');
      gc.fillStyle=rg;gc.fillRect(x-r,y-r,r*2,r*2);
    }
    const glowTex=new T.CanvasTexture(glow);glowTex.colorSpace=T.SRGBColorSpace;this.texture(glowTex);
    this.skyGlow=new T.Mesh(new T.CylinderGeometry(840,840,520,48,1,true),
      new T.MeshBasicMaterial({map:glowTex,side:T.BackSide,transparent:true,depthWrite:false,fog:false,
        toneMapped:false,blending:T.AdditiveBlending}));
    this.skyGlow.renderOrder=-9;this.skyGlow.frustumCulled=false;this.group.add(this.skyGlow);
  }

  buildStreetDetail(){
    const [main,neon,,bay]=this.world.roads;
    for(const r of [main,neon])this.paintLanes(r);
    for(const r of [main,neon,bay])this.streetFurniture(r);
    for(const r of [main,neon,bay])this.puddles(r);
    for(const r of [main,neon,bay])this.streetLamps(r);
    for(const r of [main,neon,bay])this.utilityLine(r,r===neon?-1:1);
    for(const r of [main,neon,bay])this.parkingSlots(r);
    this.buildIntersections();
  }

  paintLanes(r){
    const width=r.halfWidth[0];
    for(let s=18;s<r.length-18;s+=9){
      const f=r.frameAt(s,{});
      if(Math.abs(f.y)>1.5)continue;
      for(const side of [-1,1]){
        const off=side*width*.5;
        if(!this.clearsRoads(f,off,3.6,.18,.25,r))continue;
        this.part(f,0,off,.022,3.6,.012,.15,this.lit,0xc8c6bd,'plane');
      }
    }
  }

  streetLamps(r){
    const curb=r.halfWidth[0];
    for(let s=12;s<r.length-24;s+=38){
      const f=r.frameAt(s,{});
      if(Math.abs(f.y)>1.5)continue;
      const side=(Math.floor(s/38)%2?1:-1),base=side*(curb+.95);
      if(!this.clearsRoads(f,base,.6,.6,7.6,r))continue;
      this.part(f,0,base,3.75,.18,7.5,.18,this.steel,0x5b6168,'round');
      this.part(f,0,base-side*1.2,7.42,.13,.11,2.4,this.steel,0x50565c);
      this.part(f,0,base-side*2.25,7.34,.34,.16,.62,this.steel,0x40464d);
      this.part(f,0,base-side*2.25,7.25,.30,.05,.54,this.lit,0xd6e5ff,'round');
      this.glow(f,0,base-side*2.25,7.2,0xc9ddff,74);
      this.block(f,0,base,0,.24,7.5,.24);
    }
  }

  streetFurniture(r){
    const width=r.halfWidth[0],rand=this.rand;
    for(let s=36;s<r.length-36;s+=43){
      const f=r.frameAt(s,{});
      if(Math.abs(f.y)>1.5)continue;
      // Utility covers and storm drains break up the black carriageway.
      if((s/43)%3===0)this.part(f,0,(rand()-.5)*width*1.1,.026,.72,.02,.72,this.steel,0x2b2d31,'round');
      const side=(s/43)%2<1?1:-1;
      this.part(f,0,side*(width-.44),.027,.54,.02,1.0,this.steel,0x25272a);
      if((s/43)%4===0)this.part(f,0,0,.012,.05,.008,width*1.96,this.concrete,0x1a1c1f,'plane');
    }
  }

  puddles(r){
    const width=r.halfWidth[0];
    for(let s=104;s<r.length-40;s+=79){
      const f=r.frameAt(s,{});
      if(Math.abs(f.y)>1.4)continue;
      const side=(Math.floor(s/79)%2?1:-1),off=side*(width*.48+(s%5)*.4);
      if(!this.clearsRoads(f,off,6.6,3.2,.12,r))continue;
      this.part(f,0,off,.017,6.6,1,3.2,this.puddle,0xffffff,'plane');
    }
  }

  utilityLine(r,side){
    const curb=r.halfWidth[0],off=side*(curb+1.05);
    let prev=null;
    for(let s=26;s<r.length-30;s+=52){
      const f=r.frameAt(s,{});
      if(Math.abs(f.y)>1.6||!this.clearsRoads(f,off,.7,.7,10,r)){prev=null;continue;}
      const base={...f};
      this.part(base,0,off,4.6,.20,9.2,.20,this.concrete,0x64615a,'round');
      this.part(base,0,off,7.7,.12,.14,2.5,this.steel,0x4a4640);
      this.part(base,0,off,8.25,.12,.14,2.0,this.steel,0x4a4640);
      this.part(base,0,off,6.55,.5,.8,.5,this.steel,0x565049,'round');
      this.block(base,0,off,0,.34,9.2,.34);
      if(prev && s-prev.s<70){
        for(const [h,lat] of [[8.14,-.74],[8.14,.74],[7.62,0]]){
          let last=null;
          for(let k=0;k<=3;k++){
            const t=k/3,ff=r.frameAt(prev.s+(s-prev.s)*t,{});
            const p=at(ff,0,off+lat,h-.55*Math.sin(Math.PI*t));
            if(last)this.kit.beam(this.steel,last,p,.035,0x2f2d2b);
            last=p;
          }
        }
      }
      prev={s};
    }
  }

  parkingSlots(r){
    const curb=r.halfWidth[0];
    for(let s=55;s<r.length-50;s+=32){
      const f=r.frameAt(s,{});
      if(Math.abs(f.y)>1.4)continue;
      const side=(Math.floor(s/32)%2?1:-1),off=side*(curb-1.05);
      if(this.stops?.some(st=>Math.hypot(st.point.x-f.x,st.point.z-f.z)<10))continue;
      if(!this.clearsRoads(f,off,4.6,2.1,2.2,r))continue;
      this.slots.push({f:{...f},side:off,floor:null});
    }
  }

  junctionCrosswalks(){
    const {roads}=this.world,links=roads.filter(r=>r.name==='District link'),seen=new Set(),q={};
    for(const link of links)for(const atEnd of [false,true]){
      const e=link.frameAt(atEnd?link.length-1:0,{});
      for(const r of roads){
        if(!r.closed||r===this.world.gymkhana)continue;
        if(!r.locate(e.x,e.z,q,e.y)||q.beyondEnd||q.distance>r.halfWidth[0]+8)continue;
        if(Math.abs(q.y-e.y)>2.2)continue;
        const key=r.id+':'+Math.round(q.s/8);
        if(seen.has(key))continue;seen.add(key);
        const width=r.halfWidth[0];
        for(const dir of [-1,1]){
          const base=q.s+dir*9.2;
          for(let k=-2;k<=2;k++){
            const f=r.frameAt(base+k*.94,{});
            if(!this.clearsRoads(f,0,.6,width*1.94,.03,r,link))continue;
            this.part(f,0,0,.028,.6,.012,width*1.94,this.lit,0xd8d4c7,'plane');
          }
        }
      }
    }
  }

  buildLampHalos(){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
    const ctx=canvas.getContext('2d'),fade=ctx.createRadialGradient(32,32,0,32,32,32);
    fade.addColorStop(0,'rgba(255,255,255,.83)');
    fade.addColorStop(.12,'rgba(255,255,255,.37)');
    fade.addColorStop(.4,'rgba(255,255,255,.13)');
    fade.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=fade;ctx.fillRect(0,0,64,64);
    const positions=[],colors=[],tint=new T.Color();
    for(const {p,color} of this.sources){
      positions.push(p.x,p.y,p.z);tint.setHex(color);colors.push(tint.r,tint.g,tint.b);
    }
    const geometry=this.haloGeometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    const mat=new T.PointsMaterial({map:this.texture(new T.CanvasTexture(canvas)),vertexColors:true,
      size:4.8,transparent:true,depthWrite:false,blending:T.AdditiveBlending});
    this.materials.push(mat);this.group.add(new T.Points(geometry,mat));
  }
  block(f,along,side,bottom,length,height,width){
    const norm=Math.hypot(f.tx,f.tz);
    this.solid.push({p:at(f,along,side,bottom),h:height,box:{
      tx:f.tx/norm,tz:f.tz/norm,length:length/2,width:width/2}});
  }
  clearsRoads(f,side,length,width,height,except=null,except2=null,margin=2){
    const q={};
    // Sample the full footprint, not just three points. Long service walls
    // and buildings on tight bends can thread a carriageway between sparse
    // probes, which used to leave walls and shopfronts parked across a live
    // racing line. A 3.5 m grid is fine enough that no road (>= 9 m wide)
    // can slip between two probes.
    const along=Math.max(3,Math.min(41,Math.ceil(length/3.5)+1));
    const across=Math.max(3,Math.min(25,Math.ceil(width/3.5)+1));
    for(let ai=0;ai<along;ai++){
      const a=along===1?0:ai/(along-1)-.5;
      for(let bi=0;bi<across;bi++){
        const b=across===1?0:bi/(across-1)-.5;
        const v=at(f,a*length,side+b*width);
        if(this.world.roads.some(r=>r!==except && r!==except2 && r.locate(v.x,v.z,q) && !q.beyondEnd &&
          q.y>=v.y-1.3 && q.y<=v.y+height+1 && q.distance<q.halfWidth+margin))return false;
      }
    }
    return true;
  }
  // The harbour basin fills the whole interior of the Bay Run plus the open
  // water east of its elevated span. The generator used to keep building
  // frontage inside the ring, leaving apartment blocks standing in the bay;
  // every massing test now asks this before it asks the road test.
  bayContour(){
    if(this.bayPoly!==null)return this.bayPoly;
    const r=this.world.roads[3];
    if(!r)return null;
    // Follow the centreline instead of an inward offset. Tight port corners
    // can invert a 10 m offset and make the contour self-intersect, which
    // earcut resolves into large unexplained holes in the water. The road
    // surface, quay walk and pier cover the water along the rim anyway.
    const pts=[];
    for(let s=0;s<r.length;s+=12){
      const f=r.frameAt(s,{});
      pts.push([f.x,f.z]);
    }
    let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9;
    for(const [x,z] of pts){
      if(x<minX)minX=x;if(x>maxX)maxX=x;if(z<minZ)minZ=z;if(z>maxZ)maxZ=z;
    }
    this.bayPoly={pts,minX,maxX,minZ,maxZ};
    return this.bayPoly;
  }
  inBasin(x,z,pad=0){
    // The open bay east of the elevated shore span runs to the horizon plate.
    if(x>2830-pad && z>-460-pad && z<1660+pad)return true;
    const poly=this.bayContour();
    if(!poly)return false;
    const test=(px,pz)=>{
      if(px<poly.minX||px>poly.maxX||pz<poly.minZ||pz>poly.maxZ)return false;
      let inside=false;const pts=poly.pts;
      for(let i=0,j=pts.length-1;i<pts.length;j=i++){
        const [xi,zi]=pts[i],[xj,zj]=pts[j];
        if(((zi>pz)!==(zj>pz)) && px<(xj-xi)*(pz-zi)/(zj-zi)+xi)inside=!inside;
      }
      return inside;
    };
    if(test(x,z))return true;
    if(pad<=0)return false;
    const r=pad*.7;
    return test(x+r,z)||test(x-r,z)||test(x,z+r)||test(x,z-r);
  }
  basinClear(f,side,length,width){
    for(const a of [-.5,0,.5])for(const b of [-.5,0,.5]){
      const v=at(f,a*length,side+b*width);
      if(this.inBasin(v.x,v.z,1.2))return false;
    }
    return true;
  }
  building(r,s,side,style){
    const f=r.frameAt(s,{}),rand=this.rand;
    const w=style==='alley'?11+rand()*6:16+rand()*10,d=10+rand()*7;
    f.y=0;
    const curb=r.halfWidth[0]+1.1, front=curb+2.2+rand()*1.6,mid=(front+d/2)*side;
    const p=at(f,0,mid),q={};
    const garage=this.world.parkade;
    const dx=p.x-garage.cx,dz=p.z-garage.cz;
    if(Math.abs(dx*garage.ax+dz*garage.az)<73 && Math.abs(dx*garage.bx+dz*garage.bz)<47)return;
    if(Math.hypot(p.x-this.world.tower.x,p.z-this.world.tower.z)<44 || (r.id===0 && side===1 && s>745 && s<974))return;
    if(this.world.roads.some(other=>other!==r && other.locate(p.x,p.z,q) && q.y>-3 && q.distance<q.halfWidth+Math.hypot(w,d)*.53))return;
    // A hairpin can put a second part of this same road behind a shop.
    // Validate the full facade footprint against both sides of that bend.
    for(const u of [-.48,0,.48])for(const offset of [-.44,.44]){
      const corner=at(f,u*w,mid+side*d*offset);
      if(r.locate(corner.x,corner.z,q) && q.distance<q.halfWidth+1.5)return;
    }
    const n=Math.floor(rand()*8),high=style==='office'||style==='electric';
    const h=style==='alley'?9+rand()*13:high?24+rand()*48:14+rand()*24;
    const skin=high&&rand()>.32?this.skin.office:style==='alley'?this.skin.flats:this.skin.shops;
    // Validate the complete massing, including this road's other bend and
    // every flyover deck at this height. Sparse corner probes used to let a
    // building swallow a hairpin or a raised link.
    if(!this.clearsRoads(f,mid,w,d,h))return;
    // Never build a block into the harbour basin: those were the towers that
    // appeared to rise straight out of the bay when seen from the quay.
    if(!this.basinClear(f,mid,w+.4,d+.4))return;
    // Remember the frontage interval so the gaps between blocks can be
    // turned into walled service alleys instead of holes into the void.
    const key=r.id+':'+side;
    let lots=this.lots.get(key);
    if(!lots)this.lots.set(key,lots=[]);
    lots.push({s,w,d,front,h,n,style});
    this.part(f,0,mid,h/2,w,h,d,skin);
    this.part(f,0,mid,h+.25,w+.45,.5,d+.45,this.steel,0x565965);
    this.part(f,w*.18,mid,h+1.4,w*.34,2.5,d*.54,this.concrete,0x51525c);
    this.part(f,0,side*(front-.40),2,w-.35,4,.9,style==='alley'&&n%3===0?this.skin.grill:style==='electric'&&n%2===0?this.skin.gamehall:s>3630&&s<3830?this.skin.workshop:n%2?this.skin.market:this.skin.ramen);
    this.part(f,0,side*(front-1),4.1,w+.4,.28,2.5,this.steel,n%2?0x314963:0x632f33);
    this.part(f,0,side*(front-1.1),4.85,w*.86,1.4,.22,this.sign(n));
    this.part(f,w*.39,side*(front-1.2),7.7,1.65,5.4,.45,this.sign((n+2)%8,true));
    this.part(f,0,side*(front-.8),3.95,w*.87,.09,.15,this.lit,cityColors[n%6]);
    if(style==='electric'||(style==='office'&&rand()>.56)){
      const ad=this.skin['ad'+n%4]||this.sign(n);
      this.part(f,-w*.10,side*(front-.16),h*.59,w*.67,Math.min(13,h*.41),.45,ad);
    }
    if(n%3===0){
      this.part(f,-w*.35,side*(front-1.35),1.02,1.22,2.04,.83,this.steel,0xad292b);
      this.part(f,-w*.35,side*(front-1.82),1.34,1.02,.96,.06,this.sign(3));
      this.part(f,-w*.35,side*(front-1.83),.50,.76,.24,.06,this.concrete,0x24282d);
    }
    if(style==='alley'){
      if(n%2===0){
        for(let k=-2;k<=2;k++){
          this.part(f,k*w*.16,side*(front-1),.99,.8,.13,.8,this.concrete,0x946e49);
          this.part(f,k*w*.16,side*(front-1),.50,.16,.94,.16,this.steel,0x5b5350);
          this.part(f,k*w*.16,side*(front-1),1.11,.30,.17,.30,this.concrete,0xe7d3a2,'lamp');
        }
      }
      for(let k=0;k<2;k++)this.kit.beam(this.steel,at(f,-w*.52,side*(front-1),8+k*.3),at(f,w*.52,side*front,7.6+k*.3),.046,0x343940);
      for(const a of [-.35,0,.35])this.part(f,a*w,side*(front-1.6),3.2,.68,.84,.68,this.lit,0xff8155,'lamp');
    }
    // Neon spill belongs on the asphalt, not over the raised pavement: keep it
    // narrow, close to the curb and let the texture carry the falloff.
    this.part(f,0,side*(r.halfWidth[0]-1.65),.034,w*.62,1,3,this.reflect,cityColors[n%6],'plane');
    if(s%100<38)this.glow(f,0,side*(front-2),4,cityColors[n%6],78);
    // Street footprints retain their vertical extents at overlapping flyovers.
    // Break up the long retail strips with projecting blades, facade ribs,
    // balcony galleries and awnings at the height of the driving camera.
    const face=front-.55;
    for(const u of [-.42,.42])this.part(f,w*u,side*face,h*.5,.43,h,.64,this.steel,0x535964);
    if(n%2===0){
      for(let y=8;y<h-2;y+=5.8){
        this.part(f,0,side*face,y,w*.79,.24,1.6,this.concrete,0x727680);
        this.part(f,0,side*(face-.75),y+.57,w*.79,.65,.13,this.steel,0x474e56);
      }
    }else{
      const sign=this.sign(n,true);
      this.part(f,-w*.38,side*(front-1.55),10.8,.46,8.3,2.1,sign);
      for(const y of [7.9,13.6])this.part(f,-w*.38,side*(front-.75),y,.22,.19,2.1,this.steel,0x67696a);
    }
    for(const u of [-.27,0,.27]){
      this.part(f,w*u,side*(front-.96),2.25,.09,3.75,.13,this.steel,0x2e3036);
      if(n%3===1)this.part(f,w*u,side*(front-1.7),3.32,w*.22,.87,.13,this.concrete,0x9b333d);
    }
    if(n%3===0){
      const behind=side*(front+d+12),bw=w*1.32,bh=h+12+n*4;
      if(this.clearsRoads(f,behind,bw,16,bh) && Math.hypot(p.x-this.world.tower.x,p.z-this.world.tower.z)>180){
        this.part(f,0,behind,bh/2,bw,bh,16,n%2?this.skin.office:this.skin.flats,n%2?0xb3bbc7:0xe5d7b4);
        this.block(f,0,behind,0,bw,bh,16);
        this.part(f,0,behind,bh+.48,bw+.4,.96,16.4,this.steel,0x626471);
        this.part(f,-bw*.2,behind,bh+2.6,bw*.48,4.3,8,this.concrete,0x656975);
        this.part(f,bw*.32,behind,bh+3.1,.18,6.2,.18,this.steel);
        this.part(f,bw*.32,behind,bh+6.3,.34,.29,.34,this.lit,0xef493b);
      }
    }
    // Rooftop plant, tanks and aerials so the skyline reads as a real city
    // instead of a row of clean boxes.
    if(n%4!==1){
      const ry=h+.5;
      if(n%2===0){
        this.part(f,-w*.24,mid,ry+1.05,1.7,2.1,1.7,this.concrete,0x85878b,'round');
        this.part(f,-w*.24,mid,ry+2.3,.9,.14,.9,this.steel,0x5d6065,'round');
        for(const a of [-.55,.55])this.part(f,-w*.24+a,mid,ry+.35,.12,.7,.12,this.steel,0x4c4e52);
      }
      for(let k=0;k<1+n%3;k++)this.part(f,w*(.06+k*.16),mid+.7*(k%2?1:-1),ry+.45,.9,.9,.72,this.steel,0x6b6f75);
      if(n%3===0){
        this.kit.beam(this.steel,at(f,w*.34,mid,ry),at(f,w*.34,mid,ry+6.5),.09,0x3c3d40);
        this.part(f,w*.34,mid,ry+6.6,.24,.24,.24,this.lit,0xef493b,'lamp');
      }
      if(h>34&&rand()>.55)this.part(f,0,mid-side*(d*.5-.45),ry+2.2,w*.5,3.2,.3,this.skin['ad'+n%4]||this.skin.market);
    }
    this.block(f,0,mid,0,w,h,d);
    this.block(f,0,side*(front-.4),0,w-.35,4,.9);
  }
  // True when any part of a 48 m ground tile lies over the harbour. Water now
  // sits more than a metre below the quay, so a single stray tile would read as
  // a concrete raft floating on the tide.
  tileOverWater(x,z,size){
    for(const a of [0,1])for(const b of [0,1]){
      if(this.inBasin(x*size+a*size,z*size+b*size,0))return true;
    }
    return this.inBasin((x+.5)*size,(z+.5)*size,0);
  }
  buildGround(){
    // One continuous dark ground plane under the whole district, cut away over
    // the harbour basin. The detailed 48 m tiles sit on top of it, so a street
    // that escapes the frontage infill still lands on city floor instead of
    // showing the sky dome through a hole, while the bay keeps its full depth.
    const contour=this.bayContour();
    const outer=new T.Shape();
    outer.moveTo(-2350,-3380);outer.lineTo(4050,-3380);outer.lineTo(4050,3020);outer.lineTo(-2350,3020);outer.closePath();
    if(contour){
      const hole=new T.Path();
      contour.pts.forEach(([x,z],i)=>{if(i===0)hole.moveTo(x,-z);else hole.lineTo(x,-z);});
      hole.closePath();outer.holes.push(hole);
    }
    const baseGeo=new T.ShapeGeometry(outer);
    baseGeo.rotateX(-Math.PI/2);
    const floor=this.floor||(this.floor=this.material({color:0x232830,roughness:.92,metalness:.02,envMapIntensity:.22}));
    const base=new T.Mesh(baseGeo,floor);
    base.position.set(0,-.38,0);base.name='Tokyo city floor';
    this.group.add(base);this.base=base;
    // Coarse pavement tiles leave openings around tunnel approaches and the underground garage.
    const occupied=new Set(),excluded=new Set(),size=48;
    for(const r of this.world.roads)for(let i=0;i<r.count;i+=4){
      const x=Math.floor(r.px[i]/size),z=Math.floor(r.pz[i]/size);
      for(let a=-2;a<=2;a++)for(let b=-2;b<=2;b++){
        const key=(x+a)+','+(z+b);
        occupied.add(key);
        if(Math.abs(a)<=1&&Math.abs(b)<=1&&(r.id===4||r.py[i]<-.2))excluded.add(key);
      }
    }
    for(const key of occupied){
      const [x,z]=key.split(',').map(Number);
      if(this.tileOverWater(x,z,size))continue;
      if(excluded.has(key)){
        // Keep the city block intact around tunnel mouths. Only cut paving where
        // an underground lane actually passes through the surface.
        const q={},unit=size/6;
        for(let a=0;a<6;a++)for(let b=0;b<6;b++){
          const px=x*size+(a+.5)*unit,pz=z*size+(b+.5)*unit;
          const cut=this.world.roads.some(r=>r.locate(px,pz,q,-2) && !q.beyondEnd &&
            q.y<-.12 && q.y>-8 && q.distance<q.halfWidth+unit*.72);
          if(!cut)this.kit.put('plane',this.concrete,px,-.35,pz,unit+.02,1,unit+.02,0,0x444952);
        }
        this.kit.put('plane',this.concrete,(x+.5)*size,-14,(z+.5)*size,size+.03,1,size+.03,0,0x393c45);
        continue;
      }
      this.kit.put('plane',this.concrete,(x+.5)*size,-.35,(z+.5)*size,size+.05,1,size+.05,0,0x444952);
    }
    this.buildBay();
  }
  buildBay(){
    // The basin is the area enclosed by the Bay Run, not a ribbon of water
    // floating alongside it. A triangulated contour follows the road's inner
    // shoulder exactly, so the quay line never cuts across the carriageway
    // and no harbour water can leak under the city frontage.
    const contour=this.bayContour();
    if(!contour)return;
    const shape=new T.Shape();
    contour.pts.forEach(([x,z],i)=>{if(i===0)shape.moveTo(x,-z);else shape.lineTo(x,-z);});
    const geo=new T.ShapeGeometry(shape);
    geo.rotateX(-Math.PI/2);
    const uv=geo.attributes.uv,pos=geo.attributes.position;
    for(let i=0;i<uv.count;i++)uv.setXY(i,pos.getX(i)/132+.18,pos.getZ(i)/132+.31);
    uv.needsUpdate=true;
    const basin=new T.Mesh(geo,this.bay);
    basin.position.y=this.bayLevel;basin.name='Tokyo Bay basin';basin.renderOrder=-1;
    this.group.add(basin);this.basin=basin;
    // A second, coarser scroll of the same breakup runs over the basin at a
    // different scale and angle. A single tiling reads as painted bands from
    // the quay; the interference between the two passes reads as moving water.
    this.bayTex2=this.texture(this.bayTex.clone());
    this.bayTex2.needsUpdate=true;
    this.bayTex2.repeat.set(2.3,3.4);
    this.bayTex2.rotation=.16;
    this.bayTex2.center.set(.5,.5);
    this.baySheen=this.material({map:this.bayTex2,color:0x5d7f96,transparent:true,opacity:.16,
      depthWrite:false,blending:T.AdditiveBlending},true);
    const sheen=new T.Mesh(geo,this.baySheen);
    sheen.position.y=this.bayLevel+.03;sheen.renderOrder=-1;sheen.name='Tokyo Bay sheen';
    this.group.add(sheen);this.sheen=sheen;
    // Open water outside the elevated span. It sits five millimetres lower
    // than the basin so the strip where the two sheets overlap (under the
    // skyway) cannot z-fight; from the quay the join is invisible.
    const open=new T.Mesh(new T.PlaneGeometry(1210,2200),this.bay);
    open.rotation.x=-Math.PI/2;
    open.position.set(3430,this.bayLevel-.005,600);
    open.name='Tokyo Bay';open.renderOrder=-2;
    this.group.add(open);this.sea=open;
  }
  buildStreets(){
    const [main,neon,,bay,,entry]=this.world.roads;
    for(const r of this.world.roads){
      if(r.id===4||r===this.world.gymkhana)continue;
      const roadWidth=r.halfWidth[0],dense=r===main||r===neon,step=dense?22:44;
      for(let s=6;s<r.length;s+=step){
        const f=r.frameAt(s,{}),isTunnel=f.y < -2;
        if(dense || (r!==entry && !isTunnel)){
          const style=r===neon&&s>900?'alley':r===main&&s>1280&&s<2450?'electric':r===bay?'port':'office';
          if(style!=='port')for(const side of [-1,1])this.building(r,s,side,style);
        }
      }
      // Short sections follow the actual graded centreline through turns and tunnel portals.
      for(let s=0;s<r.length;s+=9){
        const f=r.frameAt(s,{}),n=r.frameAt(Math.min(s+9,r.length),{}),span=Math.hypot(f.x-n.x,f.z-n.z);
        if(span<.1)continue;
        const mid={...f,x:(f.x+n.x)/2,y:(f.y+n.y)/2,z:(f.z+n.z)/2,tx:(n.x-f.x)/span,tz:(n.z-f.z)/span};
        mid.rx=-mid.tz;mid.rz=mid.tx;
        if(f.y<-1.8){
          for(const side of [-1,1]){
            this.part(mid,0,side*(roadWidth+1.6),2.9,span+.25,6.6,.7,this.concrete,0xaaa9a4);
            this.part(mid,0,side*(roadWidth+1.19),1.25,span+.15,.28,.08,this.lit,0x748a92);
          }
          this.part(mid,0,0,6.18,span+.25,.45,2*roadWidth+4,this.concrete,0x7b8183);
          this.part(mid,0,0,5.87,1.5,.12,5.2,this.lit,s%144<72?0xffd799:0xc9f0ff);
          if(s%54===0)this.glow(mid,0,0,4.9,0xffd6a0,122);
          if(s%108===0){
            for(const side of [-1,1])this.part(mid,0,side*4,4.73,2.2,.98,.98,this.steel,0x848991,'lamp');
            this.part(mid,0,roadWidth+1.05,2.9,.20,5.4,.24,this.concrete,0x577078);
          }
          if(s%126===0)this.part(mid,0,-roadWidth-.98,1.65,1.5,2.8,.15,this.sign(13));
        }else if(f.y>1.6){
          this.part(mid,0,0,-.57,span+.25,1.1,2*roadWidth+1.9,this.concrete,0x77808b);
          if(s%45===0){
            const base={...mid,y:0};
            for(const side of [-1,1]){
              const offset=side*(roadWidth-1.4);
              if(!this.clearsRoads(base,offset,1.8,1.8,mid.y-2))continue;
              const height=mid.y-1.1;
              this.part(base,0,offset,height/2,1.8,height,1.8,this.concrete,0x76808b);
              this.block(base,0,offset,0,1.8,height,1.8);
            }
          }
          for(const side of [-1,1]){
            const rail=side<0?r.railLeft:r.railRight;
            if(!rail[f.index])continue;
            this.part(mid,0,side*(roadWidth+1),.69,span+.25,1.35,.45,this.concrete,0x9a9e9b);
            this.part(mid,0,side*(roadWidth+1),1.38,span+.25,.12,.55,this.concrete,0x74797a);
            if(s%27===0)this.part(mid,0,side*(roadWidth+.76),.69,.07,1.3,.03,this.concrete,0x606567);
          }
          if(s%27===0)this.part(mid,0,0,.008,.22,.016,2*roadWidth-.3,this.steel,0x34393b);
        }else if(r!==entry){
          this.part(mid,0,0,-.48,span+.35,.5,2*roadWidth+10,this.concrete,0x484c54);
        }
        if(!dense && s%270===0 && r!==entry && r.name!=='District link' && Math.abs(f.y)<1.6 &&
          this.clearsRoads(mid,-roadWidth-.45,.8,.8,7.8,r)){
          this.part(mid,0,-roadWidth-.45,3.9,.30,7.8,.30,this.steel,0xb0b1af);
          this.part(mid,0,-roadWidth*.42,6.75,.25,.28,roadWidth*1.2,this.steel);
          this.part(mid,0,-roadWidth*.42,7.1,.22,2.15,6.4,this.sign(10,false,['湾岸線 ↑','BAYSHORE ROUTE  /  B'],'#17654e'));
        }
        // The pavement and its wheel contact surface share a +0.155 m deck.
        if(r!==entry && Math.abs(f.y)<1.6){
          const curb=r.halfWidth[0];
          for(const side of [-1,1]){
            // The bay road's inner pavement is the quay walk. Stop it at the
            // coping instead of running a four-metre slab out over the basin.
            const quay=r===bay&&side===1;
            const walk=quay?2.7:4.6,center=side*(curb+(quay?1.35:2.5));
            if(!this.clearsRoads(mid,center,span,walk,.35,r))continue;
            // Fill down to the city plane so the slab never floats over a gap.
            this.part(mid,0,center,-.0975,span+.12,.505,walk,this.pavement,0xffffff);
            this.part(mid,0,side*(curb+.16),.075,span+.12,.15,.24,this.concrete,0x76746f);
            // Tactile guidance strip and transverse expansion joints.
            this.part(mid,0,center,.162,span+.12,.006,.30,this.concrete,0xc7a03a,'plane');
            this.part(mid,0,center,.161,.045,.006,walk-.04,this.concrete,0x66645f,'plane');
          }
        }
        if(mid.y>=-1.8 && s%45===0){
          const side=s%90===0?1:-1;
          this.part(mid,0,side*(roadWidth+1.6),4.45,.18,8.9,.18,this.steel,0xaeb0aa);
          this.part(mid,0,side*roadWidth,8.8,.17,.18,3.4,this.steel);
          this.part(mid,0,side*(roadWidth-.9),8.6,.55,.13,1.6,this.lit,0xffdfb7);
          this.part(mid,0,side*(roadWidth-.8),.045,4,1,8,this.reflect,0xbfa47d,'plane');
          if(s%135===0)this.glow(mid,0,side*(roadWidth-1),7.2,0xffe4ca,115);
        }
      }
    }
    this.sealFrontages();
  }
  sealFrontages(){
    for(const [key,lots] of this.lots){
      const [idRaw,sideRaw]=key.split(':');
      const r=this.world.roads[Number(idRaw)],side=Number(sideRaw);
      lots.sort((a,b)=>a.s-b.s);
      for(let i=0;i<lots.length-1;i++){
        const a=lots[i],b=lots[i+1];
        const gap=(b.s-b.w/2)-(a.s+a.w/2);
        if(gap<.55)continue;
        const s=(a.s+a.w/2+b.s-b.w/2)/2;
        this.sealGap(r,side,s,gap,a,b);
      }
    }
  }
  // A Tokyo block never ends in a dark hole. Every gap between two buildings
  // becomes a shallow service alley: paved, walled at the back, lit by a single
  // practical, and filled with the dumpsters, crates, AC units, pipes and
  // back-door signage that make the backs of the city read as built space.
  sealGap(r,side,s,gap,a,b){
    const f=r.frameAt(s,{});
    if(Math.abs(f.y)>1.6)return;
    const curb=r.halfWidth[0],mouth=curb+1.0;
    const front=Math.max(curb+3.0,Math.min(a.front,b.front));
    const small=gap<10;
    const depth=small?4.7+Math.min(gap,8)*.34:6.8+Math.min(gap,22)*.09;
    const back=front+depth,mid=(mouth+back)/2,run=back-mouth;
    // If the opening is actually a street mouth, leave it open for the
    // junction pass to dress; do not wall a live road off. The back half of
    // the yard is checked against every road (including a bend of this one),
    // while the front half still tolerates this street's own kerb.
    const yardDepth=back-front;
    if(!this.clearsRoads(f,side*(front+yardDepth/2),gap+.4,yardDepth+.4,9) ||
       !this.clearsRoads(f,side*mid,gap+.4,run+.4,.4,r) ||
       !this.basinClear(f,side*mid,gap+.4,run+.4)){this.gapStats.cross++;return;}
    const tint=[0x8b8a84,0x797c77,0x6f7371,0x92887b,0x7d7469][Math.floor(this.rand()*5)];
    const cap=0xb2b0a8;
    // Paved floor carried into the alley and registered with the ground
    // sampler so wheels stay on the +0.155 m platform the whole way in.
    // Tile the slab with the same 9 m / 4.4 m rhythm as the sidewalk so the
    // paver scale stays constant instead of stretching across a wide gap.
    for(let u0=0;u0<gap;u0+=8.6){
      const uw=Math.min(8.6,gap-u0),ua=-gap/2+u0+uw/2;
      for(let v0=mouth;v0<back;v0+=4.4){
        const vd=Math.min(4.4,back-v0),va=v0+vd/2;
        this.part(f,ua,side*va,-.0975,uw+.012,.505,vd+.012,this.pavement,0xffffff);
      }
    }
    const px=f.x+side*mid*f.rx,pz=f.z+side*mid*f.rz;
    this.world.tokyoPavements.push({x:px,z:pz,tx:f.tx,tz:f.tz,hl:gap/2,hw:run/2,y:f.y+.155});
    const wide=gap>=22;
    const wallH=small?3.25+this.rand()*1.0:wide?5.6+this.rand()*2.6:2.9+this.rand()*.7;
    // Deterministic local random so wall dressing does not perturb the city
    // layout sequence (and so each side of a street stays internally coherent).
    const wr=n=>{const v=Math.sin(gap*12.9898+n*78.233+side*37.719)*43758.5453;return v-Math.floor(v)};
    // Back wall, capped and collided high enough that a jump cannot clear it.
    this.part(f,0,side*back,wallH/2,gap+.55,wallH,.44,this.wall,tint);
    this.part(f,0,side*back,wallH+.05,gap+.66,.1,.56,this.concrete,cap);
    this.block(f,0,side*back,0,gap+.7,Math.max(6.2,wallH+2),.62);
    // Side returns start behind the shopfront line so the public pavement
    // stays open; the neighbours' flanks meet them and close the pocket.
    const inner=front-.3,sideRun=back-inner,sideMid=(inner+back)/2;
    for(const edge of [-1,1]){
      this.part(f,edge*gap/2,side*sideMid,wallH/2,.32,wallH,sideRun,this.wall,tint);
      this.part(f,edge*gap/2,side*sideMid,wallH+.045,.4,.09,sideRun+.1,this.concrete,cap);
      this.block(f,edge*gap/2,side*sideMid,0,.45,Math.max(5.5,wallH+1.2),sideRun);
    }
    // A long flank beside a junction is a real Tokyo building wall. Dress it
    // as a service elevation - pipe runs, condensers, a lit door, a painted
    // tenant sign and a blade sign over the parapet - so it never reads as a
    // blank slab of void with the skyline floating above it.
    if(wide){
      const runL=gap-1.4,py=side*(back-.30);
      this.kit.beam(this.steel,at(f,-runL/2,py,2.75),at(f,runL/2,py,2.75),.06,0x5c6263);
      if(wallH>6.3)this.kit.beam(this.steel,at(f,-runL/2,py,5.05),at(f,runL/2,py,5.05),.045,0x4f5556);
      for(const t of [-.37,.06,.41]){
        const ua=gap*t;
        this.part(f,ua,side*(back-.27),wallH*.5,.09,wallH,.1,this.steel,0x555b5b,'round');
        this.part(f,ua,side*(back-.35),.95,.32,.44,.24,this.steel,0x3f4647);
      }
      for(let k=0;k<2;k++){
        const ua=(k?1:-1)*gap*(.19+wr(3+k)*.09),ay=3.75+k*.95;
        this.part(f,ua,side*(back-.34),ay,.9,.66,.56,this.steel,0x777c7c);
        this.part(f,ua,side*(back-.63),ay,.42,.44,.05,this.steel,0x303636);
      }
      // Recessed service windows and a painted advertising panel break up the
      // flank; without them a 60 m wall reads as a single flat slab.
      for(let k=0;k<5;k++){
        const ua=-gap*.25+k*gap*.115,wy=2.35+(k%2)*1.15;
        this.part(f,ua,side*(back-.29),wy,1.15,.85,.05,this.steel,0x252a2c);
        this.part(f,ua,side*(back-.33),wy,.98,.68,.02,this.lit,[0x6f8798,0x3c4b57,0xffd9a2][k%3]);
      }
      this.part(f,gap*.06,side*(back-.34),4.35,6.0,2.7,.09,this.sign(6+Math.floor(wr(13)*2),false));
      this.part(f,gap*.06,side*(back-.48),6.0,6.25,.18,.44,this.steel,0x3b3f41);
      this.part(f,gap*.06,side*(back-.55),6.1,.9,.16,.22,this.lit,0xffe2b0,'lamp');
      // Upper windows and a steel fire escape make the flank read as the side
      // of a low-rise building, not a retaining wall.
      for(let k=0;k<4;k++){
        const ua=-gap*.20+k*gap*.105;
        this.part(f,ua,side*(back-.27),5.25,1.05,.8,.08,this.steel,0x343a3d);
        this.part(f,ua,side*(back-.32),5.25,.9,.66,.03,this.lit,[0x46525a,0x6a7c88,0xffd9a2][k%3]);
      }
      const fu=-gap*.33;
      for(const fy of [3.2,5.4,7.4]){
        if(fy>wallH-.5)break;
        this.part(f,fu,side*(back-1.0),fy,2.3,.12,1.35,this.steel,0x4a5052);
        this.part(f,fu,side*(back-1.62),fy+.55,2.3,.08,.08,this.steel,0x4a5052);
        for(const e of [-1,1])this.part(f,fu+e*1.1,side*(back-1.0),fy+.28,.08,.56,.08,this.steel,0x4a5052);
        this.kit.beam(this.steel,at(f,fu-1.1,side*(back-1.0),fy),at(f,fu-1.1,side*(back-.28),fy),.04,0x454b4d);
      }
      const du=gap*.30;
      this.part(f,du,side*(back-.24),1.02,1.02,2.04,.07,this.steel,0x3d4446);
      this.part(f,du,side*(back-.29),.86,.72,.2,.04,this.lit,0xd7e5e1);
      this.part(f,du,side*(back-.31),2.32,1.18,.34,.08,this.lit,0xffdfae);
      this.part(f,du,side*(back-.35),2.66,1.3,.42,.1,this.sign(2+Math.floor(wr(7)*3),false));
      this.part(f,-gap*.13,side*(back-.28),Math.min(3.9,wallH-.85),4.9,1.55,.07,
        this.sign(5+Math.floor(wr(9)*3),false));
      const bu=gap*.24;
      this.part(f,bu,side*(back-.62),wallH+.95,.78,3.1,.22,this.sign(Math.floor(wr(11)*8)),0xffffff);
      this.part(f,bu,side*(back-.60),wallH+2.62,.9,.2,.3,this.lit,0xf0dfb6);
      this.part(f,-gap*.28,side*(back-.9),wallH+.55,1.9,1.1,1.2,this.steel,0x5d6364);
      this.part(f,gap*.35,side*(back-.85),wallH+.4,1.3,.8,1.0,this.concrete,0x8e908b);
    }
    // Wide gaps on secondary streets get a row of small frontage shops,
    // leaving a central lane into the service alley. The frontage reads as a
    // real block instead of a broad empty apron, and the back wall still seals.
    if(gap>=12){
      this.gapStats.wide++;
      const entry=Math.min(6.2,gap*.32);
      for(const sgn of [-1,1]){
        const band=(gap-entry)/2,count=Math.max(1,Math.round(band/7.4)),uw=band/count-.65;
        for(let k=0;k<count;k++){
          const ua=sgn*(entry/2+band*(k+.5)/count);
          const lat=front+2.55;
          const cx=f.x+ua*f.tx+side*lat*f.rx,cz=f.z+ua*f.tz+side*lat*f.rz;
          const uf={x:cx,y:f.y,z:cz,tx:f.tx,tz:f.tz,rx:f.rx,rz:f.rz};
          const uh=3.9+this.rand()*4.8,ud=4.6;
          if(!this.clearsRoads(uf,0,uw+.6,ud+.6,uh+1)){
            this.gapStats.shopMiss++;
            // A road mouth stole the shop slot. Close the remaining street
            // frontage with a proper compound wall instead of letting the
            // far service wall show through as an unlit black band.
            this.frontageSegment(f,ua,side,front,uw,r);
            continue;
          }
          this.gapStats.shops++;
          const uskin=this.rand()>.4?this.skin.shops:this.skin.ramen;
          this.part(uf,0,0,uh/2,uw,uh,ud,uskin,0xffffff);
          this.part(uf,0,0,uh+.18,uw+.3,.34,ud+.3,this.steel,0x5b5e68);
          // Lit shopfront and awning face the street, not the service lane.
          this.part(uf,0,-side*(ud/2+.035),1.55,uw-.52,3.05,.08,this.skin.shops);
          this.part(uf,0,-side*(ud/2+.55),3.72,uw-.35,.13,1.0,this.steel,0x3b3e45);
          this.part(uf,0,-side*(ud/2+.09),3.35,uw-.5,.52,.07,this.sign(Math.floor(this.rand()*8),false));
          this.part(uf,-uw*.26,-side*(ud/2+.08),2.35,.7,2.1,.07,this.steel,0x3e4547);
          this.part(uf,uw*.2,-side*(ud/2+.12),1.0,.9,.52,.07,this.lit,0xffdfae);
          this.glow(uf,-uw*.1,-side*(ud/2+.3),2.5,0xffcf9c,46);
          this.block(uf,0,0,0,uw,uh,ud);
        }
      }
    }
    // Back door, service sign and meter box.
    const along=(this.rand()-.5)*gap*.34;
    this.part(f,along,side*(back-.26),1.15,.92,1.72,.07,this.steel,0x3f4649);
    this.part(f,along,side*(back-.31),1.05,.72,.22,.04,this.lit,0xd8e2e2);
    this.part(f,along+1.25,side*(back-.28),2.5,1.7,.82,.08,this.sign(4+Math.floor(this.rand()*3),false));
    this.part(f,-gap*.38,side*(back-.28),1.55,.32,.52,.16,this.steel,0x59605c);
    // Air-conditioning condenser, downpipe and cable tray.
    this.part(f,gap*.32,side*(back-.5),2.25,1.05,.68,.48,this.steel,0x767b78);
    this.part(f,gap*.32,side*(back-.24),2.25,.44,.44,.03,this.steel,0x33383a);
    this.part(f,-gap*.44,side*(back-.3),wallH*.5,.09,wallH,.09,this.steel,0x565b5c,'round');
    this.kit.beam(this.steel,at(f,-gap*.42,side*inner,wallH-.22),at(f,-gap*.42,side*back,wallH-.22),.035,0x2f3134);
    // Dumpster, crates and a small puddle at the dead end.
    this.part(f,-gap*.22,side*(back-.72),.58,1.45,.86,.88,this.steel,0x3d4a41);
    this.part(f,-gap*.22,side*(back-.72),1.04,1.35,.13,.8,this.steel,0x333d36);
    for(const a2 of [-.62,.62])this.part(f,-gap*.22+a2,side*(back-1.06),.12,.11,.22,.11,this.steel,0x252a2a,'round');
    this.block(f,-gap*.22,side*(back-.72),0,1.5,1.2,1.0);
    for(let k=0;k<3;k++)this.part(f,gap*.16+(k%2)*.6,side*(back-.55-k*.2),.26,.58,.5,.58,this.concrete,[0x9c7a4e,0x7c6b55,0x8a5b43][k]);
    this.part(f,gap*.05,side*(back-1.35),.158,1.3,1,.65,this.puddle,0xffffff,'plane');
    // Wall-washer practicals: one is enough for an alley, but a 40–70 m yard
    // needs a short row to read as maintained service space rather than a void.
    const lampCount=gap>24?Math.min(4,Math.round(gap/19)):1;
    for(let k=0;k<lampCount;k++){
      const lu=lampCount===1?0:(-.38+.76*k/(lampCount-1))*gap;
      this.part(f,lu,side*(back-1.15),wallH+.12,.16,.18,.16,this.lit,0xffd39a,'lamp');
      this.part(f,lu,side*(back-1.05),wallH+.02,.06,.2,.06,this.steel,0x4c4a45);
      this.glow(f,lu,side*(back-1.15),wallH+.12,0xffc98f,44);
    }
    // A vending machine tucked just inside the mouth keeps the alley alive.
    if(gap>4.2&&this.rand()>.32){
      const va=gap*.28;
      this.part(f,va,side*(front-.55),.97,.92,1.94,.72,this.sign(2+Math.floor(this.rand()*3)),0xffffff);
      this.part(f,va,side*(front-.92),1.1,.72,1.35,.03,this.lit,0xcfe4ff);
      this.glow(f,va,side*(front-.7),1.3,0x9fc8ff,28);
    }
    // Low-rise backdrop behind the wall: the fill that keeps the horizon out
    // of sight when the camera looks down a side street or over a roofline.
    // Long gaps get a nearly continuous row: an uncovered 60 m yard at the end
    // of a street otherwise exposes the panorama skyline above a 3 m wall.
    const count=Math.max(1,Math.min(6,Math.ceil(gap/9.5)));
    for(let k=0;k<count;k++){
      const bw=Math.max(5.4,gap/count-.85);
      const ba=-gap/2+gap*(k+.5)/count;
      const bh=small?7.5+this.rand()*9:9.5+this.rand()*13,bd=7+this.rand()*5;
      const cx=f.x+ba*f.tx+side*(back+bd/2+1.1)*f.rx,cz=f.z+ba*f.tz+side*(back+bd/2+1.1)*f.rz;
      const vf={x:cx,y:f.y,z:cz,tx:f.tx,tz:f.tz,rx:f.rx,rz:f.rz};
      if(!this.clearsRoads(vf,0,bw+1,bd+1,bh+2))continue;
      const skin=this.rand()>.45?(this.rand()>.5?this.skin.flats:this.skin.shops):this.skin.office;
      this.part(vf,0,0,bh/2,bw,bh,bd,skin,this.rand()>.5?0xffffff:0xd8d2c2);
      this.part(vf,0,0,bh+.2,bw+.35,.4,bd+.35,this.steel,0x5b5e68);
      if(bh>9){
        this.part(vf,-bw*.22,0,bh+1.1,1.5,1.8,1.5,this.concrete,0x82858a,'round');
        this.part(vf,bw*.25,0,bh+1.0,1.2,1.9,1.1,this.steel,0x656a70);
      }
      if(this.rand()>.55)this.part(vf,bw*.1,0,bh+2.1,.18,4.2,.18,this.steel,0x44464a);
    }
    this.gapStats.sealed++;
  }
  // A shop slot rejected by a road mouth becomes a walled service frontage:
  // capped blockwork, pilasters, a poster, a downpipe and a wall-washer. It
  // sits on the building line, so the street keeps a continuous edge instead
  // of exposing the tall back wall of the service alley as a black band.
  frontageSegment(f,ua,side,front,width,skip){
    const h=2.5+this.rand()*.9,d=.46,lat=front+.34;
    const cx=f.x+ua*f.tx+side*lat*f.rx,cz=f.z+ua*f.tz+side*lat*f.rz;
    const wf={x:cx,y:f.y,z:cz,tx:f.tx,tz:f.tz,rx:f.rx,rz:f.rz};
    // A frontage wall is still a solid building: reject it if it reaches any
    // carriageway, including a bend of the street it faces. It sits several
    // metres behind the kerb, so the ordinary frontage itself stays clear.
    if(!this.clearsRoads(wf,0,width+.25,d+.7,h+.8) ||
       !this.basinClear(wf,0,width+.25,d+.7))return;
    const tint=[0x7c7a72,0x6f706b,0x857b6f,0x747877][Math.floor(this.rand()*4)];
    this.part(wf,0,0,h/2,width,h,d,this.wall,tint);
    this.part(wf,0,0,h+.05,width+.22,.12,.6,this.concrete,0xb0aea5);
    for(const e of [-1,1])this.part(wf,e*(width/2-.1),0,h/2+.1,.24,h+.2,d+.14,this.concrete,0x8f8d85);
    if(this.rand()>.45)
      this.part(wf,(this.rand()-.5)*width*.5,-side*(d/2+.035),1.5,.86,1.15,.05,
        this.sign(4+Math.floor(this.rand()*4),false));
    this.part(wf,width*.34,-side*(d/2+.06),1.9,.12,1.7,.12,this.steel,0x52575a,'round');
    if(this.rand()>.42){
      const lx=(this.rand()-.5)*width*.6;
      this.part(wf,lx,-side*(d/2+.18),h-.15,.13,.16,.24,this.steel,0x3d4143);
      this.part(wf,lx,-side*(d/2+.18),h-.32,.17,.1,.14,this.lit,0xffd7a2,'lamp');
      this.glow(wf,lx,-side*(d/2+.4),h-.3,0xffc98f,40);
    }
    if(this.rand()>.55){
      this.part(wf,width*.44,-side*(d/2+.3),1.1,.18,2.2,.18,this.steel,0x565b5d);
      this.part(wf,width*.44,-side*(d/2+.3),1.4,.24,1.4,.1,this.sign(9,false));
    }
    this.block(wf,0,0,0,width,h+.6,d+.4);
    this.gapStats.wallFill=(this.gapStats.wallFill||0)+1;
  }
  // Find every at-grade crossing between two different roads. Links meet the
  // circuits at their endpoints, while the loops cross each other at grade, so
  // sampling both centrelines catches T-junctions as well as four-ways.
  findJunctions(){
    const roads=this.world.roads,skip=new Set([4,5,11]),out=[],q={};
    for(let i=0;i<roads.length;i++){
      const a=roads[i];
      if(skip.has(a.id)||a===this.world.gymkhana)continue;
      const step=a.length>6000?11:7;
      for(let s=6;s<a.length-4;s+=step){
        const f=a.frameAt(s,{});
        if(Math.abs(f.y)>1.6)continue;
        for(let k=i+1;k<roads.length;k++){
          const b=roads[k];
          if(skip.has(b.id)||b===this.world.gymkhana)continue;
          if(!b.locate(f.x,f.z,q,f.y))continue;
          if(q.distance>1.8||Math.abs(q.y-f.y)>1.8)continue;
          if(q.beyondEnd&&(q.s<-3.5||q.s>b.length+3.5))continue;
          const g=b.frameAt(Math.max(0,Math.min(b.length-.01,q.s)),{});
          const dot=Math.abs(f.tx*g.tx+f.tz*g.tz);
          if(dot>.965)continue;
          if(out.some(o=>Math.hypot(o.x-f.x,o.z-f.z)<15&&Math.abs(o.y-f.y)<2))continue;
          out.push({x:f.x,y:f.y,z:f.z,a,b,sA:s,sB:q.s,fa:{...f},fb:{...g},dot});
        }
      }
    }
    return out;
  }
  buildIntersections(){
    this.junctionSites=this.findJunctions();
    for(const j of this.junctionSites)this.dressJunction(j);
  }
  // Rebuild the four quadrants of a crossing as real city corners: a chamfered
  // corner block with illuminated ground-floor retail, a paved corner apron,
  // bollards and a traffic mirror on the kerb, plus crosswalks and signals on
  // the approaches. This is what stops a junction reading as four grey holes.
  dressJunction(j){
    const fa=j.fa,fb=j.fb,A=j.a,B=j.b;
    const halfA=A.halfWidth[0],halfB=B.halfWidth[0];
    for(const [sa,sb] of [[1,1],[1,-1],[-1,1],[-1,-1]]){
      let dx=fa.rx*sa+fb.rx*sb,dz=fa.rz*sa+fb.rz*sb;
      const len=Math.hypot(dx,dz);
      if(len<.18)continue;
      dx/=len;dz/=len;
      const rA=(halfA+4.9)/Math.max(.3,Math.abs(dx*fa.rx+dz*fa.rz));
      const rB=(halfB+4.9)/Math.max(.3,Math.abs(dx*fb.rx+dz*fb.rz));
      const r=Math.max(rA,rB)+.55;
      this.cornerBlock(j,dx,dz,r,A,B,fa,fb);
    }
    this.junctionMarkings(j);
    this.junctionSignals(j);
  }
  cornerBlock(j,dx,dz,r,A,B,fa,fb){
    const rand=this.rand;
    let size=11.5+rand()*3.5,h=11+rand()*(A.halfWidth[0]>=8?27:17);
    let vf=null,placed=false;
    for(let attempt=0;attempt<4&&!placed;attempt++){
      const sz=size-attempt*1.7;
      const cx=j.x+dx*(r+.8+attempt*2.4+sz*.5),cz=j.z+dz*(r+.8+attempt*2.4+sz*.5);
      vf={x:cx,y:j.y,z:cz,tx:dx,tz:dz,rx:-dz,rz:dx};
      // Ignore the two junction approaches for the generous 2 m street-edge
      // check, but never allow the block itself to sit on any asphalt. The
      // previous blanket exception let a corner tower swallow a whole lane.
      if(this.clearsRoads(vf,0,sz+.2,sz+.2,h+3,A,B) &&
         this.clearsRoads(vf,0,sz+.2,sz+.2,h+3,null,null,.35) &&
         this.basinClear(vf,0,sz+.2,sz+.2)){size=sz;placed=true;break;}
    }
    if(!placed){
      // No room for a full block (a slip lane or another deck already owns
      // the quadrant). Fill the sightline with a walled pocket and a planter
      // instead of leaving the corner open to the void.
      const cx=j.x+dx*(r+1.5),cz=j.z+dz*(r+1.5);
      vf={x:cx,y:j.y,z:cz,tx:dx,tz:dz,rx:-dz,rz:dx};
      // A corner pocket is scenery, never a barrier. A third street can run
      // through this quadrant even when the two junction roads miss it, so
      // validate against every carriageway before building the low wall.
      if(this.clearsRoads(vf,0,6.2,6.2,3.2,A,B) &&
         this.clearsRoads(vf,0,6.2,6.2,3.2,null,null,.35) &&
         this.basinClear(vf,0,6.2,6.2)){
        this.part(vf,0,0,1.35,6,.08,6,this.pavement,0xffffff);
        this.part(vf,0,0,1.6,.32,3.2,6.2,this.wall,0x837e74);
        this.part(vf,0,0,3.24,6.2,.12,.44,this.concrete,0xb2b0a8);
        this.part(vf,0,0,3.7,2.4,2.4,2.4,this.skin.flats,0xe1d7bd);
        this.block(vf,0,0,0,6.3,4.8,.5);
        this.glow(vf,0,0,2.2,0xffd9a6,38);
      }
      // A distant mass still supplies a silhouette above the corner.
      const bx=j.x+dx*(r+21),bz=j.z+dz*(r+21),bf={x:bx,y:j.y,z:bz,tx:dx,tz:dz,rx:-dz,rz:dx};
      if(this.clearsRoads(bf,0,14,12,34,A,B) &&
         this.clearsRoads(bf,0,14,12,34,null,null,.35) &&
         this.basinClear(bf,0,14,12)){
        this.part(bf,0,0,14,14,28,12,this.skin.office,0xcdd6e2);
        this.part(bf,0,0,28.2,14.4,.4,12.4,this.steel,0x5a5e68);
        this.glow(bf,0,0,24,0xb8d8ff,52);
      }
      return;
    }
    // Chamfered corner block. The diagonal face looks straight into the
    // junction, so the ground floor and blade sign are always seen by traffic.
    const skin=rand()>.42?(rand()>.5?this.skin.office:this.skin.shops):this.skin.flats;
    this.part(vf,0,0,h/2,size,h,size,skin,0xffffff);
    this.part(vf,0,0,h+.2,size+.4,.4,size+.4,this.steel,0x5c606a);
    // The diagonal corner face is the one drivers see: put the lit shopfront
    // on that surface, not buried inside the block.
    this.part(vf,-size/2-.04,0,2.15,.08,4.3,size-.55,rand()>.5?this.skin.shops:this.skin.ramen);
    this.part(vf,-size/2-.1,0,4.38,size-.35,.3,1.4,this.steel,0x3a3e45);
    this.part(vf,-size/2-.14,0,1.02,.12,1.02,size-.85,this.lit,0xffe0ad);
    this.part(vf,-size/2-.14,0,3.2,.06,.2,size-1.0,this.lit,0xffe7c4);
    this.part(vf,-size/2-.1,0,.36,size-.3,.72,.13,this.concrete,0x5a5b57);
    this.part(vf,0,0,4.45,size-.3,.36,1.5,this.steel,0x3a3e45);
    this.part(vf,-size/2-.06,0,5.35,.1,1.45,Math.min(8.2,size*.72),this.sign(Math.floor(rand()*8),false));
    const blade=this.sign(Math.floor(rand()*8));
    this.part(vf,-size*.5-1.1,size*.32,8.2,.6,6.6,.34,blade);
    this.part(vf,-size*.5-1.12,size*.32,11.9,.78,.18,.5,this.lit,0xf2e2b4);
    this.part(vf,size*.28,size*.22,h+.85,1.3,1.7,1.3,this.concrete,0x8a8c90,'round');
    if(h>17)this.part(vf,-size*.2,size*.2,h+.9,1.1,1.9,1.1,this.steel,0x6e7379);
    this.part(vf,size*.34,size*.3,h+2.0,.12,3.4,.12,this.steel,0x46484c);
    this.block(vf,0,0,0,size,h,size);
    this.glow(vf,-size*.5-.2,0,5.2,0xffcf9c,54);
    // Corner apron and kerbside furniture.
    const pad=j.x+dx*r*.74,pz=j.z+dz*r*.74;
    const pf={x:pad,y:j.y,z:pz,tx:dx,tz:dz,rx:-dz,rz:dx};
    if(this.clearsRoads(pf,0,5.2,5.2,.3,A,B) &&
       this.basinClear(pf,0,5.2,5.2)){
      this.part(pf,0,0,-.043,5.6,.4,5.6,this.pavement,0xffffff,'round');
      for(const t of [-1,1])this.part(pf,t*1.55,0,.168,3.2,.006,.3,this.concrete,0xc7a03a,'plane');
      this.world.tokyoPavements.push({x:pad,z:pz,tx:dx,tz:dz,hl:2.7,hw:2.7,y:j.y+.155});
      for(const t of [-1,1]){
        this.part(pf,t*1.9,1.65,.46,.14,.92,.14,this.steel,0x555a5d,'round');
        this.part(pf,t*1.9,1.65,.8,.11,.13,.11,this.lit,0xffe0a8);
      }
      if(rand()>.55){
        this.part(pf,1.7,1.65,1.9,.11,3.7,.11,this.steel,0x5d6264,'round');
        this.part(pf,1.7,1.65,3.75,.7,.7,.07,this.steel,0xc7d0d0);
        this.part(pf,1.7,1.65,3.75,.58,.58,.03,this.steel,0x6d7b80);
        this.part(pf,1.7,1.65,4.15,.1,.5,.1,this.steel,0x4c5052);
      }
      if(rand()>.6)this.part(pf,-1.6,-1.2,.96,.9,1.92,.7,this.sign(2+Math.floor(rand()*3)),0xffffff);
    }
    this.gapStats.corners++;
    this.gapStats.signals+=0;
  }
  junctionMarkings(j){
    const {a,b}=j,A=a,B=b,fa=j.fa,fb=j.fb;
    for(const [r,other,base,half] of [[A,B,j.sA,A.halfWidth[0]],[B,A,j.sB,B.halfWidth[0]]]){
      for(const dir of [-1,1]){
        const cross=base+dir*(other.halfWidth[0]+3.0);
        let painted=0;
        for(let k=-2;k<=2;k++){
          const f=r.frameAt(Math.max(2,Math.min(r.length-2,cross+k*1.02)),{});
          if(Math.abs(f.y-j.y)>1.6||!this.clearsRoads(f,0,.6,half*1.74,.04,A,B))continue;
          this.part(f,0,0,.03,.46,.012,half*1.74,this.paint,0x939087,'plane');
          painted++;
        }
        if(painted)this.gapStats.crossings++;
        const sf=r.frameAt(Math.max(2,Math.min(r.length-2,cross-dir*2.8)),{});
        if(Math.abs(sf.y-j.y)<1.6&&this.clearsRoads(sf,-dir*half*.48,.34,half*.9,.03,A,B))
          this.part(sf,0,-dir*half*.48,.028,.34,.01,half*.9,this.paint,0x87857e,'plane');
      }
    }
  }
  junctionSignals(j){
    const A=j.a,B=j.b;
    const green=Math.abs(Math.round(j.x*.37+j.z*.73))%2===0;
    for(const [r,other,base,otherHalf,isGreen] of [[A,B,j.sA,B.halfWidth[0],green],[B,A,j.sB,A.halfWidth[0],!green]]){
      for(const dir of [-1,1]){
        const half=r.halfWidth[0];
        const s=base-dir*(otherHalf+6.0);
        if(s<4||s>r.length-4)continue;
        const f=r.frameAt(s,{});
        if(Math.abs(f.y-j.y)>1.6)continue;
        const side=dir,pole=side*(half+1.15);
        if(!this.clearsRoads(f,pole,.7,.7,6.2,A,B))continue;
        const key=Math.round(f.x*2)+','+Math.round(f.z*2);
        this.signalKeys||=new Set();
        if(this.signalKeys.has(key))continue;
        this.signalKeys.add(key);
        this.part(f,0,pole,2.9,.17,5.8,.17,this.steel,0x5b6064,'round');
        this.part(f,0,pole,.28,.34,.56,.34,this.concrete,0x767970);
        const head=side*half*.42;
        this.part(f,0,(pole+head)/2,5.74,.13,.11,Math.abs(pole-head),this.steel,0x555a5e);
        this.part(f,0,head,5.42,.4,.54,1.2,this.steel,0x3c4145);
        this.part(f,dir*.23,head,5.42,.06,.7,1.36,this.steel,0x23272a);
        const lenses=[[-1,0x2de08a,0x15352a],[0,0xffc247,0x3a311d],[1,0xff4b3f,0x3a2220]];
        for(const [k,on,off] of lenses){
          const live=isGreen?k===-1:k===1;
          this.part(f,-dir*.21,head+k*.35,5.42,.07,.3,.3,this.lit,live?on:off);
        }
        this.part(f,-dir*.23,head-1.02,5.42,.06,.18,.28,this.lit,isGreen?0x1d6b4a:0x6d211e);
        this.part(f,0,side*(half*.55),5.02,.07,.56,2.35,
          this.sign(10,false,[A===r?'中央通り':'環状通り',A===r?'CHUO DORI':'LOOP ROAD'],'#1c5b46'));
        this.part(f,-dir*.18,pole,2.7,.3,.64,.3,this.steel,0x313639);
        this.part(f,-dir*.34,pole,2.84,.05,.22,.22,this.lit,0xff4c3e);
        this.part(f,-dir*.34,pole,2.55,.05,.22,.22,this.lit,0x37e18c);
        this.part(f,.55,pole,.56,.5,1.04,.42,this.steel,0x676c66);
        this.part(f,.55,pole,1.1,.56,.11,.5,this.steel,0x454a46);
        this.glow(f,0,head,5.45,isGreen?0x2de08a:0xff4b3f,58,'signal');
        this.block(f,0,pole,0,.34,6,.34);
        this.gapStats.signals++;
      }
    }
  }
  buildParkade(){
    const r=this.world.roads[4],colors=levelColors;
    const step=4.6;
    for(let s=0;s<r.length;s+=step){
      const f=r.frameAt(s,{}),floor=Math.max(0,Math.min(8,Math.round(f.y/FLOOR_RISE)+2));
      const tint=colors[floor],idx=Math.round(s/step);
      this.part(f,0,0,-.37,step+.65,.68,19.7,this.concrete,0x97999e);
      // The curve is counter-clockwise in local coordinates; both shoulders carry real architecture.
      for(const side of [-1,1]){
        const entry=this.world.roads[5],q={};
        const p=at(f,0,side*9.3);
        const opening=Math.abs(f.y)<1.5&&entry.locate(p.x,p.z,q)&&q.distance<9;
        if(!opening){
          this.part(f,0,side*9.45,.59,step+.3,1.18,.33,this.concrete,0xb2b7bd);
          if(floor<2)this.part(f,0,side*9.65,2.6,step+.45,5.35,.38,this.concrete,0x78848f);
          if(idx%11===0){
            for(const k of [-1,0,1])this.part(f,k*.58,side*9.24,.69,.29,.35,.05,this.lit,tint);
          }
        }
        if(idx%4===0&&!opening){
          this.part(f,0,side*8.85,2.4,.52,4.8,.56,this.concrete,0xb7b9bd);
          this.part(f,0,side*8.85,1.15,.54,.89,.59,this.lit,tint);
          this.part(f,0,side*8.85,.56,.57,.24,.63,this.steel,0x554f45);
          if(idx%12===0&&side===1){
            this.part(f,0,8.50,2.18,.48,.58,.06,this.sign(floor,false,[FLOOR_NAMES[floor],'駐車場'],'#313e4c'));
            this.part(f,0,8.51,.95,.45,.66,.25,this.steel,0xa7392f);
          }
        }
      }
      if(idx%3===0){
        this.part(f,0,6.4,.055,.09,.026,3.35,this.lit,0xbdbdb6);
        if(Math.abs(f.grade)<.006)this.slots.push({f,side:6.6,floor});
      }
      if(floor<8 && idx%3===0){
        this.part(f,0,0,4.71,.46,.17,11.5,this.steel,0x6a727d);
        this.part(f,0,.8,4.56,.33,.1,4.2,this.lit,tint);
        this.part(f,0,-6.85,4.43,step*3+.28,.18,.18,this.steel,0xad332c);
        if(idx%9===0){
          this.part(f,0,-6.85,4.62,.14,.54,.42,this.steel,0x6c7379);
          this.part(f,0,5.9,4.36,step*3+.28,.15,.28,this.steel,0x566170);
          this.part(f,0,6.1,4.24,step*3+.28,.08,.09,this.steel,0x977046);
        }
        if(idx%9===0)this.glow(f,0,0,4.25,tint,170);
      }
      if(idx%12===0){
        this.part(f,0,-8.45,2.05,2.8,1.47,.16,this.sign(floor,false,[FLOOR_NAMES[floor],'深夜駐車場  /  PARKADE'],'#315361'));
        this.part(f,0,-7.2,.047,6.1,1,3.2,this.reflect,tint,'plane');
      }
    }
    // The marked constant-height gallery occupies the inside of the oval on each landing.
    for(let floor=0;floor<9;floor++){
      const a=this.world.parkade, y=(floor-2)*FLOOR_RISE;
      this.kit.put('box',this.concrete,a.cx,y-.44,a.cz,64,.8,28,Math.atan2(-a.az,a.ax),0x929597);
      for(let k=-2;k<=2;k++){
        const x=a.cx+a.ax*k*12,z=a.cz+a.az*k*12;
        if(floor<8)this.kit.put('box',this.concrete,x,y+2.5,z,1.2,5,1.2,0,0xb9b9bb);
        this.kit.put('box',this.lit,x,y+.03,z,8,.02,.13,Math.atan2(-a.az,a.ax),0xc9c3b3);
      }
    }
    // Keep vehicles on the terminal decks past the timing gates.
    for(const s of [1,r.length-1]){
      const end=r.frameAt(s,{});
      this.part(end,0,0,.72,.9,1.44,18,this.concrete,0x8e9093);
      this.block(end,0,0,-.4,.9,2.1,18);
      for(const k of [-6,-3,0,3,6])this.part(end,0,k,.94,1,.32,1.3,this.lit,0xfba43c);
    }
    const e=this.world.roads[5],f=e.frameAt(e.length*.4,{});
    for(const side of [-1,1]){
      this.part(f,0,side*5.7,2.55,.42,5.1,.42,this.steel,0xd3d9d9);
      this.part(f,-2,side*5.9,1.1,1.2,2.2,.85,this.concrete,0xc9a65e);
    }
    this.part(f,0,0,5.3,.38,1.8,12.8,this.sign(8));
  }
  setParking(roam,density=.5){
    if(!roam && this.competitiveParking)return;
    this.competitiveParking=!roam;
    this.parkKit?.dispose();
    this.parked.clear();
    const original=this.kit;
    this.kit=this.parkKit=new CityBatch(this.parked);
    const rand=createRandom(roam?Math.floor(Math.random()*1000000):81086);
    this.parkSolids=[];
    for(const slot of this.slots){
      if(rand()>density)continue;
      this.kit.layered=slot.floor!==null;
      const {f,side}=slot,paint=[0x9d2421,0x275296,0xd5a12c,0xbec5cd,0x30363b,0x316d5d][Math.floor(rand()*6)];
      const length=3.9+rand()*.8;
      const hatch=rand()>.58,height=hatch?1.09:.86;
      this.part(f,0,side,.25,length,.63,1.86,this.steel,paint,'body');
      this.part(f,-.12,side,.79,length*(hatch?.66:.58),height*.65,1.61,this.steel,0x283744,hatch?'hatch':'coupe');
      this.part(f,-.18,side,.80+height*.65,length*.26,.065,1.33,this.steel,paint);
      this.part(f,length*.498,side,.44,.06,.17,.83,this.concrete,0x24282b);
      this.part(f,-length*.499,side,.43,.05,.15,.48,this.concrete,0xe5dfca);
      if(!hatch){
        this.part(f,-length*.44,side,.89,.33,.07,1.82,this.steel,paint);
        for(const b of [-1,1])this.part(f,-length*.43,side+.61*b,.80,.09,.17,.07,this.steel,0x353a40);
      }
      for(const a of [-1,1])for(const b of [-1,1]){
        this.part(f,a*length*.31,side+b*.89,.35,.66,.66,.19,this.concrete,0x17191d,'wheel');
        this.part(f,a*length*.31,side+b*.993,.35,.42,.42,.035,this.steel,0x92979a,'wheel');
        this.part(f,a*(length*.5),side+b*.6,.68,.08,.15,.38,this.lit,a<0?0xff3434:0xf5eac8);
      }
      const norm=Math.hypot(f.tx,f.tz);
      this.parkSolids.push({p:at(f,0,side,.1),h:1.48,box:{
        tx:f.tx/norm,tz:f.tz/norm,length:length*.49,width:.93}});
    }
    this.kit.flush();this.kit=original;
    this.world.tokyoSolids=[...this.solid,...this.parkSolids];
    this.world.indexTokyoSolids();
  }
  buildLandmarks(){
    const {roads}=this.world,shibuya=roads[0].frameAt(0,{});
    // Each band of the scramble has short stripes perpendicular to its path.
    this.part(shibuya,0,0,-.14,24,.22,24,this.concrete,0x40434b);
    for(const side of [-1,1]){
      for(let j=-8;j<=8;j++){
        this.part(shibuya,j*1.12,j*1.12*side,.065+(side+1)*.005,.64,.018,3.3,this.concrete,0xd6d4cc,'box',-side*Math.PI/4);
      }
      for(let j=-5;j<=5;j++)this.part(shibuya,side*10.3,j*1.53,.064,3.1,.018,.68,this.concrete,0xe0ded5);
    }
    // The retail gateways sit over the route with supports outside the carriageway.
    for(const [road,s,label,english,color] of [
      [roads[0],235,'渋谷中央通り','SHIBUYA CENTRAL',0xfc493e],
      [roads[0],1590,'秋葉原電気街','ELECTRIC TOWN',0x37ddf2],
      [roads[1],1390,'新宿横丁','SHINJUKU YOKOCHO',0xff9b45]]){
      const f=road.frameAt(s,{}),span=road.halfWidth[0]+4;
      if(![-span,span].every(side=>this.clearsRoads(f,side,.55,.55,7)))continue;
      for(const side of [-span,span]){
        this.part(f,0,side,3.7,.5,7.4,.5,this.steel,0x443e43);
        this.block(f,0,side,0,.5,7.4,.5);
        this.part(f,0,side,4.4,.54,4.7,.54,this.lit,color);
      }
      this.part(f,0,0,7.5,.75,.48,span*2+.6,this.steel,0x747b84);
      this.part(f,0,0,7.92,9.2,1.65,.58,this.sign(0,false,[label,english],'#5a263c'),'box',Math.PI/2);
      for(let v=-span+1;v<span;v+=2)this.part(f,0,v,7,.3,.23,.3,this.lit,color,'lamp');
    }
    const trap=roads[2].frameAt(1520,{});
    this.part(trap,0,-10.7,3.5,.28,7,.28,this.steel,0x7c8493);
    this.part(trap,0,-10.7,7.2,3.8,1.3,.35,this.sign(0,false,['速度計測','SPEED CAMERA'],'#684122'),'box',Math.PI/2);
    this.part(trap,0,-9.9,5.9,.82,.38,.42,this.concrete,0x747880);
    this.part(trap,-.43,-9.9,5.91,.06,.18,.18,this.lit,0xf14c44);
    const overlook=roads[2].frameAt(180,{});
    this.part(overlook,0,-10,2.1,4.4,1.8,.26,this.sign(11,false,['港区展望','MINATO  /  PHOTO POINT'],'#21515e'));
    const round=roads[0].frameAt(98,{});
    this.part(round,0,29,17,23,34,23,this.skin.office,0xffffff,'round');
    this.solid.push({p:at(round,0,29,0),r:11.5,h:34});
    this.part(round,0,29,34.4,23.7,.7,23.7,this.lit,0xf45a50,'round');
    this.part(round,0,18.2,26.8,14,5,.48,this.sign(0));
    // The waterfront channel runs along the bayside circuit.
    for(let j=0;j<3;j++){
      const f=this.world.gymkhana.frameAt([45,120,195][j],{});
      for(const side of [-1,1]){
        this.part(f,0,side*6.9,.45,.65,.9,.65,this.concrete,0xec8956,'round');
        this.part(f,0,side*6.9,.57,.67,.13,.67,this.lit,0xf8ecd0,'round');
      }
      this.part(f,0,-10,2.2,3.4,1.6,.24,this.sign(j,false,['湾岸 '+(j+1),'GYMKHANA  /  SECTOR'],'#86532c'));
    }
    // Quay edge: the basin starts 10.2 m inside the centreline, leaving a
    // narrow service walk between the kerb and the water. The coping tops out
    // at pavement height and the wall drops well below the waterline; the
    // tankers, barges and buoys then sit at their real draft instead of on a
    // puddle the depth of a kerb.
    for(let s=12;s<roads[3].length-12;s+=26){
      const f=roads[3].frameAt(s,{});
      if(f.y>1.2)continue;
      // The dock platform is built out from this stretch of quay; its deck
      // replaces the wall and parapet for those 230 m.
      if(s>702&&s<932)continue;
      const edge=at(f,0,10.4);
      const ef={x:edge.x,y:f.y,z:edge.z,tx:f.tx,tz:f.tz,rx:f.rx,rz:f.rz};
      if(!this.clearsRoads(ef,0,25,3,.8,null,null,.45))continue;
      this.part(f,0,10.42,-.72,25.8,1.62,.44,this.concrete,0x8b8a82);
      this.part(f,0,10.42,.07,25.9,.1,.56,this.concrete,0xb3b0a5);
      this.part(f,0,10.62,1.06,25.8,.07,.07,this.steel,0x9ba3a5);
      this.part(f,0,10.62,.66,25.8,.045,.045,this.steel,0x8a9295);
      for(const v of [-8.4,0,8.4])this.part(f,v,10.62,.60,.09,.96,.09,this.steel,0x8d9597);
      this.block(f,0,10.42,0,25.8,1.05,.44);
      if((s/26|0)%2===0){
        this.part(f,0,9.95,.31,.44,.52,.44,this.steel,0x34393b,'round');
        this.part(f,0,9.95,.61,.56,.12,.56,this.steel,0x4c5153,'round');
        this.part(f,0,10.73,-1.0,.18,1.0,.86,this.concrete,0x2b2e30);
      }
    }
    // The dock arena sits on a concrete pier inside the basin. Its three
    // water faces get a coping and a safety parapet so the platform reads as
    // a working pier instead of a slab floating on the tide.
    const pier=roads[3].frameAt(820,{});
    this.part(pier,0,29,-.02,121,.16,75,this.pierDeck);
    for(const [along,side,len,dep] of [[0,67,122,1.3],[60.9,29,1.3,76],[-60.9,29,1.3,76]]){
      this.part(pier,along,side,-.78,len,1.68,dep,this.concrete,0x86857d);
      this.part(pier,along,side,.07,len+.2,.12,dep+.2,this.concrete,0xb2afa4);
      this.part(pier,along,side,.58,len-.2,.9,.46,this.concrete,0x9a9990);
      this.part(pier,along,side,1.08,len-.2,.08,.08,this.steel,0x737a7c);
      this.block(pier,along,side,0,len-.2,.9,.46);
    }
    for(let v=-54;v<=54;v+=13.5){
      this.part(pier,v,67.5,.32,.4,.55,.4,this.steel,0x35393b,'round');
      this.part(pier,v,67.5,.62,.5,.1,.5,this.steel,0x4a4f51,'round');
    }
    // Flood masts keep the working deck legible from the water instead of
    // reading as a black slab against the sheen.
    for(const [along,side] of [[-42,58],[42,58],[-42,-2],[42,-2]]){
      this.part(pier,along,side,4.6,.15,9.2,.15,this.steel,0x6a7175);
      this.part(pier,along,side,9.2,.62,.2,.62,this.lit,0xf0efe2);
      this.glow(pier,along,side,9.1,0xf2eedd,120);
    }
    // Two barge berths and a fishing boat give the basin scale. Hulls sit on
    // the water plane, cabins and containers carry their own small lights.
    for(const [s,off,len,wid] of [[520,45,30,10],[655,61,21,8],[2650,37,24,9]]){
      const f=roads[3].frameAt(s,{});
      if(f.y>1.2||!this.inBasin(at(f,0,off).x,at(f,0,off).z,4))continue;
      const up=this.bayLevel+.5-f.y;
      this.part(f,0,off,up-.12,len,1.25,wid,this.concrete,0x30353a);
      this.part(f,0,off,up+.46,len*.96,.2,wid*.96,this.concrete,0x5b6367);
      this.part(f,0,off+wid*.18,up+1.65,Math.min(6.5,len*.3),1.5,wid*.5,this.concrete,0x555a5d);
      for(let k=-1;k<=1;k++)this.part(f,k*2.1,off+wid*.18,up+1.85,.9,.5,.16,this.lit,0xffd6a0);
      for(let k=0;k<3;k++){
        if(len<25&&k>1)break;
        this.part(f,-len*.28+k*len*.28,off+wid*.14,up+1.15,4.6,1.55,4.4,this.concrete,[0x6b4538,0x3d5a6b,0x6b6440][k]);
      }
      this.part(f,len*.36,off,up+2.7,.09,3.6,.09,this.steel,0x7a7f83);
      this.part(f,len*.36,off,up+4.55,.3,.3,.3,this.lit,0xff5a4a,'lamp');
      this.part(f,0,off,this.bayLevel+.012-f.y,len*.86,.01,wid*.72,this.reflect,0xffcf9c,'plane');
    }
    // Navigation buoys and the odd moored skiff mark the channel.
    for(const [s,off,c] of [[330,42,0xff4b3f],[470,74,0x2de08a],[760,88,0xff4b3f],[1020,63,0x2de08a],
      [1280,81,0xff4b3f],[1520,58,0x2de08a],[1780,72,0xff4b3f],[2090,66,0x2de08a],
      [2370,44,0xff4b3f],[2760,58,0x2de08a],[2960,39,0xff4b3f]]){
      const f=roads[3].frameAt(s,{});
      if(f.y>1.2||!this.inBasin(at(f,0,off).x,at(f,0,off).z,2))continue;
      const up=this.bayLevel+.22-f.y;
      this.part(f,0,off,up-.16,.7,.42,.7,this.concrete,0x2e3234,'round');
      this.part(f,0,off,up+.18,.3,.3,.3,this.lit,c,'round');
      this.part(f,0,off,up+.42,.08,.16,.08,this.steel,0x3a3f41);
    }
    // The midnight circuit, the grand tour and the port district link all
    // cross the basin at grade. Left bare they read as asphalt laid straight
    // over the tide, so each wet stretch gets a concrete embankment carried
    // below the waterline, a coping, a rail and a lamp row. clearsRoads()
    // opens the walls at junctions so no carriageway is ever fenced off.
    for(const r of [roads[0],roads[6],roads[9]]){
      if(!r)continue;
      const hw=r.halfWidth[0];
      for(let s=8;s<r.length-8;s+=12){
        const f=r.frameAt(s,{}),mid=at(f,0,0);
        if(Math.abs(f.y)>1.2||!this.inBasin(mid.x,mid.z,3))continue;
        for(const side of [-1,1]){
          const off=side*(hw+.72);
          if(!this.clearsRoads(f,off,12.4,1,1.7,r))continue;
          this.part(f,0,off,-.42,12.4,2.1,.95,this.concrete,0x8b8b85);
          this.part(f,0,off,.69,12.4,.16,1.14,this.concrete,0xb7b3a8);
          this.part(f,0,off,1.06,12.4,.07,.07,this.steel,0x9ba3a5);
          this.part(f,0,off,.66,12.4,.045,.045,this.steel,0x8a9295);
          for(const v of [-4.1,0,4.1])this.part(f,v,off,.93,.08,.34,.08,this.steel,0x8d9597);
          this.part(f,0,off,-1.24,12.4,.24,.1,this.concrete,0x3b3e3d);
          this.block(f,0,off,0,12.4,1.14,.95);
          if((s/12|0)%2===0)this.part(f,0,off,-1.02,.62,1.3,1.26,this.concrete,0x6b6c67);
        }
        if(s%48===0)for(const side of [-1,1]){
          const pole=side*(hw+.62);
          if(!this.clearsRoads(f,pole,3.6,.2,5.4,r))continue;
          this.part(f,0,pole,2.7,.14,4.6,.14,this.steel,0x6b7175);
          this.part(f,0,pole-side*.9,4.88,.14,.14,1.8,this.steel,0x4c5155);
          this.part(f,0,pole-side*1.8,4.8,.3,.05,.54,this.lit,0xd8e6ff);
          this.glow(f,0,pole-side*1.8,4.8,0xc9ddff,50);
        }
      }
    }
    // Overhead direction gantries on the elevated bay span: the reference the
    // driver needs for the harbour circuit, and a lit landmark on the skyway.
    for(const s of [1560,1810]){
      const f=roads[3].frameAt(s,{});
      if(f.y<4)continue;
      for(const side of [-1,1]){
        this.part(f,0,side*8.5,4.55,.34,6.5,.34,this.steel,0x7d8488);
        this.part(f,0,side*8.5,1.36,.7,.16,.7,this.concrete,0x8e918e);
      }
      this.part(f,0,0,7.65,.42,.42,17.4,this.steel,0x8b9298);
      this.part(f,0,0,6.55,.22,1.5,5.6,this.sign(10,false,['湾岸線 ↑','BAYSHORE  /  B'],'#17654e'));
    }
    // Container gantries stand behind the yard, orange against the navy sky.
    for(const s of [470,900,1210]){
      const f=roads[3].frameAt(s,{});
      if(f.y>1.2||!this.clearsRoads(f,-62,4,4,24))continue;
      for(const v of [-5.5,5.5])this.part(f,v,-62,10,.72,20,.72,this.steel,0xcb7145);
      this.part(f,0,-62,20.2,.8,1.2,17,this.steel,0xfa9c56);
      this.part(f,0,-56,19.3,1.8,1.1,1.5,this.steel,0xca7145);
      this.part(f,0,-56,14.2,.1,9,.1,this.steel,0x777d80);
      this.part(f,0,-62,22,1.4,.5,1.4,this.steel,0x8b9296);
      this.part(f,0,-62,22.42,.3,.3,.3,this.lit,0xff4b3f,'lamp');
    }
    for(let s=1350;s<1900;s+=14){
      const f=roads[3].frameAt(s,{});
      if(f.y<4)continue;
      for(const side of [-1,1]){
        // The catenary poles stand on the bridge shoulder, inside the
        // parapet. They used to sit 1.9 m outboard of the deck and float.
        const p=at(f,0,side*8.1);
        const top=16-8*Math.abs(Math.sin((s-1350)*Math.PI/140));
        this.part(f,0,side*8.1,top/2,.11,top,.11,this.steel,0xe5d5ac);
        this.kit.put('lamp',this.lit,p.x,p.y+top,p.z,.4,.4,.4,0,0xffd69b);
      }
    }
    for(let s=440;s<1300;s+=67){
      const f=roads[3].frameAt(s,{});
      if(!this.clearsRoads(f,-37,36,18,10))continue;
      this.block(f,0,-37,-.05,36,9.5,18);
      this.part(f,0,-37,4.7,36,9.5,18,this.concrete,0x566575);
      this.part(f,0,-37,9.65,38,.54,20,this.steel,0x485162);
      this.part(f,0,-27.8,2.7,14,5.4,.6,this.steel,0x354755);
      this.part(f,0,-27.1,6.2,8,1.35,.3,this.sign(9));
      this.part(f,-9,-27.2,4.8,.8,.33,.8,this.lit,0xffcd85);
    }
    for(let i=0;i<14;i++){
      const f=roads[0].frameAt(3680+i*5.3,{}),side=-19.3-(i%3)*.4;
      this.part(f,0,side,1.52,.30,.35,.30,this.concrete,0xac8a76,'lamp');
      this.part(f,0,side,1.03,.52,.75,.32,this.concrete,[0x5a4a51,0x455b70,0x756656][i%3],'lamp');
      for(const v of [-.13,.13])this.part(f,v,side,.38,.16,.69,.17,this.concrete,0x303642);
    }
    for(const i of [4,5,6]){
      const site=this.world.tokyoSites[i];
      this.part(site,0,16,3.5,8,1.55,.38,this.sign(14));
      this.part(site,-4.2,16,1.65,.2,3.3,.2,this.steel);
      this.part(site,4.2,16,1.65,.2,3.3,.2,this.steel);
    }
    // Cars at the open-air meet and workshops are set back from the circuit.
    for(let i=0;i<12;i++){
      const f=roads[0].frameAt(3700+i*7,{});
      const slot=at(f,0,-14),q={};
      if(roads.some(other=>other.id!==0&&other.locate(slot.x,slot.z,q,0)&&Math.abs(q.y)<3&&q.distance<q.halfWidth+4))continue;
      this.part(f,0,-15,-.08,7.2,.25,11,this.concrete,0x78787d);
      this.slots.push({f,side:-14,floor:null});
      if(i===6)this.part(f,0,-20,3.8,11,2.3,.4,this.sign(14));
    }
    for(let s=700;s<1050;s+=19){
      const f=roads[0].frameAt(s,{});
      this.part(f,0,-12,2,.45,4,.45,this.concrete,0x776451);
      this.part(f,0,-12,4.8,4.2,4.4,4,this.concrete,0x455446,'lamp');
    }
  }
  insideGarage(p){
    const a=this.world.parkade,x=p.x-a.cx,z=p.z-a.cz;
    return p.y<6*FLOOR_RISE-.8 && ((x*a.ax+z*a.az)/67)**2+((x*a.bx+z*a.bz)/41)**2<1;
  }
  smokeLight(base,brake){
    if(!this.tint)this.tint=new T.Color();
    this.tint.copy(base);
    if(this.lights[0].intensity)this.tint.lerp(this.lights[0].color,.37);
    if(brake)this.tint.lerp(this.brakeTint||=new T.Color(0xff4b3c),.43);
    return this.tint;
  }
  setQuality(q){this.radius=q?.shadowMapSize===0?420:650;}
  update(pos,dt=0,night=true,driver=pos){
    this.time+=dt;this.horizon.position.set(pos.x,110,pos.z);
    if(this.bayTex){
      // Two slow drifts at different rates keep the basin alive at rest.
      this.bayTex.offset.x=(this.bayTex.offset.x+dt*.0035)%1;
      this.bayTex.offset.y=(this.bayTex.offset.y+dt*.0013)%1;
      if(this.bayTex2){
        this.bayTex2.offset.x=(this.bayTex2.offset.x-dt*.0011+1)%1;
        this.bayTex2.offset.y=(this.bayTex2.offset.y+dt*.0006)%1;
      }
    }
    this.skyDome.position.set(pos.x,0,pos.z);this.skyGlow.position.set(pos.x,110,pos.z);
    const program=Math.floor(this.time/12)%4;
    if(program!==this.adProgram){
      this.adProgram=program;
      for(let i=0;i<4;i++){const m=this.skin['ad'+i],tex=this.advertTextures[(i+program)%4];m.map=tex;m.emissiveMap=tex;}
    }
    const enclosed=this.insideGarage(pos);
    for(const stop of this.stops){
      const near=stop.point.distanceToSquared(pos)<140*140;
      stop.beacon.visible=near;
      if(near){
        stop.beacon.material.color.setHex(stop.litUntil>this.time?0xa2ffe0:stop.color);
        stop.beacon.scale.setScalar(1+.12*Math.sin(this.time*2.6));
      }
    }
    this.life.update(dt,pos,this.weather==='Rain',pos.y<-.8||enclosed,!this.competitiveParking,driver);
    this.kit.update(pos,this.radius,enclosed);this.parkKit.update(pos,this.radius,enclosed);
    if(!this.lastLight || this.lastLight.distanceToSquared(pos)>12){
      if(!this.lastLight)this.lastLight=new T.Vector3();
      this.lastLight.copy(pos);
      // Signals carry their own emissive lens and halo; letting a red or green
      // head become one of the three recycled point lights floods the whole
      // junction (and its zebra bars) in a single saturated colour. Reserve
      // the dynamic lights for actual lamps and shopfronts.
      const near=this.sources.filter(s=>s.kind!=='signal'&&s.p.distanceToSquared(pos)<55**2).sort((a,b)=>a.p.distanceToSquared(pos)-b.p.distanceToSquared(pos));
      this.lights.forEach((light,i)=>{
        const s=near[i];light.intensity=s?s.power:0;
        if(s){light.position.copy(s.p);light.color.setHex(s.color)}
      });
    }
  }
  dispose(){
    this.disposed=true;this.beaconGeometry.dispose();this.haloGeometry.dispose();this.life.dispose();this.horizon.geometry.dispose();this.base?.geometry.dispose();this.basin?.geometry.dispose();this.sea?.geometry.dispose();this.kit.dispose();this.parkKit.dispose();
    this.materials.forEach(m=>m.dispose());this.textures.forEach(t=>t.dispose());
    this.tower?.traverse(n=>{n.geometry?.dispose();n.material?.dispose()});
  }
}
