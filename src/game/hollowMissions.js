import { anchor } from '../world/hollowSites.js';

export function hollowMissions(world) {
  const sites=world.sites;
  const at=(name,r,s,offset=0,radius=14)=>({...anchor(world,r,s,offset),name,radius});
  const site=id=>({...sites[id],radius:id==='factory'?20:15});
  const place=(id,name,instruction,goals,options={})=>({id,name,instruction,goals,...options});
  const signals=['fuel','rail','hospital','mine','wharf'].map((id,i)=>({
    ...site(id),name:['Pump receiver','Platform receiver','Ward receiver','Adit receiver','Harbour receiver'][i],
    clue:['Carrier 1 · the pumps stopped at 03:17.','Carrier 2 · train 09 never departed.',
      'Carrier 3 · the ward called after it closed.','Carrier 4 · a second voice came from below.',
      'Carrier 5 · the ferry answered from an empty berth.'][i]}));
  const fork=world.roads[4], start=fork.frameAt(0,{}), end=fork.frameAt(fork.length,{});
  const merge={},exit={};world.roads[0].locate(start.x,start.z,merge);world.roads[2].locate(end.x,end.z,exit);
  const pursuitStart=at('Meet the tail lights',0,merge.s-140);
  const pursuitPath=[[0,merge.s-140,merge.s],[4,0,fork.length],[2,exit.s,exit.s+230]];
  const junction=(road,end,name)=>at(name,road,end?world.roads[road].length-4:4);
  const freight=id=>{
    const d=world.depots.find(p=>p.id===id);
    return {...d,name:d.label,radius:6};
  };
  return [
    place('deadletter','Dead Letter Run','Read the undelivered prescription at the parcel office. Stop beside the pharmacy lamp, then trace its addressee to the chain ferry.',
      [{...freight('parcel'),clue:'Bag 17. A prescription for the ferryman, still awaiting collection.'},
       {...freight('dispenser'),clue:'The ledger gives a delivery address: chain winch, east landing.'},
       {...freight('float'),clue:'Under the winch cover lies the unopened return receipt.'}],{hold:2.5}),
    place('shift','The Empty Shift','Clock in at the assembly hall, stop under the ore tram lamp, then carry its final shift ticket to the mine.',
      [site('factory'),{...freight('tram'),clue:'A shift ticket drops from the empty ore bucket.'},
       {...site('mine'),clue:'Six names punched in. All six punched out at the same second.'}],{hold:2}),
    place('transmission','The Last Transmission','Tune five receivers across town.',signals),
    place('pursuit','Phantom Pursuit','Meet the phantom at the turnoff. Stay close to its tail lights.',[pursuitStart],{pursuitPath}),
    place('mist','Into the Mist','Finish the Vanishing Road as the fog closes in.',[],{race:'vanishing'}),
    place('delivery','Midnight Delivery','Collect the parcel at the garage. Reach the hospital within three minutes.',[site('garage'),site('hospital')],{limit:180}),
    place('echoes','Echoes of the Past','Recover the station log, the ward note and the ferry manifest.',
      ['rail','hospital','wharf'].map(id=>({...site(id),clue:sites[id].story}))),
    place('ghost','Ghost Circuit','Race a recorded Hollow Creek lap. A first solo lap records an opponent.',[],{race:'sprint'}),
    place('route','The Forgotten Route','Find the mine cutting, take its side passage and emerge at the mine.',
      [at('Mine approach',2,2440),at('Unmarked cutting',9,100),at('Mine exit',9,world.roads[9].length-12)]),
    place('drift','Drift After Dark','Bank 120 drift points in each marked district.',
      [at('Clock Square',1,460,0,105),at('Station approach',0,1550,0,120),{...site('factory'),radius:34}],{score:120}),
    place('driver','The Lost Driver','Follow the tyre marks from the pumps and the distress signal into the mill.',
      [{...site('fuel'),clue:'Two dark tracks leave the pump island toward the railway.'},
       {...site('rail'),clue:'Dispatch: the missing coupe was last seen at the assembly hall.'},
       {...site('factory'),name:'Dust-covered coupe',x:sites.factory.x+sites.factory.tx*15,z:sites.factory.z+sites.factory.tz*15,clue:'The car is cold. The radio still transmits.'}]),
    place('light','Last Light','Reach the pumps, the church and the garage during the blackout.', ['fuel','church','garage'].map(site)),
    place('explore','Urban Explorer','Find every secret location in Hollow Creek.',Object.keys(sites).map(site),{anyOrder:true}),
    place('escape','Escape the Fog','Run three rally stages through the quarter, the town and the mining hills.',
      [at('Quarter start',1,640),at('Old Town gate',1,950),junction(5,false,'Church lane'),
       junction(5,true,'Main circuit'),at('Town gate',0,2290),junction(6,false,'Mill turnoff'),
       junction(6,true,'Outer circuit'),at('Cave gate',2,3980),at('Mill finish',2,4980)]),
  ];
}

const KEY='slop-drift-hollow-journal-v1';
const defaults={ambience:.7,music:.55,effects:.8,scares:.6,weather:1};
export class HollowJournal {
  constructor(storage){
    this.storage=storage;let saved={};
    try{saved=JSON.parse(storage?.getItem(KEY)||'{}')||{};}catch{}
    this.found=new Set(Array.isArray(saved.found)?saved.found:[]);
    this.completed=new Set(Array.isArray(saved.completed)?saved.completed:[]);
    this.settings={...defaults};
    for(const k of Object.keys(defaults)){
      const n=saved.settings?.[k];if(Number.isFinite(n))this.settings[k]=Math.min(1,Math.max(0,n));
    }
    this.active=typeof saved.active?.id==='string'?saved.active:null;
    this.exitKnown=saved.exitKnown===true;
  }
  save(){
    try{this.storage?.setItem(KEY,JSON.stringify({found:[...this.found],completed:[...this.completed],
      active:this.active,settings:this.settings,exitKnown:this.exitKnown}));}catch{}
  }
}
