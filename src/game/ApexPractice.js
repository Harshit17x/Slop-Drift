import {boxFor} from './apexSport.js';

export class ApexPractice {
  constructor(game) {
    this.game = game;
    this.boxes = Array.from({length:40}, (_,i) => boxFor(game.world,i));
    game.scenery.setEvent(.15);
    this.reset();
  }

  reset() {
    this.wear = 0;
    this.elapsed = 0;
    this.phase = 'track';
    this.box = null;
    this.screenSecond = -1;
    this.game.world.apex.tyreGrip = 1;
    this.game.scenery.pitCrew(null);
  }

  update(dt,state) {
    const {world,vehicle,hud,scenery,session} = this.game;
    this.wear = Math.min(1,this.wear + dt * state.speed * (.000005 + .000025 * Math.min(1,Math.abs(state.slipAngle))));
    if (state.speed < .4) {
      this.box = this.boxes.find(p => Math.abs(p.y-state.position.y)<2 &&
        (p.x-state.position.x)**2 + (p.z-state.position.z)**2 < 2.7**2);
    } else this.box = null;
    if (!this.box) {
      this.phase = 'track';
      this.elapsed = 0;
    } else if (this.phase !== 'released') {
      if (this.phase === 'track') hud.toast('Changing tyres · hold still for 5 seconds','info');
      this.phase = 'service';
      this.elapsed += dt;
      if (this.elapsed >= 5) {
        this.wear = 0;
        this.phase = 'released';
        for (const wheel of vehicle.wheels) wheel.temperature = vehicle.tuning.tire.slickThermal?.initial ?? vehicle.roadTemperature;
        hud.toast('Fresh tyres fitted','good');
      }
    }
    world.apex.tyreGrip = 1 - .15*this.wear;
    scenery.pitCrew(this);
    const second = Math.floor(session.elapsed);
    if (this.screenSecond !== second) {
      this.screenSecond = second;
      scenery.telecast(second,session.route,state.position,[]);
      scenery.timing(second,session.hud.lap,Math.round(state.speed*3.6));
    }
  }
}
