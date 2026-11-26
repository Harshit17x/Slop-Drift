import * as T from 'three';
import {ApexWoodland} from './ApexWoodland.js';
import {MeshBuffer} from './road/MeshBuffer.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {finishPaddock,crewModel} from './apexFacilities.js';
import {ApexKit} from './ApexKit.js';
import {createRandom} from '../world/noise.js';

const IVORY=0xd5d3c9, STEEL=0x889498, DARK=0x253238, GLASS=0x456472, RED=0xb9362d, INK=0x252a2b;
const teams=[RED,0x235569,0xd19a32,0x347364,0x664e64];
const seats=[0x92281f,0xc1c1b8,0x888c8a,0x662a24];
const shirts=[0x455b70,0xba543a,0xafb1a4,0x4c4d46,0xd1ac64,0x314443];
function local(kit,f){
  const flat=Math.hypot(f.tx,f.tz),tx=f.tx/flat,tz=f.tz/flat,rx=-tz,rz=tx;
  const yaw=Math.atan2(-tz,tx);
  const p=(u,v,h)=>new T.Vector3(f.x+tx*u+rx*v,f.y+h,f.z+tz*u+rz*v);
  const block=(u,v,h,l,d,ht,color,kind='stone',shape='box',roll=0)=>{
    const q=p(u,v,h);kit.instance(kind,shape,q.x,q.y,q.z,l,ht,d,yaw,color,roll);
  };
  const beam=(u,v,h,U,V,H,w,c)=>kit.beam(p(u,v,h),p(U,V,H),w,c);
  // A sign faces oncoming traffic by default. Side-facing facades face the lane.
  const sign=(label,u,v,h,w,ht,face='traffic',style='dark')=>{
    const n=face==='traffic'?{x:-tx,z:-tz}:face==='right'?{x:rx,z:rz}:{x:-rx,z:-rz};
    kit.sign(label,p(u,v,h),n,w,ht,style);
  };
  return {p,block,beam,sign};
}
function stand(kit,frame,side,rows,bays,random){
  const {block,beam}=local(kit,frame),width=bays*6,run=1.02,rise=.53;
  for(let row=0;row<rows;row++){
    const v=side*(row*run),h=row*rise;
    block(0,v,h-.18,width,1.08,.40,0xa6a69d);
    for(let bay=0;bay<bays;bay++){
      const origin=(bay+.5)*6-width/2;
      for(let j=-2;j<=2;j++){
        const u=origin+j*.9,c=seats[(Math.floor(bay/2)+Math.floor(row/3))%seats.length];
        block(u,v,h+.14,.57,.45,.22,c);
        block(u,v+side*.18,h+.32,.57,.11,.29,c);
        if(random()>.70)continue;
        const skin=random()>.5?0xc6a288:0x9a7058;
        block(u,v,h+.49,.40,.28,.51,shirts[Math.floor(random()*shirts.length)],'crowd','ball');
        block(u,v,h+.83,.24,.22,.27,skin,'crowd','ball');
      }
    }
  }
  const back=side*(rows*run+.5),top=rows*rise+4.6;
  block(0,side*(rows*.5),top,width+2,rows+5,.29,0xc4c7c3,'steel');
  block(0,-side*2.5,top-.28,width+2,.35,.69,IVORY,'steel');
  for(let i=0;i<=bays;i+=2){
    const u=i*6-width/2;
    block(u,back,top/2,.29,.39,top,STEEL,'steel');
    beam(u,back,top-2.5,u,-side*2.2,top-.28,.19,STEEL);
    beam(u,back,top-.35,u,side*rows*.4,top-1.2,.13,STEEL);
    if(i<bays)beam(u,back,.2,u+12,back,rows*rise,.16,STEEL);
  }
}
function transporter(a,u,v,c){
  const {block}=a;
  block(u,v,1.94,12.6,2.55,3.1,c,'steel');block(u,v,1.85,12.65,2.59,.24,IVORY);
  block(u+8,v,1.75,2.8,2.5,2.65,IVORY);block(u+8.4,v,2.35,1.75,2.54,.83,GLASS,'glass');
  for(const x of [-4.2,-2.8,5.3,8.3])for(const z of [-1,1])block(u+x,v+z,.53,.95,.4,1.04,INK,'stone','ball');
}
export class ApexPark extends ApexWoodland{
  constructor(options){
    const {world}=options, f=world.apex.main.frameAt(0,{});
    const reserve=world.isReserved.bind(world);
    world.isReserved=(x,z,margin)=>Math.abs(x-f.x)<395+margin && Math.abs(z-f.z)<128+margin || reserve(x,z,margin);
    super(options);
    this.kit=new ApexKit(this.group);this.standsDensity=1;this.park=world.apex;
    const a=local(this.kit,f),{block,sign,beam}=a,rand=createRandom(4271);
    // Apron, 40 open-front garages and glazed upper-level hospitality gallery.
    block(0,51,-.23,364,75,.35,0x626261);
    block(0,36,4.65,325,18,.50,IVORY);
    block(0,43.9,2.3,324,.45,4.55,0x737776);
    block(0,37.3,6.3,324,13.3,2.99,GLASS,'glass');
    block(0,36.5,8.12,327,16.9,.48,0xbfc3c1,'steel');
    block(0,28.2,4.73,327,.36,.9,RED,'steel');
    for(let i=0;i<40;i++){
      const u=-156+i*8,c=teams[Math.floor(i/4)%5],num=String(i+1).padStart(2,'0');
      block(u-3.88,36.4,2.2,.29,17.8,4.6,IVORY);block(u,42.4,2.1,7.5,.28,4.1,0x414749);
      block(u+2.6,40.8,.67,1.65,.85,1.26,c,'steel');block(u+2.5,40.8,1.34,1.84,.96,.13,STEEL);
      for(let t=0;t<3;t++)block(u-2.6,39.7,.18+t*.31,.91,.91,.28,INK,'stone','tube');
      block(u,34.8,4.29,4.7,.19,.13,0xf4e4bf,'lamp');block(u,28.8,4.08,7.6,.35,.75,c);
      sign(num,u,28.56,4.08,2.1,.63,'left','dark');
      block(u,30.58,6.4,.16,.25,3,IVORY,'steel');
      block(u,28.1,5.24,7.93,.10,.12,STEEL,'steel');block(u-3.8,28.1,5.00,.11,.12,.7,STEEL,'steel');
      block(u+3.5,24.2,.038,.11,6.6,.04,0xe4cf87);
      block(u,27.4,.038,7.0,.13,.04,0xe4cf87);
      if(i%4===0)transporter(a,u,62,c);
    }
    // Pit wall with openings at pit entry and exit, timing desks, grid markings.
    block(-5,9.25,.59,438,.70,1.18,0xc5c2b8);
    for(let i=0;i<20;i++){
      const u=-175+i*18;
      block(u,10.8,1.54,5.1,1.65,.2,IVORY,'steel');block(u,10.8,2.7,5.65,2.2,.18,DARK);
      for(const d of [-2,2])block(u+d,11.4,1.72,.13,.13,1.92,STEEL);
      block(u,10.4,1.92,1.5,.25,.69,GLASS,'glass');
      for(let m=0;m<2;m++){
        const side=m===0?-3:3,grid=-12-i*8-m*4;
        block(grid,side,.058,.16,2.7,.02,IVORY);
        block(grid-1,side-1.3,.058,2.1,.12,.02,IVORY);block(grid-1,side+1.3,.058,2.1,.12,.02,IVORY);
      }
    }
    for(let j=-14;j<14;j++)for(let k=0;k<2;k++)block(k*.5,j*.5+.25,.053,.50,.5,.028,(j+k)%2===0?IVORY:INK);
    block(0,-10,4.55,.65,.65,9.1,STEEL,'steel');block(0,10,4.55,.65,.65,9.1,STEEL,'steel');
    block(0,0,8.15,1.4,22,2.15,DARK,'steel');sign('APEX   GRAND PRIX',-.73,0,8.15,18.5,1.98);
    this.startLights=[];
    for(let i=0;i<5;i++){
      block(0,(i-2)*.76,6.59,.45,.67,1.02,INK);
      const l=new T.Mesh(new T.SphereGeometry(.19,10,7),new T.MeshBasicMaterial({color:0x372220}));
      l.position.copy(a.p(-.29,(i-2)*.76,6.58));this.group.add(l);this.startLights.push(l);
    }
    for(let j=0;j<6;j++)stand(this.kit,this.offset(f,-122+j*51,-19,0),-1,13,8,rand);
    const m=world.apex.main;
    for(const station of [41.7,42.4,43.5,44.2]){
      const k=Math.floor(station),s=world.apex.stations[k]+(station-k)*(world.apex.stations[k+1]-world.apex.stations[k]);
      const q=m.frameAt(s,{}),side=-Math.sign(q.curvature)||1;stand(this.kit,this.offset(q,0,side*34,0),side,8,5,rand);
    }
    // Control and medical facilities, paddock entries, technical and media compounds.
    for(const [u,v,title] of [[-202,36,'RACE CONTROL'],[189,38,'MEDICAL CENTRE'],[157,92,'SCRUTINEERING'],[-73,93,'MEDIA CENTRE'],[60,93,'PARC FERME']]){
      const tower=title==='RACE CONTROL',h=tower?12:5;
      block(u,v,h/2,36,13,h,IVORY);block(u,v,h-.9,38,14.4,2.7,GLASS,'glass');
      block(u,v,h+.62,39,15.4,.41,DARK,'steel');
      sign(title,u,v-7.31,h-1.05,22,1.77,'left',title==='MEDICAL CENTRE'?'green':'dark');
      for(let j=-16;j<18;j+=4)block(u+j,v-7.26,h-1,.17,.17,2.78,STEEL,'steel');
      if(tower){block(u+12,v,h+4,.16,.16,7.5,STEEL);block(u+12,v,h+7.8,.29,.29,.29,RED,'lamp');}
    }
    sign('PIT ENTRY',-273,12.8,2.5,5,1.15,'traffic','green');sign('PIT EXIT',217,12,2.4,4,1,'traffic','green');
    for(let u=-211;u<=220;u+=24){
      for(let v=9.6;v>=-16;v-=25.6){
        block(u,v,2.28,.12,.12,3.4,STEEL,'steel');
        for(let h=2;h<4.1;h+=.45)beam(u,v,h,u+24,v,h,.032,STEEL);
        for(let k=1;k<24;k+=2)beam(u+k,v,1.1,u+k,v,3.85,.028,STEEL);
      }
    }
    for(let i=0;i<9;i++){
      const u=-130+i*32;block(u,76,2.9,8.5,7,.36,teams[i%5]);
      for(const d of [-4,4])for(const v of [73,79])block(u+d,v,1.45,.12,.12,2.9,STEEL);
    }
    for(let i=0;i<16;i++){
      const q=m.frameAt(i*m.length/16+130,{}),b=local(this.kit,q),side=q.curvature>0?-1:1;
      b.block(0,side*19,1.4,3.6,2.4,2.8,0xb2aca0);b.block(0,side*19,2.2,3.66,2.48,.8,GLASS,'glass');b.block(0,side*19,3,4.4,3.4,.24,DARK);
      b.sign('MP  '+String(i+1).padStart(2,'0'),-1.84,side*19,1.1,2.1,.82);
    }
    for(const {name,start,end} of world.apex.sections){
      const f=m.frameAt(start-12,{}),b=local(this.kit,f),side=-Math.sign(m.frameAt((start+end)/2,{}).curvature)||1;
      b.block(0,side*17,1.65,.25,.27,3.3,STEEL);b.sign(name.toUpperCase(),-.2,side*17,2.6,5.7,1.16);
      for(const d of [150,100,50]){
        const g=local(this.kit,m.frameAt(start-d,{}));g.block(0,side*11,1,.12,.12,2,STEEL);
        g.sign(String(d),-.1,side*11,1.68,1.75,.94,'traffic','white');
      }
    }
    const br=m.frameAt(world.apex.bridge,{}),b=local(this.kit,br);
    b.block(0,0,-1.02,89,16.6,1.85,0x929591);
    for(const v of [-8.2,8.2]){
      b.block(0,v,.72,89,.38,1.43,IVORY);
      for(const u of [-32,32])b.block(u,v*.72,-5.4,1.8,1.9,9.2,0x93918b);
    }
    for(const u of [-245,-151,-55,45,145,235]){
      const v=-37;block(u,v,9,.21,.21,18,STEEL,'steel');beam(u,v,17,u,v+3,18.1,.2,STEEL);
      block(u,v+3,18.1,2.4,1.08,.42,DARK);block(u,v+3,17.85,2.23,.95,.11,0xffe5bd,'lamp');
    }
    finishPaddock(a,this.kit,rand);this.crew=crewModel();this.group.add(this.crew);
    this.facades(a);
    this.makeTimingBoard(a);
    this.lights=[-120,0,120].map(u=>{const l=new T.PointLight(0xffebd4,4100,115,1.65);l.position.copy(a.p(u,6,14));this.group.add(l);return l;});
    this.kit.finish();this.setQuality(options.quality);
    const pos=a.p(178,-25,0);
    this.towerReady=new GLTFLoader().loadAsync(new URL('../assets/maps/apex-pylon.glb',import.meta.url).href).then(({scene})=>{
      this.pylon=scene;scene.position.copy(pos);scene.rotation.y=Math.PI/2;
      scene.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});this.group.add(scene);
    });
  }
  makeTimingBoard(a){
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=480;
    this.boardCtx=canvas.getContext('2d');this.boardMap=new T.CanvasTexture(canvas);this.boardMap.colorSpace=T.SRGBColorSpace;
    this.board=new T.Mesh(new T.PlaneGeometry(3.99,12.2),new T.MeshBasicMaterial({map:this.boardMap,side:T.DoubleSide}));
    this.board.position.copy(a.p(176.91,-25,17));this.board.rotation.y=Math.PI/2;this.group.add(this.board);
    this.timing(0,0,0);
  }
  timing(elapsed,lap,pos){
    const second=Math.floor(elapsed),key=second+'-'+lap+'-'+pos;if(key===this.boardKey)return;this.boardKey=key;
    const ctx=this.boardCtx;ctx.fillStyle='#151817';ctx.fillRect(0,0,160,480);ctx.textAlign='center';
    for(const [s,v,y] of [['APEX','GP',47],['LAP',lap||'—',178],['POS',pos||'—',305]]){
      ctx.font='bold 27px Arial';ctx.fillStyle='#e3e0d4';ctx.fillText(s,80,y);ctx.font='bold 63px monospace';ctx.fillStyle='#f9ad48';ctx.fillText(v,80,y+65);
    }
    ctx.font='bold 39px monospace';ctx.fillStyle='#e4b56e';ctx.fillText(Math.floor(second/60)+':'+String(second%60).padStart(2,'0'),80,451);this.boardMap.needsUpdate=true;
  }
  pitCrew(service){
    this.crew.visible=service?.phase==='service';
    if(!this.crew.visible)return;
    const p=service.box;this.crew.position.set(p.x,p.y,p.z);this.crew.rotation.y=Math.PI/2;
    for(let i=0;i<4;i++)this.crew.children[i].scale.y=.66+.18*(1+Math.sin(service.elapsed*4+i));
  }
  facades(a){
    const atlas=new T.TextureLoader().load(new URL('../assets/maps/apex-garages.webp',import.meta.url).href);
    atlas.colorSpace=T.SRGBColorSpace;atlas.anisotropy=4;
    const buf=new MeshBuffer({uvs:true});
    function panel(u,v,y,w,h,cell){
      const points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([dx,dy])=>{
        const p=a.p(u-dx*w/2,v,y+dy*h/2);
        return buf.vertex(p.x,p.y,p.z,(cell%2+.006+(dx+1)*.494)*.5,(1-Math.floor(cell/2)+.006+(dy+1)*.494)*.5);
      });buf.quad(...points);
    }
    for(let i=0;i<40;i++){const u=-156+8*i;panel(u,42.20,2.12,7.46,4.02,i%2);panel(u,30.60,6.31,7.84,2.85,2);
      if(i%9===2)panel(u,31.1,1.95,7.62,3.85,3);
    }
    this.garageSkin=new T.Mesh(buf.build(),new T.MeshStandardMaterial({map:atlas,side:T.DoubleSide,roughness:.70,emissiveMap:atlas,emissive:0xf1cf9a,emissiveIntensity:.12}));
    this.garageSkin.receiveShadow=true;this.group.add(this.garageSkin);
  }
  offset(f,u,v,h){
    const q=local(this.kit,f).p(u,v,h);
    return {...f,x:q.x,y:q.y+v*f.bank,z:q.z};
  }
  setQuality(q){super.setQuality(q);this.density=Math.min(1,q?.trees??1);this.kit?.crowd(this.density*(this.standsDensity??1));}
  setEvent(race){this.standsDensity=race?1:.37;this.kit.crowd(this.density*this.standsDensity);}
  setSignals(state,countdown){this.startLights.forEach((m,i)=>m.material.color.setHex(state==='countdown' && i<Math.ceil((3.5-countdown)*1.5)?0xff2b15:0x38292a));}
  update(view,dt,night,car,camera){super.update(view,dt,night,car,camera);for(const l of this.lights)l.visible=!!night;this.garageSkin.material.emissiveIntensity=night?.9:.12;}
  dispose(){this.board.geometry.dispose();this.board.material.dispose();this.boardMap.dispose();this.crew.userData.dispose();this.pylon?.traverse(n=>{if(n.isMesh){n.geometry.dispose();for(const mat of [].concat(n.material))mat.dispose();}});this.garageSkin.geometry.dispose();this.garageSkin.material.map.dispose();this.garageSkin.material.dispose();this.kit.dispose();for(const l of this.startLights){l.geometry.dispose();l.material.dispose();}super.dispose();}
}

