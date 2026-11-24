import * as THREE from 'three';
import { createRandom } from '../world/noise.js';

// Several intersecting, slightly folded planes give each atlas plant depth.
// Keep leaf normals biased upward so neighbouring planes share their lighting.
export function plantGeometry(column, row, spread, overhead = false) {
  const pos = [], uv = [], normal = [], indices = [];
  for (let blade = 0; blade < 3; blade++) {
    const a = blade*Math.PI/3, ux = Math.cos(a), uz = Math.sin(a);
    const first = pos.length/3;
    for (const h of [0, 1]) {
      for (const w of [-1, 0, 1]) {
        const fold = (1-Math.abs(w))*0.18;
        const depth = h*spread + fold;
        pos.push(ux*w - uz*depth, overhead ? h*0.68+0.25-fold : h, uz*w + ux*depth);
        normal.push(ux*w*0.48,0.85,uz*w*0.48);
        uv.push((column+0.008+0.984*(w+1)/2)/2,(1-row+0.008+0.984*h)/2);
      }
    }
    for(let j=0;j<2;j++) {
      const k=first+j;
      indices.push(k,k+1,k+3,k+1,k+4,k+3);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geom.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geom.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));
  geom.setIndex(indices);
  return geom;
}

export function barkTexture() {
  const canvas = document.createElement('canvas');
  canvas.width=128; canvas.height=256;
  const ctx=canvas.getContext('2d'), rng=createRandom(817);
  ctx.fillStyle='#8b8270';
  ctx.fillRect(0,0,128,256);
  for (let i=0;i<2600;i++) {
    const x=rng()*128, y=rng()*280-24, len=2+rng()**2*52;
    ctx.strokeStyle=['#413b30','#665942','#c1b7a0','#6e744b','#989477'][i%5];
    ctx.globalAlpha=0.15+0.38*rng();
    ctx.lineWidth=0.45+rng()*2;
    ctx.beginPath();ctx.moveTo(x,y);
    ctx.bezierCurveTo(x+3,y+len*0.35,x-2,y+len*0.7,x+1,y+len);ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapT=texture.wrapS=THREE.RepeatWrapping;
  texture.repeat.set(2,3);
  return texture;
}

// Soft-edged light shafts are confined to openings in the canopy.
export function shaftMaterial() {
  const canvas=document.createElement('canvas');
  canvas.width=64; canvas.height=128;
  const ctx=canvas.getContext('2d'), data=ctx.createImageData(64,128);
  for(let y=0;y<128;y++) for(let x=0;x<64;x++){
    const i=(y*64+x)*4, h=y/127;
    const fade=Math.sin(Math.PI*x/63)**3 * Math.sin(h*Math.PI)**1.1;
    data.data.set([255,236,170,Math.round(42*fade)],i);
  }
  ctx.putImageData(data,0,0);
  return new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,side:THREE.DoubleSide,
    blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
}
