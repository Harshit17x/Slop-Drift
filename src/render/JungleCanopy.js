import * as THREE from 'three';
import { createRandom } from '../world/noise.js';

import { RIDGE, TAPIR_BEND } from '../world/jungleStage.js';
import { TapirFamily } from './TapirFamily.js';
import { butterflyFlight } from './jungleWildlife.js';
import { plantGeometry, barkTexture, shaftMaterial } from './junglePlants.js';

const UP = new THREE.Vector3(0,1,0);
const foliageUrl = new URL('../assets/maps/jungle-foliage.webp', import.meta.url).href;

export class JungleCanopy {
  constructor({world, quality}) {
    this.group = new THREE.Group();
    this.sectors = [];
    this.clock = 0;
    this.wind = {value:0};
    this.material = new THREE.MeshStandardMaterial({roughness:0.87});
    const atlas = new THREE.TextureLoader().load(foliageUrl);
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = 4;
    this.foliage = new THREE.MeshStandardMaterial({map:atlas,alphaTest:0.36,side:THREE.DoubleSide,roughness:0.84});
    this.foliage.onBeforeCompile = shader => {
      shader.uniforms.uBreeze = this.wind;
      shader.vertexShader = 'uniform float uBreeze;\n' + shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed.x += 0.025 * position.y * sin(uBreeze * 1.3 + instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.17);');
    };
    this.bark = new THREE.MeshStandardMaterial({map:barkTexture(),roughness:0.94});
    this.beams = shaftMaterial();
    this.shapes = {
      trunk: new THREE.CylinderGeometry(0.62,1,1,8),
      crown: plantGeometry(0,0,0.6,true),
      fern: plantGeometry(1,0,0.26),
      banana: plantGeometry(0,1,0.24),
      vine: plantGeometry(1,1,0.15),
      stone: new THREE.IcosahedronGeometry(1,0),
      beam: new THREE.PlaneGeometry(1,1),
    };
    this.birdGeometry = this.shapes.stone;
    const road = world.roads[0], random = createRandom(world.config.seed);
    const dummy=new THREE.Object3D(), delta=new THREE.Vector3(), obstacles=[], loc={};
    const probe=(f,d)=> {
      const x=f.x+f.rx*d, z=f.z+f.rz*d;
      return new THREE.Vector3(x,world.grid.heightAt(x,z),z);
    };
    for (let first=0; first<road.length; first+=80) {
      const group=new THREE.Group(), centre=road.frameAt(first+40,{});
      const batches=Object.fromEntries(Object.keys(this.shapes).map(key=>[key,[]]));
      const submit=(shape,color)=>{
        dummy.updateMatrix();
        batches[shape].push([dummy.matrix.clone(),color]);
      };
      const place=(shape,x,y,z,sx,sy,sz,yaw,roll,color)=>{
        dummy.position.set(x,y,z);
        dummy.scale.set(sx,sy,sz);
        dummy.rotation.set(0,yaw,roll,'YXZ');
        submit(shape,color);
      };
      const limb=(a,b,r,color)=>{
        delta.subVectors(b,a);
        dummy.position.copy(a).lerp(b,0.5);
        dummy.scale.set(r,delta.length(),r);
        dummy.quaternion.setFromUnitVectors(UP,delta.normalize());
        submit('trunk',color);
      };
      // Continuous banks of growth; a near row has inward-reaching limbs,
      // while staggered rear trees fill the gaps visible around the apex.
      for(let i=0;i<68;i++){
        const near=i<24, side=i%2 ? -1:1;
        const s=first+(near ? (Math.floor(i/2)+random())*80/12 : random()*80);
        const f=road.frameAt(s,{}), d=side*(f.halfWidth+(near ? 1.6+random()*3.3 : 7+random()**1.2*36));
        if (side>0 && Math.abs(s-RIDGE)<50 && !near) continue;
        if (side>0 && Math.abs(s-TAPIR_BEND)<11 && d<15) continue;
        const base=probe(f,d);
        const creek=Math.abs(s-world.bridge.centreS)<23;
        if(base.y<world.waterLevel && (!creek || Math.abs(d)<6)) continue;
        if(road.locate(base.x,base.z,loc)&&loc.distance<loc.halfWidth+1.15) continue;
        const tall=Math.max(0,f.y-base.y)+11+random()*11, r=0.22+random()**2*0.62;
        const inward=near ? 0.9+random()*1.5 : random();
        const fork=base.clone().add(new THREE.Vector3(-f.rx*side*inward,tall*0.55,-f.rz*side*inward));
        const bark=i%4===0?0xc1c1a0:0x928b76;
        const buried=base.clone();
        buried.y-=1.4;
        limb(buried,fork,r,bark);
        obstacles.push(base.x,base.z,r);
        if(near){
          for(let k=0;k<3;k++){
            const angle=random()*6.28;
            const root=base.clone().add(new THREE.Vector3(Math.cos(angle)*r*2.4,0,Math.sin(angle)*r*2.4));
            root.y=world.grid.heightAt(root.x,root.z)-1.25;
            limb(root,base.clone().add(new THREE.Vector3(0,r*2.8,0)),r*0.55,bark);
          }
        }
        const clearing=0.5+0.5*Math.sin(s/92+0.8*Math.sin(s/33));
        for(let k=0;k<2;k++){
          const reach=k===0 && near ? Math.abs(d)*(0.68+0.44*clearing) : 1.1+random()*3;
          const drift=(random()-0.5)*4;
          const top=fork.clone().add(new THREE.Vector3(-f.rx*side*reach+f.tx*drift,tall*(0.22+0.16*random()),-f.rz*side*reach+f.tz*drift));
          limb(fork,top,r*(k?0.49:0.64),bark);
          // Finish large limbs in a leafy spray at the wood tip.
          if (near) place('crown',top.x,top.y-1.6,top.z,2.2,3.1,2.2,s*0.17+k,0.2,0x9aad83);
          const scale=4.2+random()*2.6;
          place('crown',top.x,top.y-1.9,top.z,scale,scale*0.92,scale,random()*6.28,0.12*side,i%3?0xb8c998:0x8cae88);
          if(near && (i+k)%4===0){
            const len=Math.min(5.5,Math.max(1.7,top.y-f.y-5.4));
            place('vine',top.x,top.y-len,top.z,1.5,len,1.5,random()*6.28,0,0x93af76);
          }
        }
      }
      for(let i=0;i<150;i++){
        const s=first+random()*80, f=road.frameAt(s,{}), side=i%2?-1:1;
        if (side>0 && Math.abs(s-TAPIR_BEND)<9) continue;
        const d=side*(f.halfWidth+0.8+random()**1.35*14);
        const p=probe(f,d);
        if(p.y<world.waterLevel+0.3 || (road.locate(p.x,p.z,loc)&&loc.distance<loc.halfWidth+0.7))continue;
        const sz=Math.min(0.8+random()**1.4*2.8,Math.abs(d)-f.halfWidth+0.35);
        const kind=i%4===0?'banana':'fern';
        place(kind,p.x,p.y-0.16,p.z,sz,sz*(kind==='banana'?1.8:1.03),sz,random()*6.28,0,
          i%3?0xb7c394:0x8ba57b);
        if(i%5===0)place('stone',p.x,p.y+0.06,p.z,sz*0.64,sz*0.44,sz*0.85,random()*6,0.2,0x556043);
      }
      // A shaded middle storey blocks the horizon between the tall trunks.
      // Along the creek it becomes a low mangrove fringe on the waterline.
      for(let j=0; j<54; j++){
        const f=road.frameAt(first+(j+random())*80/54,{});
        const side=j%2?1:-1, p=probe(f,side*(9+random()*18));
        const height=4+random()*5;
        const y=Math.max(p.y,world.waterLevel-0.6);
        place('crown',p.x,y-0.7,p.z,height*0.69,height*0.98,height*0.72,random()*6.28,side*0.09,
          j%3?0x788a67:0x8ba372);
        if(j%3===0)place('vine',p.x,y+height*0.45,p.z,1.6,height*0.47,1.6,random()*6,0,0x89965d);
      }
      // Bamboo stands alternate with hardwood cuttings and fern gullies.
      if(Math.sin(first/361)>0.45) {
        for(let clump=0;clump<10;clump++){
          const f=road.frameAt(first+random()*80,{}), side=clump%2?1:-1;
          const p=probe(f,side*(f.halfWidth+2.4+random()*3.5));
          if(p.y<world.waterLevel)continue;
          for(let culm=0;culm<6;culm++){
            const angle=random()*6.28, h=6+random()*6;
            const foot=p.clone().add(new THREE.Vector3(Math.cos(angle)*0.45,0,Math.sin(angle)*0.45));
            const top=foot.clone().add(new THREE.Vector3(Math.cos(angle)*1.6,h,Math.sin(angle)*1.6));
            limb(foot,top,0.085,culm%2?0x8ba642:0xa3aa64);
            for(let j=1;j<=4;j++){
              const joint=foot.clone().lerp(top,j/5);
              place('trunk',joint.x,joint.y,joint.z,0.094,0.068,0.094,0,0,0x514938);
            }
            place('crown',top.x,top.y-0.9,top.z,1.1,2.7,1.5,angle,0.2,0x9da977);
          }
          obstacles.push(p.x,p.z,0.4);
        }
      }
      if(first%240===0){
        const f=road.frameAt(first+42,{});
        for(let k=0;k<4;k++)place('beam',f.x+f.rx*(1.4+k*0.8),f.y+6,f.z+f.rz*k,0.8+k*0.26,13,1,Math.atan2(f.rx,f.rz),0.36,0xfff4ce);
      }
      for(const [shape,entries] of Object.entries(batches)){
        if(!entries.length) continue;
        const mat=shape==='trunk'?this.bark:shape==='stone'?this.material:shape==='beam'?this.beams:this.foliage;
        const mesh=new THREE.InstancedMesh(this.shapes[shape],mat,entries.length);
        entries.forEach(([matrix,color],i)=>{mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,new THREE.Color(color));});
        mesh.computeBoundingSphere();
        mesh.receiveShadow=shape!=='beam';
        group.add(mesh);
      }
      this.group.add(group);
      this.sectors.push({group,centre});
    }
    world.setObstacles(obstacles);
    this.butterflies = butterflyFlight(road, world, random, this.wind);
    this.group.add(this.butterflies);
    // Hornbills circle the creek; animate just the wing pivots.
    this.flock = new THREE.Group();
    this.wings = [];
    this.flock.position.set(world.bridge.centre.x, world.bridge.centre.y+12, world.bridge.centre.z);
    for (let i=0; i<5; i++) {
      const bird = new THREE.Group();
      bird.position.set(i*2,Math.sin(i)*1.3,i%3*2);
      const part = (x,y,z,sx,sy,sz,color) => {
        const mesh = new THREE.Mesh(this.birdGeometry, this.material.clone());
        mesh.material.color.setHex(color);
        mesh.position.set(x,y,z);
        mesh.scale.set(sx,sy,sz);
        bird.add(mesh);
        return mesh;
      };
      part(0,0,0,0.18,0.18,0.53,0x252e26);
      part(0,0.12,0.48,0.10,0.09,0.24,0xedaa48);
      for (const side of [-1,1]) {
        const wing = part(side*0.42,0,0,0.57,0.055,0.22,0x343a32);
        this.wings.push({ wing, side, i });
      }
      this.flock.add(bird);
    }
    this.group.add(this.flock);
    this.tapirs = new TapirFamily(world);
    this.group.add(this.tapirs.group);
    this.bridge = world.bridge;
    this.setQuality(quality);
  }

  setQuality(quality) { this.range = 170 + 95 * (quality?.terrainLod ?? 1); }

  update(camera, dt = 0, night = false, car = camera) {
    this.tapirs.update(dt,camera,car);
    this.beams.visible = !night;
    this.butterflies.visible = !night;
    this.wind.value = this.clock;
    for (const { group, centre } of this.sectors) {
      group.visible = (camera.x-centre.x)**2 + (camera.z-centre.z)**2 < this.range**2;
    }
    this.clock += dt;
    const t = this.clock * 0.24;
    this.flock.position.x = this.bridge.centre.x + 17*Math.cos(t);
    this.flock.position.z = this.bridge.centre.z + 17*Math.sin(t);
    this.flock.rotation.y = -t;
    for (const {wing,side,i} of this.wings) wing.rotation.z = side*Math.sin(8*this.clock+i)*0.48;
  }

  dispose() {
    this.tapirs.mesh.geometry.dispose();
    this.butterflies.geometry.dispose();
    this.group.traverse(obj => {
      if (obj.isInstancedMesh) obj.dispose();
      if (obj.material && obj.material !== this.material && ![this.foliage,this.bark,this.beams].includes(obj.material)) obj.material.dispose();
    });
    Object.values(this.shapes).forEach(g => g.dispose());
    for (const material of [this.foliage,this.bark,this.beams]) {
      material.map.dispose();
      material.dispose();
    }
    this.material.dispose();
  }
}
