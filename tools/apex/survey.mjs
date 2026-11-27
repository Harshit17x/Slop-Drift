import {writeFile,mkdir} from 'node:fs/promises';
import {World} from '../../src/world/World.js';
import {MAPS} from '../../src/world/maps.js';
import {APEX_LAYOUTS,apexSurface} from '../../src/world/Apex.js';
const world=await new World(MAPS.apex.config).build(),a=world.apex,r=a.main;
const out=new URL('../../artifacts/apex/',import.meta.url);await mkdir(out,{recursive:true});
const km=x=>(x/1000).toFixed(3),f=x=>Number(x.toFixed(3)),deg=x=>Math.atan(x)*180/Math.PI;
const layouts=Object.entries(world.routes).map(([id,v])=>({id,name:APEX_LAYOUTS[id],physicalMetres:f(v.metres),planMetres:f(v.length),startStation:f(v.startS),checkpoints:v.checkpoints.map(f)}));
const stats={layouts,elevationRange:f(Math.max(...r.py)-Math.min(...r.py)),maxBankDegrees:f(deg(Math.max(...r.bank.map(Math.abs)))),gradePercent:[f(Math.min(...r.grade)*100),f(Math.max(...r.grade)*100)],crossoverMetres:f(r.frameAt(a.bridge,{}).y-r.frameAt(a.under,{}).y),sections:a.sections,pitLength:f(a.pit.length)};
await writeFile(new URL('survey.json',out),JSON.stringify(stats,null,2));
let csv='route,s_plan_m,x_m,y_m,z_m,bank_deg,signed_curvature_per_m,surface\n';
for(const [id,route] of Object.entries(world.routes)){
 const road=world.roads[route.roadId];
 for(let s=0;s<road.length;s+=5){const p=road.frameAt(route.startS+s,{}),loc=world.locate(p.x,p.z,{},-1,p.y),physical=world.roads[loc.roadId]||road;
   csv+=[id,s,f(p.x),f(p.y),f(p.z),f(deg(loc.bank??p.bank)),p.curvature.toFixed(6),apexSurface(physical,loc.s)].join(',')+'\n';}
}
await writeFile(new URL('centrelines.csv',out),csv);
const parts=['<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="880" viewBox="0 0 1200 880"><rect width="1200" height="880" fill="#182126"/><g font-family="Arial,sans-serif" fill="#f0eee5">'];
function label(x,y,text,size=15,fill='#f0eee5'){parts.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}">${text}</text>`);}
function path(points,color,width){parts.push(`<polyline fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" points="${points.join(' ')}"/>`);}
label(44,48,'APEX GRAND PRIX',33);label(44,78,'ENDURANCE CIRCUIT   /   CENTRELINE SURVEY',16,'#e9ab86');
const bounds={x:Math.min(...r.px),z:Math.min(...r.pz)};const scale=.255;
function plan(x,z){return [45+(x-bounds.x)*scale,108+(z-bounds.z)*scale];}
for(const road of a.physical){const pts=[];for(let i=0;i<road.count;i+=2)pts.push(plan(road.px[i],road.pz[i]).map(f).join(','));if(road.closed)pts.push(pts[0]);path(pts,road===r?'#df9b78':'#6d898d',road===r?3:1.6);}
const [x,z]=plan(r.px[0],r.pz[0]);parts.push(`<circle cx="${x}" cy="${z}" r="5" fill="#fff"/>`);label(x-8,z+22,'S/F',12);
label(688,122,'CONFIGURATIONS',18);
layouts.forEach((q,i)=>{label(688,158+i*31,q.name);label(1000,158+i*31,km(q.physicalMetres)+' km');});
label(688,370,stats.elevationRange.toFixed(1)+' m elevation range');label(688,398,stats.maxBankDegrees.toFixed(1)+'° peak bank');
label(688,426,stats.crossoverMetres.toFixed(1)+' m between deck centrelines');
for(const [title,arr,y,color] of [['Elevation (m)',r.py,650,'#c5d899'],['Signed bank (°)',r.bank.map(deg),729,'#e9a785'],['Curvature (1/m)',r.curvature,808,'#8fb9c6']]){
 const lo=Math.min(...arr),hi=Math.max(...arr);label(44,y-35,title,14);label(44,y-12,f(lo)+' to '+f(hi),12,'#a2b2ad');
 const pts=[];for(let i=0;i<r.count;i++)pts.push(f(212+930*i/r.count)+','+f(y-59*(arr[i]-lo)/(hi-lo)));path(pts,color,1.75);
}
label(44,843,'Surface',14);for(let i=0;i<r.count;i+=4){const type=apexSurface(r,i*r.spacing);parts.push(`<rect x="${212+930*i/r.count}" y="828" width="${930*4/r.count+.2}" height="12" fill="${type==='slab'?'#e1c9ae':type==='concrete'?'#bfd0bb':'#6e7c83'}"/>`);}
label(212,861,'0 km',12);label(520,861,'Asphalt / banked concrete / heritage slabs',12);label(1090,861,km(layouts[0].physicalMetres)+' km',12);
parts.push('</g></svg>');await writeFile(new URL('circuit-survey.svg',out),parts.join('\n'));console.log(stats);

