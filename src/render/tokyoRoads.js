import * as T from 'three';
import { createRandom } from '../world/noise.js';

function parkingConcrete(){
  const c=document.createElement('canvas');c.width=c.height=256;
  const ctx=c.getContext('2d'),pixels=ctx.createImageData(256,256),rand=createRandom(763);
  for(let i=0;i<pixels.data.length;i+=4){
    const v=133+rand()*21;
    pixels.data.set([v+4,v+4,v+1,255],i);
  }
  ctx.putImageData(pixels,0,0);
  ctx.strokeStyle='#555958';ctx.lineWidth=1;ctx.strokeRect(0,0,256,256);
  for(let i=0;i<18;i++){
    ctx.beginPath();ctx.arc(-60,110,70+i*3,.1,.91);ctx.strokeStyle='rgba(49,48,48,.07)';ctx.stroke();
  }
  const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;tex.wrapS=tex.wrapT=T.RepeatWrapping;
  return tex;
}

export function finishTokyoRoads(view){
  const surface=view.asphaltMesh,geo=surface.geometry;
  const deck=view.track(new T.MeshStandardMaterial({map:view.track(parkingConcrete()),roughness:.74,metalness:.02}));
  // Tokyo asphalt is matte: it absorbs the night and only catches a soft
  // sheen from the storefronts. Kill the metallic env reflection and the
  // glossy roughness patches so headlights read as pools, not mirrors.
  const street=surface.material;
  street.roughness=.88;street.metalness=.02;street.envMapIntensity=.32;
  street.roughnessMap=null;street.bumpScale=.022;
  view.streetMaterial=street;
  let start=0;
  for(const r of view.world.roads){
    const count=r.segments*24;
    geo.addGroup(start,count,r.id===4?1:0);start+=count;
  }
  surface.material=[street,deck];
  // A single world-wide mesh defeats frustum culling on the expressway and parkade.
  // Share immutable vertex attributes and partition only triangle indices and bounds.
  for(const obj of [...view.group.children]){
    const g=obj.geometry;
    if(!g?.index||g.index.count<15000||obj.isInstancedMesh)continue;
    const bins=new Map(),pos=g.attributes.position,idx=g.index.array,pt=new T.Vector3();
    const groups=g.groups.length?g.groups:[{start:0,count:idx.length,materialIndex:0}];
    for(const {start,count,materialIndex} of groups){
      for(let i=start;i<start+count;i+=3){
        const a=idx[i],key=Math.floor(pos.getX(a)/320)+','+Math.floor(pos.getZ(a)/320)+','+materialIndex;
        let b=bins.get(key);
        if(!b){b={ids:[],box:new T.Box3(),materialIndex};bins.set(key,b);}
        for(let k=0;k<3;k++){const v=idx[i+k];b.ids.push(v);b.box.expandByPoint(pt.fromBufferAttribute(pos,v));}
      }
    }
    for(const b of bins.values()){
      const tile=view.track(new T.BufferGeometry());
      for(const [name,attr] of Object.entries(g.attributes))tile.setAttribute(name,attr);
      tile.setIndex(b.ids);tile.boundingBox=b.box;tile.boundingSphere=b.box.getBoundingSphere(new T.Sphere());
      const mat=Array.isArray(obj.material)?obj.material[b.materialIndex]:obj.material;
      view.addMesh(tile,mat,obj.name+' sector',{cast:obj.userData.baseCastShadow,receive:obj.userData.baseReceiveShadow});
    }
    obj.removeFromParent();
  }
}
