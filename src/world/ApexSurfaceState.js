// Each cell covers approximately 20 m along one physical ribbon. The jobs that
// deposit rubber run at 4 Hz. Wheel contacts can sample the same field directly.
const CELLS = 512;
export class ApexSurfaceState {
  constructor(roads) {
    this.roads = roads;
    this.width = CELLS;
    this.data = new Uint8Array(CELLS * roads.length);
    this.rows = roads.length;
    this.dirty = false;
    this.loc = {};
    for (const road of roads) {
      for (let i = 0; i < CELLS; i++) {
        const index = Math.min(road.count-1, Math.floor(i / CELLS * road.count));
        this.data[road.id * CELLS + i] = Math.round(45 + Math.min(.04, Math.abs(road.curvature[index])) * 1550);
      }
    }
  }
  cell(road,s) {
    return road.id * CELLS + Math.max(0,Math.min(CELLS-1,Math.floor(s / road.length * CELLS)));
  }
  deposit(position) {
    let winner, distance=Infinity, station=0;
    for (const road of this.roads) {
      const p=this.loc;
      if (!road.locate(position.x,position.z,p,position.y) || p.beyondEnd || p.distance>=distance ||
          p.distance>p.halfWidth || Math.abs(p.y+p.bank*p.lateral-position.y)>2) continue;
      winner=road; distance=p.distance; station=p.s;
    }
    if (!winner) return;
    const cell=this.cell(winner,station);
    if(this.data[cell]<255){this.data[cell]++;this.dirty=true;}
  }
  grip(road,p,wet) {
    const racingLine=Math.max(-.5,Math.min(.5,p.curvature*33))*p.halfWidth;
    const onLine=Math.max(0,1-Math.abs(p.lateral-racingLine)/2.8);
    const rubber=this.data[this.cell(road,p.s)]/255;
    return 1 + rubber * onLine * (.055-.21*wet);
  }
}
