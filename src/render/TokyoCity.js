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

export class TokyoCity {
  constructor({world,quality}){
    this.world=world;this.group=new T.Group();this.group.name='Tokyo After Hours';
    this.kit=new CityBatch(this.group);this.rand=createRandom(81086);
    this.materials=[];this.textures=[];this.sources=[];this.slots=[];this.walks=[];this.solid=[];this.time=0;
    this.concrete=this.material({color:0xffffff,roughness:.78});
    this.steel=this.material({color:0xffffff,roughness:.39,metalness:.54});
    this.lit=this.material({color:0xffffff},true);
    this.reflect=this.material({map:this.texture(reflectionTexture()),transparent:true,depthWrite:false,
      blending:T.AdditiveBlending,opacity:.51,polygonOffset:true,polygonOffsetFactor:-2},true);
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
    this.buildGround();
    this.buildStreets();
    this.kit.layered=true;
    this.buildParkade();
    this.kit.layered=false;
    this.buildLandmarks();
    this.stops=buildStreetStops(this);
    this.driftSectors=buildDriftSectors(this);
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
  glow(f,along,side,up,color,power=50){
    const p=at(f,along,side,up);
    this.sources.push({p,color,power});
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
  clearsRoads(f,side,length,width,height){
    const q={};
    // Test the actual corners and centres on long props, including beneath flyovers.
    for(const a of [-.5,0,.5])for(const b of [-.5,0,.5]){
      const v=at(f,a*length,side+b*width);
      if(this.world.roads.some(r=>r.locate(v.x,v.z,q,v.y) && !q.beyondEnd &&
        q.y>=v.y-1.3 && q.y<=v.y+height+1 && q.distance<q.halfWidth+2))return false;
    }
    return true;
  }
  building(r,s,side,style){
    const f=r.frameAt(s,{}),rand=this.rand;
    const w=style==='alley'?8+rand()*6:14+rand()*11,d=10+rand()*7;
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
    this.part(f,0,mid,h/2,w,h,d,skin);
    this.part(f,0,mid,h+.25,w+.45,.5,d+.45,this.steel,0x565965);
    this.part(f,w*.18,mid,h+1.4,w*.34,2.5,d*.54,this.concrete,0x51525c);
    this.part(f,0,side*(front-.40),2,w-.35,4,.9,style==='alley'&&n%3===0?this.skin.grill:style==='electric'&&n%2===0?this.skin.gamehall:s>3630&&s<3830?this.skin.workshop:n%2?this.skin.market:this.skin.ramen);
    this.part(f,0,side*(front-1),4.1,w+.4,.28,2.5,this.steel,n%2?0x314963:0x632f33);
    this.part(f,0,side*(front-1.1),4.85,w*.86,1.4,.22,this.sign(n));
    this.part(f,w*.39,side*(front-1.2),7.7,1.65,5.4,.45,this.sign((n+2)%8,true));
    this.part(f,0,side*(curb+1.6),.02,w,.25,4.4,this.concrete,0xaaa7a5);
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
    this.part(f,0,side*(curb-1),.038,w*.78,1,4.8,this.reflect,cityColors[n%6],'plane');
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
    if(n%2===0 && r.id<2 && this.clearsRoads(f,side*(curb+1.15),w*.68,.7,2)){
      this.walks.push({f,side:side*(curb+1.15),span:w*.32});
    }
    if(style==='electric'||style==='alley'){
      for(let j=0;j<2+n%3;j++){
        const u=(j-1)*1.24+w*.15,off=side*(front-1.68-(j%2)*.41);
        const coat=[0x504762,0x93634b,0x526075][(j+n)%3],base=.14;
        this.part(f,u,off,base+1.04,.48,.75,.32,this.concrete,coat,'lamp');
        this.part(f,u,off,base+1.40,.13,.17,.14,this.concrete,0xab806a,'round');
        this.part(f,u,off,base+1.54,.25,.31,.25,this.concrete,0xc89c80,'lamp');
        this.part(f,u,off,base+1.64,.26,.18,.27,this.concrete,0x302b2c,'lamp');
        for(const side of [-1,1]){
          this.part(f,u+side*.10,off,base+.43,.20,.86,.23,this.concrete,0x32363c,'round');
          this.part(f,u+side*.10,off+.04,base+.07,.18,.14,.28,this.steel,0x2b292b,'lamp');
          this.part(f,u+side*.22,off,base+1.05,.15,.54,.19,this.concrete,coat,'lamp');
          this.part(f,u+side*.22,off,base+.78,.10,.14,.12,this.concrete,0xb98b73,'lamp');
        }
      }
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
    this.block(f,0,mid,0,w,h,d);
    this.block(f,0,side*(front-.4),0,w-.35,4,.9);
  }
  buildGround(){
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
  }
  buildStreets(){
    const [main,neon,,bay,,entry]=this.world.roads;
    for(const r of this.world.roads){
      if(r.id===4||r===this.world.gymkhana)continue;
      const roadWidth=r.halfWidth[0],dense=r===main||r===neon,step=dense?22:r===bay?47:86;
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
            if(rail[f.index])this.part(mid,0,side*(roadWidth+1),.69,span+.25,1.35,.45,this.concrete,0xd1d2cf);
          }
        }else if(r!==entry){
          this.part(mid,0,0,-.48,span+.35,.5,2*roadWidth+10,this.concrete,0x484c54);
        }
        if(!dense && s%270===0 && r!==entry){
          this.part(mid,0,-roadWidth-.45,3.9,.30,7.8,.30,this.steel,0xb0b1af);
          this.part(mid,0,-roadWidth*.42,6.75,.25,.28,roadWidth*1.2,this.steel);
          this.part(mid,0,-roadWidth*.42,7.1,.22,2.15,6.4,this.sign(10,false,['湾岸線 ↑','BAYSHORE ROUTE  /  B'],'#17654e'));
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
    for(let s=200;s<3200;s+=29){
      const f=roads[3].frameAt(s,{}),side=s<1700?1:-1;
      if(s>728&&s<918)continue;
      this.part(f,0,side*59,-.20,32,.15,82,this.steel,0x274b65);
      this.part(f,0,side*62,-.115,16,1,3.4,this.reflect,0x55a1ce,'plane');
      for(let k=0;k<3;k++){
        const offset=-side*(18+k*2),base={...f,...at(f,k*6-6,0)};
        if(!this.clearsRoads(base,offset,7.5,2.6,3.2))continue;
        this.part(base,0,offset,1.3,7.5,2.6,2.6,this.concrete,[0x84473f,0x365069,0x807d55][k]);
        this.block(base,0,offset,0,7.5,2.6,2.6);
        for(let rib=-3;rib<=3;rib++)this.part(base,rib,offset+side*1.31,1.3,.12,2.48,.09,this.steel,0x61676a);
      }
      if(s%145===55 || (s-200)%232===0){
        this.part(f,0,side*35,10,1,20,1,this.steel,0xcb7145);
        this.part(f,0,side*45,20.1,1.2,1.1,23,this.steel,0xfa9c56);
        this.part(f,0,side*54,15,.12,10,.12,this.steel);
      }
    }
    for(let s=1350;s<1900;s+=14){
      const f=roads[3].frameAt(s,{});
      if(f.y<4)continue;
      for(const side of [-1,1]){
        const p=at(f,0,side*9.4);
        const top=21-13*Math.abs(Math.sin((s-1350)*Math.PI/140));
        this.part(f,0,side*9.4,top/2,.11,top,.11,this.steel,0xe5d5ac);
        this.kit.put('lamp',this.lit,p.x,p.y+top,p.z,.55,.55,.55,0,0xffd69b);
        if(Math.round((s-1350)/14)%10===0)this.part(f,0,side*9.4,11,1.5,22,1.5,this.concrete,0x9da7b0);
      }
    }
    const apron=roads[3].frameAt(820,{});
    this.part(apron,0,29,-.28,121,.15,75,this.concrete,0x646871);
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
      const near=this.sources.filter(s=>s.p.distanceToSquared(pos)<55**2).sort((a,b)=>a.p.distanceToSquared(pos)-b.p.distanceToSquared(pos));
      this.lights.forEach((light,i)=>{
        const s=near[i];light.intensity=s?s.power:0;
        if(s){light.position.copy(s.p);light.color.setHex(s.color)}
      });
    }
  }
  dispose(){
    this.disposed=true;this.beaconGeometry.dispose();this.haloGeometry.dispose();this.life.dispose();this.horizon.geometry.dispose();this.kit.dispose();this.parkKit.dispose();
    this.materials.forEach(m=>m.dispose());this.textures.forEach(t=>t.dispose());
    this.tower?.traverse(n=>{n.geometry?.dispose();n.material?.dispose()});
  }
}
