// Distances follow the surveyed centreline. Positive offsets are to the driver's right.
export const HOLLOW_SITES = [
  ['garage','The Last Garage',0,40,18,'A warm inspection lamp still burns above the service bay.'],
  ['fuel','Abandoned Gas Station',0,750,-18,'Under the pump cover: the Saltline service-team paint formula.'],
  ['rail','Ghost Railway Station',0,1590,20,'The station log lists a final evacuation train at 03:17.'],
  ['wharf','Silent Waterfront',0,2350,-22,'Nobody collected the last ferry manifest. Every passenger signed in the same hand.'],
  ['hospital','Abandoned Hospital',0,3910,23,'All ward clocks stopped when the emergency frequency went silent.'],
  ['church','Forgotten Church',1,515,-23,'The sexton rang the evacuation bell long after the last train left.'],
  ['mine','Underground Mine',2,2680,19,'An old survey shows a maintenance cut behind the tunnel.'],
  ['factory','Forgotten Factory',2,4980,-34,'Fresh circular skid marks break the dust in the assembly hall.'],
];
export function anchor(world,roadId,s,offset=0) {
  const f=world.roads[roadId].frameAt(s,{});
  const x=f.x+offset*f.rx,z=f.z+offset*f.rz;
  return {...f,x,z,y:world.heightAt(x,z),roadId,s};
}
export function surveySites(world) {
  return Object.fromEntries(HOLLOW_SITES.map(([id,name,road,s,offset,story]) =>
    [id,{...anchor(world,road,s,offset),id,name,offset,story}]));
}
