import * as T from 'three';

export function finishPaddock(a,kit,random){
  const {block,sign,beam}=a;
  // Roof plant, ducts, walkways, stairs and ventilation plenums break up the roofline.
  for(let i=0;i<13;i++){
    const u=-145+i*24;
    block(u,41.5,8.75,4.2,2.25,.95,0x727b7c,'steel');
    for(const x of [-1.15,1.15])block(u+x,41.5,9.25,1.45,1.45,.12,0x273236,'steel','tube');
    block(u+5,41.7,8.49,6.2,.8,.42,0xa1a6a3,'steel');
    beam(u-10,44.25,9.02,u+13,44.25,9.02,.08,0x737c7d);
    for(let d=-10;d<14;d+=4)block(u+d,44.25,8.69,.08,.09,.67,0x737c7d);
    for(let l=0;l<3;l++)block(u+l*5,64,.07,.10,13.6,.035,0xd7d1bc);
  }
  for(let i=0;i<7;i++){
    const u=-167+i*51;
    for(let j=0;j<12;j++)block(u+j*.38,47.7,.16+j*.25,.40,1.7,.30,0x949997);
    beam(u,46.8,.98,u+4.5,46.8,3.84,.08,0x5e6a6c);
  }
  // Helipad and a visiting medical wagon.
  block(208,77,-.08,19,19,.22,0x526c61,'stone','tube');
  block(207,77,.065,.45,4.0,.03,0xe0e3d7);block(209,77,.065,.45,4.0,.03,0xe0e3d7);block(208,77,.065,2.0,.4,.03,0xe0e3d7);
  for(let i=0;i<2;i++){
    const u=178+i*7;block(u,50,1.62,4.75,2.05,2.14,0xd4d3c6);
    block(u+.68,50,2.1,1.55,2.08,.78,0x384e56,'glass');block(u,50,1.27,4.8,2.09,.33,0x819c52);
    block(u+.5,50,2.83,.36,1.12,.23,0x496e96,'lamp');
    for(const d of [-1.45,1.4])for(const v of [-1,1])block(u+d,50+v,.48,.80,.22,.80,0x282b2b,'stone','ball');
  }
  for(let i=0;i<11;i++){
    const u=-145+i*13,c=[0x6c8286,0xb2a79b,0x5e6361,0x813f39][i%4];
    block(u,103,.71,4.4,1.81,.85,c);block(u-.22,103,1.33,2.67,1.58,.65,0x46545a,'glass');
  }
  sign('PADDOCK   /   WEST GATE',-184,81,4.74,13,1.2);
  block(-184,81,4.71,.3,13.5,1.4,0x3a4446);
  for(const v of [74.8,87.2])block(-184,v,2.38,.38,.38,4.76,0x737c7e,'steel');
  block(-191,90,1.45,4.5,3.6,2.9,0x999f98);
  block(-191,90,2.1,4.6,3.7,.92,0x597780,'glass');
  // A track-day museum, winners' rostrum, team concessions and perimeter signage.
  block(-227,78,2.75,31,13,5.5,0x9f9181);block(-226,78,5.62,33,15,.37,0x545d5b,'steel');
  sign('HERITAGE GALLERY',-227,71.4,4.2,16,1.31,'left');
  for(let j=0;j<7;j++)block(-239+j*4,71.45,2.24,3.1,.15,2.7,0x47616b,'glass');
  block(115,81,.16,13,5,.32,0x474e4e);
  for(const [u,h,n] of [[111,.85,'2'],[115,1.25,'1'],[119,.61,'3']]){
    block(u,81,h/2+.32,3.65,2.75,h,0xa8aea9);sign(n,u,79.58,h/2+.37,1.2,.56,'left','red');
  }
  for(let i=0;i<4;i++){
    const u=-86+48*i;
    block(u,-44,1.35,7.5,3.7,2.6,0xa6a59c);block(u,-42.02,1.65,6.82,.19,1.24,0x344447);
    block(u,-42.2,2.8,8.1,1.7,.19,0xa63b2f,'steel');sign(['COFFEE','PROGRAMMES','SOUVENIRS','REFRESHMENTS'][i],u,-41.2,2.75,5.8,.56,'right','red');
  }
  for(let i=0;i<12;i++){
    const u=-148+i*27;block(u,-39,5.65,.12,.12,11.3,0x8c9697,'steel');
    block(u+1.35,-39,10.49,2.65,.055,1.55,[0xb23a28,0xd2ccaf,0x34646f][i%3]);
  }
  for(let i=0;i<16;i++){
    const u=-148+i*19,l=1.38+random()*.17;
    block(u,29.8,.8,.46,.36,l,0x333e44,'crowd','ball');block(u,29.8,1.55,.30,.27,.30,0xab8c73,'crowd','ball');
  }
}

export function crewModel(){
  const g=new T.Group(),geometry=new T.SphereGeometry(1,10,7),suit=new T.MeshStandardMaterial({color:0xaf362b}),helmet=new T.MeshStandardMaterial({color:0xe0dbca,roughness:.35});
  for(const [x,z] of [[-2,-1.3],[2,1.3],[-2,1.3],[2,-1.3]]){
    const mechanic=new T.Group();mechanic.position.set(x,0,z);g.add(mechanic);
    for(const [h,sx,sy,sz,m] of [[.67,.24,.50,.19,suit],[1.26,.174,.19,.165,helmet]]){
      const part=new T.Mesh(geometry,m);part.position.y=h;part.scale.set(sx,sy,sz);mechanic.add(part);
    }
  }
  g.visible=false;g.userData.dispose=()=>{geometry.dispose();suit.dispose();helmet.dispose();};return g;
}

