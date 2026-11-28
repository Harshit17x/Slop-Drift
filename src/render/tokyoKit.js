import * as T from 'three';
import { FLOOR_RISE } from '../world/Tokyo.js';

export const cityColors=[0xff504e,0x44bfff,0xffc256,0xff75ab,0xbde8ff,0xff9d48];
const labels=[
  ['星野百貨店','HOSHINO  /  SHIBUYA'],['夜光電機','YAKO ELECTRIC'],['らーめん月影','TSUKIKAGE  /  RAMEN'],['青空市場','AOZORA MARKET'],
  ['深夜遊戯','ARCADE  /  OPEN'],['喫茶つばき','TSUBAKI COFFEE'],['北口書店','KITAGUCHI BOOKS'],['音響研究所','STEREO LAB'],
  ['深夜駐車場','MIDNIGHT PARKADE'],['東京湾','BAY SHORE'],['首都高速','EXPRESSWAY'],['港区','MINATO'],
  ['入口 ↑','ENTRANCE'],['出口 →','EXIT'],['整備工場','NIGHT WORKS'],['屋上展望台','ROOFTOP'],
];
export function signTexture(index, background, vertical=false,custom){
  const c=document.createElement('canvas');c.width=vertical?128:512;c.height=vertical?384:144;
  const ctx=c.getContext('2d'),[jp,en]=custom||labels[index%labels.length];
  ctx.fillStyle=background;ctx.fillRect(0,0,c.width,c.height);
  ctx.strokeStyle='rgba(255,255,255,.58)';ctx.lineWidth=3;ctx.strokeRect(5,5,c.width-10,c.height-10);
  ctx.fillStyle='#fff6dd';ctx.textAlign='center';ctx.textBaseline='middle';
  const font='"Yu Gothic","Meiryo",sans-serif';
  if(vertical){
    const size=Math.min(71,320/jp.length);
    ctx.font='bold '+size+'px '+font;
    [...jp].forEach((ch,i)=>ctx.fillText(ch,64,32+(i+.5)*320/jp.length));
  }else{
    ctx.font='bold 68px '+font;ctx.fillText(jp,256,55,470);
    ctx.font='bold 22px sans-serif';ctx.fillText(en,256,111,456);
  }
  const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;return tex;
}

export function reflectionTexture(){
  const c=document.createElement('canvas');c.width=64;c.height=128;
  const ctx=c.getContext('2d'),img=ctx.createImageData(64,128);
  for(let y=0;y<128;y++)for(let x=0;x<64;x++){
    const off=(y*64+x)*4,dx=(x-32)/32,dz=(y-64)/64;
    const grain=.35+.65*(.5+.5*Math.sin(y*3.63+Math.sin(x*.61+y)*.6));
    img.data[off]=img.data[off+1]=img.data[off+2]=255;
    img.data[off+3]=Math.max(0,1-dx*dx-dz*dz)**3*grain*170;
  }
  ctx.putImageData(img,0,0);return new T.CanvasTexture(c);
}

// Longitudinal cross-sections give the parked fleet a bumper, bonnet, tapered windscreen and rear glass.
function coachwork(sections){
  const vertices=[],triangles=[];
  for(const [x,y,half] of sections)vertices.push(x,0,-half,x,0,half,x,y,half*.89,x,y,-half*.89);
  for(let i=0;i<sections.length-1;i++)for(let k=0;k<4;k++){
    const a=i*4+k,b=i*4+(k+1)%4;
    triangles.push(a,a+4,b,b,a+4,b+4);
  }
  const end=vertices.length/3-4;triangles.push(0,1,2,0,2,3,end,end+2,end+1,end,end+3,end+2);
  const geom=new T.BufferGeometry();geom.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
  geom.setIndex(triangles);geom.computeVertexNormals();return geom;
}

export class CityBatch {
  constructor(group){
    this.group=group;this.bins=new Map();this.obj=new T.Object3D();
    this.geometries={box:new T.BoxGeometry(1,1,1),round:new T.CylinderGeometry(.5,.5,1,12),
      lamp:new T.SphereGeometry(.5,8,6),plane:new T.PlaneGeometry(1,1)};
    const g=this.geometries;
    g.plane.rotateX(-Math.PI/2);g.wheel=new T.CylinderGeometry(.5,.5,1,14).rotateX(Math.PI/2);
    g.body=coachwork([[-.5,.62,.4],[-.44,.91,.48],[-.27,.98,.5],[.23,.94,.5],[.43,.73,.47],[.5,.51,.42]]);
    g.coupe=coachwork([[-.5,.04,.49],[-.23,.92,.47],[.16,1,.46],[.5,.04,.49]]);
    g.hatch=coachwork([[-.5,.14,.48],[-.41,.93,.46],[.13,1,.46],[.5,.06,.49]]);
    this.tiles=[];
  }
  put(shape,mat,x,y,z,w,h,d,yaw=0,tint=0xffffff,orientation=null){
    const level=this.layered?Math.round(y/FLOOR_RISE):null;
    const cell=Math.floor(x/180)+','+Math.floor(z/180)+(level===null?'':','+level),key=cell+'|'+shape+'|'+mat.id;
    if(!this.bins.has(key))this.bins.set(key,{shape,mat,cell,items:[]});
    const obj=this.obj;obj.position.set(x,y,z);obj.scale.set(w,h,d);
    if(orientation)obj.quaternion.copy(orientation);else obj.rotation.set(0,yaw,0);
    obj.updateMatrix();this.bins.get(key).items.push([obj.matrix.clone(),tint]);
  }
  beam(mat,a,b,w,tint){
    const v=new T.Vector3().subVectors(b,a),length=v.length();
    const q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),v.normalize());
    this.put('box',mat,(a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2,w,length,w,0,tint,q);
  }
  flush(){
    const cells=new Map(),color=new T.Color();
    for(const {shape,mat,cell,items} of this.bins.values()){
      if(!cells.has(cell)){
        const [ix,iz,level]=cell.split(',').map(Number);
        const g=new T.Group();
        // Cell and mesh transforms stay at identity. All placements are in the instance matrices.
        g.matrixAutoUpdate=false;
        g.userData.cx=(ix+.5)*180;g.userData.cz=(iz+.5)*180;g.userData.level=level;
        cells.set(cell,g);this.group.add(g);this.tiles.push(g);
      }
      const mesh=new T.InstancedMesh(this.geometries[shape],mat,items.length);
      mesh.matrixAutoUpdate=false;
      items.forEach(([m,tint],i)=>{mesh.setMatrixAt(i,m);mesh.setColorAt(i,color.setHex(tint))});
      mesh.computeBoundingSphere();cells.get(cell).add(mesh);
    }
    this.bins.clear();
  }
  update(p,radius,inGarage=false){
    const level=p.y/FLOOR_RISE;
    for(const tile of this.tiles){
      const {cx,cz,level:deck}=tile.userData;
      tile.visible=(cx-p.x)**2+(cz-p.z)**2<radius*radius &&
        (!inGarage || (deck===undefined?level>-.62:Math.abs(deck-level)<2.3));
    }
  }
  dispose(){for(const tile of this.tiles)tile.traverse(obj=>{if(obj.isInstancedMesh)obj.dispose()});Object.values(this.geometries).forEach(g=>g.dispose());}
}
