import { CatmullRomCurve3, Vector3 } from 'three';
import {ApexSurfaceState} from './ApexSurfaceState.js';
import { Road, indexPhysicalRoads } from './Road.js';
import { clamp, smoothstep, lerp } from '../core/math.js';

// Survey stations in plan coordinates plus height. Both visits to the viaduct have
// their own station, tangent and altitude. The stadium straight runs due west.
const survey = [
  [0,540,29],[-300,540,29],[-560,540,29],[-685,492,31],[-690,407,33],
  [-565,325,32],[-610,204,26],[-795,139,23],[-828,18,29],[-714,-84,41],
  [-580,-37,49],[-462,-106,57],[-385,-236,68],[-228,-235,82],[0,-180,99],
  [200,-97,116],[330,-146,129],[302,-309,143],[428,-424,156],[409,-566,166],
  [247,-644,168],[157,-594,164],[205,-514,158],[111,-457,151],[-70,-554,140],
  [-156,-470,132],[-85,-367,119],[-38,-314,108],[0,-180,89],[65,34,72],
  [264,62,61],[404,42,52],[486,-57,47],[645,-54,43],[753,21,39],
  [873,28,38],[1030,-58,38],[1127,-15,37],[1091,91,36],[837,183,33],
  [490,287,31],[362,326,31],[338,393,32],[390,437,32],[398,504,31],
  [322,546,29],[183,540,29]
];
const stations = survey.map(([x,z,y])=>new Vector3(x,y,z));
const curve = new CatmullRomCurve3(stations,true,'centripetal');
const dense = curve.getPoints(stations.length*32);
const measured = dense.slice(1).reduce((sum,p,i)=>sum+p.distanceTo(dense[i]),0);
const scale = 8200/measured;
function scaled(p){ return new Vector3(p.x*scale,p.y,p.z*scale); }
const knot = i=>scaled(stations[i]);
const sections = [
  ['The Serpent',7,12],['Summit Ascension',12,17],['Skyline Ridge',17,20],
  ['The Carousel',20,23],['The Vortex',24,28],['Heritage Sector',29,35],
  ['Velocity Straight',38,41],['Thunder Bowl',41,45],['Victory Bend',45,46]
];
export const APEX_LAYOUTS = {
  loop:'Endurance Circuit', gp:'Grand Prix Circuit', ridge:'Mountain Circuit',
  international:'International Sprint', bowl:'Stadium Circuit', academy:'Motorsport Academy'
};
function makeRoad(world,name,points,closed,width){
  const sample=world.constructor.resamplePolyline(points.flatMap(p=>[p.x,p.z]),points.map(p=>p.y),closed,3);
  const road=new Road({id:world.roads.length,name,closed,points:sample.points,heights:sample.profile,
    config:{...world.config.road,halfWidth:width,hairpinExtraWidth:0}});
  world.roads.push(road);
  return road;
}
function lengths3d(road){
  let length=0;
  for(let i=0;i<road.segments;i++){const j=(i+1)%road.count; length+=Math.hypot(road.px[j]-road.px[i],road.py[j]-road.py[i],road.pz[j]-road.pz[i]);}
  return length;
}
function profile(bank,s,a,b,ramp){return bank*smoothstep(a,a+ramp,s)*(1-smoothstep(b-ramp,b,s));}
export function apexSurface(road,s){
  if(road.heritage && s>=road.heritage[0] && s<=road.heritage[1])return 'slab';
  if(road.carousel && s>=road.carousel[0] && s<=road.carousel[1])return 'concrete';
  return 'asphalt';
}
export function apexShoulder(road,i,side){
  if(road.pitApron || (road.stadiumEnd && (i*road.spacing<road.stadiumEnd || i*road.spacing>road.length-255)))return 'paved';
  const escape=(side<0?road.escapeLeft:road.escapeRight)?.[i]||0;
  if(escape>1)return 'gravel';
  return 'grass';
}
export function apexKerbHeight(s,lateral,width,curvature){
  const a=Math.abs(lateral)-width;
  if(a<0 || a>1.05 || Math.abs(curvature)<.0018)return 0;
  return Math.sin(Math.PI*a/1.05)*(.044+.014*Math.cos(s*Math.PI));
}
function bakeTerrain(world,roads,bridge){
  const {grid}=world, {size,half,cell,heights}=grid;
  const delta=new Float32Array(size*size).fill(Infinity), bed=new Float32Array(size*size);
  // Nearest graded cross-section blends into natural relief outside the cut.
  for(const road of roads)for(let i=0;i<road.count;i+=2){
    const x=road.px[i],z=road.pz[i],s=i*road.spacing;
    if(road.id===0 && Math.abs(s-bridge)<48)continue;
    const radius=94, ix=Math.round((x+half)/cell),iz=Math.round((z+half)/cell),n=Math.ceil(radius/cell);
    for(let j=Math.max(0,iz-n);j<=Math.min(size-1,iz+n);j++)for(let k=Math.max(0,ix-n);k<=Math.min(size-1,ix+n);k++){
      const dx=k*cell-half-x,dz=j*cell-half-z,dist=Math.hypot(dx,dz),key=j*size+k;
      if(dist>=delta[key] || dist>radius)continue;
      const lateral=dx*road.rx[i]+dz*road.rz[i];
      delta[key]=dist;
      bed[key]=road.py[i]+clamp(lateral,-22,22)*road.bank[i]-.24;
    }
  }
  for(let i=0;i<heights.length;i++){
    if(delta[i]<Infinity)heights[i]=lerp(bed[i],heights[i],smoothstep(23,94,delta[i]));
  }
  // At flyovers and converging embankments the LOWER pavement sets the
  // terrain ceiling. Evaluate its graded plane at every covered grid node.
  for(const road of roads)for(let i=0;i<road.count;i+=2){
    const x=road.px[i],z=road.pz[i],reach=road.halfWidth[i]+cell*1.5+4;
    const cx=Math.round((x+half)/cell),cz=Math.round((z+half)/cell),n=Math.ceil(reach/cell);
    for(let j=cz-n;j<=cz+n;j++)for(let k=cx-n;k<=cx+n;k++){
      const dx=k*cell-half-x,dz=j*cell-half-z;
      if(dx*dx+dz*dz>reach*reach)continue;
      const lateral=dx*road.rx[i]+dz*road.rz[i],along=dx*road.tx[i]+dz*road.tz[i];
      const plane=road.py[i]+road.bank[i]*lateral+road.grade[i]*along;
      const key=j*size+k;heights[key]=Math.min(heights[key],plane-.22);
    }
  }
  grid.updateRange();
}
export async function buildApex(world,stage){
  await stage(.05,'Surveying Apex International Motorsport Park');
  const main=makeRoad(world,'APEX Endurance',dense.slice(0,-1).map(scaled),true,7);
  const S=stations.map((_,i)=>{
    const p=knot(i),loc={};main.locate(p.x,p.z,loc,p.y);return loc.s;
  });
  main.heritage=[S[29],S[35]];main.carousel=[S[20],S[23]];
  for(let i=0;i<main.count;i++){
    const s=i*main.spacing, k=main.curvature[i];
    const extra=profile(.29,s,S[20],S[23],45)+profile(.38,s,S[41],S[45],62);
    main.bank[i]=clamp(main.bank[i]-Math.tanh(k*95)*extra+profile(.045,s,S[24],S[25],26),-.445,.445);
    if(apexSurface(main,s)==='slab')main.py[i]+=.014*Math.sin(s*.85);
  }
  // Outside runoffs widen progressively at the major braking and descent zones.
  main.escapeLeft=new Float32Array(main.count);main.escapeRight=new Float32Array(main.count);
  for(const [enter,exit,width,side] of [[2,5,20,-1],[6,9,12,1],[17,19,11,-1],[20,22,15,-1],[24,27,14,1],[36,39,22,-1],[41,44,15,1]]){
    for(let i=0;i<main.count;i++){
      const s=i*main.spacing;
      (side<0?main.escapeLeft:main.escapeRight)[i]+=profile(width,s,S[enter]-32,S[exit]+32,58);
    }
  }
  main.stadiumEnd=S[1];
  const at=s=>main.frameAt(s,{});
  function connector(name,a,b,via,width=6){
    const f=at(S[a]),g=at(S[b]);
    const v=[knot(a),...via.map(([x,z,y])=>scaled(new Vector3(x,y,z))),knot(b)];
    const lead=Math.min(35,v[0].distanceTo(v[1])*.24),tail=Math.min(35,v.at(-1).distanceTo(v.at(-2))*.24);
    v.splice(1,0,v[0].clone().addScaledVector(new Vector3(f.tx,f.ty,f.tz),lead));
    v.splice(-1,0,v.at(-1).clone().addScaledVector(new Vector3(g.tx,g.ty,g.tz),-tail));
    const c=new CatmullRomCurve3(v,false,'centripetal');
    const path=c.getPoints(v.length*30);
    // Match the local road plane throughout both merge aprons.
    for(const p of path){
      const loc={};if(main.locate(p.x,p.z,loc,p.y) && Math.abs(loc.y-p.y)<5)
        p.y=lerp(loc.y+loc.lateral*loc.bank,p.y,smoothstep(13,28,loc.distance));
    }
    return makeRoad(world,name,path,false,width);
  }
  const gp=connector('Grand Prix link',13,29,[[-150,-140,83],[-50,-102,78],[62,-96,76]]);
  const sprint=connector('International link',6,40,[[-584,137,28],[-489,121,31],[-337,215,34],[-182,174,35],[14,215,33],[259,240,30],[495,255,31],[530,275,31]]);
  const bowl=connector('Stadium infield',2,41,[[-620,503,29],[-535,455,30],[-371,449,31],[-267,383,31],[-94,412,31],[124,353,30],[319,306,31],[385,310,31]]);
  const ridge=connector('Mountain return',27,12,[[-185,-257,101],[-292,-328,90],[-446,-420,82],[-694,-429,75],[-770,-357,70],[-677,-292,67],[-521,-286,65],[-457,-216,65],[-427,-172,64]]);
  const academy=makeRoad(world,'Academy',new CatmullRomCurve3([
    [-300,730],[-535,730],[-625,799],[-586,918],[-432,940],[-344,856],[-257,900],[-123,908],[-63,810],[-133,735]
  ].map(([x,z])=>scaled(new Vector3(x,29,z))),true).getPoints(256).slice(0,-1),true,4.8);
  const pitPoints=[];
  for(let s=-360;s<=320;s+=4){
    const f=at(s),offset=18*smoothstep(-360,-245,s)*(1-smoothstep(218,320,s));
    pitPoints.push(new Vector3(f.x+f.rx*offset, f.y+f.bank*offset+.015, f.z+f.rz*offset));
  }
  const pit=makeRoad(world,'Pit lane',pitPoints,false,5.5);
  pit.pitApron=true;
  const access=connector('Academy approach',1,2,[[-340,578,29],[-338,657,29],[-387,730,29],[-452,730,29],[-451,632,29],[-504,586,29]],3.5);
  const physical=world.roads.slice();
  function lapWithLink(key,link,begin,end){
    // One logical closed lap for timing, reusing both physical ribbons.
    const points=[];
    const span=(S[begin]-S[end]+main.length)%main.length;
    for(let d=0;d<span;d+=3){const f=at(S[end]+d);points.push(new Vector3(f.x,f.y,f.z));}
    for(let i=0;i<link.count-1;i++)points.push(new Vector3(link.px[i],link.py[i],link.pz[i]));
    const road=makeRoad(world,APEX_LAYOUTS[key],points,true,7);
    const loc={};const start=key==='ridge'?0:road.locate(main.px[0],main.pz[0],loc,main.py[0])?loc.s:0;
    route(key,road,start);
  }
  function route(key,road,start){
    const checkpoints=Array.from({length:11},(_,i)=>(start+road.length*(i+1)/12)%road.length);
    world.routes[key]={id:key,roadId:road.id,closed:true,direction:1,startS:start,finishS:start,
      length:road.length,metres:lengths3d(road),checkpoints};
  }
  route('loop',main,0);
  lapWithLink('gp',gp,13,29);lapWithLink('ridge',ridge,27,12);
  lapWithLink('international',sprint,6,40);lapWithLink('bowl',bowl,2,41);route('academy',academy,0);
  for(const route of Object.values(world.routes)){
    const road=world.roads[route.roadId],p=pit.frameAt(0,{}),q=pit.frameAt(pit.length,{});
    const enter={},exit={};
    if(road.locate(p.x,p.z,enter,p.y) && road.locate(q.x,q.z,exit,q.y) && enter.distance<3 && exit.distance<3){
      const span=(exit.s-enter.s+road.length)%road.length;
      if(span>600 && span<750)route.pitPath={entry:(enter.s-route.startS+road.length)%road.length,span};
    }
  }
  world.layered=true;world.physicalRoads=physical;
  world.apex={roadsAt:indexPhysicalRoads(physical),shoulder:apexShoulder,surfaceState:new ApexSurfaceState(physical),kerb:apexKerbHeight,surface:apexSurface,stations:S,pit,access,physical,main,bridge:S[14],under:S[28],sections:sections.map(([name,a,b])=>({name,start:S[a],end:S[b]}))};
  world.labels=world.apex.sections.map(({name,start,end})=>({name,...at((start+end)/2)}));
  world.summit=at(S[20]);
  await stage(.34,'Cutting the ridge and grading the circuit');
  const plateau=knot(0);
  await world.grid.fill((x,z)=>{
    const X=x/scale,Z=z/scale;
    const summit=127*Math.exp(-(((X-170)/560)**2+((Z+560)/450)**2));
    const outer=smoothstep(920,1740,Math.hypot(X*.83,Z));
    const ridgeHeight=outer*(175+90*Math.sin(X/211+Z/271)+62*Math.cos(Z/132-X/197)+25*Math.sin(X/51+Z/67));
    const natural=34+summit+ridgeHeight+7*Math.cos(X/124)+5*Math.sin(Z/92+X/141);
    const lake=Math.hypot((X-820)/260,(Z+390)/163);
    const valley=lerp(5,natural,smoothstep(.65,1.28,lake));
    const apron=Math.max(Math.abs(x)-535,Math.abs(z-plateau.z)-135);
    return lerp(28.76,valley,smoothstep(0,90,apron));
  });
  bakeTerrain(world,physical,S[14]);
  // Guardrails sit beyond the runoff. Omit either side at a junction.
  for(const road of physical){
    if(road===pit || road===access)continue;
    for(let i=0;i<road.count;i++)for(const side of [-1,1]){
      const atRail=side*(road.halfWidth[i]+world.config.road.shoulder+world.config.road.railOffset+(side<0?road.escapeLeft?.[i]??0:road.escapeRight?.[i]??0));
      const x=road.px[i]+road.rx[i]*atRail,z=road.pz[i]+road.rz[i]*atRail;
      const pos={}; const open=physical.some(other=>other!==road && other.locate(x,z,pos,road.py[i]) && pos.distance<pos.halfWidth+9 && Math.abs(pos.y-road.py[i])<4);
      if(!open && (road.closed || (i*road.spacing>42 && (road.count-i)*road.spacing>42)))
        (side<0?road.railLeft:road.railRight)[i]=1;
    }
  }
  const f=at(0);
  // Long walls use overlapping footings, registered once with the scenery hash.
  const wall=(from,to,v,r,step)=>{for(let u=from;u<=to;u+=step)world.staticObstacles.push(f.x+f.tx*u+f.rx*v,f.z+f.tz*u+f.rz*v,r);};
  wall(-224,214,9.25,.38,.55);wall(-162,162,43.9,.4,.57);wall(-143,160,-19,1.3,1.8);
  // Fronts stay open to lane traffic. Closed paddock buildings and the dividing
  // walls between garages have contacts on their actual rendered footprint.
  for(let i=0;i<40;i++){
    const u=-159.88+i*8;
    for(let v=27.6;v<=45.2;v+=.7)world.staticObstacles.push(f.x+f.tx*u+f.rx*v,f.z+f.tz*u+f.rz*v,.23);
  }
  for(const [u,v,l,d] of [[-202,36,36,13],[189,38,36,13],[157,92,36,13],[-73,93,36,13],[60,93,36,13],[-227,78,31,13]]){
    for(const side of [-1,1]){
      wall(u-l/2,u+l/2,v+side*d/2,.38,.65);
      for(let b=-d/2;b<=d/2;b+=.65)world.staticObstacles.push(f.x+f.tx*(u+side*l/2)+f.rx*(v+b),f.z+f.tz*(u+side*l/2)+f.rz*(v+b),.38);
    }
  }
  world.setObstacles([]);world.built=true;
  await stage(.9,'Opening the pit lane');
  return world;
}

