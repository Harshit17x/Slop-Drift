import * as T from 'three';
import {MeshBuffer} from './road/MeshBuffer.js';
import {createAsphaltTexture,createAsphaltReliefTexture,createGrainTexture} from './road/textures.js';
import {apexSurface} from '../world/Apex.js';
const PAINT=0xe1dfd3, RED=0xae3d32, WHITE=0xd8d4c8;
const tint=new T.Color();
function vertex(buf,r,i,d,h,s){
  return buf.vertex(r.px[i]+r.rx[i]*d,r.py[i]+d*r.bank[i]+h,r.pz[i]+r.rz[i]*d,d/4,s/4,tint.r,tint.g,tint.b);
}
function lane(buf,r,i,j,l,h,L,H,low,high,color){
  tint.setHex(color);const s=i*r.spacing,t=s+r.spacing;
  const a=vertex(buf,r,i,l,low,s),b=vertex(buf,r,i,h,high,s),c=vertex(buf,r,j,H,high,t),d=vertex(buf,r,j,L,low,t);
  if(l<h)buf.quad(a,b,c,d);else buf.quad(d,c,b,a);
}
function patch(buf,r,i,j,left,right,h1,h2,color){lane(buf,r,i,j,left,right,left,right,h1,h2,color);}
const groove=(r,i)=>Math.max(-.5,Math.min(.5,r.curvature[i]*33))*r.halfWidth[i];
export class ApexCircuitSurface{
  constructor({world,anisotropy}){
    this.world=world;this.group=new T.Group();this.geometries=[];
    const asphalt=createAsphaltTexture(anisotropy),relief=createAsphaltReliefTexture(anisotropy),gravel=createGrainTexture(anisotropy);
    this.textures=[asphalt,relief,gravel];
    this.tarmac=new T.MeshStandardMaterial({map:asphalt,bumpMap:relief,bumpScale:.015,roughness:.9,vertexColors:true,side:T.DoubleSide});
    this.paint=new T.MeshStandardMaterial({bumpMap:relief,bumpScale:.007,roughness:.79,vertexColors:true,side:T.DoubleSide});
    this.runoff=new T.MeshStandardMaterial({map:gravel,roughness:1,vertexColors:true,side:T.DoubleSide});
    for(const r of world.physicalRoads)this.build(r);
    this.rubberTraces();
  }
  build(r){
    const other={},park=this.world.apex;
    for(let base=0;base<r.segments;base+=140){
      const asphalt=new MeshBuffer({colors:true,uvs:true}),paint=new MeshBuffer({colors:true,uvs:true}),gravel=new MeshBuffer({colors:true,uvs:true});
      for(let i=base;i<Math.min(base+140,r.segments);i++){
        const s=i*r.spacing,j=(i+1)%r.count,w=r.halfWidth[i],lift=.005*r.id;
        const a=groove(r,i),b=groove(r,j),type=apexSurface(r,s),slab=type!=='asphalt';
        const colors=slab?[0xaaa99e,0x97978c,0x909187,0x99998d,0xaaa99e]:[0xdbddd9,0xd4d6d2,0xcdd0cd,0xd3d6d2,0xdbddd9];
        const A=[-w,a-1.85,a-.9,a+.9,a+1.85,w],B=[-w,b-1.85,b-.9,b+.9,b+1.85,w];
        for(let v=0;v<5;v++)lane(slab?paint:asphalt,r,i,j,A[v],A[v+1],B[v],B[v+1],lift,lift,colors[v]);
        if(slab){
          patch(paint,r,i,j,-.034,.034,lift+.009,lift+.009,0x53564f);
          if(i%3===0){
            const f=r.frameAt(s,{});paint.box(f.x,f.y+lift+.01,f.z,r.rx[i]*w,r.bank[i]*w,r.rz[i]*w,0,.006,0,r.tx[i]*.035,0,r.tz[i]*.035,.12,.12,.10);
          }
        }
        for(const side of [-1,1]){
          const lat=side*(w+1),x=r.px[i]+lat*r.rx[i],z=r.pz[i]+lat*r.rz[i];
          if(park.physical.some(o=>o!==r && o.locate(x,z,other,r.py[i]) && !other.beyondEnd && other.distance<other.halfWidth+4 && Math.abs(other.y-r.py[i])<2.1))continue;
          patch(paint,r,i,j,side*(w-.16),side*w,lift+.012,lift+.012,PAINT);
          patch(gravel,r,i,j,side*w,side*(w+5),lift-.022,lift-.028,0xc9bdaa);
          patch(paint,r,i,j,side*(w+5),side*(w+8),lift-.029,lift-.14,0x747c4c);
          if(Math.abs(r.curvature[i])>.0018 && r!==park.pit){
            const color=i%2===0?RED:WHITE;
            patch(paint,r,i,j,side*w,side*(w+.52),lift+.019,lift+.067,color);
            patch(paint,r,i,j,side*(w+.52),side*(w+1.05),lift+.067,lift+.011,color);
          }
          const extra=side<0?r.escapeLeft?.[i]??0:r.escapeRight?.[i]??0;
          if(extra>.05){
            const widths=[w+7.95,w+8+extra],ids=[];
            for(const [idx,n] of [[i,0],[i,1],[j,1],[j,0]]){
              const lat=side*widths[n],X=r.px[idx]+lat*r.rx[idx],Z=r.pz[idx]+lat*r.rz[idx];
              const Y=n?this.world.grid.heightAt(X,Z)+.025:r.py[idx]+lat*r.bank[idx]-.14;
              ids.push(gravel.vertex(X,Y,Z,X/3,Z/3,.72,.65,.52));
            }gravel.quad(...ids);
          }
          if(side<0?r.railLeft[i]:r.railRight[i]){
            const d=side*(w+9+extra);
            for(const h of [.39,.79])patch(paint,r,i,j,d,d+side*.11,h,h+.22,0xa7acaa);
            if(i%2===0)paint.box(r.px[i]+d*r.rx[i],r.py[i]+d*r.bank[i]+.47,r.pz[i]+d*r.rz[i],.084,0,0,0,.54,0,0,0,.084,.22,.24,.23);
          }
        }
      }
      for(const [buf,mat] of [[asphalt,this.tarmac],[paint,this.paint],[gravel,this.runoff]]){
        if(!buf.triangleCount)continue;const g=buf.build(),m=new T.Mesh(g,mat);m.receiveShadow=true;this.geometries.push(g);this.group.add(m);
      }
    }
  }
  rubberTraces(){
    const r=this.world.apex.main,b=new MeshBuffer({uvs:true,colors:true});
    for(const section of this.world.apex.sections){
      for(let n=0;n<8;n++){
        const begin=section.start-82+n*4.1,len=27+(n*17)%33,offset=(n%4-1.5)*1.05;
        for(let s=begin;s<begin+len;s+=r.spacing){
          const i=Math.floor(s/r.spacing),j=(i+1)%r.count,d=offset+.68*Math.sin(s*.031+n*.83);
          patch(b,r,i,j,d,d+.14,.023+n*.0003,.023+n*.0003,0x505350);
        }
      }
    }
    const mat=new T.MeshStandardMaterial({vertexColors:true,transparent:true,opacity:.25,roughness:.94,side:T.DoubleSide,depthWrite:false});
    const mesh=new T.Mesh(b.build(),mat);this.geometries.push(mesh.geometry,mat);this.group.add(mesh);
  }
  setRoute(route){
    if(this.guide){this.group.remove(this.guide);this.guide.geometry.dispose();this.guide.material.dispose();this.guide=null;}
    if(!route||route.roadId===0)return;
    const r=this.world.roads[route.roadId],buf=new MeshBuffer();
    for(let s=0;s<r.length;s+=32){
      const f=r.frameAt(s,{}),ground=this.world.sampleGround(f.x,f.z,{},f.y+.6);
      const ids=[[-.4,-.8],[0,1],[.4,-.8],[0,-.4]].map(([v,u])=>buf.vertex(f.x+u*f.tx+v*f.rx,ground.y+.055,f.z+u*f.tz+v*f.rz));
      buf.quad(...ids);
    }
    this.guide=new T.Mesh(buf.build(),new T.MeshBasicMaterial({color:0x96bda9,side:T.DoubleSide}));this.group.add(this.guide);
  }
  setWet(w){this.tarmac.roughness=.9-.57*w;this.tarmac.color.setScalar(1-.32*w);this.paint.roughness=.79-.28*w;}
  dispose(){this.setRoute(null);for(const r of [...this.geometries,...this.textures,this.tarmac,this.paint,this.runoff])r.dispose();}
}

