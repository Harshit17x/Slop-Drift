import { surveyDepots, setHollowRails } from './hollowDistricts.js';
import { surveySites } from './hollowSites.js';
import { Road } from './Road.js';
import { CONFIG } from '../config.js';
import { smoothstep } from '../core/math.js';

// The districts follow the same valley at different elevations. Survey each ring
// before scaling it so the event distance is independent of the road sample rate.
const TAU = Math.PI * 2;
// The old gallery is replaced by a natural massif on the Vanishing Road. The
// road keeps its surveyed grade while the mountain is raised around it; a
// rendered rock shell and roof strip turn the carved cutting into a cave.
const CAVE = { s0: 3950, s1: 4550, roofHalf: 22, shellHalf: 9.5, shellHeight: 11.5, height: 168, radius: 230 };
function elevation(x,z) {
  return 19 + 5*Math.sin(x/167) + 6*Math.cos(z/194) + 3*Math.sin((x-z)/95)
    +40*Math.exp(-(((x+850)/245)**2+((z+590)/210)**2));
}
function ring(length, id) {
  const points = [];
  for (let i=0;i<512;i++) {
    const t = i*TAU/512;
    const radius = 1 + .08*Math.sin(3*t) + .07*Math.cos(5*t) + .024*Math.sin(9*t+id);
    // District-specific bends: a folded hillside switchback, a dogleg through
    // the old quarter and a long waterfront sweep on the main road.
    const ridge=id===2?Math.exp(-((t-3.87)**2)/.054):0;
    const turn=id===1?.049*Math.sin(8*t+.7):0;
    const bend=t+ridge*.032*Math.sin((t-3.87)*21);
    points.push([(radius+turn+ridge*.10*Math.cos((t-3.87)*19))*Math.cos(bend),
      .84*(radius+turn)*Math.sin(bend)]);
  }
  let perimeter=0;
  points.forEach(([x,z],i)=>{
    const next=points[(i+1)%points.length];
    perimeter+=Math.hypot(next[0]-x,next[1]-z);
  });
  return points.map(([x,z])=>[x*length/perimeter,z*length/perimeter]);
}
export async function buildHollowCreek(world,stage) {
  await stage(.07,'Surveying Hollow Creek');
  const rings=[ring(5000,0),ring(3000,1),ring(7000,2)];
  const names=['Hollow Creek Circuit','Forgotten Quarter','Vanishing Road'];
  function road(points,closed,name,width) {
    const sample=world.constructor.resamplePolyline(points.flat(),points.map(([x,z])=>elevation(x,z)),closed,3);
    const config={...world.config.road,halfWidth:width,maxBank:0};
    const result=new Road({id:world.roads.length,name,closed,points:sample.points,heights:sample.profile,config,
      flatten:new Float32Array(sample.points.length).fill(1)});
    world.roads.push(result);
    return result;
  }
  rings.forEach((p,i)=>road(p,true,names[i],[5.5,4,4.6][i]));
  // Each street connects at both ends. Stagger the forks so a missed turn
  // leaves a usable recovery route in either direction.
  for (const [a,b,index] of [[1,0,24],[0,2,88],[1,0,200],[0,2,260],[1,0,372],[0,2,430]]) {
    const start=rings[a][index], end=rings[b][(index+17)%512];
    const p=Array.from({length:49},(_,j)=>{
      const t=j/48, sway=16*Math.sin(t*TAU);
      return [start[0]+(end[0]-start[0])*t+sway,start[1]+(end[1]-start[1])*t-sway];
    });
    road(p,false,'Cross street',4);
  }
  // The old service cutting forks out of the tunnel and rejoins beyond the mine.
  const outer=world.roads[2], cut=[];
  for(let j=0;j<=48;j++){
    const t=j/48, f=outer.frameAt(2504+t*222,{});
    const offset=39*Math.sin(Math.PI*t);
    cut.push([f.x+offset*f.rx,f.z+offset*f.rz]);
  }
  road(cut,false,'Mine service cutting',3.3);
  world.mineGate=world.roads[9].frameAt(28,{});
  // Survey the cave corridor once. Every terrain sample asks which point of the
  // corridor is nearest; the massif is then gated along the road so the tram
  // incline before the portal and the mill beyond it stay clear.
  const caveRoad=world.roads[2],caveSamples=[];
  let caveMinX=Infinity,caveMaxX=-Infinity,caveMinZ=Infinity,caveMaxZ=-Infinity;
  for(let s=CAVE.s0-160;s<=CAVE.s1+160;s+=12){
    const f=caveRoad.frameAt(s,{});
    caveSamples.push({x:f.x,z:f.z,s,y:f.y});
    caveMinX=Math.min(caveMinX,f.x);caveMaxX=Math.max(caveMaxX,f.x);
    caveMinZ=Math.min(caveMinZ,f.z);caveMaxZ=Math.max(caveMaxZ,f.z);
  }
  const caveSpan=(x,z)=>{
    let best=Infinity,along=0,height=0;
    for(const p of caveSamples){
      const dx=x-p.x,dz=z-p.z,d=dx*dx+dz*dz;
      if(d<best){best=d;along=p.s;height=p.y;}
    }
    return {d:Math.sqrt(best),s:along,y:height};
  };
  const massif=(x,z)=>{
    if(x<caveMinX-360||x>caveMaxX+360||z<caveMinZ-360||z>caveMaxZ+360)return 0;
    const {d,s}=caveSpan(x,z);
    if(d>340)return 0;
    // The cliff face rises over the last sixty metres before each portal and
    // reaches full height well inside the massif, so the entrances sit at the
    // foot of a slope instead of under a vertical curtain of rock.
    const gate=smoothstep(CAVE.s0-60,CAVE.s0+180,s)*(1-smoothstep(CAVE.s1-180,CAVE.s1+60,s));
    if(gate<=0)return 0;
    const ridge=1-smoothstep(42,CAVE.radius,d);
    const shape=Math.pow(ridge,1.22);
    // Peaks wander along the ridge so the skyline is a mountain, not a wall.
    const peak=.82+.26*Math.sin(s*.0061+1.7)+.12*Math.sin(s*.0173-.4);
    const noise=(10*Math.sin(x*.018+z*.013)+5.5*Math.sin(x*.047-z*.031)+2.2*Math.sin(x*.11+z*.073))*gate*ridge;
    return CAVE.height*peak*gate*shape+noise;
  };
  const bank=world.roads[0].frameAt(2350,{});
  const lakeX=bank.x-110*bank.rx,lakeZ=bank.z-110*bank.rz;
  world.creek={x:lakeX,z:lakeZ,y:elevation(bank.x,bank.z)-2.4};
  const plant=world.roads[2].frameAt(4980,{});
  const mill={x:plant.x-34*plant.rx,z:plant.z-34*plant.rz};
  const millY=elevation(mill.x,mill.z);
  const ground=(x,z)=>{
    const dx=x-mill.x,dz=z-mill.z;
    const edge=Math.max(Math.abs(dx*plant.tx+dz*plant.tz)-26,Math.abs(dx*plant.rx+dz*plant.rz)-20);
    if(edge<7){const t=Math.max(0,edge/7);return millY*(1-t)+elevation(x,z)*t;}
    const d=Math.hypot((x-lakeX)/102,(z-lakeZ)/90);
    const natural=elevation(x,z)+massif(x,z), t=Math.min(1,Math.max(0,(d-.77)/.23));
    return (world.creek.y-4)*(1-t)+natural*t;
  };
  const caveStart=caveRoad.frameAt(CAVE.s0,{}),caveEnd=caveRoad.frameAt(CAVE.s1,{});
  world.cave={roadId:2,...CAVE,start:caveStart,end:caveEnd,massif,surface:ground};
  await world.grid.fill(ground,f=>stage(.15+.45*f,'Grading the creek valley'));
  world.grid.carve(world.roads,[],world.config.road);
  // `carve()` must keep the carriageway open, so it cuts a trench through the
  // massif. Raise everything outside the shell corridor back to the mountain
  // surface. The open slot above the road is sealed by the roof strip and the
  // two portal walls in HollowCave, so the cutting is never visible.
  {
    const {size,cell,heights,half}=world.grid,c=world.cave;
    const pad=380,otherRoads=world.roads.filter(rd=>rd.id!==c.roadId),loc={};
    const minX=Math.max(0,Math.floor((caveMinX-pad+half)/cell)),maxX=Math.min(size-1,Math.ceil((caveMaxX+pad+half)/cell));
    const minZ=Math.max(0,Math.floor((caveMinZ-pad+half)/cell)),maxZ=Math.min(size-1,Math.ceil((caveMaxZ+pad+half)/cell));
    for(let iz=minZ;iz<=maxZ;iz++){
      const z=iz*cell-half;
      for(let ix=minX;ix<=maxX;ix++){
        const x=ix*cell-half;
        // Project onto the carriageway itself, not the nearest survey sample:
        // on a bend the sample distance overstates the lateral offset and the
        // cut slope would poke through the shell.
        if(!caveRoad.locate(x,z,loc)||loc.beyondEnd||loc.s<c.s0||loc.s>c.s1)continue;
        // Close the massif over the carriageway too, not just beside it. The
        // terrain is single-sided, so from inside the cave its underside is
        // culled and the rock shell is all that draws; from outside the
        // mountain reads as unbroken rock instead of a trench with a lid.
        // Other roads keep their carved corridor even where the massif's
        // outer skirt reaches them.
        let blocked=false;
        for(const rd of otherRoads){
          if(rd.locate(x,z,loc)&&!loc.beyondEnd&&loc.distance<26){blocked=true;break;}
        }
        if(blocked)continue;
        const i=iz*size+ix,h=ground(x,z);
        if(h>heights[i])heights[i]=h;
      }
    }
    world.grid.updateRange();
  }
  world.buildRoutes();
  for (const [id,index] of [['quarter',1],['vanishing',2]]) {
    const r=world.roads[index], count=Math.round(r.length/CONFIG.race.checkpointSpacing);
    world.routes[id]={id,roadId:index,closed:true,direction:1,startS:40,finishS:40,length:r.length,
      checkpoints:Array.from({length:count-1},(_,i)=>(40+(i+1)*r.length/count)%r.length)};
  }
  world.sites=surveySites(world);
  world.depots=surveyDepots(world);
  setHollowRails(world);
  const dock=world.sites.wharf;
  dock.y=Math.max(dock.y,world.creek.y+.48);
  world.dock=dock;
  world.labels=[[0,40,'The Last Garage'],[1,470,'Clock Square'],[0,2350,'East Wharf'],[2,3940,'Signal Tunnel'],[2,4980,'Blackwater Mill']].map(([i,s,name])=>{
    const {x,z}=world.roads[i].frameAt(s,{});return {x,z,name};
  });
  world.landmarkLabels=Object.values(world.sites).filter(p=>p.id!=='garage').map(({id,x,z,name})=>({id,x,z,name}));
  world.built=true;
  await stage(.9,'Opening the abandoned streets');
  return world;
}
