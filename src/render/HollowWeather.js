import * as T from 'three';

const TAU = Math.PI * 2;

function boltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 512;
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, 128, 512);
  const points = [];
  let x = 64 + (Math.random() - .5) * 18;
  for (let y = 0; y <= 512; y += 22) {
    points.push([x, y]);
    x = Math.max(10, Math.min(118, x + (Math.random() - .5) * 42));
  }
  c.globalCompositeOperation = 'lighter';
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (const [width, alpha] of [[18, .18], [9, .42], [4, 1]]) {
    c.strokeStyle = `rgba(220,240,255,${alpha})`;
    c.lineWidth = width;
    c.beginPath();
    points.forEach(([px, py], i) => i ? c.lineTo(px, py) : c.moveTo(px, py));
    c.stroke();
  }
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  return map;
}

export class HollowWeather {
  constructor(world,random){
    this.group=new T.Group();this.t=0;this.night=false;this.random=random;
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

    // Lightning: a cloud flash sphere, a directional flash and a distant bolt.
    // The sphere is behind the world geometry and depth-tested, so the cave
    // roof naturally masks the sky while the directional light still leaks in.
    this.flash=new T.Mesh(new T.SphereGeometry(1,20,10),new T.MeshBasicMaterial({
      color:0xcfe4ff,transparent:true,opacity:0,blending:T.AdditiveBlending,
      side:T.BackSide,depthWrite:false,depthTest:true,fog:false,
    }));
    this.flash.scale.setScalar(2800);this.flash.renderOrder=-99;this.flash.visible=false;
    this.group.add(this.flash);
    this.flashLight=new T.DirectionalLight(0xd8ecff,0);
    this.group.add(this.flashLight,this.flashLight.target);
    this.boltMap=boltTexture();
    this.bolt=new T.Sprite(new T.SpriteMaterial({
      map:this.boltMap,color:0xdff2ff,transparent:true,opacity:0,
      blending:T.AdditiveBlending,depthWrite:false,fog:false,
    }));
    this.bolt.visible=false;this.bolt.scale.set(170,700,1);
    this.group.add(this.bolt);
    this.strikeIn=8+random()*10;this.flashAt=-10;this.flashPower=0;this.boltAzimuth=0;
  }
  setQuality(q){
    const scale=Math.max(0.25,Math.min(1,Number(q?.effects??1)));
    this.rain.geometry.setDrawRange(0,Math.round(180*scale)*2);
  }
  update(pos,dt,night=this.night,weather=1,inside=false){
    this.night=night;
    this.t+=dt;
    this.sky.position.copy(pos);this.sky.scale.setScalar(3200);
    this.sky.material.uniforms.mist.value.setHex(night?0x293f50:0x6f939f);this.sky.material.uniforms.night.value=night?1:0;
    this.rain.visible=!inside&&weather>.15&&Math.sin(this.t*.035)>.05;
    this.rain.position.set(pos.x,pos.y-8-(this.t*10)%12,pos.z);
    this.veil.opacity=.26*weather;
    for(const m of this.mist){
      m.visible=!inside&&weather>0&&Math.abs(m.position.z-pos.z)<190&&Math.abs(m.userData.start-pos.x)<190;
      if(m.visible)m.position.x=m.userData.start+4*Math.sin(this.t*.085+m.userData.start);
    }
    this.strikeIn-=dt;
    if(this.strikeIn<=0&&night){
      this.strikeIn=13+this.random()*22;
      const distance=520+this.random()*1850;
      this.flashAt=this.t;
      this.flashPower=.55+this.random()*.45;
      this.boltAzimuth=this.random()*TAU;
      this.bolt.position.set(
        pos.x+Math.cos(this.boltAzimuth)*distance,
        pos.y+260,
        pos.z+Math.sin(this.boltAzimuth)*distance,
      );
      this.bolt.scale.set(150+this.random()*90,620+this.random()*180,1);
      this.onThunder?.(distance/343,Math.max(.18,1-distance/2600),inside);
    }
    const u=this.t-this.flashAt;
    let e=0;
    if(u>=0&&u<1.25){
      e=Math.exp(-u*7)*(.6+.4*Math.cos(u*48));
      if(u>.13&&u<.42)e=Math.max(e,Math.exp(-(u-.13)*13)*.95);
      if(u>.3&&u<.62)e=Math.max(e,Math.exp(-(u-.3)*16)*.55);
    }
    e*=this.flashPower;
    this.flash.position.copy(pos);
    this.flash.visible=!inside&&e>.004;
    this.flash.material.opacity=e*.5;
    this.flashLight.position.set(pos.x+180,pos.y+420,pos.z+120);
    this.flashLight.target.position.set(pos.x,pos.y,pos.z);
    this.flashLight.target.updateMatrixWorld();
    this.flashLight.intensity=e*(inside?3.2:26);
    this.bolt.visible=!inside&&e>.02;
    this.bolt.material.opacity=e*.9;
  }
  dispose(){
    this.sky.geometry.dispose();this.sky.material.dispose();
    this.rain.geometry.dispose();this.rain.material.dispose();
    this.map.dispose();this.veil.dispose();
    this.flash.geometry.dispose();this.flash.material.dispose();
    this.boltMap.dispose();this.bolt.material.dispose();
    this.flashLight.dispose();
  }
}
