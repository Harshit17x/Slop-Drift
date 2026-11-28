// Architecture is authored in local metres. x follows the street and positive z
// runs into the property, so entrances always face the approaching driver.
export function buildLandmarks(world,place,registerSign,obstacles,beam) {
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
      case 'rail': {
        // The station faces the road, but the abandoned train is parked on the
        // near side of the platform so the driver actually sees it: road, then
        // rails and rusted carriages, then the platform and the station.
        const local=(x,z)=>({X:p.x+p.tx*x+p.rx*z*side,Z:p.z+p.tz*x+p.rz*z*side});
        const groundAt=(x,z)=>{const q=local(x,z);return world.heightAt(q.X,q.Z);};
        const placeLocal=(key,x,y,z,w,h,d,turn=0)=>place(key,local(x,z).X,p.y+y,local(x,z).Z,w,h,d,yaw+turn);
        const trackZ=-9.5;
        const railY=x=>p.y+.45+x*.035;

        // Forecourt, building, platform and canopy.
        part('slab',0,-.01,1,46,.12,16);
        part('stone',0,-.55,3,32,2.2,8);
        solid('wall0',0,3.1,30,6.2,7.5);
        part('roof',0,6.65,3,32,2.6,8.6);
        for(const x of [-9,-4.5,4.5,9])part('iron',x,2.2,-5.55,.18,4.4,.18);
        part('trainWindow',0,1.6,-.82,3.2,3.1,.12);
        part('trainWindow',-8,3.05,-.82,2.4,1.8,.12);
        part('trainWindow',8,3.05,-.82,2.4,1.8,.12);
        part('window',-8,3.05,-.92,2.1,1.5,.06);
        plaque(0,5.3,-.95,11);
        part('clock',0,4.35,-1,1.5,1.5,.12);
        part('stone',0,.05,-5,48,1.7,6);
        part('slab',0,.98,-5,48,.18,6);
        part('roof',0,4.7,-5,40,.35,7.2);
        for(const x of [-14,-7,7,14])part('iron',x,2.35,-6.9,.2,4.7,.2);
        for(const x of [-12,0,12])part('trainLamp',x,4.05,-5,.3,.45,.3);
        // One lamp hangs over the track edge, where the driver can see it and
        // it can throw light onto the rusted carriage roofs.
        part('iron',0,4.42,-8.2,.06,.55,.06);
        part('trainLamp',0,4.02,-8.2,.34,.5,.34);
        // A gate lamp by the road lights the carriage sides from the front.
        part('iron',-2,1.65,-12.2,.14,3.3,.14);
        part('iron',-2,3.25,-12.2,.5,.1,.1);
        part('trainLamp',-2,3.02,-12.2,.34,.5,.34);
        for(const x of [-6,6]){
          part('wood',x,1.28,-4.1,3,.12,.6);
          part('wood',x,1.72,-3.85,3,.5,.1);
        }
        // Ivy and grass reclaim the platform.
        for(const [x,z,h] of [[-13,-.9,2.6],[-5,-.9,3.2],[7,-.9,2.2],[13,-.9,3.6],[-17,-7.2,2.8],[17,-7.2,3.1]])
          placeLocal('vine',x,1.2+h*.5,z,.35,h,.12);
        for(const [x,z,s] of [[-18,-6.2,1.8],[-11,-3.4,1.4],[3,-3.1,1.9],[15,-5.4,1.6],[20,-3.6,2.1],[-22,-3.2,1.7]])
          placeLocal('scrub',x,groundAt(x,z)-p.y,z,s,s*.8,s);
        for(const [x,z,h] of [[-40,7,9],[28,20,11],[-26,23,8],[38,9,10]]){
          const q=local(x,z);place('willow',q.X,world.heightAt(q.X,q.Z),q.Z,h*.8,h,h*.8,yaw);
        }
        // A small goods shed on the far platform end.
        part('wall3',22,2.1,9,5.2,4.2,4.6);
        part('roof',22,4.35,9,5.8,1.2,5.2);
        part('trainWindow',22,2.4,6.65,1.6,1.2,.1);

        // Ballast, sleepers and rails follow the hillside grade.
        for(let x=-43;x<=43;x+=3.2)placeLocal('slab',x,railY(x)-p.y-.32,trackZ,3.4,.55,4.1,yaw);
        for(let x=-42;x<=42;x+=1.3)placeLocal('wood',x,railY(x)-p.y+.02,trackZ,.26,.12,2.7,yaw);
        for(const z of [trackZ-.75,trackZ+.75]){
          const a=local(-42,z),b=local(42,z);
          beam('iron',{x:a.X,y:railY(-42)+.12,z:a.Z},{x:b.X,y:railY(42)+.12,z:b.Z},.075);
        }

        // Locomotive and three carriages, rusted solid under the ivy.
        const locoX=14;
        const train=(x,y,z,w,h,d,key='trainBody')=>placeLocal(key,x,y-p.y,z,w,h,d,yaw);
        train(locoX,railY(locoX)+1.45,trackZ,10.5,2.2,2.7);
        train(locoX-4.5,railY(locoX)+2.0,trackZ,3.4,2.8,2.8);
        train(locoX-4.5,railY(locoX)+3.5,trackZ,3.8,.25,3.0,'trainRoof');
        train(locoX+.2,railY(locoX)+1.85,trackZ,7.5,1.8,1.8,'boiler');
        train(locoX+3.5,railY(locoX)+3.4,trackZ,.55,1.3,.55,'stack');
        train(locoX-1,railY(locoX)+2.9,trackZ,1.1,1.1,1.1,'dome');
        train(locoX+5.6,railY(locoX)+.7,trackZ,1.2,.8,2.7);
        for(const x of [locoX-4,locoX-1,locoX+2])for(const sideWheel of [-1,1])
          placeLocal('trainWheel',x,railY(x)+.55-p.y,trackZ+sideWheel*1.35,1.1,1.1,.24,yaw);
        const cars=[[-3,12.5],[-17,12.5],[-31,12.5]];
        for(const [cx,len] of cars){
          train(cx,railY(cx)+1.95,trackZ,len,2.4,2.6);
          train(cx,railY(cx)+3.3,trackZ,len+.3,.3,2.8,'trainRoof');
          train(cx,railY(cx)+.95,trackZ,len-1,.35,2.3);
          for(const bx of [cx-4.2,cx+4.2])for(const sideWheel of [-1,1])
            placeLocal('trainWheel',bx,railY(bx)+.48-p.y,trackZ+sideWheel*1.35,.95,.95,.22,yaw);
          for(const sideWin of [-1,1])for(let wx=cx-4.6;wx<=cx+4.6;wx+=2.3)
            placeLocal('trainWindow',wx,railY(wx)+2.35-p.y,trackZ+sideWin*1.34,1.2,.9,.06,yaw);
          for(const [vx,vz,vh] of [[cx-5.2,-1.32,2.4],[cx+1.1,1.32,2.9],[cx+4.9,-1.32,2.1]])
            placeLocal('vine',vx,railY(vx)+1.5-p.y,trackZ+vz,.32,vh,.1,yaw);
          for(const [sx,sz,ss] of [[cx-6.4,trackZ-2.1,1.4],[cx+5.9,trackZ+2.2,1.7],[cx-.2,trackZ+2.4,1.2]])
            placeLocal('scrub',sx,railY(sx)-.05-p.y,sz,ss,ss*.75,ss,yaw);
          for(let ox=cx-len*.42;ox<=cx+len*.42;ox+=2.1){
            const q=local(ox,trackZ);obstacles.push(q.X,q.Z,1.55);
          }
        }
        for(let ox=locoX-5;ox<=locoX+6;ox+=2){const q=local(ox,trackZ);obstacles.push(q.X,q.Z,1.55);}
        for(const ox of [-9.8,-23.8]){const q=local(ox,trackZ);obstacles.push(q.X,q.Z,.8);}

        // Bones on the platform and a pumpkin by the door.
        placeLocal('skull',-3,1.15,-4.7,.3,.34,.27);
        placeLocal('bone',-2.2,1.12,-4.5,.4,.07,.12);
        placeLocal('pumpkin',4,1.24,-3.4,.7,.5,.7);
        break;
      }
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
