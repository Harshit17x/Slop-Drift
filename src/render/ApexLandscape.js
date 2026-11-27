import * as T from 'three';
import {createRandom} from '../world/noise.js';

function fernGeometry() {
  const vertices=[],colors=[];
  const triangle=(a,b,c,shade)=>{
    vertices.push(...a,...b,...c);
    for(const gain of [.82,.92,1.1])colors.push(.16*shade*gain,.28*shade*gain,.074*shade*gain);
  };
  for(let frond=0;frond<7;frond++){
    const angle=frond*2.4,dx=Math.cos(angle),dz=Math.sin(angle);
    const point=(u,v)=>[dx*u-dz*v,.12+.8*u-.65*u*u,dz*u+dx*v];
    for(let i=1;i<8;i++){
      const u=i*.09,spread=.14*Math.sin(u*3.85);
      for(const sign of [-1,1])triangle(point(u,0),point(u+.085,sign*spread),point(u+.052,0),.78+u*.4);
    }
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();return geometry;
}
function stoneGeometry(){
  const geometry=new T.IcosahedronGeometry(1,1),p=geometry.attributes.position;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const fracture=1+.14*Math.sin(x*9+y*5)*Math.cos(z*6);
    p.setXYZ(i,x*fracture,Math.sign(y)*Math.abs(y)**.76*(.87+.13*Math.cos(x*8)),z*fracture);
  }
  geometry.computeVertexNormals();return geometry;
}
export class ApexLandscape{
  constructor(world,parent,texture){
    const rnd=createRandom(81924),matrix=new T.Object3D(),road=world.apex.main,loc={},sectors=new Map();
    this.group=new T.Group();this.batches=[];parent.add(this.group);
    this.geometry={stone:stoneGeometry(),fern:fernGeometry(),reed:new T.ConeGeometry(.045,1,3)};
    this.material={
      stone:new T.MeshStandardMaterial({color:0xb4afa4,map:texture,bumpMap:texture,bumpScale:.07,roughness:.91}),
      fern:new T.MeshStandardMaterial({vertexColors:true,side:T.DoubleSide,roughness:1}),
      reed:new T.MeshStandardMaterial({color:0x78804b,roughness:.93})
    };
    const place=(kind,x,y,z,sx,sy,sz,yaw,tilt=0)=>{
      matrix.position.set(x,y,z);matrix.scale.set(sx,sy,sz);matrix.rotation.set(0,yaw,tilt,'YXZ');matrix.updateMatrix();
      const key=kind+'/'+Math.floor(x/260)+'/'+Math.floor(z/260);
      if(!sectors.has(key))sectors.set(key,{kind,items:[]});sectors.get(key).items.push(matrix.matrix.clone());
    };
    const clear=(x,z,radius)=>!world.isReserved(x,z,radius) && !world.physicalRoads.some(r=>
      r.locate(x,z,loc) && !loc.beyondEnd && loc.distance < loc.halfWidth+12+radius+(loc.lateral<0?r.escapeLeft?.[loc.index]??0:r.escapeRight?.[loc.index]??0));
    for(const section of world.apex.sections.slice(0,6)){
      for(let s=section.start-30;s<section.end;s+=16+rnd()*36){
        const f=road.frameAt(s,{}),side=rnd()>.48?1:-1,d=side*(17+rnd()*24);
        for(let k=0;k<11;k++){
          const local=d+side*rnd()*11,x=f.x+f.rx*local+(rnd()-.5)*13,z=f.z+f.rz*local+(rnd()-.5)*13;
          if(!clear(x,z,2))continue;
          const y=world.grid.heightAt(x,z);
          if(section.name==='Skyline Ridge'||section.name==='The Vortex'||f.y>108 && k%3===0){
            const size=.6+rnd()*2.8;place('stone',x,y-.23*size,z,size*(1+rnd()),size*(.55+rnd()*.45),size,rnd()*2,.25*(rnd()-.5));
          }else{
            const size=.7+rnd()*1.5;place('fern',x,y-.06,z,size,size,size,rnd()*6);
          }
        }
      }
    }
    // Cluster reeds along the shallow shore using the actual water contour.
    for(let n=0;n<3800;n++){
      const x=500+rnd()*650,z=-670+rnd()*490,y=world.grid.heightAt(x,z);
      if(y<world.waterLevel-.8||y>world.waterLevel+.9||!clear(x,z,1))continue;
      for(let j=0;j<8;j++){const h=1+rnd()*1.3;place('reed',x+rnd()*1.7,y+h*.45,z+rnd()*1.7,1,h,1,rnd()*6,(rnd()-.5)*.37);}
    }
    for(const {kind,items} of sectors.values()){
      const mesh=new T.InstancedMesh(this.geometry[kind],this.material[kind],items.length);
      items.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.computeBoundingSphere();mesh.receiveShadow=true;
      mesh.userData.range=kind==='stone'?530:125;mesh.userData.capacity=items.length;
      this.group.add(mesh);this.batches.push(mesh);
    }
  }
  update(position,scale){
    for(const mesh of this.batches){
      const radius=mesh.userData.range*scale+mesh.boundingSphere.radius;
      mesh.visible=mesh.boundingSphere.center.distanceToSquared(position)<radius*radius;
    }
  }
  dispose(){for(const mesh of this.batches)mesh.dispose();for(const r of [...Object.values(this.geometry),...Object.values(this.material)])r.dispose();}
}
