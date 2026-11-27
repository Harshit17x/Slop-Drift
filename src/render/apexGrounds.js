import {Mesh,MeshStandardMaterial,DoubleSide} from 'three';
import {MeshBuffer} from './road/MeshBuffer.js';

// A ribbon follows the underlying terrain even on the raised agricultural benches.
export function outerGrounds(world,kit,local,random){
  const buf=new MeshBuffer({colors:true,uvs:true}),grid=world.grid;
  function strip(x,z,length,width,angle,color){
    const dx=Math.cos(angle),dz=Math.sin(angle),steps=Math.ceil(length/6);
    let prev;
    for(let i=0;i<=steps;i++){
      const along=length*i/steps,ids=[];
      for(const side of [-.5,.5]){
        const X=x+dx*along-dz*side*width,Z=z+dz*along+dx*side*width;
        ids.push(buf.vertex(X,grid.heightAt(X,Z)+.10,Z,X*.15,Z*.15,...color));
      }
      if(prev)buf.quad(prev[0],ids[0],ids[1],prev[1]);
      prev=ids;
    }
  }
  for(let field=0;field<6;field++){
    const x=440+(field%3)*127,z=730+Math.floor(field/3)*156,angle=-.17+.05*Math.floor(field/3);
    for(let row=0;row<26;row++){
      const v=row*3.9,shade=.88+random()*.16;
      strip(x-Math.sin(angle)*v,z+Math.cos(angle)*v,103,3.85,angle,
        field%3===1?[.24*shade,.201*shade,.104*shade]:[.095*shade,.144*shade,.068*shade]);
    }
  }
  strip(412,713,474,4.2,-.16,[.22,.20,.17]);
  for(let i=0;i<5;i++){
    const x=425+i*81,z=688-i*12,y=grid.heightAt(x,z),length=i%2?12:18;
    kit.instance('stone','box',x,y+2.1,z,length,4.4,7.4,.15,0xb8b2a4);
    kit.instance('stone','roof',x,y+5.35,z,length+.9,2.2,8,.15,0x755d4c);
    for(let j=-1;j<=1;j++)kit.instance('glass','box',x+j*4,y+2.3,z-3.7,1.32,1.34,.15,.15,0x38474a);
  }
  const m=world.apex.main;
  for(const [index,side] of [[3,-1],[8,1],[24,1],[38,-1],[42,1]]){
    const station=world.apex.stations[index];
    for(let n=0;n<16;n++){
      const f=m.frameAt(station+n*1.02,{}),i=f.index,extra=(side<0?m.escapeLeft[i]:m.escapeRight[i])||0;
      const d=side*(f.halfWidth+9+extra+1.15),x=f.x+f.rx*d,z=f.z+f.rz*d;
      const hit={};if(world.physicalRoads.some(r=>r!==m && r.locate(x,z,hit,f.y) && !hit.beyondEnd && hit.distance<hit.halfWidth+9 && Math.abs(hit.y-f.y)<4))continue;
      const y=grid.heightAt(x,z);
      for(let j=0;j<3;j++)kit.instance('stone','tube',x,y+.17+j*.33,z,1,.32,1,0,n%8<4?0x3b4140:0x93958c);
    }
  }
  // Lakeside timber platform is sited outside the road corridor on the contour.
  let lakeSide;
  for(let z=-650;z<-360;z+=3){
    const y=grid.heightAt(850,z);if(y>world.waterLevel+1&&y<world.waterLevel+3){lakeSide={x:850,y,z};break;}
  }
  if(lakeSide){
    const f={...lakeSide,tx:1,tz:0},a=local(kit,f);
    for(let i=0;i<25;i++)a.block(-5+i*.42,0,.35,.4,5,.17,0x897b65);
    for(const u of [-5,-2.5,0,2.5,5])a.block(u,2.4,.92,.14,.14,1.35,0x675a47);
    a.block(0,2.4,1.52,10.4,.12,.14,0x766850);
    a.sign('LAKESIDE WALK',0,-2.3,1.24,3.4,.61,'left','green');
    world.apex.lakeDeck=lakeSide;
  }
  const mesh=new Mesh(buf.build(),new MeshStandardMaterial({vertexColors:true,roughness:1,side:DoubleSide}));
  mesh.receiveShadow=true;return mesh;
}
