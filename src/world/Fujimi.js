// Fujimi Rally: a compact, flat bayside drift course. The track, every prop and the drift
// clipping zones are authored in Blender (tools/blender/fujimi) and arrive as world.mapData (layout.json).
import { Road } from './Road.js';
import { race } from './Tokyo.js';

export async function buildFujimi(world, stage) {
  const data = world.mapData;
  if (!data?.road) throw new Error('Fujimi needs its layout.json');
  await stage(0.1, 'Surveying the bayside course');
  const { points, heights } = data.road;
  // Blender exports an evenly spaced, already smooth 2 m centreline. Use it as is: resampling and
  // smoothing again would pull the hairpins up to a metre away from the barriers placed in Blender.
  const road = new Road({ id: 0, name: data.road.name, closed: true, config: world.config.road,
    points: heights.map((y, i) => [points[i * 2], points[i * 2 + 1]]), heights: Float32Array.from(heights) });
  world.roads.push(road);
  race(world, 'loop', road);

  // Barriers line both sides of the whole lap; Blender places their meshes on the same line.
  road.railLeft.fill(1);
  road.railRight.fill(1);
  world.grid.heights.fill(-0.06);
  world.grid.updateRange();

  const at = {};
  world.driftZones = (data.zones || []).map((zone) => {
    road.locate(zone.x, zone.z, at);
    return { ...zone, s: at.s };
  });
  world.tower = data.tower;
  // [from, to] metres along the lap that are loose gravel (physics in World.sampleGround, look in RoadView).
  world.gravel = data.gravel?.length === 2 ? data.gravel : null;
  world.labels = (data.labels || []).map((label) => ({ ...label }));
  // Tyre islands and boulders from Blender: [x, z, radius] triples that the car collides with.
  world.staticObstacles = (data.solids || []).flatMap((o) => [o.x, o.z, o.r]);
  world.setObstacles([]);
  world.built = true;
  await stage(0.9, 'Lighting the bay');
  return world;
}
