// Distances measured along each circuit. The approach lies between the road
// and the working face of each structure, clear of buildings and guardrails.
export const DEPOTS = [
  {id:'parcel',label:'Returned Mail',road:0,s:1510,side:1,width:30,depth:22},
  {id:'dispenser',label:'Bell Street Pharmacy',road:1,s:1080,side:-1,width:23,depth:16},
  {id:'tram',label:'Incline No. 2',road:2,s:3710,side:1,width:39,depth:27},
  {id:'float',label:'Chain Ferry',road:0,s:2390,side:-1,width:18,depth:14},
];

export function surveyDepots(world){
  return DEPOTS.map(d=>{
    const road=world.roads[d.road],f=road.frameAt(d.s,{});
    const offset=d.side*(f.halfWidth+6),x=f.x+offset*f.rx,z=f.z+offset*f.rz;
    return {...d,x,z,y:world.heightAt(x,z),tx:f.tx,tz:f.tz,rx:f.rx,rz:f.rz};
  });
}

export function inDepot(x,z,d,margin=0){
  const dx=x-d.x,dz=z-d.z,along=dx*d.tx+dz*d.tz,back=(dx*d.rx+dz*d.rz)*d.side;
  return Math.abs(along)<d.width/2+margin && back>-4-margin && back<d.depth+margin;
}

export function setHollowRails(world){
  const connectors=world.roads.slice(3);
  const loc={}, entrances=[...Object.values(world.sites),...world.depots];
  for(const road of world.roads.slice(0,3)){
    for(let i=0;i<road.count;i++){
      const s=i*road.spacing;
      for(const side of [-1,1]){
        const exterior=road.id===2 && side===-1;
        const bend=road.id===2 && side===1 && (Math.abs(road.curvature[i])>.004 || (s>=1830 && s<=1870));
        const quay=road.id===0 && side===-1 && s>2200 && s<2490;
        if(!(exterior||bend||quay))continue;
        if(entrances.some(e=>road.id===(e.roadId??e.road) && side===(e.side??Math.sign(e.offset)) && Math.abs(s-e.s)<(e.width??44)/2+4))continue;
        const offset=side*(road.halfWidth[i]+road.config.shoulder+road.config.railOffset);
        const x=road.px[i]+offset*road.rx[i],z=road.pz[i]+offset*road.rz[i];
        // Include the turning apron at both ends of every connecting street.
        const junction=connectors.some(other=>other.locate(x,z,loc) && loc.distance<loc.halfWidth+5);
        if(!junction)(side<0?road.railLeft:road.railRight)[i]=1;
      }
    }
  }
}
