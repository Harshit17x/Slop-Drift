// Architecture is authored in local metres. x follows the street and positive z
// runs into the property, so entrances always face the approaching driver.
export function buildLandmarks(world,place,registerSign,obstacles) {
  for(const p of Object.values(world.sites)){
    const side=Math.sign(p.offset), yaw=Math.atan2(p.rx,p.rz);
    const part=(key,x,y,z,w,h,d,turn=0)=>{
      const X=p.x+p.tx*x+p.rx*z*side,Z=p.z+p.tz*x+p.rz*z*side;
      place(key,X,p.y+y,Z,w,h,d,yaw+turn);
    };
    const solid=(key,x,z,w,h,d)=>{
      part(key,x,h*.5,z,w,h,d);
      const n=Math.max(1,Math.round(w/d));
      for(let i=0;i<n;i++)obstacles.push(p.x+p.tx*w*((i+.5)/n-.5)+p.tx*x+p.rx*z*side,
        p.z+p.tz*w*((i+.5)/n-.5)+p.tz*x+p.rz*z*side,Math.min(w/n,d)*.44);
    };
    const posts=(width,depth,h)=>{
      for(const x of [-width,width])for(const z of [-depth,depth])part('iron',x,h/2,z,.28,h,.28);
    };
    const plaque=(x,y,z,w=7)=>part(registerSign(p.name.toUpperCase()),x,y,z,w,1.05,.15);
    switch(p.id){
      case 'garage':
        solid('wall3',0,5.9,16,5,2);
        for(const x of [-7.4,7.4])part('wall3',x,2.5,0,.85,5,12);
        part('roof',0,5,0,16.3,1.9,13);part('lamp',-2,4.4,-4,2.3,.12,.22);
        part('wood',-4,1,3,4,.15,1.2);part('iron',5,.6,3,1.5,1.2,1);
        plaque(0,4.6,-6);break;
      case 'fuel':
        posts(6.6,3.2,5);part('paint',0,5,0,17,.65,9);
        solid('wall1',0,12,15,4.5,6);plaque(0,5.1,-4.6);
        for(const x of [-4,3]){
          part('stone',x,.16,0,2.5,.32,1.4);part('paint',x,1,0,.94,1.8,.75);
          part('iron',x,1.45,-.4,.7,.48,.07);part('lamp',x,1.5,-.45,.47,.12,.02);
        }break;
      case 'church':
        solid('wall2',0,3,10,8,20);part('roof',0,8,3,11.3,5,21.2);
        solid('wall2',0,-8,5,14,5);part('spire',0,17,-8,7,8,7);
        part('iron',0,21.7,-8,.16,2,.16);part('iron',0,22,-8,1.1,.15,.16);
        for(let i=0;i<14;i++)part('stone',9+(i%3)*2, .6, -7+Math.floor(i/3)*2,.72,1.2,.3);
        plaque(8,1.7,-8);break;
      case 'rail':
        solid('wall0',0,4,25,4.8,5);part('roof',0,4.9,2,28,2.7,10);
        for(let x=-12;x<=12;x+=4)part('wood',x,2,-2.7,.18,4,.18);
        part('stone',0,.26,-1,38,.5,7);
        for(const z of [-6,-7.5])part('iron',0,.14,z,65,.17,.13);
        for(let x=-32;x<32;x+=1.25)part('wood',x,.02,-6.75,.26,.1,2.4);
        for(const x of [-.5,.5])part('trainLamp',26+x,2.4,-6.75,.26,.24,.26);
        plaque(0,3.2,-3);break;
      case 'hospital':
        solid('wall1',0,4,30,12,9);solid('wall2',-10,-2,8,15,7);
        part('roof',-10,15,-2,9,3,8);part('stone',3,3,-2,9,.45,5);
        posts(5,3,3);part('window',6,9,-.59,1.8,1.7,.1);plaque(3,3.6,-4);break;
      case 'mine':
        for(let i=0;i<9;i++){
          const f=world.roads[9].frameAt(world.roads[9].length*.58+i*3,{});
          const angle=Math.atan2(f.tx,f.tz);
          for(const sign of [-1,1])place('wood',f.x+sign*4.4*f.rx,f.y+2.4,f.z+sign*4.4*f.rz,.45,4.8,.56,angle);
          place('wood',f.x,f.y+4.8,f.z,9.5,.55,.6,angle);
          if(i<8)place('stone',f.x,f.y+5.55,f.z,11,1.05,3.6,angle);
        }
        plaque(0,3.5,0);part('wood',0,1.8,0,.28,3.6,.28);break;
      case 'factory':
        // Open street-facing loading bay with a clear 44 x 33 metre sliding floor.
        part('slab',0,.01,0,46,.08,35);
        part('roof',0,9,0,48,3,37);solid('wall3',0,18,48,9,1.4);
        for(const x of [-23,23]){
          part('wall3',x,5,4,1,8,27);
          for(let z=-16;z<=16;z+=8)part('iron',x,4.5,z,.55,9,.55);
        }
        for(let x=-21;x<=21;x+=7){
          part('iron',x,8.7,0,.26,.45,35);part('lamp',x,8.35,-4,1.6,.09,.19);
        }
        solid('wall3',26,16,3.6,22,3.6);plaque(0,8.6,-17.8);break;
      case 'wharf':
        for(let j=0;j<32;j++){
          part('wood',0,0,j*.66,3.35,.23,.63);
          if(j%4===0)for(const x of [-1.4,1.4])part('wood',x,-.65,j*.66,.22,3,.22);
        }
        solid('wall0',14,-6,7,4,7);part('roof',14,4,-6,8,2,8);plaque(14,3,-9.7);break;
    }
  }
}
