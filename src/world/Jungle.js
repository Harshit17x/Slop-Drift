import { WASHOUT, RIDGE, TAPIR_BEND, shapeStage, cutWashout, Washout } from './jungleStage.js';
import { clamp, smoothstep } from '../core/math.js';

// Chainage is measured along the centre of the route, in metres.
export const BRIDGE = Object.freeze({ start: 352, end: 400, halfWidth: 2.65, recovery: 331 });
export function onBridge(s) {
  return s >= BRIDGE.start && s < BRIDGE.end;
}

// At bends runoff pools on the inside. On straights the wet line wanders
// across the crown. All three consumers (tyres, soil and puddles) sample this field.
export function mudLine(s, curvature) {
  const inside = clamp(curvature * 85, -1, 1);
  return 1.9 * inside + 0.75 * Math.sin(s / 27) + 0.38 * Math.sin(s / 9);
}

export function wetness(s, lateral, curvature) {
  const hollow = Math.sin(s / 24 + 1.6 * Math.sin(s / 64)) + 0.55 * Math.sin(s / 12 + 1);
  const lengthMask = smoothstep(-0.12, 0.92, hollow + Math.min(0.32, Math.abs(curvature) * 16));
  const distance = Math.abs(lateral - mudLine(s, curvature));
  const width = 1.65 + 0.8 * Math.sin(s / 42);
  return lengthMask * (1 - smoothstep(width * 0.3, width + 0.5, distance));
}

function hills(x, z) {
  const ridge = 34*Math.exp(-(((x-209)/256)**2 + ((z+737)/118)**2));
  return 21 + ridge + 6 * Math.sin(x / 148) + 5 * Math.cos(z / 133) + 3 * Math.sin((x + z) / 79);
}

// Local deviations in the survey create a double-apex bend, a narrowing
// S through bamboo and a late braking corner on the return to the creek.
const BENDS = [[1.19,25,0.041],[1.30,-18,0.044],[2.94,-29,0.045],
  [3.07,24,0.048],[4.36,28,0.039],[4.46,-20,0.045],[5.67,-27,0.042]];

export function jungleLoop() {
  const points = [];
  const heights = [];
  for (let i = 0; i < 768; i++) {
    const t = 2 * Math.PI * i / 768;
    let r = 650 + 88 * Math.sin(3 * t) + 63 * Math.cos(5 * t) + 37 * Math.sin(9 * t);
    for (const [bearing, metres, width] of BENDS) r += metres * Math.exp(-(((t-bearing)/width)**2));
    points.push(r * Math.cos(t), r * 0.83 * Math.sin(t));
  }
  let length = 0;
  for (let i = 0; i < points.length; i += 2) {
    const next = (i + 2) % points.length;
    length += Math.hypot(points[i] - points[next], points[i + 1] - points[next + 1]);
  }
  for (let i = 0; i < points.length; i += 2) {
    points[i] *= 5000 / length;
    points[i + 1] *= 5000 / length;
    heights.push(hills(points[i], points[i + 1]));
  }
  return { name: 'loop', closed: true, points, heights };
}

export async function buildJungle(world, stage) {
  await stage(0.1, 'Surveying the jungle circuit');
  world.buildMapRoads({ roads: [jungleLoop()] });
  shapeStage(world.roads[0]);
  world.washout = new Washout(world.roads[0]);
  await world.grid.fill(hills, fraction => stage(0.15 + fraction * 0.4, 'Raising the jungle floor'));
  world.grid.carve(world.roads, [], world.config.road);
  const bridge = new RopeBridge(world.roads[0]);
  world.bridge = bridge;
  const { grid } = world;
  const f = bridge.centre;
  world.waterLevel = 4;
  // Cut a meandering creek across the road. Keep other low valleys dry.
  const bankLocation = {};
  for (let iz = 0; iz < grid.size; iz++) {
    for (let ix = 0; ix < grid.size; ix++) {
      const dx = grid.coordinate(ix) - f.x;
      const dz = grid.coordinate(iz) - f.z;
      const across = dx * f.rx + dz * f.rz;
      const along = dx * f.tx + dz * f.tz - 7 * Math.sin(across / 43);
      const depth = (1 - smoothstep(14, 25, Math.abs(along))) * (1 - smoothstep(80, 135, Math.abs(across)));
      const index = iz * grid.size + ix;
      const x = grid.coordinate(ix), z = grid.coordinate(iz);
      const radius = Math.hypot(dx,dz);
      // Earth cuttings rise beyond the shoulder, alternating high banks and creek clearings.
      if (world.roads[0].locate(x,z,bankLocation) && radius > 32) {
        const verge = bankLocation.distance - bankLocation.halfWidth;
        const slope = smoothstep(1.7, 10, verge) * (1 - smoothstep(12, 29, verge));
        const side = Math.sign(bankLocation.lateral);
        grid.heights[index] += slope * (2.6 + 2.1*Math.sin(bankLocation.s/94 + side*2) + 0.6*Math.sin(x/9+z/7));
      }
      grid.heights[index] += (Math.min(grid.heights[index], world.waterLevel - 4) - grid.heights[index]) * depth;
    }
  }
  cutWashout(grid, world.washout.centre);
  grid.updateRange();
  world.buildRoutes();
  world.labels = [{ name: 'Rope crossing', x: f.x, z: f.z }];
  for (const [name,s] of [['Flood Cut',WASHOUT.lip],['Tapir Bend',TAPIR_BEND],['Cloud Ridge',RIDGE]]) {
    const point=world.roads[0].frameAt(s,{});
    world.labels.push({name,x:point.x,z:point.z});
  }
  world.built = true;
  await stage(0.9, 'Growing the canopy');
  return world;
}

export class RopeBridge {
  constructor(road) {
    this.road = road;
    this.centreS = (BRIDGE.start + BRIDGE.end) / 2;
    this.centre = road.frameAt(this.centreS, {});
    this.location = {};
    this.reset();
  }

  reset() {
    this.time = 0;
    this.stress = 0;
    this.broken = false;
    this.falling = false;
    this.loaded = false;
    this.dropTime = 0;
  }

  displacement(s) {
    const span = Math.sin(Math.PI * clamp((s - BRIDGE.start) / (BRIDGE.end - BRIDGE.start), 0, 1));
    return span * (-0.65 + (this.loaded ? 0.045 + this.stress * 0.13 : 0.012) * Math.sin(this.time * 15));
  }

  step(dt, state, controls) {
    this.time += dt;
    if (this.broken) this.dropTime += dt;
    else if (!this.loaded) this.stress = Math.max(0, this.stress - dt * 0.6);
    const p = state.position;
    const loc = this.location;
    if (Math.hypot(p.x - this.centre.x, p.z - this.centre.z) > 70) {
      this.loaded = false;
      return;
    }
    if (!this.road.locate(p.x, p.z, loc) || !onBridge(loc.s)) {
      this.loaded = false;
      return;
    }
    this.loaded = loc.distance < BRIDGE.halfWidth && !this.broken && p.y > loc.y - 2;
    if (!this.loaded) {
      if (p.y < loc.y - 2) this.falling = true;
      return;
    }
    const overload = Math.max(0, (state.speed - 11) / 7)
      + Math.max(0, Math.abs(state.slipAngle) - 0.22) * Math.min(state.speed, 12) / 3
      + (controls.handbrake && state.speed > 7 ? 1 : 0);
    this.stress = clamp(this.stress + dt * (overload - 0.25), 0, 1);
    if (this.stress >= 1) this.broken = this.falling = true;
  }
}
