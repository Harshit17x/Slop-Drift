import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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
        const lift = overhead ? 0.30 + 0.65 * h : 0.55 + 0.35 * h;
        normal.push(ux*w*0.72 - uz*depth, lift, uz*w*0.72 + ux*depth);
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

/** A flared rainforest giant: tapered bole plus six triangular buttress fins. */
export function buttressGeometry() {
  const trunk = new THREE.CylinderGeometry(0.66, 0.94, 1, 10, 2);
  trunk.translate(0, 0.5, 0);
  const parts = [trunk];
  for (let i = 0; i < 6; i++) {
    const w = 0.07 + (i % 2) * 0.018;
    const spread = 0.88 + 0.24 * ((i * 37) % 7) / 7;
    const height = 0.32 + 0.24 * ((i * 53) % 9) / 9;
    const v = [
      -0.07, 0, -w, spread, 0.01, -w * 0.65, -0.07, height, 0,
      -0.07, 0, w, -0.07, height, 0, spread, 0.01, w * 0.65,
      -0.07, height, 0, spread, 0.01, -w * 0.65, spread, 0.01, w * 0.65,
      -0.07, 0, -w, -0.07, 0, w, spread, 0.01, w * 0.65,
      -0.07, 0, -w, spread, 0.01, w * 0.65, spread, 0.01, -w * 0.65,
    ];
    const fin = new THREE.BufferGeometry();
    fin.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    fin.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((v.length / 3) * 2), 2));
    fin.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    fin.computeVertexNormals();
    fin.rotateY(i / 6 * Math.PI * 2 + (i % 2) * 0.16);
    parts.push(fin);
  }
  return mergeGeometries(parts, false);
}

/** A radial palm crown made from drooping segmented fronds, coloured per vertex. */
export function palmCrownGeometry() {
  const position = [], color = [], normal = [], index = [];
  const fronds = 9;
  for (let f = 0; f < fronds; f++) {
    const angle = f / fronds * Math.PI * 2 + (f % 2) * 0.12;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const length = 2.3 + (f % 4) * 0.22;
    const droop = 0.14 + (f % 3) * 0.045;
    let previous = null;
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const r = t * length;
      const y = 0.3 * Math.sin(t * Math.PI * 0.92) - t * t * length * droop;
      const width = 0.2 * (1 - t * 0.84);
      const shade = 0.72 + 0.3 * t;
      const first = position.length / 3;
      position.push(
        dx * r - dz * width, y, dz * r + dx * width,
        dx * r + dz * width, y + 0.015, dz * r - dx * width,
      );
      color.push(
        0.46 * shade, 0.66 * shade, 0.3 * shade,
        0.52 * shade, 0.74 * shade, 0.34 * shade,
      );
      normal.push(0, 1, 0, 0, 1, 0);
      if (previous !== null) index.push(previous, previous + 1, first, previous + 1, first + 1, first);
      previous = first;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setIndex(index);
  return geometry;
}

/** Wild ginger / heliconia: broad leaves and a bright bract spike. */
export function flowerGeometry() {
  const position = [], color = [], normal = [], index = [];
  const ribbon = (ax, az, bx, bz, height, width, bend, r, g, b) => {
    let previous = null;
    for (let i = 0; i <= 3; i++) {
      const t = i / 3;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const y = height * t - Math.sin(t * Math.PI) * bend;
      const w = width * (1 - t * 0.75);
      const first = position.length / 3;
      position.push(x - w, y, z - w * 0.4, x + w, y + 0.02, z + w * 0.4);
      normal.push(0, 1, 0, 0, 1, 0);
      color.push(r * 0.72, g * 0.72, b * 0.72, r, g, b);
      if (previous !== null) index.push(previous, previous + 1, first, previous + 1, first + 1, first);
      previous = first;
    }
  };
  const bract = (x, y, z, angle, size, r, g, b) => {
    const first = position.length / 3;
    const sa = Math.sin(angle) * size, ca = Math.cos(angle) * size;
    position.push(x - sa, y, z - ca, x + sa, y + 0.02, z + ca, x, y + size * 0.9, z);
    normal.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    color.push(r, g, b, r, g, b, r * 1.05, g * 0.82, b * 0.55);
    index.push(first, first + 1, first + 2);
  };
  for (let cluster = 0; cluster < 2; cluster++) {
    const ox = (cluster ? 0.5 : -0.35), oz = (cluster ? 0.22 : -0.12);
    ribbon(ox, oz, ox + 0.36, oz + 0.28, 1.1, 0.22, 0.3, 0.19, 0.42, 0.16);
    ribbon(ox, oz, ox - 0.3, oz + 0.34, 0.9, 0.18, 0.22, 0.23, 0.5, 0.19);
    for (let i = 0; i < 4; i++) {
      bract(ox + 0.3 + i * 0.035, 0.5 + i * 0.17, oz + 0.26, angleForBract(i),
        0.16 - i * 0.01, 0.64, 0.1 + i * 0.04, 0.07);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setIndex(index);
  return geometry;
}

function angleForBract(i) {
  return i * 1.9 + 0.4;
}

/** A single folded leaf card for the debris drifted along the trail edges. */
export function leafLitterGeometry() {
  const geometry = new THREE.BufferGeometry();
  const position = [
    -0.5, 0, 0, 0, 0.05, -0.3, 0.5, 0, 0,
    0, 0.05, -0.3, 0.5, 0, 0, 0, 0.05, 0.3,
  ];
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  return geometry;
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
