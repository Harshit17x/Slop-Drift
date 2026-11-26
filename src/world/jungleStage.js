import { smoothstep } from '../core/math.js';

export const WASHOUT = Object.freeze({ lip: 1710, bank: 1736, retry: 1480, targetKmh: 110 });
export const TAPIR_BEND = 3130;
export const RIDGE = 3950;

// Named adventure beats along the lap. The renderer places its set pieces from
// these chainages, and the same numbers drive the map pins and roadside boards.
export const STAGE = Object.freeze({
  timberCamp: 930,
  shrine: 2330,
  bamboo: Object.freeze({ start: 2600, end: 2860 }),
  watchtower: 3230,
  elephants: 3590,
  deerGlade: 3675,
});

// Man-made clearings cut into the canopy so the set pieces stay readable.
// side is -1 left, 1 right, 0 both sides; radius is measured along the road.
// Radii cover the approach as well as the beat: a 15 m hole in the canopy is
// invisible from 50 m back, which is how the tower and herd used to get lost.
export const CLEARINGS = Object.freeze([
  Object.freeze({ s: STAGE.timberCamp, side: 1, radius: 38 }),
  Object.freeze({ s: STAGE.shrine, side: -1, radius: 36 }),
  Object.freeze({ s: STAGE.watchtower, side: 1, radius: 34 }),
  Object.freeze({ s: STAGE.elephants, side: 1, radius: 48 }),
  Object.freeze({ s: STAGE.deerGlade, side: 1, radius: 38 }),
]);

export function inClearing(s, lateral, core = null) {
  for (const clearing of CLEARINGS) {
    if (clearing.side !== 0 && Math.sign(lateral || 1) !== clearing.side) continue;
    let distance = Math.abs(s - clearing.s);
    distance = Math.min(distance, 5000 - distance); // the lap wraps
    if (distance < (core ?? clearing.radius)) return clearing;
  }
  return null;
}

// Rolling crests and compressions break the constant-radius drive into
// readable rises, so the car breathes and the camera gets moments of sky.
// [chainage, height, span] – a crest is followed by a smaller rebound dip.
const CRESTS = Object.freeze([
  [760, 1.45, 27],
  [1240, 2.15, 32],
  [2150, 1.75, 30],
  [2870, 1.35, 24],
  [4490, 1.9, 33],
]);

export function inWashout(s) {
  return s >= WASHOUT.lip && s < WASHOUT.bank;
}

// Shape the road before the terrain is carved so the suspension, terrain LOD,
// spawn poses, checkpoint gates and road ribbon all use the same elevation.
export function shapeStage(road) {
  const {lip, bank} = WASHOUT;
  // Gentle natural rollers first; the washout deck then wins around the cut.
  for (let i = 0; i < road.count; i++) {
    const s = i * road.spacing;
    for (const [centre, rise, span] of CRESTS) {
      const crest = (s - centre) / span;
      const rebound = (s - centre - span * 1.35) / (span * 0.85);
      road.py[i] += rise * Math.exp(-crest * crest) - rise * 0.48 * Math.exp(-rebound * rebound);
    }
  }
  const y = road.frameAt(lip, {}).y;
  for (let i = 0; i < road.count; i++) {
    const s = i * road.spacing;
    if (s > lip-95 && s < bank+95) {
      const deck = s < lip ? y + 0.083*(s-lip) :
        s < bank ? y - 2.7*(s-lip)/(bank-lip) : y - 2.7 - 0.10*(s-bank);
      const blend = smoothstep(lip-95,lip-30,s)*(1-smoothstep(bank+25,bank+95,s));
      road.py[i] += (deck-road.py[i])*blend;
    }
  }
  for (let i=0; i<road.count; i++) {
    const prev=(i+road.count-1)%road.count, next=(i+1)%road.count;
    road.grade[i]=(road.py[next]-road.py[prev])/Math.hypot(road.px[next]-road.px[prev],road.pz[next]-road.pz[prev]);
  }
}

export function cutWashout(grid, frame) {
  const {lip,bank} = WASHOUT;
  const reach=76, halfGap=(bank-lip)/2;
  const from=v=>Math.max(0,Math.floor((v-reach+grid.half)/grid.cell));
  const to=v=>Math.min(grid.size-1,Math.ceil((v+reach+grid.half)/grid.cell));
  for (let z=from(frame.z); z<=to(frame.z); z++) for(let x=from(frame.x); x<=to(frame.x); x++){
    const dx=grid.coordinate(x)-frame.x,dz=grid.coordinate(z)-frame.z;
    const across=dx*frame.rx+dz*frame.rz;
    const along=dx*frame.tx+dz*frame.tz - 0.008*across*Math.abs(across);
    const cut=(1-smoothstep(halfGap-1,halfGap+4,Math.abs(along)))*(1-smoothstep(43,69,Math.abs(across)));
    const i=z*grid.size+x;
    grid.heights[i] -= 9*cut;
  }
}

export class Washout {
  constructor(road) {
    this.road=road;
    this.centre=road.frameAt((WASHOUT.lip+WASHOUT.bank)/2,{});
    this.bankY=road.frameAt(WASHOUT.bank,{}).y;
    this.loc={};
    this.reset();
  }
  reset() { this.missed=false; this.warned=false; this.fallTime=0; this.inFlight=false; }
  update(dt, state) {
    const position = state.position;
    if (this.missed) { this.fallTime+=dt; return; }
    if (Math.hypot(position.x-this.centre.x,position.z-this.centre.z)>160) {
      this.warned=false;
      this.inFlight=false;
      return;
    }
    if (!this.road.locate(position.x,position.z,this.loc)) return;
    const {s,distance} = this.loc;
    if (distance>8) return;
    // Check just before the front axle reaches the far wall. The ground query
    // is a heightfield and would otherwise lift a car up the vertical bank.
    if (inWashout(s)) {
      if (state.airborne) this.inFlight=true;
      const atWall = s >= WASHOUT.bank - 3.0 && s < WASHOUT.bank - 1.9;
      if (position.y < this.bankY - (atWall ? 0.08 : 0.65)) this.missed=true;
    }
    if (this.inFlight && s>=WASHOUT.bank && s<WASHOUT.bank+42 && state.wheelsOnGround>=2) {
      this.inFlight=false;
      return 'Flood Cut cleared';
    }
    if (!this.warned && s>WASHOUT.lip-135 && s<WASHOUT.lip-65) {
      this.warned=true;
      return `Washout ahead · straight over crest · ${WASHOUT.targetKmh} km/h`;
    }
  }
}
