// Objects use metres along the street and metres back from the loading apron.
export function buildCreekIndustry(world,place,beam,sign,obstacles){
  for(const d of world.depots){
    const angle=Math.atan2(d.rx,d.rz);
    const pos=(a,b,h=0)=>({x:d.x+a*d.tx+b*d.side*d.rx,y:d.y+h,z:d.z+a*d.tz+b*d.side*d.rz});
    function box(key,a,b,h,w,depth,height,rotation=0){
      const p=pos(a,b,h);place(key,p.x,p.y,p.z,w,height,depth,angle+rotation);
    }
    function strut(key,a,b,h,u,v,k,width){
      beam(key,pos(a,b,h),pos(u,v,k),width);
    }
    const foot=(a,b,r)=>{const p=pos(a,b);obstacles.push(p.x,p.z,r);};
    if(d.id==='tram'){
      // Splayed timber headframe, discharge bin and the pair of hauling cables.
      for(const a of [-5,5])for(const b of [5,13]){
        const topA=a*.68,topB=9+(b-9)*.55;
        strut('wood',a,b,0,topA,topB,14,.48);
        strut('iron',a,b,2,-topA,topB,10,.17);
        foot(a,b,.38);
      }
      box('oxidised',0,9,9.7,8.3,6.4,4);
      box('wood',0,9,13.7,10,6.5,.45);
      for(const a of [-4,4])for(const b of [6.6,11.4])box('wood',a,b,14.6,.22,.22,2);
      box('roof',0,9,15.55,11,7.6,2.2);
      for(const a of [-5.5,5.5]){
        // Stone footings, the hoist ladder and the caged landing.
        for(const b of [5,13])box('setwall',a*.92,b,.28,1.35,1.35,.56);
        strut('iron',a,6,.2,a*.7,6.8,13.7,.09);
        strut('iron',a+.55,6,.2,a*.7+.55,6.8,13.7,.09);
        for(let j=0;j<=24;j++){
          const t=j/24,l=a*(1-.3*t),b=6+.8*t,h=.2+13.5*t;
          strut('iron',l,b,h,l+.55,b,h,.055);
        }
      }
      for(const a of [-3.2,3.2])strut('iron',a,10,14,a+30,42,8,.095);
      for(const a of [-2.8,2.8]){strut('iron',a+15,26,10.9,a+15,26,8.8,.11);box('oxidised',a+15,26,8.1,1.6,1.55,1.4);}
      for(let a=-4;a<=4;a+=2)box('iron',a,5.8,14.35,.09,.09,1.4);
      box('iron',0,5.8,15.02,8,.12,.1);
      box(sign('INCLINE No. 2'),0,5.65,10.3,6,.09,1.1);
      // Second bent supports both cables at the uphill end.
      for(const a of [26.8,33.2])strut('wood',a,42,0,a,42,8.3,.4);
      strut('wood',26,42,8.15,34,42,8.15,.32);
    }else if(d.id==='parcel'){
      box('parcels',0,8,3,14,7.5,6);
      box('roof',0,8,6,15.1,8.4,2.4);
      box('wood',0,2.5,.4,18,3,.7);
      for(const a of [-8,-4,4,8]){
        box('wood',a,2.2,2.2,.18,.18,3.4);
        strut('iron',a,2,3.7,a,4.4,4.7,.14);
      }
      box('oxidised',0,2.8,4.45,18,3.5,.25);
      for(let i=0;i<7;i++)box('crate',-6+i%4*1.35,2.5+Math.floor(i/4)*1.1,1.18,1.15,.95,.95);
      for(const a of [-4,0,4])foot(a,8,3.2);
      // The siding ends at a buffer stop. One four-wheel van remains on it.
      for(let a=-19;a<=19;a+=.85)box('wood',a,15,.07,.21,2.15,.14);
      for(const b of [14.28,15.72])box('iron',0,b,.18,39,.10,.16);
      for(const a of [-4.5,2.5]){
        for(const b of [14.28,15.72])box('wheel',a,b,.61,.76,.18,.76);
        box('iron',a,15,.62,.18,1.6,.18);
      }
      box('iron',-1,15,.98,10,2.55,.32);
      box('oxidised',-1,15,2.37,9.7,2.48,2.5);
      box('roof',-1,15,3.62,2.7,10.1,.40,Math.PI/2);
      for(const b of [13.73,16.27]){
        box('wood',-1,b,2.28,2.55,.09,2.18);
        for(const a of [-5.7,-4.2,-2.4,.4,2.6,3.7])box('iron',a,b,2.33,.09,.12,2.5);
        box('iron',-1,b,3.54,4.85,.14,.10);
      }
      for(const a of [-4,-1,2])foot(a,15,1.5);
      for(const b of [14.28,15.72])strut('iron',18,b,.18,16.6,b,1.32,.17);
      box('wood',16.5,15,1.30,.34,2.6,.29);
      // The depot's old loading gauge hangs over the disused siding.
      strut('iron',10,6,0,10,6,6,.25);strut('iron',10,6,5.9,10,14,5.9,.23);
      box(sign('WEIGH OFFICE'),10,10,5.3,.16,4,.78,Math.PI/2);
    }else if(d.id==='dispenser'){
      box('pharmacy',0,6,2.5,12,6.7,5);box('setwall',0,6,5.15,12.5,7.1,.35);
      for(const a of [-4,0,4])foot(a,6,2.7);
      box('wood',0,1.8,3.5,12.5,2.6,.2);
      for(const a of [-5.6,5.6])box('iron',a,.7,1.7,.11,.11,3.45);
      for(let i=0;i<4;i++)box('crate',4+i%2,1.7+Math.floor(i/2),.43,.8,.74,.86);
      // Green glass cross, caged in iron and hanging perpendicular to the row.
      box('iron',-6,1,4.2,.12,3,.12);
      box('window',-6,.1,3.75,.22,.93,.28);box('window',-6,.1,3.75,.22,.28,.94);
    }else{
      // Rusted chain drums, dock cleats and a grounded ferry landing.
      for(const a of [-5,5]){
        box('setwall',a,2,.25,2.4,2.8,.5);
        box('oxidised',a,2,1.05,1.75,1.6,1.35);foot(a,2,1);
        for(let j=0;j<4;j++)box('iron',a-.69+j*.46,2,1.11,.1,1.82,1.5);
        strut('iron',a,2,1.7,a,10,.45,.078);
      }
      box(sign('FERRY CLOSED'),0,4,2.6,5.2,.12,.92);
      for(const a of [-2,2])box('wood',a,4,1.34,.22,.22,2.68);
    }
    // A lamp beside the logbook is the visual target of the radio dispatch.
    box('iron',1.7,0,1.22,.14,.14,2.44);
    box('lamp',1.7,0,2.48,.32,.32,.35);
  }
}
