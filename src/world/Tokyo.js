import { Road } from './Road.js';

export const FLOOR_NAMES = ['B2', 'B1', '1F', '2F', '3F', '4F', '5F', '6F', '7F'];
export const FLOOR_RISE = 5.6;
const TAU = 2 * Math.PI;
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t*t*(3-2*t); };

// Cut the survey corners with quadratic arcs. Scale the finished centreline, preserving
// the junction at the first point while matching the event distance.
function circuit(vertices, target, anchor, height) {
  let points = [];
  vertices.forEach((b,i) => {
    const a=vertices[(i+vertices.length-1)%vertices.length], c=vertices[(i+1)%vertices.length];
    const entry=b.map((v,k)=>v+.18*(a[k]-v)), exit=b.map((v,k)=>v+.18*(c[k]-v));
    for(let j=0;j<=16;j++){
      const t=j/16;
      points.push(b.map((v,k)=>(1-t)**2*entry[k]+2*t*(1-t)*v+t*t*exit[k]));
    }
  });
  const lengths=points.map((p,i)=>Math.hypot(...p.map((v,k)=>v-points[(i+1)%points.length][k])));
  const scale=target/lengths.reduce((a,b)=>a+b);
  let s=0;
  return points.map(([x,z],i)=>{
    const p=[anchor[0]+(x-points[0][0])*scale,height(s/target),anchor[1]+(z-points[0][1])*scale];
    s+=lengths[i]*scale;
    return p;
  });
}

export function makeRoad(world,name,xyz,width,closed=false,clearances=[]) {
  const sample=world.constructor.resamplePolyline(xyz.flatMap(p=>[p[0],p[2]]),xyz.map(p=>p[1]),closed,3.4);
  // Ease the deck up or down on both approaches. The flat part spans the
  // entire intersecting carriageway, including the shoulder and soffit.
  for(const {x,z,rise} of clearances){
    for(let i=0;i<sample.points.length;i++){
      const [px,pz]=sample.points[i];
      sample.profile[i]+=rise*(1-smooth((Math.hypot(px-x,pz-z)-35)/115));
    }
  }
  const r=new Road({id:world.roads.length,name,closed,points:sample.points,heights:sample.profile,
    config:{...world.config.road,halfWidth:width,maxBank:0,hairpinExtraWidth:0}});
  world.roads.push(r);
  return r;
}

export function race(world,id,road,dir=1, start, finish) {
  const l=road.length;
  const a=start??(road.closed?40:dir===1?22:l-22), b=finish??(road.closed?a:dir===1?l-14:14);
  const length=road.closed?l:Math.abs(b-a);
  const count=Math.max(3,Math.ceil(length/(road.id===4?73:300)));
  world.routes[id]={id,roadId:road.id,closed:road.closed,direction:dir,startS:a,finishS:b,length,
    checkpoints:Array.from({length:count-1},(_,i)=>(a+dir*length*(i+1)/count+l)%l)};
}

