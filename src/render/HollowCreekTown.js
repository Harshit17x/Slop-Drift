import { buildTexturedGrassGeometry } from './Scenery.js';
import { HollowWeather } from './HollowWeather.js';
import { inDepot } from '../world/hollowDistricts.js';
import { buildCreekIndustry } from './hollowIndustry.js';
import { buildLandmarks } from './hollowLandmarks.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as T from 'three';
import { createRandom } from '../world/noise.js';

const sheetURL = new URL('../assets/maps/hollow-facades.webp',import.meta.url).href;
// Two cutout planes preserve the crown silhouette as the car passes the tree.
function winterTree(tile) {
  const positions=[],uv=[],indices=[];
  for(const [x,z] of [[.5,0],[0,.5]]){
    const start=positions.length/3;
    positions.push(-x,0,-z, x,0,z, x,1,z, -x,1,-z);
    const left=(tile+.004)/2,right=(tile+.996)/2;
    uv.push(left,.012, right,.012, right,.995, left,.995);
    indices.push(start,start+1,start+2,start,start+2,start+3);
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  return geometry;
}
function gable() {
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute([
    -.5,0,-.5, .5,0,-.5, .5,0,.5, -.5,0,.5, 0,1,-.5, 0,1,.5
  ],3));
  g.setIndex([0,4,1,3,2,5,0,3,5,0,5,4,1,4,5,1,5,2]);
  const geo=g.toNonIndexed(),uv=[],v=geo.attributes.position;
  for(let i=0;i<v.count;i++)uv.push(v.getZ(i)+.5,(v.getY(i)+.15*Math.abs(v.getX(i)))*.65);
  geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.computeVertexNormals();g.dispose();return geo;
}
function signTexture(text) {
  const canvas=document.createElement('canvas'); canvas.width=512; canvas.height=96;
  const c=canvas.getContext('2d');
  c.fillStyle='#213237';c.fillRect(0,0,512,96);
  c.strokeStyle='#aaa78e';c.lineWidth=3;c.strokeRect(6,6,500,84);
  c.fillStyle='#d4d3bb';c.font='bold 37px Georgia';c.textAlign='center';c.textBaseline='middle';c.fillText(text,256,48,475);
  const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;return map;
}
export class HollowCreekTown {
  constructor({world,quality}) {
    this.group=new T.Group();this.group.name='Hollow Creek districts';
    this.lamps=[];this.clock=0;this.outage=0;this.chunks=[];this.textures=[];
    const random=createRandom(3927), cube=new T.BoxGeometry(),roof=gable();
    const stone=new T.MeshStandardMaterial({color:0x465054,roughness:.88,side:T.DoubleSide});
    const wood=new T.MeshStandardMaterial({color:0x3d3937,roughness:.86});
    const iron=new T.MeshStandardMaterial({color:0x273238,roughness:.61});
    const amber=new T.MeshBasicMaterial({color:0xffdb91});
    const faded=new T.MeshStandardMaterial({color:0x929b94,roughness:.74});
    const texture=new T.TextureLoader().load(sheetURL);texture.colorSpace=T.SRGBColorSpace;
    texture.anisotropy=4;this.textures.push(texture);
    const walls=new T.MeshStandardMaterial({map:texture,roughness:.78});
    this.parts={stone:[cube,stone],roof:[roof,stone],wood:[cube,wood],iron:[cube,iron],lamp:[cube,amber],paint:[cube,faded],
      spire:[new T.ConeGeometry(.62,1,8),stone], crown:[new T.IcosahedronGeometry(.5,0),wood]};
    for(let i=0;i<4;i++){
      const geom=cube.clone(),uv=geom.attributes.uv;
      for(let j=0;j<uv.count;j++) uv.setXY(j,(i%2+.008+.984*uv.getX(j))/2,((i<2?1:0)+.008+.984*uv.getY(j))/2);
      this.parts['wall'+i]=[geom,walls];
    }
    const tradeMap=new T.TextureLoader().load(new URL('../assets/maps/hollow-trade-atlas.webp',import.meta.url).href);
    tradeMap.colorSpace=T.SRGBColorSpace;tradeMap.anisotropy=4;this.textures.push(tradeMap);
    const tradeWalls=new T.MeshStandardMaterial({map:tradeMap,bumpMap:tradeMap,bumpScale:.045,roughness:.83});
    ['pharmacy','parcels','oxidised','setwall'].forEach((key,i)=>{
      const geometry=this.parts['wall'+i][0].clone();
      if(i<2){
        // Only the street elevation carries signage. Corrugated siding wraps
        // the remaining walls, including the elevation facing the hinterland.
        const uv=geometry.attributes.uv,metal=this.parts.wall2[0].attributes.uv;
        const normal=geometry.attributes.normal,streetNormal=i===0?1:-1;
        for(let j=0;j<uv.count;j++)if(normal.getZ(j)!==streetNormal)uv.setXY(j,metal.getX(j),metal.getY(j));
      }
      this.parts[key]=[geometry,tradeWalls];
    });
    this.parts.crate=[cube,new T.MeshStandardMaterial({color:0x6b5840,roughness:.92})];
    const tiles=new T.TextureLoader().load(new URL('../assets/maps/hollow-roof.webp',import.meta.url).href);
    tiles.colorSpace=T.SRGBColorSpace;tiles.wrapS=tiles.wrapT=T.RepeatWrapping;tiles.repeat.set(2,1);
    this.textures.push(tiles);this.parts.roof=[roof,new T.MeshStandardMaterial({map:tiles,bumpMap:tiles,bumpScale:.06,roughness:.78,side:T.DoubleSide,color:0xacb4b2})];
    const districts=['CLOCK SQUARE','HOLLOW CREEK','VANISHING ROAD','SIGNAL TUNNEL','THE LAST GARAGE','BLACKWATER MILL'];
    districts.forEach((label,i)=>{
      const map=signTexture(label);this.textures.push(map);
      this.parts['sign'+i]=[cube,new T.MeshStandardMaterial({map,roughness:.84})];
    });
    const batches=new Map(), transform=new T.Object3D();
    const place=(key,x,y,z,w,h,d,yaw=0,roll=0)=>{
      const k=Math.floor(x/100)+','+Math.floor(z/100);
      if(!batches.has(k)) batches.set(k,new Map());
      const group=batches.get(k);
      if(!group.has(key))group.set(key,[]);
      transform.position.set(x,y,z); transform.rotation.set(0,yaw,roll,'YXZ');transform.scale.set(w,h,d);
      transform.updateMatrix();group.get(key).push(transform.matrix.clone());
    };
    const beam=(key,a,b,r)=>{
      const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z;
      place(key,(a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2,r,Math.hypot(dx,dy,dz),r,
        Math.atan2(-dz,dx),-Math.atan2(Math.hypot(dx,dz),dy));
    };
    const loc={};
    const clear=(x,z,r)=>!world.roads.some(rd=>rd.locate(x,z,loc)&&!loc.beyondEnd&&loc.distance<loc.halfWidth+r+1);
    const obstacles=[];
    const leaves=new T.TextureLoader().load(new URL('../assets/maps/alpine-foliage.webp',import.meta.url).href);
    leaves.colorSpace=T.SRGBColorSpace;this.textures.push(leaves);
    const canopy=new T.MeshStandardMaterial({map:leaves,alphaTest:.34,vertexColors:true,side:T.DoubleSide,color:0x88968a,roughness:1});
    this.windTime={value:0};
    canopy.onBeforeCompile=s=>{
      s.uniforms.hcWind=this.windTime;
      s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nuniform float hcWind;')
        .replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.x+=sin(hcWind+instanceMatrix[3].z*.31)*position.y*.019;');
    };
    const winterMap=new T.TextureLoader().load(new URL('../assets/maps/hollow-winter-trees.webp',import.meta.url).href);
    winterMap.colorSpace=T.SRGBColorSpace;this.textures.push(winterMap);
    const twigs=new T.MeshLambertMaterial({map:winterMap,side:T.DoubleSide,alphaTest:.32,alphaToCoverage:true,color:0xaeb2ac});
    this.parts.elm=[winterTree(0),twigs];this.parts.willow=[winterTree(1),twigs];
    this.parts.scrub=[buildTexturedGrassGeometry(),canopy];
    this.parts.slab=[cube,new T.MeshStandardMaterial({color:0x66635a,roughness:.9})];
    this.parts.rubber=[cube,new T.MeshStandardMaterial({color:0x242827,roughness:.88})];
    this.parts.rock=[new T.DodecahedronGeometry(.56),stone];
    this.parts.drum=[new T.CylinderGeometry(.5,.5,1,12),new T.MeshStandardMaterial({color:0x615043,metalness:.52,roughness:.72})];
    this.parts.wheel=[new T.CylinderGeometry(.5,.5,1,14).rotateX(Math.PI/2),iron];
    this.parts.rim=[new T.CylinderGeometry(.51,.51,1,12),iron];
    const pavement=new T.TextureLoader().load(new URL('../assets/maps/hollow-road.webp',import.meta.url).href);
    pavement.colorSpace=T.SRGBColorSpace;this.textures.push(pavement);
    this.parts.slab[1].map=pavement;this.parts.slab[1].color.setHex(0xbab2a4);
    const lightTex=document.createElement('canvas');lightTex.width=lightTex.height=96;
    const lc=lightTex.getContext('2d'),falloff=lc.createRadialGradient(48,48,1,48,48,47);
    falloff.addColorStop(0,'rgba(255,225,166,.55)');falloff.addColorStop(.28,'rgba(253,202,125,.24)');falloff.addColorStop(1,'rgba(246,199,123,0)');
    lc.fillStyle=falloff;lc.fillRect(0,0,96,96);
    const lightMap=new T.CanvasTexture(lightTex);this.textures.push(lightMap);
    const spill=new T.PlaneGeometry(1,1);spill.rotateX(-Math.PI/2);
    this.parts.spill=[spill,new T.MeshBasicMaterial({map:lightMap,color:0xd3bd8c,transparent:true,depthWrite:false,blending:T.AdditiveBlending,polygonOffset:true,polygonOffsetFactor:-1})];
    this.parts.tunnelLamp=[cube,amber];this.parts.exitLamp=[cube,amber];this.parts.trainLamp=[cube,amber];
    for(const rd of world.roads) {
      let pole=null;
      for(let s=12,i=0;s<rd.length;s+=rd.id===2?36:rd.id===1?16:rd.id===0&&s<1750?18:23,i++){
        const f=rd.frameAt(s,{}), yaw=Math.atan2(f.rx,f.rz);
        for(const side of [-1,1]){
          const offset=side*(rd.config.halfWidth+(rd.id<=1?7.4:9)+random()*(rd.id<=1?2.8:5));
          const x=f.x+offset*f.rx,z=f.z+offset*f.rz;
          const w=8+random()*7,d=7+random()*3;
          if(world.depots.some(depot=>inDepot(x,z,depot,9)) || !clear(x,z,Math.min(d*.56+1,w*.57)) || rd.id===9 || (rd.id===1 && Math.abs(s-470)<30 && side<0) ||
             Object.values(world.sites).some(p=>Math.hypot(p.x-x,p.z-z)<(p.id==='factory'?45:32)) ||
             Math.hypot((world.creek.x-x)/102,(world.creek.z-z)/90)<1.1)continue;
          if(rd.id===2 && (s<1800 || s>5200) && i%7!==0)continue;
          const y=world.heightAt(x,z)-.48;
          const type=rd.id===1?(i%7===0?2:0):rd.id===2?(i%5===0?3:0):Math.floor(s/590)%3===1?1:i%4===0?3:0;
          const h=type===1?12+random()*11:type===3?8+random()*5:5.3+random()*3;
          const masonry=rd.id===1 && (Math.floor(s/125)%3!==1);
          place('wall'+type,x,y+h/2,z,w,h,d,yaw);
          const frontZ=side*(d*.5+.08),sx=x-frontZ*f.rx,sz=z-frontZ*f.rz;
          if(masonry){
            place('setwall',sx,y+.77,sz,w,1.55,.18,yaw);
            if(i%3===0)place('wood',sx,y+2.7,sz,w*.49,.28,.44,yaw);
          }
          if(type===1){
            // Awnings, cornices and downpipes break up the storefront silhouette.
            place('oxidised',sx-side*.64*f.rx,y+3.1,sz-side*.64*f.rz,w*.86,.3,1.6,yaw);
            place('stone',x,y+h-.6,z,w+.27,.24,d+.22,yaw);
            if(i%4===2){
              // Fire escapes hang off the masonry. The landing, balusters
              // and diagonal stair leave distinct silhouettes above the awning.
              for(let floor=4.8;floor<h-1.5;floor+=3.4){
                const bx=sx-side*f.rx*.68,bz=sz-side*f.rz*.68;
                place('iron',bx,y+floor,bz,4.5,.12,1.45,yaw);
                const ox=bx-side*f.rx*.69,oz=bz-side*f.rz*.69;
                place('iron',ox,y+floor+.95,oz,4.5,.07,.065,yaw);
                for(const j of [-2,-1,0,1,2])place('iron',ox+f.tx*j,y+floor+.47,oz+f.tz*j,.055,.94,.055);
                if(floor+3.4<h-1.5)beam('iron',{x:ox-2*f.tx,y:y+floor,z:oz-2*f.tz},
                  {x:ox+2*f.tx,y:y+floor+3.4,z:oz+2*f.tz},.18);
              }
            }
            place('iron',sx+f.tx*w*.43,y+h*.46,sz+f.tz*w*.43,.13,h*.91,.13);
          }
          if(type===3 && i%2===0){
            place('oxidised',sx,y+2.2,sz,w*.56,4.4,.24,yaw);
            for(const k of [-1,1])place('iron',sx+k*w*.3*f.tx,y+2.5,sz+k*w*.3*f.tz,.18,5,.26,yaw);
          }
          obstacles.push(x,z,Math.min(w,d)*.53);
          if(type!==1)place('roof',x,y+h-.12,z,d+.8,2.3,w+.65,yaw+Math.PI/2);
          else place('stone',x,y+h,z,w+.55,.45,d+.55,yaw);
          const front=side*(d*.5+1.0),px=x-front*f.rx,pz=z-front*f.rz;
          if(i%3===1){
            place('wall1',x+2.4*f.tx,y+h+1.1,z+2.4*f.tz,.84,3.1,.88,yaw);
            place('stone',x+2.4*f.tx,y+h+2.7,z+2.4*f.tz,1,.22,1,yaw);
          }
          if(type===0 && i%4!==2){
            place('roof',px,y+2.6,pz,2.3,1.05,w+.5,yaw+Math.PI/2);
            for(const end of [-1,1])place('wood',px+end*w*.42*f.tx,y+1.3,pz+end*w*.42*f.tz,.13,2.6,.13);
          }
          if(type===0 && i%3===0)for(const j of [-3,-2,-1,0,1,2,3]){
            const gx=px+f.tx*(7+j*.7)-side*f.rx*2.8,gz=pz+f.tz*(7+j*.7)-side*f.rz*2.8;
            if(clear(gx,gz,.3))place('wood',gx,world.heightAt(gx,gz)+.57,gz,.15,1.14,.085,yaw,j*.012);
          }
          // Stock and street furniture stay against the frontage, leaving the
          // driving line and the side-street turning aprons open.
          if(type!==0 && i%5===1 && clear(px,pz,1.35)){
            for(let k=0;k<2;k++){
              const bx=px+f.tx*(1.1*k-1.3),bz=pz+f.tz*(1.1*k-1.3),by=world.heightAt(bx,bz);
              place('drum',bx,by+.49,bz,.64,.98,.64);
              for(const lift of [.23,.74])place('rim',bx,by+lift,bz,.66,.045,.66);
            }
          }else if(type===0 && i%4===1){
            for(let step=0;step<3;step++){
              const back=side*(1.6-step*.35),ax=px-back*f.rx+w*.21*f.tx,az=pz-back*f.rz+w*.21*f.tz;
              if(clear(ax,az,.8))place('slab',ax,world.heightAt(ax,az)+.07*step,az,1.65,.16+.13*step,.42,yaw);
            }
          }
          if(i%2===0){
            const tx=x-side*6*f.rx+8*f.tx,tz=z-side*6*f.rz+8*f.tz;
            if(clear(tx,tz,1.5) && !world.depots.some(d=>inDepot(tx,tz,d,2))){
              const h=7+random()*4.5,w=h*(.75+.21*random());
              place(rd.id===0 && s>2040 && s<2480?'willow':'elm',tx,world.heightAt(tx,tz)-.05,tz,w,h,w,random()*Math.PI);
              obstacles.push(tx,tz,.27);
            }
          }
        }
        // Cracked sidewalks and gutter stones, interrupted at every crossing.
        if(rd.id<=1)for(const side of [-1,1]){
          for(let j=0;j<5;j++){
            const edge=rd.frameAt(s+j*4.55,{}),off=(edge.halfWidth+2.05)*side;
            const x=edge.x+edge.rx*off,z=edge.z+edge.rz*off;
            if(!clear(x,z,.43))continue;
            const y=world.heightAt(x,z), angle=Math.atan2(edge.tx,edge.tz);
            place('slab',x,y+.025,z,2,.15,4.47,angle);
            if((i+j)%5===0) {
              for(let k=0;k<5;k++){
                const ox=side*(2+random()*2.6), xx=x+ox*edge.rx+random()*edge.tx,zz=z+ox*edge.rz+random()*edge.tz;
                place('scrub',xx,world.heightAt(xx,zz)+.14,zz,1+random(),.45+random()*.8,.85+random());
              }
              if(i%4===0)place('rock',x,y+.16,z,.7,.33,.4,angle);
            }
          }
          if(i%9===0){const off=side*(f.halfWidth+4.7),x=f.x+f.rx*off,z=f.z+f.rz*off,y=world.heightAt(x,z);
            if(clear(x,z,1)){place('wood',x,y+.5,z,.53,.12,2.6,Math.atan2(f.tx,f.tz));
              for(const v of [-.85,.85])place('iron',x+f.tx*v,y+.22,z+f.tz*v,.22,.48,.4);}
          }
        }
        if(i%2===0){
          const x=f.x+(rd.config.halfWidth+2)*f.rx,z=f.z+(rd.config.halfWidth+2)*f.rz,y=world.heightAt(x,z);
          if(!clear(x,z,.35)){pole=null;continue;}
          place('wood',x,y+3.6,z,.22,7.2,.22,yaw);
          place('wood',x,y+6.7,z,2.4,.14,.15,yaw+Math.PI/2);
          const top={x,y:y+6.75,z};
          if(pole){
            const sag={x:(pole.x+x)/2,y:(pole.y+top.y)/2-1.2,z:(pole.z+z)/2};
            beam('iron',pole,sag,.047);beam('iron',sag,top,.047);
          }
          pole=top;
          if(i%6===0){
            place('iron',x-f.rx*.7,y+4.3,z-f.rz*.7,.14,.14,1.6,yaw);
            place('lamp',x-f.rx*1.4,y+4.03,z-f.rz*1.4,.37,.44,.37);
            const lx=x-f.rx*3.6,lz=z-f.rz*3.6;
            place('spill',lx,world.heightAt(lx,lz)+.085,lz,7.2,1,9,yaw);
          }
        }
        if(rd.id===0 && i%22===0)for(let j=-3;j<=3;j++)
          place('paint',f.x+j*f.rx,f.y+.035,f.z+j*f.rz,.43,.012,2.5,Math.atan2(f.tx,f.tz));
      }
    }
    const feature=(rid,s,offset)=>{
      const f=world.roads[rid].frameAt(s,{});const x=f.x+f.rx*offset,z=f.z+f.rz*offset;
      return {x,z,y:world.heightAt(x,z),yaw:Math.atan2(f.tx,f.tz)};
    };
    const tower=feature(1,470,-20);
    place('slab',tower.x,tower.y-.055,tower.z,30,.19,23,tower.yaw);
    for(const s of [458,482]){
      const p=feature(1,s,-10);place('iron',p.x,p.y+1.65,p.z,.15,3.3,.15);
      place('lamp',p.x,p.y+3.36,p.z,.34,.49,.34);
    }
    place('wall2',tower.x,tower.y+9,tower.z,6,18,6,tower.yaw);
    place('spire',tower.x,tower.y+23,tower.z,9,11,9,tower.yaw);
    const clock=document.createElement('canvas');clock.width=clock.height=128;
    const face=clock.getContext('2d');face.fillStyle='#333f40';face.fillRect(0,0,128,128);face.fillStyle='#b3b1a0';face.beginPath();face.arc(64,64,55,0,7);face.fill();
    face.strokeStyle='#293333';face.lineWidth=5;face.beginPath();face.moveTo(42,73);face.lineTo(64,64);face.lineTo(74,24);face.stroke();
    const dial=new T.CanvasTexture(clock);dial.colorSpace=T.SRGBColorSpace;this.textures.push(dial);
    this.parts.clock=[cube,new T.MeshStandardMaterial({map:dial})];
    place('clock',tower.x,tower.y+15,tower.z,6.08,3.9,6.08,tower.yaw);
    // The old railway gallery covers the track. Its posts sit outside tyre clearance.
    for(let i=0;i<=22;i++){
      const s=2460+i*4,f=world.roads[2].frameAt(s,{}),yaw=Math.atan2(f.tx,f.tz);
      place('stone',f.x,f.y+6.1,f.z,13,.7,4.35,yaw);
      for(const side of [-1,1]){
        if(side===1 && i>=7 && i<=17)continue;
        place(i%3?'wall3':'stone',f.x+6.1*side*f.rx,f.y+3,f.z+6.1*side*f.rz,.65,6,i%3?4.25:1,yaw);
      }
      if(i===10)place('exitLamp',f.x+4.8*f.rx,f.y+3.7,f.z+4.8*f.rz,.28,.5,.28);
      if(i%5===0)place('tunnelLamp',f.x,f.y+5.65,f.z,1.25,.15,.24,yaw);
    }
    for(const [idx,r,s] of [[0,1,425],[3,2,2427],[4,0,60],[5,2,4940],...world.roads.slice(3,9).map(rd=>[rd.id%2===1?0:2,rd.id,32])]){
      const p=feature(r,s,7.6);
      place('wood',p.x,p.y+1.55,p.z,.17,3.1,.17,p.yaw);
      place('sign'+idx,p.x,p.y+2.75,p.z,4.7,.92,.13,p.yaw);
    }
    const signs=new Map();
    const registerSign=label=>{
      if(signs.has(label))return signs.get(label);
      const key='site'+signs.size, map=signTexture(label);this.textures.push(map);
      this.parts[key]=[cube,new T.MeshStandardMaterial({map,roughness:.72})];signs.set(label,key);return key;
    };
    this.parts.window=[cube,new T.MeshBasicMaterial({color:0x87c6ad})];
    buildLandmarks(world,place,registerSign,obstacles);
    buildCreekIndustry(world,place,beam,registerSign,obstacles);
    // Stone foundations, collapsed fencing, evergreen silhouettes and gutters
    // keep the roadside readable as it changes from settlement into forest.
    for(let s=0;s<world.roads[2].length;s+=11){
      const f=world.roads[2].frameAt(s,{});
      for(const side of [-1,1]){
        const off=side*(9+random()*36),x=f.x+off*f.rx,z=f.z+off*f.rz;
        if(!clear(x,z,3)||world.depots.some(d=>inDepot(x,z,d,5))||Object.values(world.sites).some(p=>Math.hypot(p.x-x,p.z-z)<38))continue;
        const y=world.heightAt(x,z),h=7+random()*9;
        const crown=h*(.74+.25*random());
        place(s<2300?'willow':'elm',x,y,z,crown,h,crown,random()*Math.PI);
        obstacles.push(x,z,.32);
        const offset=side*(38+random()*18),bx=f.x+offset*f.rx,bz=f.z+offset*f.rz;
        if(clear(bx,bz,4) && !world.depots.some(d=>inDepot(bx,bz,d,6)) &&
           !Object.values(world.sites).some(p=>Math.hypot(p.x-bx,p.z-bz)<40)){
          const height=11+random()*9;
          place(s>1800 && s<2700?'willow':'elm',bx,world.heightAt(bx,bz),bz,height*.93,height,height*.93,random()*Math.PI);
        }
      }
    }
    // Thickets and cuts form a second layer behind the boundary rail. Preserve
    // the clear silhouettes of the ferry, mine entrance and timber headframe.
    const outer=world.roads[2];
    for(let s=8;s<outer.length;s+=8.4){
      const f=outer.frameAt(s,{}),offset=-(outer.config.halfWidth+4+random()*7);
      const x=f.x+offset*f.rx,z=f.z+offset*f.rz;
      if(!clear(x,z,2.4) || world.depots.some(d=>inDepot(x,z,d,8)) ||
         Object.values(world.sites).some(p=>Math.hypot(x-p.x,z-p.z)<38))continue;
      const y=world.heightAt(x,z), rot=Math.atan2(f.tx,f.tz);
      if(s>3200 && s<4640){
        const h=2+.9*Math.sin(s/28)+random()*1.8;
        place('setwall',x,y+h*.46,z,2.6,h,7.8,rot);
        place('rock',x-2*f.rx,y+h*.75,z-2*f.rz,4.8,h,5.6,rot);
      }else if(s<1780 || s>5250){
        const h=7+random()*8;place('willow',x,y,z,h*.77,h,h*.77,random()*6.28);
        for(let j=0;j<3;j++)place('scrub',x+f.tx*j,y,z+f.tz*j,2.6,1.8,2.4,random()*6.28);
      }
    }
    // Willow beds behind the incline obscure the bare horizon while the logbook
    // and the towers occupy the foreground. Leave a channel for the cross street.
    // The next row reads through alley mouths and around the parcel siding.
    // Keep the water sightline and the discoverable landmark yards open.
    for(const rd of world.roads.slice(0,2)){
      for(let s=8;s<rd.length;s+=21){
        const f=rd.frameAt(s,{});
        for(const side of [-1,1]){
          const off=side*(27+random()*22),x=f.x+off*f.rx,z=f.z+off*f.rz;
          if(!clear(x,z,6)||world.depots.some(d=>inDepot(x,z,d,2))||
             Object.values(world.sites).some(p=>Math.hypot(x-p.x,z-p.z)<40)||
             Math.hypot((x-world.creek.x)/106,(z-world.creek.z)/95)<1.25)continue;
          const h=8+random()*11,w=h*(.68+random()*.28);
          place(s%130<62?'elm':'willow',x,world.heightAt(x,z),z,w,h,w,random()*Math.PI);
        }
      }
    }
    const incline=world.depots.find(d=>d.id==='tram');
    for(let n=0;n<100;n++){
      const along=(random()-.5)*198,back=48+random()*48;
      const x=incline.x+along*incline.tx+back*incline.rx,z=incline.z+along*incline.tz+back*incline.rz;
      if(!clear(x,z,5))continue;
      const h=8+random()*12;
      place(n%4?'elm':'willow',x,world.heightAt(x,z),z,h*.85,h,h*.85,random()*Math.PI);
    }
    // The shutter is inside the maintenance road, clear of the ranked tunnel.
    const gate=world.roads[9].frameAt(28,{});
    this.gate=new T.Group();this.gate.position.set(gate.x,gate.y,gate.z);
    this.gate.rotation.y=Math.atan2(gate.tx,gate.tz);
    for(let i=-6;i<=6;i++){
      const bar=new T.Mesh(cube,iron);bar.position.set(i*.49,1.67,0);bar.scale.set(.095,3.35,.13);this.gate.add(bar);
    }
    const cross=new T.Mesh(cube,wood);cross.position.y=1.2;cross.scale.set(6.4,.28,.22);this.gate.add(cross);
    this.group.add(this.gate);this.gateBase=gate.y;
    // Empty lift shafts and the frames of unfinished flats across the water.
    const wharf=world.sites.wharf;
    for(let i=-3;i<4;i++){
      const x=wharf.x-wharf.rx*(208+14*Math.cos(i))+i*15*wharf.tx;
      const z=wharf.z-wharf.rz*(208+14*Math.cos(i))+i*15*wharf.tz;
      const y=world.heightAt(x,z),floors=3+Math.floor(random()*6),yaw=Math.atan2(wharf.rx,wharf.rz);
      for(let k=0;k<floors;k++)place('stone',x,y+3.1*k,z,9.8,.4,8,yaw);
      for(const a of [-1,1])for(const b of [-1,1])
        place('iron',x+a*4.3*wharf.tx+b*3.5*wharf.rx,y+floors*1.55,z+a*4.3*wharf.tz+b*3.5*wharf.rz,.45,floors*3.1,.45,yaw);
    }
    const lake=world.creek;
    const lakeMat=new T.MeshStandardMaterial({color:0x34525e,roughness:.18,metalness:.42});
    const water=new T.Mesh(new T.CircleGeometry(1,72),lakeMat);
    water.rotation.x=-Math.PI/2;water.scale.set(98,86,1);
    water.position.set(lake.x,lake.y,lake.z);this.group.add(water);this.lake=water;
    // A timber causeway spans the creek bed on the outer approach to the mine.
    for(let s=1830;s<1870;s+=.62){
      const f=world.roads[2].frameAt(s,{}),yaw=Math.atan2(f.tx,f.tz);
      place('wood',f.x,f.y+.015,f.z,2*f.halfWidth,.055,.595,yaw);
      if(Math.round((s-1830)/.62)%7===0)for(const sign of [-1,1]){
        const x=f.x+sign*(f.halfWidth+.7)*f.rx,z=f.z+sign*(f.halfWidth+.7)*f.rz;
        place('wood',x,f.y-.68,z,.31,3.4,.31,yaw);place('wood',x,f.y+.77,z,.15,.16,4.5,yaw);
      }
    }
    for(const id of ['fuel','rail','factory']){
      const p=world.sites[id];
      for(let i=0;i<15;i++)for(const tire of [-.77,.77]){
        const off=p.offset*(i/16),f=world.roads[p.roadId].frameAt(p.s-29+i*2.1,{});
        const x=f.x+f.rx*(off+tire),z=f.z+f.rz*(off+tire);
        place('rubber',x,world.heightAt(x,z)+.045,z,.18,.018,1.75,Math.atan2(f.tx+.34*Math.sign(off)*f.rx,f.tz+.34*Math.sign(off)*f.rz));
      }
    }
    world.setObstacles(obstacles);
    for(const [key,parts] of batches){
      const group=new T.Group(),[cx,cz]=key.split(',').map(Number);
      group.userData.cx=cx*100+50;group.userData.cz=cz*100+50;
      for(const [name,matrices] of parts){
        const mesh=new T.InstancedMesh(...this.parts[name],matrices.length);
        matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.computeBoundingSphere();
        if(['lamp','spill','window','tunnelLamp','exitLamp','trainLamp'].includes(name)){
          mesh.material=mesh.material.clone();
          this.lamps.push({mesh,cx:group.userData.cx,cz:group.userData.cz,kind:name});
        }
        group.add(mesh);
      }
      this.chunks.push(group);this.group.add(group);
    }
    this.weather=new HollowWeather(world,random);this.group.add(this.weather.group);
    this.setQuality(quality);
  }
  async loadCoupe(world){
    const {scene}=await new GLTFLoader().loadAsync(new URL('../assets/maps/hollow-coupe.glb',import.meta.url).href);
    const p=world.sites.factory,x=p.x+p.tx*15,z=p.z+p.tz*15;
    scene.position.set(x,world.heightAt(x,z)+.04,z);scene.rotation.y=.28+Math.atan2(p.tx,p.tz);
    this.group.add(scene);this.coupe=scene;
  }
  setQuality(q){this.range=170+45*(q?.terrainLod||1);this.effectScale=q?.effects??1;}
  update(position,dt=0,night=this.weather.night){
    this.weather.update(position,dt,night,(this.weatherStrength??1)*this.effectScale);
    this.clock+=dt;this.windTime.value=this.clock;
    this.gate.position.y=this.gateBase+(this.exitKnown?4.25:0);
    if(this.outage>0)this.outage=Math.max(0,this.outage-dt);
    for(const light of this.lamps){
      if(!light.mesh.parent.visible)continue;
      const distance=Math.hypot(light.cx-(this.outageX??0),light.cz-(this.outageZ??0));
      const dark=this.outage>0 && (this.townBlackout || distance<(30-this.outage)*34);
      const windowLight=light.kind==='window';
      let level=dark ? .022 : windowLight ? .62+.35*Math.sin(this.clock*.9) : 1;
      if(light.kind==='exitLamp')level=this.exitKnown?1:.012;
      if(light.kind==='trainLamp')level=this.trainUntil>this.clock ? .6+.4*Math.sin(this.clock*4) : .005;
      if(light.kind==='tunnelLamp')level*=.72+.27*Math.sin(this.clock*(1+(this.tunnelPhase||0)%3));
      light.mesh.material.color.setHex(windowLight||light.kind==='exitLamp'?0x87c6ad:0xffdb91).multiplyScalar(level);
    }
    for(const group of this.chunks) group.visible=Math.abs(position.x-group.userData.cx)<this.range && Math.abs(position.z-group.userData.cz)<this.range;
  }
  dispose(){
    this.weather.dispose();
    if(this.coupe){
      const resources=new Set();this.coupe.traverse(o=>{if(o.isMesh){resources.add(o.geometry);resources.add(o.material);}});
      resources.forEach(r=>r.dispose());
    }
    this.lake.geometry.dispose();this.lake.material.dispose();for(const light of this.lamps)light.mesh.material.dispose();
    this.group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});
    for(const item of new Set(Object.values(this.parts).flat()))item.dispose();
    for(const tex of this.textures)tex.dispose();
    this.group.removeFromParent();
  }
}
