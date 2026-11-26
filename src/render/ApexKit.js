import * as T from 'three';
import {MeshBuffer} from './road/MeshBuffer.js';

// Static venue kit. Shared primitives are instanced by material and 128 m cell.
// Printed signs share a single atlas, including all forty individual bay numbers.
export class ApexKit{
  constructor(group){
    this.group=group;this.batches=new Map();this.meshes=[];this.signs=[];
    this.box=new T.BoxGeometry(1,1,1);this.tube=new T.CylinderGeometry(.5,.5,1,12);
    const gable=new MeshBuffer(),ids=[];
    for(const x of [-.5,.5])for(const [y,z] of [[-.5,-.5],[.5,0],[-.5,.5]])ids.push(gable.vertex(x,y,z));
    gable.quad(ids[0],ids[1],ids[4],ids[3]);gable.quad(ids[1],ids[2],ids[5],ids[4]);
    gable.triangle(ids[0],ids[2],ids[1]);gable.triangle(ids[3],ids[4],ids[5]);
    this.roof=gable.build();
    this.ball=new T.SphereGeometry(.5,8,6);this.person=new T.IcosahedronGeometry(.5,0);this.transform=new T.Object3D();this.color=new T.Color();
    this.materials={
      stone:new T.MeshStandardMaterial({roughness:.87}),
      steel:new T.MeshStandardMaterial({roughness:.42,metalness:.52}),
      glass:new T.MeshStandardMaterial({roughness:.17,metalness:.55}),
      lamp:new T.MeshBasicMaterial({color:0xffffff}),
      fabric:new T.MeshStandardMaterial({roughness:.92,side:T.DoubleSide}),
      crowd:new T.MeshStandardMaterial({roughness:.94})
    };
    this.wind={value:0};
    this.materials.fabric.onBeforeCompile=shader=>{
      shader.uniforms.flagTime=this.wind;shader.vertexShader='uniform float flagTime;\n'+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\n        float weight=position.x+.5;float phase=instanceMatrix[3].x*.028+flagTime*3.2;\n        transformed.z+=weight*(3.5*sin(phase-4.*weight)+1.3*sin(phase*1.7+position.y*3.));\n        transformed.y+=weight*.065*sin(phase);`);
    };
  }
  instance(kind,shape,x,y,z,l,h,d,yaw,color,roll=0){
    const key=[kind,shape,Math.floor(x/128),Math.floor(z/128)].join('/');
    if(!this.batches.has(key))this.batches.set(key,{kind,shape,items:[]});
    const o=this.transform;o.position.set(x,y,z);o.rotation.set(0,yaw,roll,'YXZ');o.scale.set(l,h,d);o.updateMatrix();
    this.batches.get(key).items.push([o.matrix.clone(),color]);
  }
  beam(a,b,width,color){
    const dir=new T.Vector3().subVectors(b,a),mid=new T.Vector3().addVectors(a,b).multiplyScalar(.5);
    const o=this.transform;o.position.copy(mid);o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),dir.clone().normalize());o.scale.set(width,dir.length(),width);o.updateMatrix();
    const key='truss/'+Math.floor(mid.x/128)+'/'+Math.floor(mid.z/128);
    if(!this.batches.has(key))this.batches.set(key,{kind:'steel',shape:'box',items:[]});
    this.batches.get(key).items.push([o.matrix.clone(),color]);
  }
  sign(text,p,normal,width,height,style='dark'){this.signs.push({text,p,normal,width,height,style});}
  finish(){
    for(const {kind,shape,items} of this.batches.values()){
      const mesh=new T.InstancedMesh(kind==='crowd'?this.person:this[shape],this.materials[kind],items.length);
      items.forEach(([m,color],i)=>{mesh.setMatrixAt(i,m);mesh.setColorAt(i,this.color.setHex(color));});
      mesh.receiveShadow=kind!=='lamp';mesh.castShadow=kind!=='crowd' && kind!=='lamp';
      mesh.userData.crowd=kind==='crowd';mesh.userData.capacity=items.length;mesh.computeBoundingSphere();
      mesh.userData.range=kind==='crowd'?340:kind==='lamp'?780:Infinity;
      this.group.add(mesh);this.meshes.push(mesh);
    }
    this.batches.clear();
    const cells=new Map();
    for(const s of this.signs){const key=s.style+s.text;if(!cells.has(key))cells.set(key,cells.size);s.cell=cells.get(key);}
    const canvas=document.createElement('canvas');canvas.width=2048;const rows=Math.ceil(cells.size/4);canvas.height=rows*80;
    const ctx=canvas.getContext('2d'),buf=new MeshBuffer({uvs:true});
    const paint={dark:['#17252b','#f5f1e6','#e1442d'],red:['#b52e20','#fff9ef','#fff2ce'],white:['#eeeae0','#15262c','#ba3e2c'],green:['#095f51','#eff8e8','#c4e279']};
    for(const s of this.signs){
      const x=(s.cell%4)*512,y=Math.floor(s.cell/4)*80,[bg,fg,accent]=paint[s.style];
      ctx.fillStyle=bg;ctx.fillRect(x,y,512,80);ctx.fillStyle=accent;ctx.fillRect(x+3,y+6,8,68);
      ctx.font='bold 54px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=fg;ctx.fillText(s.text,x+260,y+42,477);
      const {p,normal:n,width:w,height:h}=s;
      const points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>buf.vertex(p.x+a*n.z*w/2,p.y+b*h/2,p.z-a*n.x*w/2,
        (x+2+(a+1)*254)/canvas.width,1-(y+2+(1-b)*38)/canvas.height));
      buf.quad(...points);
    }
    this.atlas=new T.CanvasTexture(canvas);this.atlas.colorSpace=T.SRGBColorSpace;this.atlas.anisotropy=4;
    this.printed=new T.Mesh(buf.build(),new T.MeshStandardMaterial({map:this.atlas,roughness:.79,side:T.DoubleSide}));
    this.group.add(this.printed);
  }
  cull(position,scale){
    for(const mesh of this.meshes){
      const distance=mesh.userData.range*scale+mesh.boundingSphere.radius;
      mesh.visible=distance===Infinity || mesh.boundingSphere.center.distanceToSquared(position)<distance*distance;
    }
  }
  crowd(density){for(const m of this.meshes)if(m.userData.crowd)m.count=Math.ceil(m.userData.capacity*density);}
  dispose(){for(const mesh of this.meshes)mesh.dispose();for(const a of [this.box,this.tube,this.roof,this.ball,this.person,...Object.values(this.materials),this.atlas,this.printed.geometry,this.printed.material])a.dispose();}
}

