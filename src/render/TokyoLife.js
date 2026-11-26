import * as T from 'three';

export class TokyoLife {
  constructor(city){
    const box=new T.BoxGeometry(1,1,1);
    this.geometry=box;this.group=new T.Group();city.group.add(this.group);
    const train=this.train=new T.Group();this.group.add(train);
    const f=city.world.roads[0].frameAt(1690,{});
    this.origin=new T.Vector3(f.x,15.8,f.z);this.axis=new T.Vector3(f.rx,0,f.rz);
    train.rotation.y=Math.atan2(-f.rz,f.rx);
    const put=(parent,x,y,z,w,h,d,mat)=>{
      const m=new T.Mesh(box,mat);m.position.set(x,y,z);m.scale.set(w,h,d);parent.add(m);return m;
    };
    const shell=city.material({color:0xb7c1cc,roughness:.45,metalness:.4});
    const windows=city.material({color:0xffe5b4},true),red=city.material({color:0xe7524d},true);
    for(let i=0;i<3;i++){
      put(train,i*12,0,0,11.6,2.7,3.1,shell);
      for(const side of [-1,1]){
        put(train,i*12,-.51,side*1.56,11.6,.22,.06,red);
        for(let k=0;k<6;k++)put(train,i*12-4.5+k*1.8,.37,side*1.57,1.2,.79,.07,windows);
      }
    }
    city.part(f,0,0,13.7,5,1.6,650,city.concrete,0x646b75);
    for(let j=-300;j<=300;j+=36){
      if(Math.abs(j)<15)continue;
      city.part(f,0,j,6.6,2.1,13.2,2.5,city.concrete,0x767d85);
    }
    // Repeating route-access lamps cycle safely above the footpath.
    this.signals=[];
    const green=city.material({color:0x5cffa8},true);
    for(const s of [35,460,1610]){
      const f=city.world.roads[0].frameAt(s,{});
      city.part(f,0,-11,3.2,.2,6.4,.2,city.steel);
      city.part(f,0,-8.4,6.3,.18,.18,5.4,city.steel);
      city.part(f,0,-6.1,6.1,.36,.68,1.7,city.concrete,0x343b43);
      const lamp=put(this.group,f.x-6.1*f.rx+.22*f.tx,6.1,f.z-6.1*f.rz+.22*f.tz,.38,.37,.35,green);
      this.signals.push(lamp);
    }
    this.green=green;
    // Reuse a local crowd pool. Walkers turn at shop boundaries and remain
    // on the pavement even when the racing surface branches nearby.
    this.walks=city.walks;
    this.walkCount=42;this.person=new T.Object3D();
    this.clothes=city.material({color:0xffffff,roughness:.87});
    this.walkerShape=new T.SphereGeometry(.5,8,6);
    this.crowd=new T.InstancedMesh(this.walkerShape,this.clothes,this.walkCount*7);
    this.crowd.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.crowd.frustumCulled=false;this.crowd.count=0;this.group.add(this.crowd);
    this.crowdTick=0;this.tint=new T.Color();
    const taxiPaint=city.material({color:0x244851,roughness:.37,metalness:.55});
    const glass=city.material({color:0x293d52,roughness:.17,metalness:.5});
    this.cabs=[];
    // Service streets have two lanes. Turn inside the setbacks at their ends.
    for(const road of city.world.roads.filter(r=>r.name==='District link')){
      const cab=new T.Group();this.group.add(cab);
      const hull=new T.Mesh(city.kit.geometries.body,taxiPaint);
      hull.scale.set(4.45,.69,1.81);hull.position.y=.21;cab.add(hull);
      const roof=new T.Mesh(city.kit.geometries.coupe,glass);
      roof.scale.set(2.65,.69,1.62);roof.position.set(-.14,.84,0);cab.add(roof);
      put(cab,-.08,1.58,0,.41,.16,.31,windows);
      for(const side of [-1,1]){
        put(cab,2.2,.64,side*.62,.08,.16,.36,windows);
        put(cab,-2.2,.61,side*.62,.08,.15,.33,red);
        for(const x of [-1.36,1.32]){
          const tire=new T.Mesh(city.kit.geometries.wheel,glass);
          tire.scale.set(.62,.62,.19);tire.position.set(x,.32,side*.86);cab.add(tire);
        }
      }
      cab.visible=false;
      this.cabs.push({cab,road,phase:road.length*.32,frame:{}});
    }
    const points=[];
    for(let i=0;i<230;i++){
      const x=city.rand()*38-19,y=city.rand()*17,z=city.rand()*38-19;
      points.push(x,y,z,x-.05,y+.55,z+.05);
    }
    this.rainGeometry=new T.BufferGeometry();this.rainGeometry.setAttribute('position',new T.Float32BufferAttribute(points,3));
    this.rainMaterial=new T.LineBasicMaterial({color:0xb2d6ff,transparent:true,opacity:.24,depthWrite:false});
    this.rain=new T.LineSegments(this.rainGeometry,this.rainMaterial);this.rain.visible=false;this.group.add(this.rain);
    this.clock=0;
  }
  pedestrians(p,wet){
    const mesh=this.crowd, model=this.person;
    let i=0;
    const put=(x,y,z,w,h,d,yaw,tint)=>{
      model.position.set(x,y,z);model.rotation.y=yaw;model.scale.set(w,h,d);model.updateMatrix();
      mesh.setMatrixAt(i,model.matrix);mesh.setColorAt(i++,this.tint.setHex(tint));
    };
    for(let k=0;k<this.walks.length&&i<7*this.walkCount;k++){
      const {f,side,span}=this.walks[k];
      if((f.x-p.x)**2+(f.z-p.z)**2>110**2||Math.abs(f.y-p.y)>14)continue;
      const phase=(this.clock*.72+k*3.17)%(4*span),dir=phase<2*span?1:-1;
      const u=phase<2*span?phase-span:3*span-phase;
      const x=f.x+u*f.tx+side*f.rx,z=f.z+u*f.tz+side*f.rz,y=f.y+.16;
      const yaw=Math.atan2(-dir*f.tz,dir*f.tx),stride=Math.sin(this.clock*4.5+k)*.16;
      const cloth=[0x813f48,0x36526c,0xba9672,0x405e56,0x49404f][k%5];
      for(const leg of [-1,1])put(x+f.tx*leg*stride+f.rx*leg*.1,y+.4,z+f.tz*leg*stride+f.rz*leg*.1,.23,.83,.18,yaw,0x353943);
      put(x,y+1.07,z,.35,.79,.48,yaw,cloth);
      put(x,y+1.54,z,.25,.32,.24,yaw,0xbd947e);
      put(x-.025*f.tx,y+1.63,z-.025*f.tz,.26,.19,.26,yaw,0x302c30);
      put(x+.27*f.rx,y+.77,z+.27*f.rz,.23,.30,.16,yaw,0x8d7460);
      if(wet)put(x,y+1.94,z,.97,.13,.91,yaw,cloth);
      else put(x-.24*f.rx,y+1.03,z-.24*f.rz,.17,.46,.13,yaw,cloth);
    }
    mesh.count=i;mesh.instanceMatrix.needsUpdate=true;
    if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  }
  update(dt,p,wet,inside,roam,driver){
    if(this.clock>=this.crowdTick||dt===0){
      this.crowdTick=this.clock+.08;
      if(inside)this.crowd.count=0;else this.pedestrians(p,wet);
    }
    for(const car of this.cabs){
      const {road,cab}=car;
      cab.visible=false;
      if(!roam)continue;
      const radius=2.3,arc=Math.PI*radius,straight=road.length-80,period=2*(straight+arc);
      if(straight<15)continue;
      const t=car.phase%period,returning=t>=straight+arc;
      const u=returning?t-straight-arc:t,dir=returning?-1:1;
      const turn=Math.max(0,(u-straight)/radius);
      const progress=Math.min(u,straight)+radius*Math.sin(turn);
      const f=road.frameAt(returning?road.length-40-progress:40+progress,car.frame);
      const lane=-dir*radius*Math.cos(turn);
      cab.position.set(f.x+lane*f.rx,f.y+.04,f.z+lane*f.rz);
      cab.rotation.y=Math.atan2(-dir*f.tz,dir*f.tx)-turn;
      cab.visible=cab.position.distanceToSquared(p)<240*240;
      const dx=driver.x-cab.position.x,dz=driver.z-cab.position.z;
      if(dx*dx+dz*dz>7*7 || dx*Math.cos(cab.rotation.y)-dz*Math.sin(cab.rotation.y)<0)
        car.phase+=dt*8;
    }
    this.clock+=dt;
    this.train.position.copy(this.origin).addScaledVector(this.axis,(this.clock*17)%565-282);
    this.train.visible=this.origin.distanceToSquared(p)<620**2;
    this.green.color.setHex(this.clock%16<8?0x5fffa4:this.clock%16<10?0xffb53b:0xff4139);
    this.rain.visible=wet&&!inside;
    if(this.rain.visible)this.rain.position.set(p.x,p.y-3-(this.clock*10)%3,p.z);
  }
  dispose(){this.crowd.dispose();this.walkerShape.dispose();this.geometry.dispose();this.rainGeometry.dispose();this.rainMaterial.dispose();}
}