export async function buildTokyo(world,stage){
  await stage(.05,'Surveying the Tokyo night circuits');
  world.layered=true;
  const downtown=[[0,0],[2,-6],[8,-6],[8,-2],[12,-2],[12,4],[8,5],[6,2],[2,3]];
  const neon=[[0,0],[-3,-1],[-3,-4],[-6,-4],[-7,-1],[-5,1],[-5,4],[-1,4]];
  const express=[[0,0],[5,-2],[12,-5],[13,-10],[8,-13],[0,-12],[-3,-8],[-1,-4]];
  const port=[[0,0],[4,0],[5,2],[9,2],[9,5],[6,5],[5,4],[2,5],[-1,3]];
  const window=(t,a,b,k)=>smooth((t-a)/k)*smooth((b-t)/k);
  const main=makeRoad(world,'Tokyo Midnight Circuit',circuit(downtown,5000,[0,0],()=>0),9,true);
  const shibuya=makeRoad(world,'Shibuya Neon Circuit',circuit(neon,3000,[0,0],()=>0),6.8,true);
  const start=main.frameAt(1280,{});
  const highway=makeRoad(world,'Metropolitan Expressway',circuit(express,9000,[start.x,start.z],
    t=>19*window(t,0,.63,.045)-9*window(t,.66,.97,.038)),8.5,true);
  const dock=main.frameAt(3000,{});
  const bay=makeRoad(world,'Tokyo Bay Run',circuit(port,4000,[dock.x,dock.z],t=>12*window(t,.32,.60,.06)),7.5,true);

  const gate=shibuya.frameAt(360,{});
  // Set the garage back from the street. Its entrance crosses the outer wall
  // radially at the level 1F landing, away from the sloped section.
  const cx=gate.x+gate.rx*115, cz=gate.z+gate.rz*115;
  world.parkade={cx,cz,gate,ax:-gate.rx,az:-gate.rz,bx:gate.tx,bz:gate.tz};
  const deck=[];
  for(let i=0;i<=8*128+56;i++){
    const revolutions=i/128, t=revolutions%1, angle=revolutions*TAU;
    const u=55*Math.cos(angle), v=29*Math.sin(angle);
    const level=Math.min(8,Math.floor(revolutions)+smooth((t-.47)/.41));
    deck.push([cx+u*(-gate.rx)+v*gate.tx,(level-2)*FLOOR_RISE,cz+u*(-gate.rz)+v*gate.tz]);
  }
  const garage=makeRoad(world,'Midnight Parkade',deck,8.1);
  makeRoad(world,'Parkade entrance',[[gate.x,0,gate.z],deck[256]],6.3);
  // Pin the long tour to real district junctions. Stretch only the port and
  // expressway outskirts to calibrate distance without moving those junctions.
  const station=(r,s)=>{const p=r.frameAt(s,{});return [p.x,p.y,p.z]};
  const anchors=[station(bay,825),[2500,0,1350],[2790,6,1780],[2100,15,2190],
    station(main,3760),[290,0,1230],[-900,0,750],station(shibuya,1800),
    [-1060,-9,-760],[-520,-9,-1390],station(main,910),[790,9,-1630],
    station(highway,1820),[2620,24,-1770],[3120,18,-1200],station(main,1730),
    [1280,0,-190],station(main,3000)];
  const fixed=new Set([0,4,7,10,12,15,17]);
  function tourSurvey(scale){
    const a=anchors.map(([x,y,z],i)=>fixed.has(i)?[x,y,z]:[x*scale,y,z*scale]);
    const points=[];
    for(let i=0;i<a.length;i++){
      const p=a[(i+a.length-1)%a.length],b=a[i],c=a[(i+1)%a.length],d=a[(i+2)%a.length];
      for(let j=0;j<48;j++){
        const t=j/48,u=1-t;
        points.push(b.map((v,k)=>k===1?v+(c[k]-v)*smooth(t):
          (1+2*t)*u*u*v+t*u*u*(c[k]-p[k])*.36+t*t*(3-2*t)*c[k]+t*t*(t-1)*(d[k]-v)*.36));
      }
    }
    return points;
  }
  let lo=.7,hi=1.8;
  for(let i=0;i<18;i++){
    const m=(lo+hi)/2,points=tourSurvey(m);
    const length=points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2]);},0);
    if(length<15000)lo=m;else hi=m;
  }
  const tour=makeRoad(world,'Grand Tokyo Tour',tourSurvey((lo+hi)/2),8,true,[
    {x:-773,z:-355,rise:-4.1},{x:2286,z:-1331,rise:5.3}
  ]);
  // Through streets give each district multiple approaches.
  for(const [a,as,b,bs] of [[main,1850,shibuya,1690],[main,2200,highway,5400],[main,3620,bay,900],[bay,2300,tour,2300]]){
    const f=a.frameAt(as,{}),g=b.frameAt(bs,{});
    makeRoad(world,'District link',[[f.x,f.y,f.z],[g.x,g.y,g.z]],6,false,
      a===bay?[{x:2069,z:1176,rise:1.7}]:[]);
  }

  const apron=bay.frameAt(820,{}),yard=[];
  for(let j=0;j<120;j++){
    const a=j*TAU/120,u=53*Math.sin(a),v=28*(1-Math.cos(a))+6*Math.sin(a*2)**2;
    yard.push([apron.x+apron.tx*u+apron.rx*v,0,apron.z+apron.tz*u+apron.rz*v]);
  }
  world.gymkhana=makeRoad(world,'Shibaura Dock Arena',yard,6.4,true);
  for(const [id,r] of [['loop',main],['shibuya',shibuya],['express',highway],['bay',bay],['parkade',garage],['tour',tour]])race(world,id,r);
  race(world,'parkdown',garage,-1);
  race(world,'underground',highway,1,6080,8270);
  // A timed sector of a circuit is point-to-point.
  const sector=world.routes.underground;
  sector.closed=false; sector.length=sector.finishS-sector.startS;
  sector.checkpoints=[6650,7240,7780];

  const tower=main.frameAt(910,{});
  world.tower={x:tower.x+tower.rx*67,z:tower.z+tower.rz*67};
  world.tokyoSites=[
    [0,43,'Shibuya Crossing','渋谷'],[1,360,'Midnight Parkade','深夜駐車場'],[0,910,'Minato Tower','港区'],
    [2,1820,'Midnight Expressway','首都高'],[0,1730,'Akihabara Electric Town','秋葉原'],
    [1,1800,'Shinjuku Backstreets','新宿'],[0,3760,'Midnight Auto Meet','深夜集会'],[3,820,'Tokyo Bay','東京湾'],
  ].map(([id,s,name,jp])=>({...world.roads[id].frameAt(s,{}),id,s,name,jp}));
  world.labels=world.tokyoSites.map(({x,z,name})=>({x,z,name}));
  // Barriers follow graded segments and open where another street physically meets this deck.
  for(const r of world.roads){
    for(let i=0;i<r.count;i++){
      if(r.id!==4 && Math.abs(r.py[i])<.65)continue;
      for(const side of [-1,1]){
        const offset=side*(r.halfWidth[i]+1);
        const x=r.px[i]+r.rx[i]*offset,z=r.pz[i]+r.rz[i]*offset,y=r.py[i];
        const q={};
        const fork=world.roads.some(other=>other!==r && other.locate(x,z,q,y) && q.distance<q.halfWidth+2 && Math.abs(q.y-y)<1.4);
        if(!fork)(side<0?r.railLeft:r.railRight)[i]=1;
      }
    }
  }
  world.grid.heights.fill(-.35);
  world.grid.updateRange();
  world.built=true;
  await stage(.91,'Opening Shibuya Crossing');
  return world;
}
