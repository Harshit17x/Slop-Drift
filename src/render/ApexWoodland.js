import * as T from 'three';
import {createRandom} from '../world/noise.js';

// Camera-facing canopy impostors keep the four photographed silhouettes legible
// at a distance. Each stand is independently culled and density-scaled.
export class ApexWoodland{
  constructor({world,quality}){
    this.group=new T.Group();this.forestTiles=[];
    this.atlas=new T.TextureLoader().load(new URL('../assets/maps/apex-woodland.webp',import.meta.url).href);
    this.atlas.colorSpace=T.SRGBColorSpace;this.atlas.anisotropy=4;
    const material=this.canopy=new T.ShaderMaterial({side:T.DoubleSide,fog:true,uniforms:{
      ...T.UniformsUtils.clone(T.UniformsLib.fog),atlas:{value:this.atlas},light:{value:1},wind:{value:0}
    },vertexShader:`
      uniform float wind;
      attribute vec4 tree; attribute vec2 variety;
      varying vec2 vUv; varying float shade;
      #include <fog_pars_vertex>
      void main(){
        vec3 centre=tree.xyz;vec2 toward=normalize(cameraPosition.xz-centre.xz+vec2(.0001));
        vec3 right=vec3(toward.y,0.,-toward.x);
        vec3 p=centre+right*position.x*tree.w+vec3(0.,(position.y+.5)*tree.w,0.);
        p.xz+=vec2(.09,.038)*tree.w*.16*uv.y*uv.y*sin(wind+tree.x*.047+tree.z*.021);
        vec2 cell=vec2(mod(variety.x,2.),1.-floor(variety.x/2.));
        vUv=(cell+clamp(uv,vec2(.003),vec2(.997)))*.5;
        shade=variety.y*mix(.72,1.0,uv.y);
        vec4 mvPosition=viewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,fragmentShader:`
       uniform sampler2D atlas; uniform float light;varying vec2 vUv;varying float shade;
       #include <fog_pars_fragment>
       void main(){vec4 c=texture2D(atlas,vUv);
         if(c.a<.38)discard;
         gl_FragColor=vec4(c.rgb*shade*light,1.);
         #include <tonemapping_fragment>
         #include <colorspace_fragment>
         #include <fog_fragment>
       }`});
    const rnd=createRandom(78912),base=new T.PlaneGeometry(1,1),groups=new Map(),hit={},solid=[];
    const main=world.apex.main,start=main.frameAt(0,{});
    for(let i=0;i<43000;i++){
      const x=(rnd()-.5)*3880,z=(rnd()-.5)*3880,y=world.grid.heightAt(x,z);
      const ridge=Math.sin(x/136+Math.sin(z/205))*Math.cos(z/116)+Math.sin((x+z)/311)*.4;
      if(y<world.waterLevel+1.3 || (ridge<-.15 && rnd()>.10) || world.isReserved(x,z,6))continue;
      // Preserve sightlines at the skyline and keep the spectator terraces open.
      if(z>start.z-185 && z<start.z+160 && x>-470 && x<540)continue;
      if(world.physicalRoads.some(r=>r.locate(x,z,hit)&&hit.distance<hit.halfWidth+16+(hit.lateral<0?r.escapeLeft?.[hit.index]??0:r.escapeRight?.[hit.index]??0)))continue;
      const sector=Math.floor(x/380)+':'+Math.floor(z/380);
      if(!groups.has(sector))groups.set(sector,{positions:[],species:[]});
      const g=groups.get(sector),h=(12+rnd()*11)*(y>280?.8:1);
      const species=rnd()<(y>95?.84:.62)?Math.floor(rnd()*2):2+Math.floor(rnd()*2);
      g.positions.push(x,y-.36,z,h);g.species.push(species,.74+.34*rnd());
      if(world.physicalRoads.some(r=>r.locate(x,z,hit)))solid.push(x,z,.31);
    }
    for(const {positions,species} of groups.values()){
      const geo=new T.InstancedBufferGeometry();geo.index=base.index;geo.attributes.position=base.attributes.position;geo.attributes.uv=base.attributes.uv;
      geo.setAttribute('tree',new T.InstancedBufferAttribute(new Float32Array(positions),4));
      geo.setAttribute('variety',new T.InstancedBufferAttribute(new Float32Array(species),2));
      const box=new T.Box3();for(let i=0;i<positions.length;i+=4)box.expandByPoint(new T.Vector3(positions[i],positions[i+1],positions[i+2]));
      box.expandByScalar(25);geo.boundingSphere=box.getBoundingSphere(new T.Sphere());
      const mesh=new T.Mesh(geo,material);mesh.userData.count=positions.length/4;this.forestTiles.push(mesh);this.group.add(mesh);
    }
    this.quad=base;world.setObstacles(solid);this.setQuality(quality);
  }
  setQuality(q){const fraction=Math.min(1,.32+.64*(q?.trees??1));for(const mesh of this.forestTiles)mesh.geometry.instanceCount=Math.ceil(mesh.userData.count*fraction);}
  update(view,dt,night){this.canopy.uniforms.wind.value+=dt*.95;this.canopy.uniforms.light.value=night?.09:this.skyLight??1.2;}
  dispose(){for(const tree of this.forestTiles)tree.geometry.dispose();this.quad.dispose();this.atlas.dispose();this.canopy.dispose();}
}

