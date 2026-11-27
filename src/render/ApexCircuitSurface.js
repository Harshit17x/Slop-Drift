import * as T from 'three';
import {MeshBuffer} from './road/MeshBuffer.js';
import {createAsphaltTexture,createAsphaltReliefTexture,createGrainTexture} from './road/textures.js';
import {apexSurface,apexShoulder} from '../world/Apex.js';
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
// Clip a branch's asphalt against earlier roads. Retain a narrow seam overlap to
// cover the difference between the sampled curve and its straight mesh chords.
function junctionLane(buf, road, i, j, left, right, endLeft, endRight, height, color, roads) {
  const corner = (idx, d, s) => ({
    x:road.px[idx]+road.rx[idx]*d, y:road.py[idx]+road.bank[idx]*d+height,
    z:road.pz[idx]+road.rz[idx]*d, d, s,
  });
  let poly = [corner(i,left,i*road.spacing),corner(i,right,i*road.spacing),
    corner(j,endRight,(i+1)*road.spacing),corner(j,endLeft,(i+1)*road.spacing)];
  const loc = {};
  for (const through of roads) {
    const distances = poly.map(p => {
      if (!through.locate(p.x,p.z,loc,p.y)) return 40;
      const heightGap = Math.abs(p.y-loc.y-loc.lateral*loc.bank);
      if (heightGap > 2) return 40;
      let edge = Math.abs(loc.lateral)-loc.halfWidth;
      if (loc.beyondEnd) {
        const end = loc.index === 0 ? 0 : through.count-1;
        const longitudinal = (p.x-through.px[end])*through.tx[end]+(p.z-through.pz[end])*through.tz[end];
        edge = Math.max(edge,end===0?-longitudinal:longitudinal);
      }
      return edge+.08;
    });
    if (distances.every(d=>d<0)) return;
    if (distances.every(d=>d>=0)) continue;
    const clipped = [];
    for (let n=0;n<poly.length;n++) {
      const next=(n+1)%poly.length,a=poly[n],b=poly[next],da=distances[n],db=distances[next];
      if (da>=0) clipped.push(a);
      if ((da<0)===(db<0)) continue;
      const t=da/(da-db);
      clipped.push({x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y),z:a.z+t*(b.z-a.z),
        d:a.d+t*(b.d-a.d),s:a.s+t*(b.s-a.s)});
    }
    poly=clipped;
  }
  tint.setHex(color);
  const ids=poly.map(p=>buf.vertex(p.x,p.y,p.z,p.d/4,p.s/4,tint.r,tint.g,tint.b));
  for(let n=1;n<ids.length-1;n++)buf.indices.push(ids[0],ids[n],ids[n+1]);
}
const groove=(r,i)=>Math.max(-.5,Math.min(.5,r.curvature[i]*33))*r.halfWidth[i];
export class ApexCircuitSurface{
  constructor({world,anisotropy}){
    this.world=world;this.group=new T.Group();this.geometries=[];
    const asphalt=createAsphaltTexture(anisotropy),relief=createAsphaltReliefTexture(anisotropy),gravel=createGrainTexture(anisotropy);
    this.textures=[asphalt,relief,gravel];
    this.tarmac=new T.MeshStandardMaterial({map:asphalt,bumpMap:relief,bumpScale:.015,roughness:.9,vertexColors:true,side:T.DoubleSide});
    this.paint=new T.MeshStandardMaterial({bumpMap:relief,bumpScale:.007,roughness:.79,vertexColors:true,side:T.DoubleSide});
    this.runoff=new T.MeshStandardMaterial({map:gravel,roughness:1,vertexColors:true,side:T.DoubleSide});
    const surface=world.apex.surfaceState;
    this.rubber=new T.DataTexture(surface.data,surface.width,surface.rows,T.RedFormat);
    this.rubber.magFilter=T.LinearFilter;this.rubber.minFilter=T.LinearFilter;this.rubber.needsUpdate=true;
    this.textures.push(this.rubber);
    this.water={value:0};
    this.tarmac.onBeforeCompile=shader=>{
      shader.uniforms.courseWet=this.water;shader.uniforms.rubberField={value:this.rubber};
      shader.vertexShader='attribute vec3 course; varying vec3 vCourse;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n vCourse=course;');
      shader.fragmentShader='uniform sampler2D rubberField; uniform float courseWet; varying vec3 vCourse;\n'+shader.fragmentShader
        .replace('#include <color_fragment>',`#include <color_fragment>
          float rubber = texture2D(rubberField,vCourse.xy).r * (1.-smoothstep(0.,2.8,abs(vCourse.z)));
          float standing = courseWet * smoothstep(1.3,5.,abs(vCourse.z)) * (.65+.35*sin(vCourse.x*141.));
          diffuseColor.rgb *= (1.-rubber*.28)*(1.-standing*.21);`)
        .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\n roughnessFactor=max(.13,roughnessFactor-standing*.23);');
    };
    this.runoff.onBeforeCompile=shader=>{
      shader.vertexShader='varying vec2 apronUV;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n apronUV=uv;');
      shader.fragmentShader='varying vec2 apronUV;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        float turf=step(diffuseColor.r*1.075,diffuseColor.g);
        float blades=texture2D(map,apronUV*vec2(3.8,.63)+vec2(.27,.61)).r;
        diffuseColor.rgb*=mix(1.,.85+.38*blades+.052*sin(apronUV.y*.86+apronUV.x*.22),turf);`);
    };
    for(const r of world.physicalRoads)this.build(r);
    this.rubberTraces();
  }
  build(r){
    const other={},park=this.world.apex;
    for(let base=0;base<r.segments;base+=140){
      const asphalt=new MeshBuffer({colors:true,uvs:true}),paint=new MeshBuffer({colors:true,uvs:true}),gravel=new MeshBuffer({colors:true,uvs:true});
      for(let i=base;i<Math.min(base+140,r.segments);i++){
        const s=i*r.spacing,j=(i+1)%r.count,w=r.halfWidth[i],lift=.0005*r.id;
        if (r === park.main && Math.abs(s - park.bridge) < 45) {
          // The soffit and fascia use the same banked, graded sections as the deck.
          const edge = w + r.vergeEdge + r.config.railOffset - r.config.verge;
          patch(paint,r,i,j,-edge,edge,-1.85,-1.85,0x929591);
          for (const side of [-1,1]) {
            patch(paint,r,i,j,side*edge,side*edge,-1.85,-.14,0x929591);
            patch(paint,r,i,j,side*(w+r.vergeEdge),side*edge,-.14,-.14,0x929591);
          }
        }
        const a=groove(r,i),b=groove(r,j),type=apexSurface(r,s),slab=type!=='asphalt';
        const colors=slab?[0xaaa99e,0x97978c,0x909187,0x99998d,0xaaa99e]:[0xdbddd9,0xd4d6d2,0xcdd0cd,0xd3d6d2,0xdbddd9];
        const A=[-w,a-1.85,a-.9,a+.9,a+1.85,w],B=[-w,b-1.85,b-.9,b+.9,b+1.85,w];
        const neighbours = r.id === 0 ? [] : park.roadsAt(r.px[i],r.pz[i]).filter(o =>
          o.id < r.id && o.locate(r.px[i],r.pz[i],other,r.py[i]) &&
          other.distance < w+other.halfWidth+2*r.spacing && Math.abs(other.y-r.py[i])<4);
        for(let v=0;v<5;v++) {
          if(neighbours.length) junctionLane(slab?paint:asphalt,r,i,j,A[v],A[v+1],B[v],B[v+1],lift,colors[v],neighbours);
          else lane(slab?paint:asphalt,r,i,j,A[v],A[v+1],B[v],B[v+1],lift,lift,colors[v]);
        }
        if(slab){
          patch(paint,r,i,j,-.034,.034,lift+.009,lift+.009,0x53564f);
          if(i%3===0){
            const f=r.frameAt(s,{});paint.box(f.x,f.y+lift+.01,f.z,r.rx[i]*w,r.bank[i]*w,r.rz[i]*w,0,.006,0,r.tx[i]*.035,0,r.tz[i]*.035,.12,.12,.10);
          }
        }
        for(const side of [-1,1]){
          if ((side < 0 ? r.openLeft : r.openRight)[i]) continue;
          patch(paint,r,i,j,side*(w-.16),side*w,lift+.012,lift+.012,PAINT);
          const shoulder=apexShoulder(r,i,side),grass=0x788952;
          const stripColor=shoulder==='grass'?grass:shoulder==='paved'?0xa7a7a0:0xc8b99c;
          patch(gravel,r,i,j,side*w,side*(w+.6),lift-.022,lift-.024,0xa29d87);
          patch(gravel,r,i,j,side*(w+.6),side*(w+5),lift-.025,lift-.028,stripColor);
          patch(gravel,r,i,j,side*(w+5),side*(w+8),lift-.029,lift-.14,grass);
          if(Math.abs(r.curvature[i])>.0018 && r!==park.pit){
            const color=i%2===0?RED:WHITE;
            patch(paint,r,i,j,side*w,side*(w+.52),lift+.019,lift+.067,color);
            patch(paint,r,i,j,side*(w+.52),side*(w+1.05),lift+.067,lift+.011,color);
          }
          const extra=side<0?r.escapeLeft?.[i]??0:r.escapeRight?.[i]??0;
          const nextExtra = (side < 0 ? r.escapeLeft : r.escapeRight)?.[j] ?? 0;
          const outer = w + r.vergeEdge;
          if (extra > 0 || nextExtra > 0) {
            const ids = [];
            for (const [idx, span] of [[i,0],[i,extra],[j,nextExtra],[j,0]]) {
              const lat = side * (outer + span);
              const x = r.px[idx] + lat * r.rx[idx], z = r.pz[idx] + lat * r.rz[idx];
              const edgeY = r.py[idx] + side * outer * r.bank[idx] - r.config.vergeDrop;
              const rx = side*r.rx[idx], rz = side*r.rz[idx];
              const y = span > 0 ? park.runoffHeight(this.world.grid,x-rx*span,z-rz*span,rx,rz,edgeY,span,span) : edgeY;
              ids.push(gravel.vertex(x,y,z,x/3,z/3,.72,.65,.52));
            }
            gravel.quad(...ids);
          }
          if(side<0?r.railLeft[i]:r.railRight[i]){
            const rail = w + r.config.shoulder + r.config.railOffset;
            const d = side * (rail + extra), end = side * (rail + nextExtra);
            const bases = side < 0 ? r.railBaseLeft : r.railBaseRight;
            const startH = bases[i] - r.py[i] - d*r.bank[i], endH = bases[j] - r.py[j] - end*r.bank[j];
            tint.setHex(0xa7acaa);
            for (const h of [.39,.79]) {
              const a=vertex(paint,r,i,d,startH+h,s), b=vertex(paint,r,i,d,startH+h+.22,s);
              const c=vertex(paint,r,j,end,endH+h+.22,s+r.spacing), e=vertex(paint,r,j,end,endH+h,s+r.spacing);
              paint.quad(a,b,c,e);
            }
            if(i%2===0)paint.box(r.px[i]+d*r.rx[i],bases[i]+.47,r.pz[i]+d*r.rz[i],.084,0,0,0,.54,0,0,0,.084,.22,.24,.23);
          }
        }
      }
      for(const [buf,mat] of [[asphalt,this.tarmac],[paint,this.paint],[gravel,this.runoff]]){
        if(!buf.triangleCount)continue;const g=buf.build(),m=new T.Mesh(g,mat);if(mat===this.tarmac){
          const uv=g.attributes.uv,course=new Float32Array(uv.count*3);
          for(let n=0;n<uv.count;n++){
            const s=uv.getY(n)*4,i=Math.min(r.count-1,Math.max(0,Math.round(s/r.spacing)));
            course[n*3]=s/r.length;course[n*3+1]=(r.id+.5)/this.world.physicalRoads.length;
            course[n*3+2]=uv.getX(n)*4-groove(r,i);
          }
          g.setAttribute('course',new T.BufferAttribute(course,3));
        }
        m.receiveShadow=true;this.geometries.push(g);this.group.add(m);
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
  setWet(w){this.water.value=w;const field=this.world.apex.surfaceState;if(field.dirty){this.rubber.needsUpdate=true;field.dirty=false;}this.tarmac.roughness=.9-.57*w;this.tarmac.color.setScalar(1-.32*w);this.paint.roughness=.79-.28*w;}
  dispose(){this.setRoute(null);for(const r of [...this.geometries,...this.textures,this.tarmac,this.paint,this.runoff])r.dispose();}
}

