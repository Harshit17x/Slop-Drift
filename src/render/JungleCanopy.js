import * as THREE from 'three';
import { createRandom } from '../world/noise.js';

import { RIDGE, TAPIR_BEND, STAGE, CLEARINGS, inClearing } from '../world/jungleStage.js';
import { TapirFamily } from './TapirFamily.js';
import { butterflyFlight, dragonflySwarms } from './jungleWildlife.js';
import {
  plantGeometry, barkTexture, shaftMaterial, buttressGeometry, palmCrownGeometry,
  flowerGeometry, leafLitterGeometry,
} from './junglePlants.js';
import { JungleSetPieces } from './jungleSetPieces.js';
import { JungleAnimals } from './jungleAnimals.js';
import { JungleWeather } from './jungleWeather.js';

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
    this.garden = new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.84,side:THREE.DoubleSide});
    this.litter = new THREE.MeshStandardMaterial({color:0x6d5f44,roughness:0.97,side:THREE.DoubleSide});
    this.beams = shaftMaterial();
    this.shapes = {
      trunk: new THREE.CylinderGeometry(0.62,1,1,8),
      buttress: buttressGeometry(),
      crown: plantGeometry(0,0,0.6,true),
      fern: plantGeometry(1,0,0.26),
      banana: plantGeometry(0,1,0.24),
      vine: plantGeometry(1,1,0.15),
      palm: palmCrownGeometry(),
      flower: flowerGeometry(),
      litter: leafLitterGeometry(),
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
    const gladeDetails = new Map([
      [STAGE.timberCamp, { lateral: 12.4, pad: 7.4 }],
      [STAGE.shrine, { lateral: 9.2, pad: 5.2 }],
      [STAGE.watchtower, { lateral: 10.5, pad: 5.4 }],
      [STAGE.elephants, { lateral: 15, pad: 15.0 }],
      [STAGE.deerGlade, { lateral: 9.5, pad: 6.0 }],
    ]);
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
        // Keep a wide sightline through each clearing, but leave the far forest
        // standing as a green backdrop instead of felling the whole hillside.
        if (inClearing(s, side) && Math.abs(d) < f.halfWidth + 24) continue;
        const base=probe(f,d);
        const creek=Math.abs(s-world.bridge.centreS)<23;
        if(base.y<world.waterLevel && (!creek || Math.abs(d)<6)) continue;
        if(road.locate(base.x,base.z,loc)&&loc.distance<loc.halfWidth+1.15) continue;
        const tall=Math.max(0,f.y-base.y)+11+random()*11, r=0.22+random()**2*0.62;
        // Keep the boles close to vertical; a big inward lean reads as a tent.
        const inward=near ? 0.25+random()*0.75 : random()*0.6;
        const fork=base.clone().add(new THREE.Vector3(-f.rx*side*inward,tall*0.55,-f.rz*side*inward));
        const bark=i%3===0 ? 0x7d8464 : i%3===1 ? 0x6d6a54 : 0x8a7c63;
        const buried=base.clone();
        buried.y-=1.4;
        limb(buried,fork,r,bark);
        obstacles.push(base.x,base.z,r);
        if(near){
          // Flared buttress roots anchor the big trees to the bank.
          place('buttress',base.x,base.y-0.35,base.z,r*2.2,1.6+r*2.2,r*2.2,random()*6.28,0,0x7d8068);
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
        // Keep a wide sightline through each clearing. A 7 m core left a wall of
        // bananas hiding every landmark; the full clearing plus a margin frames
        // the set piece from the approach without a leaf wall in the foreground.
        if (inClearing(s, side, 42)) continue;
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
        const s=first+(j+random())*80/54;
        const f=road.frameAt(s,{});
        const side=j%2?1:-1;
        const d=side*(9+random()*18);
        // In a clearing the middle storey retreats beyond the sightline.
        if (inClearing(s,side) && Math.abs(d)<24) continue;
        const p=probe(f,d);
        const height=4+random()*5;
        const y=Math.max(p.y,world.waterLevel-0.6);
        place('crown',p.x,y-0.7,p.z,height*0.69,height*0.98,height*0.72,random()*6.28,side*0.09,
          j%3?0x788a67:0x8ba372);
        if(j%3===0)place('vine',p.x,y+height*0.45,p.z,1.6,height*0.47,1.6,random()*6,0,0x89965d);
      }
      // Bamboo stands alternate with hardwood cuttings and fern gullies.
      if(Math.sin(first/361)>0.45) {
        for(let clump=0;clump<10;clump++){
          const sBamboo=first+random()*80;
          const f=road.frameAt(sBamboo,{}), side=clump%2?1:-1;
          if (inClearing(sBamboo,side)) continue;
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
      // Palm groves and broad-leaf ginger crowd the light gaps.
      for(let i=0;i<7;i++){
        const s=first+random()*80, f=road.frameAt(s,{}), side=i%2?-1:1;
        if (inClearing(s,side)) continue;
        const d=side*(f.halfWidth+2.6+random()*8);
        const p=probe(f,d);
        if(p.y<world.waterLevel+0.6 || p.y<f.y-7) continue;
        const h=6.5+random()*7;
        limb(p.clone().setY(p.y-0.7), p.clone().setY(p.y+h), 0.14+random()*0.07, 0x8e8567);
        place('palm',p.x,p.y+h-0.15,p.z,0.95+random()*0.35,0.95+random()*0.35,0.95+random()*0.35,random()*6.28,0.1,0xb6c68c);
        obstacles.push(p.x,p.z,0.3);
      }
      for(let i=0;i<10;i++){
        const s=first+random()*80, f=road.frameAt(s,{}), side=i%2?-1:1;
        if (inClearing(s,side)) continue;
        const d=side*(f.halfWidth+0.45+random()*2.5);
        const p=probe(f,d);
        if(p.y<world.waterLevel+0.2) continue;
        const sz=0.5+random()*0.55;
        place('flower',p.x,p.y-0.12,p.z,sz,sz*(0.9+random()*0.5),sz,random()*6.28,0,0xffffff);
      }
      // Clearings read as glades, not bare fields: low ferns, flowers and stones
      // fill the understorey while staying under the landmark sightline.
      for (const clearing of CLEARINGS) {
        const detail = gladeDetails.get(clearing.s);
        if (!detail) continue;
        const anchorFrame = road.frameAt(clearing.s, {});
        const anchorX = anchorFrame.x + anchorFrame.rx * clearing.side * detail.lateral;
        const anchorZ = anchorFrame.z + anchorFrame.rz * clearing.side * detail.lateral;
        for (let i = 0; i < 160; i++) {
          const s = clearing.s + (random() * 2 - 1) * clearing.radius * 0.92;
          if (s < first || s >= first + 80) continue;
          const f = road.frameAt(s, {});
          const lateral = f.halfWidth + 1.2 + random() ** 1.4 * 26;
          const p = probe(f, clearing.side * lateral);
          if (p.y < world.waterLevel + 0.2) continue;
          if (road.locate(p.x, p.z, loc) && loc.distance < loc.halfWidth + 0.6) continue;
          if (Math.hypot(p.x - anchorX, p.z - anchorZ) < detail.pad + 0.5) continue;
          // Keep a viewing window from the road to the landmark; the far side
          // of the glade keeps its ferns.
          if (Math.abs(s - clearing.s) < 10.5 && lateral < detail.lateral - 0.5) continue;
          const sz = lateral > 18 ? 0.65 + random() * 1.35 : 0.26 + random() * 0.42;
          if (i % 7) {
            place('fern', p.x, p.y - 0.1, p.z, sz, sz * (0.95 + random() * 0.35), sz, random() * 6.28, 0,
              i % 3 ? 0x9caf7c : 0x7e9a6f);
          } else {
            place('flower', p.x, p.y - 0.08, p.z, sz, sz, sz, random() * 6.28, 0, 0xffffff);
          }
          if (i % 11 === 0) place('stone', p.x, p.y + 0.04, p.z, sz * 0.8, sz * 0.42, sz, random() * 6, 0.2, 0x59634a);
        }
      }
      // A green backdrop grove behind every landmark. Clearings used to end in
      // white fog, which silhouetted the set pieces; a belt of tall trees and
      // understorey palms behind each pad frames them instead.
      for (const clearing of CLEARINGS) {
        const detail = gladeDetails.get(clearing.s);
        if (!detail) continue;
        for (let i = 0; i < 34; i++) {
          const s = clearing.s + (random() * 2 - 1) * clearing.radius * 0.82;
          if (s < first || s >= first + 80) continue;
          const f = road.frameAt(s, {});
          // The elephant lick sits on a crest, so its grove starts closer in
          // than the others or the herd is silhouetted against open fog.
          const back = clearing.s === STAGE.elephants ? 4 : detail.pad * 0.62;
          const lateral = detail.lateral + back + random() * 12;
          const p = probe(f, clearing.side * lateral);
          if (p.y < world.waterLevel + 0.3) continue;
          if (road.locate(p.x, p.z, loc) && loc.distance < loc.halfWidth + 1.2) continue;
          const tall = 12 + random() * 9;
          const r = 0.24 + random() * 0.3;
          const top = new THREE.Vector3(p.x, p.y + tall, p.z);
          const buried = new THREE.Vector3(p.x, p.y - 1.1, p.z);
          limb(buried, top, r, i % 3 === 0 ? 0x7d8464 : 0x6d6a54);
          obstacles.push(p.x, p.z, r);
          const crownScale = 3.4 + random() * 2.2;
          place('crown', top.x, top.y - 1.2, top.z, crownScale, crownScale * 0.9, crownScale,
            random() * 6.28, 0.1 * clearing.side, i % 3 ? 0x8fae7c : 0xa8bd8e);
          place('palm', top.x + 0.6, top.y - tall * 0.34, top.z - 0.4,
            1.8 + random(), 2.4 + random(), 1.8 + random(), random() * 6.28, 0.14, 0x8fae7c);
          // A mid-storey crown at head height on alternate trunks. The tall
          // crowns leave a band of white sky between bare poles otherwise.
          if (i % 2 === 0) {
            const low = 2.2 + random() * 1.8;
            const broad = 2.8 + random() * 1.8;
            place('crown', p.x - 0.4, p.y + low, p.z + 0.3, broad, broad * 0.8, broad,
              random() * 6.28, 0, i % 4 ? 0x5c7c4a : 0x6d8d56);
          }
          // Understorey at the grove edge closes the gap between trunks.
          for (let k = 0; k < 3; k++) {
            const bx = p.x + (random() - 0.5) * 6, bz = p.z + (random() - 0.5) * 6;
            const by = world.grid.heightAt(bx, bz);
            if (by < world.waterLevel + 0.2) continue;
            const bs = 1.1 + random() * 1.5;
            place(k === 0 ? 'banana' : 'fern', bx, by - 0.12, bz, bs, bs, bs, random() * 6.28, 0,
              k === 0 ? 0x6f8f57 : 0x5f7d4c);
          }
        }
      }
      // The elephant lick sits on a crest with the hillside falling away behind
      // it, so the tall grove shows only bare poles. A belt of short, broad-
      // crowned trees fills the gap at the herd's eye level.
      {
        const detail = gladeDetails.get(STAGE.elephants);
        for (let i = 0; i < 30; i++) {
          const s = STAGE.elephants + (random() * 2 - 1) * 34;
          if (s < first || s >= first + 80) continue;
          const f = road.frameAt(s, {});
          const lateral = detail.lateral + 5.0 + random() * 12;
          const p = probe(f, lateral);
          if (p.y < world.waterLevel + 0.2) continue;
          const tall = 8 + random() * 6;
          const r = 0.2 + random() * 0.18;
          limb(new THREE.Vector3(p.x, p.y - 0.8, p.z),
            new THREE.Vector3(p.x, p.y + tall, p.z), r, i % 2 ? 0x5c5a48 : 0x6a6650);
          obstacles.push(p.x, p.z, r);
          const cs = 3.8 + random() * 2.8;
          place('crown', p.x, p.y + tall - 1.8, p.z, cs, cs * 1.02, cs, random() * 6.28, 0.08,
            i % 3 ? 0x79996a : 0x8caa78);
          place('crown', p.x + 1.1, p.y + tall * 0.7, p.z - 0.6, cs * 0.8, cs * 0.85, cs * 0.8,
            random() * 6.28, -0.1, 0x67865a);
          // Low, wide crown at head height; the crest hides the tall canopy
          // behind the herd otherwise.
          if (i % 2 === 0) {
            const low = 2.4 + random() * 1.6;
            place('crown', p.x - 0.5, p.y + low, p.z + 0.4, 3.4 + random() * 2.2, 2.6 + random() * 1.4,
              3.4 + random() * 2.2, random() * 6.28, 0, i % 4 ? 0x5c7c4a : 0x6d8d56);
          }
        }
        // A few banana clumps on the drop-off soften the trunks without ever
        // coming between the road and the herd.
        for (let i = 0; i < 7; i++) {
          const s = STAGE.elephants + (random() * 2 - 1) * 26;
          if (s < first || s >= first + 80) continue;
          const f = road.frameAt(s, {});
          const p = probe(f, detail.lateral + 4 + random() * 6);
          if (p.y < world.waterLevel + 0.3) continue;
          const bs = 2.2 + random() * 1.4;
          place('banana', p.x, p.y - 0.2, p.z, bs, bs * 1.1, bs, random() * 6.28, 0, 0x5c7f45);
        }
      }
      // Fallen limbs and drifted leaf litter give the verge a worked-in feel.
      for(let i=0;i<2;i++){
        const s=first+20+random()*50, f=road.frameAt(s,{}), side=i%2?-1:1;
        if (inClearing(s, side, 9)) continue;
        const a=probe(f,side*(f.halfWidth+0.4+random()*1.6));
        const b=probe(f,side*(f.halfWidth+4.5+random()*4));
        a.y-=0.12; b.y+=0.28;
        limb(a,b,0.3+random()*0.3,0x6f6448);
        place('fern',b.x,b.y-0.12,b.z,1.1+random()*0.8,1.2+random(),1.1+random()*0.8,random()*6.28,0.1,0x8caa78);
      }
      for(let i=0;i<26;i++){
        const s=first+random()*80, f=road.frameAt(s,{}), side=i%2?-1:1;
        const d=side*(f.halfWidth+0.05+random()*1.5);
        const p=probe(f,d);
        if(p.y<world.waterLevel+0.15) continue;
        place('litter',p.x,p.y+0.025,p.z,0.34+random()*0.5,1,0.34+random()*0.5,random()*6.28,0,
          i%3?0x6f5c38:0x4e5a2f);
      }
      if(first%240===0){
        const f=road.frameAt(first+42,{});
        for(let k=0;k<4;k++)place('beam',f.x+f.rx*(1.4+k*0.8),f.y+6,f.z+f.rz*k,0.8+k*0.26,13,1,Math.atan2(f.rx,f.rz),0.36,0xfff4ce);
      }
      for(const [shape,entries] of Object.entries(batches)){
        if(!entries.length) continue;
        const mat=shape==='trunk'||shape==='buttress'?this.bark
          :shape==='stone'?this.material
          :shape==='beam'?this.beams
          :shape==='palm'||shape==='flower'?this.garden
          :shape==='litter'?this.litter
          :this.foliage;
        const mesh=new THREE.InstancedMesh(this.shapes[shape],mat,entries.length);
        entries.forEach(([matrix,color],i)=>{mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,new THREE.Color(color));});
        mesh.computeBoundingSphere();
        mesh.receiveShadow=shape!=='beam';
        group.add(mesh);
      }
      this.group.add(group);
      this.sectors.push({group,centre});
    }
    this.setPieces = new JungleSetPieces(world, quality, this.foliage);
    this.group.add(this.setPieces.group);
    world.setObstacles(obstacles);
    this.butterflies = butterflyFlight(road, world, random, this.wind);
    this.group.add(this.butterflies);
    this.dragonflies = dragonflySwarms(road, world, random, this.wind);
    this.group.add(this.dragonflies);
    this.animals = new JungleAnimals(world);
    this.group.add(this.animals.group);
    this.weather = new JungleWeather(world, quality);
    this.group.add(this.weather.group);
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

  setQuality(quality) {
    this.range = 170 + 95 * (quality?.terrainLod ?? 1);
    this.wildlifeEnabled = quality?.wildlife !== false;
    this.tapirs.group.visible = this.wildlifeEnabled;
    this.animals.group.visible = this.wildlifeEnabled;
    this.weather?.setQuality?.(quality);
  }

  update(camera, dt = 0, night = false, car = camera) {
    if (this.wildlifeEnabled) {
      this.tapirs.update(dt, camera, car);
      this.animals.update(dt, camera, car, night);
    }
    this.weather.update(dt,camera,night);
    this.setPieces.update(dt);
    this.beams.visible = !night;
    this.butterflies.visible = !night;
    this.dragonflies.visible = !night;
    this.wind.value = this.clock;
    for (const { group, centre } of this.sectors) {
      group.visible = (camera.x-centre.x)**2 + (camera.z-centre.z)**2 < this.range**2;
    }
    this.clock += dt;
    const dx = camera.x - this.bridge.centre.x;
    const dz = camera.z - this.bridge.centre.z;
    this.flock.visible = !night && (dx * dx + dz * dz) < 28900;
    if (this.flock.visible) {
      const t = this.clock * 0.24;
      this.flock.position.x = this.bridge.centre.x + 17*Math.cos(t);
      this.flock.position.z = this.bridge.centre.z + 17*Math.sin(t);
      this.flock.rotation.y = -t;
      for (const {wing,side,i} of this.wings) wing.rotation.z = side*Math.sin(8*this.clock+i)*0.48;
    }
  }

  dispose() {
    this.tapirs.mesh.geometry.dispose();
    this.butterflies.geometry.dispose();
    this.dragonflies.geometry.dispose();
    this.animals.dispose();
    this.weather.dispose();
    this.setPieces.dispose();
    this.group.traverse(obj => {
      if (obj.isInstancedMesh) obj.dispose();
      if (obj.material && obj.material !== this.material && ![this.foliage,this.bark,this.beams,this.garden,this.litter].includes(obj.material)) obj.material.dispose();
    });
    Object.values(this.shapes).forEach(g => g.dispose());
    for (const material of [this.foliage,this.bark,this.beams]) {
      material.map.dispose();
      material.dispose();
    }
    this.garden.dispose();
    this.litter.dispose();
    this.material.dispose();
  }
}
