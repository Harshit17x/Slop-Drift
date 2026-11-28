import { inDepot } from '../world/hollowDistricts.js';

// Roadside horror dressing. Everything is placed through the town's instanced
// batching helper, so hundreds of candles, bones and pumpkins cost very little.
// The rule is sparse: a light or a body every seventy metres or so, never a
// continuous line of props.
const TAU = Math.PI * 2;

export function buildHorrorProps(world, place, random, clear, obstacles, cave) {
  const blocked = (x, z, r) => {
    for (let i = 0; i < obstacles.length; i += 3) {
      const dx = x - obstacles[i], dz = z - obstacles[i + 1];
      if (dx * dx + dz * dz < (r + obstacles[i + 2]) ** 2) return true;
    }
    return false;
  };
  const depot = (x, z) => world.depots.some(d => inDepot(x, z, d, 2));
  const nearSite = (x, z, r = 12) => Object.values(world.sites).some(s => Math.hypot(s.x - x, s.z - z) < r);
  const inCaveSpan = (road, s) => road.id === cave.roadId && s > cave.s0 - 64 && s < cave.s1 + 64;
  const rot = (x, z, yaw, dx, dz) => ({
    x: x + dx * Math.cos(yaw) + dz * Math.sin(yaw),
    z: z - dx * Math.sin(yaw) + dz * Math.cos(yaw),
  });

  function candle(x, z, yaw, y) {
    const base = y ?? world.heightAt(x, z);
    place('candle', x, base + .13, z, .13, .26, .13, yaw);
    place('flame', x, base + .34, z, .15, .22, .15, yaw);
    place('candleSpill', x, base + .035, z, 2.1, 1, 2.1, yaw);
  }
  function candleCluster(x, z, count, yaw, y) {
    for (let i = 0; i < count; i += 1) {
      const p = rot(x, z, yaw, (random() - .5) * .8, (random() - .5) * .8);
      candle(p.x, p.z, yaw + random() * .8, y);
    }
  }
  function skeleton(x, z, yaw) {
    const y = world.heightAt(x, z);
    const at = (dx, dz) => rot(x, z, yaw, dx, dz);
    let p = at(0, .55);
    place('skull', p.x, y + .17, p.z, .34, .38, .3, yaw + .25);
    for (let i = 0; i < 3; i += 1) {
      p = at(0, .06 + i * .16);
      place('bone', p.x, y + .14, p.z, .48, .07, .13, yaw);
    }
    p = at(0, -.06);
    place('bone', p.x, y + .11, p.z, .1, .09, .72, yaw);
    p = at(0, -.42);
    place('bone', p.x, y + .13, p.z, .38, .12, .26, yaw);
    for (const side of [-1, 1]) {
      p = at(side * .3, .12);
      place('bone', p.x, y + .1, p.z, .09, .08, .62, yaw + side * .38);
      p = at(side * .18, -.76);
      place('bone', p.x, y + .09, p.z, .11, .08, .72, yaw + side * .18);
    }
  }
  function pumpkin(x, z, yaw, glow) {
    const y = world.heightAt(x, z), s = .72 + random() * .42;
    place('pumpkin', x, y + .27 * s, z, .82 * s, .56 * s, .82 * s, yaw);
    place('stem', x, y + .6 * s, z, .11, .2, .11, yaw);
    if (!glow) return;
    for (const side of [-1, 1]) {
      const p = rot(x, z, yaw, side * .15 * s, .37 * s);
      place('pumpkinFace', p.x, y + .3 * s, p.z, .1 * s, .075 * s, .025, yaw);
    }
    const mouth = rot(x, z, yaw, 0, .37 * s);
    place('pumpkinFace', mouth.x, y + .18 * s, mouth.z, .22 * s, .06 * s, .025, yaw);
  }
  function grave(x, z, yaw, cross) {
    const y = world.heightAt(x, z);
    place('mound', x, y + .06, z, 1.05, .2, 2.1, yaw);
    place('grave', x, y + .6, z, .62, 1.1, .15, yaw);
    if (cross) {
      place('grave', x, y + 1.24, z, .13, .72, .13, yaw);
      place('grave', x, y + 1.36, z, .52, .12, .13, yaw);
    }
  }
  function scarecrow(x, z, yaw) {
    const y = world.heightAt(x, z);
    place('wood', x, y + 1.2, z, .16, 2.4, .16, yaw);
    place('wood', x, y + 1.72, z, 1.7, .11, .11, yaw);
    place('scareBody', x, y + 1.45, z, .62, .86, .34, yaw);
    place('scareHead', x, y + 2.06, z, .38, .42, .38, yaw);
    place('scareHat', x, y + 2.32, z, .52, .3, .52, yaw);
    place('scareHat', x, y + 2.22, z, .9, .05, .9, yaw);
  }
  function car(x, z, yaw, roll = 0) {
    const y = world.heightAt(x, z);
    place('rust', x, y + .62, z, 1.85, .62, 4.25, yaw, roll);
    place('rust', x, y + 1.06, z, 1.58, .52, 2.1, yaw, roll);
    place('glass', x, y + 1.07, z, 1.62, .34, 1.4, yaw, roll);
    for (const side of [-1, 1]) for (const along of [-1.32, 1.32]) {
      const p = rot(x, z, yaw, side * .94, along);
      place('carWheel', p.x, y + .34, p.z, .28, .68, .68, yaw);
    }
    if (random() < .55) {
      const p = rot(x, z, yaw, -.35, -.1);
      place('skull', p.x, y + 1.08, p.z, .3, .32, .27, yaw + .6);
    }
    if (random() < .45) {
      const p = rot(x, z, yaw, 1.3, 1.7);
      candle(p.x, p.z, yaw);
    }
  }

  // Sparse roadside candles, the main warm light of the map.
  for (const road of world.roads) {
    if (road.id === 9) continue;
    const step = road.id <= 2 ? 58 + random() * 58 : 105 + random() * 85;
    for (let s = 26; s < road.length - 18; s += step) {
      if (inCaveSpan(road, s)) continue;
      const f = road.frameAt(s, {});
      const side = random() < .5 ? -1 : 1;
      const offset = side * (f.halfWidth + 2.4 + random() * 7.5);
      const x = f.x + offset * f.rx, z = f.z + offset * f.rz;
      if (!clear(x, z, .65) || depot(x, z) || blocked(x, z, 1.15)) continue;
      candleCluster(x, z, 1 + Math.floor(random() * 3), Math.atan2(f.tx, f.tz));
    }
  }
  // Candles at the cave mouth and along the foot of the rock wall. The massif
  // raises the terrain above the road here, so the road frame supplies the y.
  for (const s of [cave.s0 - 7, cave.s1 + 7]) {
    const f = world.roads[cave.roadId].frameAt(s, {});
    for (const side of [-1, 1]) {
      const x = f.x + side * (cave.shellHalf + 1.2) * f.rx;
      const z = f.z + side * (cave.shellHalf + 1.2) * f.rz;
      if (clear(x, z, .5)) candleCluster(x, z, 3, Math.atan2(f.tx, f.tz), f.y);
    }
  }
  for (let s = cave.s0 + 34, i = 0; s < cave.s1 - 18; s += 74, i += 1) {
    const f = world.roads[cave.roadId].frameAt(s, {});
    const side = i % 2 ? -1 : 1;
    const lat = side * (cave.shellHalf - .75);
    candleCluster(f.x + lat * f.rx, f.z + lat * f.rz, 3, Math.atan2(f.tx, f.tz), f.y);
  }

  // Bodies, pumpkins and warnings between the candles.
  for (const road of world.roads.slice(0, 3)) {
    for (let s = 90; s < road.length - 30; s += 150 + random() * 130) {
      if (inCaveSpan(road, s)) continue;
      const f = road.frameAt(s, {});
      const side = random() < .5 ? -1 : 1;
      const offset = side * (f.halfWidth + 2.2 + random() * 10);
      const x = f.x + offset * f.rx, z = f.z + offset * f.rz;
      if (!clear(x, z, 1.1) || depot(x, z) || blocked(x, z, 1.5) || nearSite(x, z, 10)) continue;
      if (random() < .56) skeleton(x, z, random() * TAU);
      else {
        pumpkin(x, z, random() * TAU, random() < .4);
        if (random() < .35) candleCluster(x, z, 1 + Math.floor(random() * 3), random() * TAU);
      }
    }
  }
  for (const road of world.roads.slice(0, 3)) {
    for (let s = 140; s < road.length - 30; s += 190 + random() * 170) {
      if (inCaveSpan(road, s)) continue;
      const f = road.frameAt(s, {});
      const side = random() < .5 ? -1 : 1;
      const offset = side * (f.halfWidth + 2.6 + random() * 9);
      const x = f.x + offset * f.rx, z = f.z + offset * f.rz;
      if (!clear(x, z, 1.2) || depot(x, z) || blocked(x, z, 1.7) || nearSite(x, z, 12)) continue;
      if (random() < .6) pumpkin(x, z, random() * TAU, random() < .5);
      else candleCluster(x, z, 2 + Math.floor(random() * 3), random() * TAU);
    }
  }

  // Graveyard clusters: a few near the church and the station, the rest in the
  // fields where the road bends away from the town.
  const church = world.sites.church;
  for (let i = 0; i < 2; i += 1) {
    const yaw = Math.atan2(church.tx, church.tz);
    const ox = (i - .5) * 18, oz = 9 + i * 7;
    const cx = church.x + ox * church.tx + oz * church.rx * Math.sign(church.offset);
    const cz = church.z + ox * church.tz + oz * church.rz * Math.sign(church.offset);
    for (let j = 0; j < 6; j += 1) {
      const p = rot(cx, cz, yaw, (j - 2.5) * 2.1, (random() - .5) * 3);
      if (clear(p.x, p.z, .6)) grave(p.x, p.z, yaw + (random() - .5) * .35, random() < .4);
    }
    candleCluster(cx, cz, 3, yaw);
  }
  const rail = world.sites.rail;
  for (let i = 0; i < 2; i += 1) {
    const yaw = Math.atan2(rail.tx, rail.tz);
    const cx = rail.x + (i - .5) * 34 * rail.tx + (12 + i * 8) * rail.rx * Math.sign(rail.offset);
    const cz = rail.z + (i - .5) * 34 * rail.tz + (12 + i * 8) * rail.rz * Math.sign(rail.offset);
    for (let j = 0; j < 5; j += 1) {
      const p = rot(cx, cz, yaw, (j - 2) * 2.2, (random() - .5) * 4);
      if (clear(p.x, p.z, .6)) grave(p.x, p.z, yaw + (random() - .5) * .4, random() < .35);
    }
  }
  for (let i = 0; i < 5; i += 1) {
    const s = 300 + random() * (world.roads[2].length - 600);
    if (inCaveSpan(world.roads[2], s)) continue;
    const f = world.roads[2].frameAt(s, {});
    const side = random() < .5 ? -1 : 1;
    const offset = side * (f.halfWidth + 6 + random() * 14);
    const cx = f.x + offset * f.rx, cz = f.z + offset * f.rz;
    if (depot(cx, cz) || nearSite(cx, cz, 20)) continue;
    const yaw = Math.atan2(f.tx, f.tz);
    for (let j = 0; j < 4; j += 1) {
      const p = rot(cx, cz, yaw, (j - 1.5) * 2, (random() - .5) * 3);
      if (clear(p.x, p.z, .6) && !blocked(p.x, p.z, .8)) grave(p.x, p.z, yaw, random() < .5);
    }
  }

  // Scarecrows in the fields and abandoned cars left where they stopped.
  for (let i = 0; i < 9; i += 1) {
    const road = world.roads[i % 3], s = 200 + random() * (road.length - 400);
    if (inCaveSpan(road, s)) continue;
    const f = road.frameAt(s, {});
    const side = random() < .5 ? -1 : 1;
    const offset = side * (f.halfWidth + 5 + random() * 16);
    const x = f.x + offset * f.rx, z = f.z + offset * f.rz;
    if (!clear(x, z, 1.4) || depot(x, z) || blocked(x, z, 1.8) || nearSite(x, z, 16)) continue;
    scarecrow(x, z, Math.atan2(f.tx, f.tz) + (random() - .5) * .5);
    if (random() < .4) candleCluster(x, z, 1, random() * TAU);
  }
  for (let i = 0; i < 6; i += 1) {
    const road = world.roads[i % 3], s = 260 + random() * (road.length - 520);
    if (inCaveSpan(road, s)) continue;
    const f = road.frameAt(s, {});
    const side = random() < .5 ? -1 : 1;
    const offset = side * (f.halfWidth + 3.4 + random() * 6);
    const x = f.x + offset * f.rx, z = f.z + offset * f.rz;
    if (!clear(x, z, 1.4) || depot(x, z) || blocked(x, z, 2) || nearSite(x, z, 16)) continue;
    car(x, z, Math.atan2(f.tx, f.tz) + (random() - .5) * .7, random() < .18 ? .8 : 0);
  }

  // A pumpkin patch and an abandoned campsite behind the station.
  const patch = { x: rail.x + 26 * rail.tx + 24 * rail.rx * Math.sign(rail.offset), z: rail.z + 26 * rail.tz + 24 * rail.rz * Math.sign(rail.offset) };
  for (let i = 0; i < 11; i += 1) {
    const x = patch.x + (random() - .5) * 13, z = patch.z + (random() - .5) * 9;
    if (clear(x, z, .4) && !blocked(x, z, .7)) pumpkin(x, z, random() * TAU, random() < .55);
  }
  candleCluster(patch.x, patch.z, 4, random() * TAU);
  const camp = { x: rail.x - 34 * rail.tx + 26 * rail.rx * Math.sign(rail.offset), z: rail.z - 34 * rail.tz + 26 * rail.rz * Math.sign(rail.offset) };
  const campY = world.heightAt(camp.x, camp.z);
  if (clear(camp.x, camp.z, 3) && !blocked(camp.x, camp.z, 3)) {
    place('scareBody', camp.x, campY + .62, camp.z, 3.2, 1.25, 2.4, random() * TAU);
    place('scareHat', camp.x, campY + 1.26, camp.z, 3.6, .06, 2.8, random() * TAU);
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * TAU;
      place('grave', camp.x + Math.cos(a) * .8, campY + .12, camp.z + Math.sin(a) * .8, .34, .24, .34);
    }
    candleCluster(camp.x, camp.z, 3, random() * TAU);
    skeleton(camp.x + 2.4, camp.z + 1.2, random() * TAU);
  }
}
