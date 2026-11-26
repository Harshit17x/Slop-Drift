import * as T from 'three';

// The kiosks face the driving lane. Keep the road side free so a driver can
// pull alongside from either direction without getting trapped behind props.
const stops = [
  [0, 62, 'Arcade', '渋谷ゲーム館', 0x35cfff],
  [0, 1720, 'Electric Town', '秋葉原電機', 0xef4c95],
  [1, 1800, 'Lantern Alley', '新宿屋台', 0xff9945],
  [0, 3760, 'Pit Lane', '深夜走行会', 0xaaf568],
];

export function buildStreetStops(city){
  const bulb = new T.SphereGeometry(.18,10,8);
  city.beaconGeometry=bulb;
  city.world.tokyoSolids=city.solid;
  city.world.indexTokyoSolids();
  return stops.map(([road,anchor,name,jp,color],index)=>{
    const r=city.world.roads[road],side=-(r.halfWidth[0]+3);
    let f,station;
    for(const delta of [0,8,-8,16,-16,24,-24,32,-32,48,-48,64,-64,80,-80]){
      station=anchor+delta;f=r.frameAt(station,{});
      const query={};
      const clear=city.world.roads.every(other=>other===r||[-3,0,3].every(u=>{
        const x=f.x+side*f.rx+u*f.tx,z=f.z+side*f.rz+u*f.tz;
        return !other.locate(x,z,query,f.y)||query.beyondEnd||Math.abs(query.y-f.y)>4||
          query.distance>query.halfWidth+1.8;
      }));
      if(clear&&[-2.5,0,2.5].every(u=>!city.world.collideObstacle(f.x+side*f.rx+u*f.tx,f.y+1,
        f.z+side*f.rz+u*f.tz,1,{}).hit))break;
    }
    const part=(a,b,y,w,h,d,mat,tint,shape)=>city.part(f,a,side+b,y,w,h,d,mat,tint,shape);
    const {steel,concrete,lit}=city;
    const width=index===2?5.1:3.9;
    part(0,0,.54,width,1.06,1.1,steel,0x493d39);
    const backdrop=[city.skin.gamehall,city.skin.gamehall,city.skin.grill,city.skin.workshop][index];
    part(0,-.46,1.48,width,2.8,.15,backdrop);
    city.block(f,0,side,0,width,2.9,1.1);
    for(const a of [-1,1]){
      part(a*(width/2-.12),-.4,1.94,.14,1.94,.14,steel,0x8c847a);
      part(a*width/2,.58,.55,.07,.96,.08,lit,color);
    }
    part(0,0,2.96,width+.45,.2,1.72,steel,0x493f45);
    part(0,.71,2.72,width,.58,.19,city.sign(index,false,[jp,name.toUpperCase()],'#382f4b'));
    part(0,.85,2.39,width,.06,.07,lit,color);
    if(index===2){
      // Noren curtain, paper lanterns, counter stools and serving bowls.
      for(let i=-2;i<=2;i++){
        part(i*.75,.5,2.08,.66,.51,.07,concrete,0x893834);
        part(i*.81,.73,2.48,.28,.46,.28,lit,0xffbb69,'lamp');
        part(i*.77,.17,1.13,.30,.15,.30,concrete,0xddd9bf,'lamp');
        part(i*.83,1,.38,.12,.72,.12,steel,0x48474b);
        part(i*.83,1,.78,.42,.10,.42,concrete,0x8f5540,'round');
      }
    }else if(index<2){
      // Three upright cabinets with a glowing marquee, control shelf and buttons.
      for(const a of [-1.13,0,1.13]){
        part(a,0,1.67,.95,1.26,.78,steel,0x262632);
        part(a,.43,1.82,.70,.49,.05,city.skin['ad'+((index+Math.round(a)+4)%4)]);
        part(a,.5,1.34,.92,.13,.38,concrete,0x54505b);
        for(let j=0;j<3;j++)part(a-.23+j*.19,.57,1.43,.085,.06,.085,lit,j%2?0xff7878:color,'round');
      }
    }else{
      part(0,.16,1.84,2.6,1.1,.12,city.sign(2,false,['集合場所','MIDNIGHT PIT CREW'],'#263d31'));
      for(const a of [-1.35,1.35])for(let i=0;i<3;i++)
        part(a,.22,1.17+i*.21,.76,.21,.76,concrete,0x27272b,'round');
    }
    city.glow(f,0,side+.7,2.1,color,85);
    const point=new T.Vector3(f.x+side*f.rx,f.y,f.z+side*f.rz);
    const beacon=new T.Mesh(bulb,city.material({color},true));
    beacon.position.copy(point);beacon.position.y+=3.4;city.group.add(beacon);
    return {name,point,beacon,color,road,station,litUntil:0};
  });
}

export function buildDriftSectors(city){
  return [[1,520,1150,'Neon Switchback'],[3,180,620,'Dockside Slide'],[0,3330,3830,'Meet Showcase']].map(([id,a,b,name])=>{
    const road=city.world.roads[id];
    let best=a,curve=0;
    for(let s=a;s<b;s+=4){
      const bend=Math.abs(road.frameAt(s,{}).curvature);
      if(bend>curve){curve=bend;best=s;}
    }
    const lights=city.material({color:0xefab48},true);
    for(const d of [-72,-48,-24,0,24,48,72]){
      const f=road.frameAt(best+d,{});
      for(const side of [-1,1]){
        city.part(f,0,side*(f.halfWidth-.55),.055,3,.018,.18,lights);
        if(Math.abs(d)===72){
          city.part(f,0,side*(f.halfWidth-1.3),.052,.26,.016,1.7,city.concrete,0xf2c35d);
        }
      }
    }
    return {road:id,s:best,name,lights,hot:false};
  });
}
