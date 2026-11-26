import * as T from 'three';

export class HollowWeather {
  constructor(world,random){
    this.group=new T.Group();this.t=0;this.night=false;
    const cloud=document.createElement('canvas');cloud.width=256;cloud.height=100;
    const c=cloud.getContext('2d');
    for(let i=0;i<55;i++){
      const x=35+random()*186,y=38+random()*22,r=9+random()*24;
      const puff=c.createRadialGradient(x,y,0,x,y,r);puff.addColorStop(0,'rgba(213,228,228,.24)');puff.addColorStop(1,'rgba(213,228,228,0)');
      c.fillStyle=puff;c.fillRect(x-r,y-r,r*2,r*2);
    }
    this.map=new T.CanvasTexture(cloud);
    this.veil=new T.SpriteMaterial({map:this.map,color:0xbbd3d5,opacity:.22,transparent:true,depthWrite:false});
    this.mist=[];
    for(const rd of world.roads.slice(0,3))for(let s=65;s<rd.length;s+=65+random()*125){
      const f=rd.frameAt(s,{}),side=(random()-.5)*35,sp=new T.Sprite(this.veil);
      sp.position.set(f.x+f.rx*side,f.y+1.4,f.z+f.rz*side);sp.userData.start=sp.position.x;
      sp.scale.set(36+random()*34,4+random()*5,1);this.mist.push(sp);this.group.add(sp);
    }
    this.sky=new T.Mesh(new T.SphereGeometry(1,24,12),new T.ShaderMaterial({
      side:T.BackSide,depthWrite:false,uniforms:{mist:{value:new T.Color(0x6f939f)},night:{value:0}},
      vertexShader:'varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:`varying vec3 vDir;uniform vec3 mist;uniform float night;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
        void main(){vec3 d=normalize(vDir);float h=max(0.,d.y);vec2 uv=d.xz/max(.085,h+.07);
          float cloud=.57*noise(uv*1.5)+.29*noise(uv*4.)+.14*noise(uv*11.);
          float v=smoothstep(.005,.22,h);vec3 sky=mix(mist,mix(mist*.61,mist*1.85,cloud)*mix(1.,.7,night),v);
          gl_FragColor=vec4(sky,1.);
          #include <colorspace_fragment>
        }`}));
    this.sky.frustumCulled=false;this.sky.renderOrder=-100;this.group.add(this.sky);
    const positions=new Float32Array(180*6);
    for(let i=0;i<positions.length;i+=6){
      const x=random()*48-24,y=random()*20,z=random()*48-24;
      positions.set([x,y,z,x-.06,y+.45,z+.02],i);
    }
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.BufferAttribute(positions,3));
    this.rain=new T.LineSegments(geo,new T.LineBasicMaterial({color:0xb0cbce,transparent:true,opacity:.19,depthWrite:false}));
    this.group.add(this.rain);
  }
  setQuality(q){
    const scale=Math.max(0.25,Math.min(1,Number(q?.effects??1)));
    this.rain.geometry.setDrawRange(0,Math.round(180*scale)*2);
  }
  update(pos,dt,night=this.night,weather=1){
    this.night=night;
    this.t+=dt;
    this.sky.position.copy(pos);this.sky.scale.setScalar(3200);
    this.sky.material.uniforms.mist.value.setHex(night?0x293f50:0x6f939f);this.sky.material.uniforms.night.value=night?1:0;
    this.rain.visible=weather>.15&&Math.sin(this.t*.035)>.05;
    this.rain.position.set(pos.x,pos.y-8-(this.t*10)%12,pos.z);
    this.veil.opacity=.26*weather;
    for(const m of this.mist){
      m.visible=weather>0&&Math.abs(m.position.z-pos.z)<190&&Math.abs(m.userData.start-pos.x)<190;
      if(m.visible)m.position.x=m.userData.start+4*Math.sin(this.t*.085+m.userData.start);
    }
  }
  dispose(){this.sky.geometry.dispose();this.sky.material.dispose();this.rain.geometry.dispose();this.rain.material.dispose();this.map.dispose();this.veil.dispose();}
}
