import * as THREE from 'three';
import { TAPIR_BEND } from '../world/jungleStage.js';

// Both animals use one low-poly instanced mesh. Their path follows the
// ground out into the ferns, always on the outside of the racing corridor.
export class TapirFamily {
  constructor(world) {
    this.world=world;
    this.frame=world.roads[0].frameAt(TAPIR_BEND,{});
    this.group=new THREE.Group();
    this.animals=[];
    this.parts=[];
    const dark=0x373330, muzzle=0x54463a, saddle=0xb5ac93;
    for(let i=0;i<2;i++){
      const root=new THREE.Object3D(), calf=i===1;
      const legs=[];
      root.scale.setScalar(calf?0.62:1.14);
      const part=(parent,x,y,z,sx,sy,sz,color,tilt=0)=>{
        const node=new THREE.Object3D();
        node.position.set(x,y,z); node.scale.set(sx,sy,sz); node.rotation.x=tilt;
        parent.add(node); this.parts.push({node,color});
      };
      const coat=calf?0x6c4730:dark;
      part(root,0,0.70,-0.05,0.44,0.52,0.86,coat);
      part(root,0,0.77,-0.28,0.46,0.48,0.54,calf?coat:saddle);
      part(root,0,0.90,0.47,0.34,0.43,0.49,coat,-0.30);
      part(root,0,0.86,0.83,0.24,0.29,0.37,coat,0.23);
      part(root,0,0.68,1.09,0.15,0.19,0.22,muzzle,-0.47);
      for(const side of [-1,1]){
        part(root,side*0.18,1.12,0.67,0.079,0.13,0.068,0xd6cbb4);
        part(root,side*0.184,1.105,0.70,0.072,0.11,0.054,dark);
        part(root,side*0.203,0.92,0.95,0.033,0.032,0.031,0x141311);
        for(const fore of [-1,1]){
          const pivot=new THREE.Object3D();
          pivot.position.set(side*0.265,0.47,fore*0.49);
          root.add(pivot);
          part(pivot,0,-0.16,0,0.115,0.24,0.115,coat);
          part(pivot,0,-0.37,0.03,0.099,0.095,0.13,0x39342e);
          legs.push({pivot,phase:side*fore>0?0:Math.PI});
        }
        if(calf) for(let j=0;j<8;j++) {
          const z=(j%4-1.5)*0.24;
          part(root,side*(0.41-0.09*Math.abs(z)),0.68+0.15*Math.floor(j/4),z,
            0.038,0.033,0.086,0xc8b88d);
        }
      }
      this.animals.push({root,legs,calf});
    }
    this.mesh=new THREE.InstancedMesh(new THREE.SphereGeometry(1,12,8),
      new THREE.MeshStandardMaterial({roughness:0.96}),this.parts.length);
    this.parts.forEach(({color},i)=>this.mesh.setColorAt(i,new THREE.Color(color)));
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled=false;
    this.group.add(this.mesh);
    this.time=0;
    this.flight=-1;
  }

  update(dt,camera,car) {
    const f=this.frame, distance=Math.hypot(camera.x-f.x,camera.z-f.z);
    this.group.visible=distance<135;
    if(!this.group.visible){this.flight=-1;return;}
    this.time+=dt;
    if(this.flight<0 && Math.hypot(car.x-f.x,car.z-f.z)<42) this.flight=0;
    if(this.flight>=0) this.flight+=dt;
    for(const {root,legs,calf} of this.animals){
      const t=Math.max(0,this.flight-(calf?0.40:0));
      const flee=1-Math.exp(-t*0.68);
      const along=(calf?-2.1:0)+5*flee;
      const side=f.halfWidth+(calf?3.25:1.55)+9*flee;
      const x=f.x+f.rx*side+f.tx*along, z=f.z+f.rz*side+f.tz*along;
      const stride=12*t+(calf?1.5:0);
      const gait=Math.sin(flee*Math.PI);
      root.position.set(x,this.world.grid.heightAt(x,z)+0.035+gait*Math.abs(Math.sin(stride))*0.09,z);
      root.rotation.y=Math.atan2(f.rx,f.rz)-1.16+flee*1.04;
      root.rotation.x=0.025*Math.sin(this.time*1.56+(calf?1:0));
      for(const {pivot,phase} of legs)pivot.rotation.x=gait*0.75*Math.sin(stride+phase);
      root.updateMatrixWorld(true);
    }
    this.parts.forEach(({node},i)=>this.mesh.setMatrixAt(i,node.matrixWorld));
    this.mesh.instanceMatrix.needsUpdate=true;
  }
}
