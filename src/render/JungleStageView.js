import * as THREE from 'three';
import { WASHOUT, RIDGE, TAPIR_BEND } from '../world/jungleStage.js';
import { createLabelTexture } from './road/textures.js';
import { MeshBuffer } from './road/MeshBuffer.js';
import { createRandom } from '../world/noise.js';

// Roadside notes are readable before the commitment point; nothing projects
// into the wheel corridor. Batch the stakes, tape and landing markers together.
export function buildStageFurniture(view, soilTexture) {
  const road = view.world.roads[0], wood = new MeshBuffer({colors:true});
  const face = view.track(new THREE.PlaneGeometry(3.5, 1.05));
  const timber = view.track(new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.86}));
  function board(s, title, note, accent) {
    const f=road.frameAt(s,{}), d=f.halfWidth+1.05;
    const x=f.x+f.rx*d, z=f.z+f.rz*d, y=view.world.grid.heightAt(x,z);
    wood.box(x,y+1.1,z,0.09,0,0,0,1.25,0,0,0,0.09,0.22,0.14,0.066);
    const texture=view.track(createLabelTexture([title,note],{background:'#192322',accent}));
    const sign=new THREE.Mesh(face,view.track(new THREE.MeshBasicMaterial({map:texture})));
    sign.position.set(x,y+2.1,z);
    sign.rotation.y=Math.atan2(-f.tx,-f.tz);
    view.group.add(sign);
  }
  board(WASHOUT.lip-197,'FLOOD CUT','200 m   /   BUILD SPEED','#f3aa39');
  board(WASHOUT.lip-78,`JUMP   ${WASHOUT.targetKmh}+`,'STRAIGHT OVER CREST','#ffbf48');
  board(TAPIR_BEND-48,'TAPIR BEND','WILDLIFE REFUGE','#91ce95');
  board(RIDGE-140,'CLOUD RIDGE','CREST   /   FALLING ROAD','#efb640');
  board(4460,'DOUBLE CAUTION','TIGHTENS IN 75 m','#ff9435');
  for (const side of [-1,1]) {
    for (const [start,count,step] of [[WASHOUT.lip-38,7,6],[WASHOUT.bank+1,5,6]]) {
      let last;
      for(let k=0;k<count;k++){
        const f=road.frameAt(start+k*step,{}), d=side*(f.halfWidth+0.56);
        const x=f.x+f.rx*d, z=f.z+f.rz*d, y=f.y+f.bank*d;
        const landing=start>WASHOUT.lip;
        wood.box(x,y+0.55,z,0.042,0,0,0,0.6,0,0,0,0.042,0.45,0.32,0.16);
        wood.box(x,y+1.09,z,0.055,0,0,0,0.10,0,0,0,0.055,landing?0.18:0.95,landing?0.83:0.25,0.045);
        if(last){
          const dx=(x-last.x)/2,dz=(z-last.z)/2,dy=(y-last.y)/2;
          for(let j=0;j<6;j++){
            const t=(j+0.5)/6;
            wood.box(last.x+2*dx*t,last.y+2*dy*t+0.85,last.z+2*dz*t,
              dx/6,dy/6,dz/6,0,0.047,0,f.rx*0.012,0,f.rz*0.012,
              j%2?0.85:0.16,j%2?0.78:0.083,j%2?0.54:0.036);
          }
        }
        last={x,y,z};
      }
    }
  }
  view.addMesh(view.track(wood.build()),timber,'Rally boards and washout tape');
  // Strata exposed by the washout: actual end faces give the suspended
  // ribbon a solid edge down to the excavated bed, also visible on a miss.
  const cut=new MeshBuffer({colors:true,uvs:true}), rng=createRandom(1722);
  for(const s of [WASHOUT.lip,WASHOUT.bank]){
    const f=road.frameAt(s,{}), half=f.halfWidth+road.shoulderEdge+0.65;
    let prev;
    for(let k=0;k<=20;k++){
      const d=half*(k/10-1), x=f.x+f.rx*d,z=f.z+f.rz*d;
      const y=f.y+f.bank*d+road.profileAt(Math.abs(d),f.halfWidth);
      const faceDir=s===WASHOUT.lip?1:-1;
      const row=[];
      for(let j=0;j<4;j++){
        const depth=[0,0.45,1.5,8][j], col=[0.20,0.28,0.17,0.11][j]*(0.7+0.4*rng());
        const bulge=j===0?0:(0.12+rng()*0.28)*j;
        row.push(cut.vertex(x+f.tx*faceDir*bulge,y-depth,z+f.tz*faceDir*bulge,
          d/4,depth/4,col*2.7,col*2.1,col*1.58));
      }
      if(prev) for(let j=0;j<3;j++)cut.quad(prev[j],row[j],row[j+1],prev[j+1]);
      prev=row;
    }
  }
  view.addMesh(view.track(cut.build()),view.track(new THREE.MeshStandardMaterial({
    vertexColors:true,map:soilTexture,bumpMap:soilTexture,bumpScale:0.12,side:THREE.DoubleSide,roughness:1
  })),'Exposed clay banks');
}
