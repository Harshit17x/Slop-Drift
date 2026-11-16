import { DEG2RAD, lerp, smoothstep } from '../core/math.js';

// Road centrelines in plan view (x, z), built from the leg descriptions in worldConfig.js.
// A path here is a plain array of [x, z] pairs; closed paths do not repeat their first point.

function sampleLeg(shape, leg, altFrom, altTo, radialOffset = null) {
  const sweep = (leg.to - leg.from) * DEG2RAD;
  const midRadius = shape.radiusForDegrees((leg.from + leg.to) * 0.5, (altFrom + altTo) * 0.5);
  const steps = Math.max(8, Math.ceil((Math.abs(sweep) * midRadius) / 5));
  const [amplitude, cycles] = leg.wiggle || [0, 0];
  // Altitude is spread by distance travelled, not by bearing, so the grade is even along the leg
  // even where the radius changes a lot (the summit spiral). Distances depend on the altitudes, so iterate.
  const climbed = new Float64Array(steps + 1);
  for (let i = 0; i <= steps; i += 1) climbed[i] = i / steps;
  let points = [];
  for (let pass = 0; pass < 4; pass += 1) {
    points = [];
    for (let i = 0; i <= steps; i += 1) {
      const u = i / steps;
      const bearing = leg.from + (leg.to - leg.from) * u;
      const theta = bearing * DEG2RAD;
      let radius = shape.radiusFor(theta, lerp(altFrom, altTo, climbed[i]));
      if (amplitude) {
        // Esses that fade to nothing at both ends so legs still meet where they should.
        const taper = smoothstep(0, 0.14, u) * smoothstep(0, 0.14, 1 - u);
        radius += amplitude * Math.sin(u * cycles * Math.PI * 2) * taper;
      }
      if (radialOffset) radius += radialOffset(bearing, u);
      points.push([Math.cos(theta) * radius, Math.sin(theta) * radius]);
    }
    let total = 0;
    const along = new Float64Array(steps + 1);
    for (let i = 1; i <= steps; i += 1) {
      total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      along[i] = total;
    }
    for (let i = 0; i <= steps; i += 1) climbed[i] = along[i] / total;
  }
  return leg.smooth ? smoothPath(points, leg.smooth, false, 1, 1) : points;
}

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total;
}

/** Point at arc length `distance` from the start of an open polyline. */
function pointAlong(points, distance) {
  let remaining = Math.max(0, distance);
  for (let i = 1; i < points.length; i += 1) {
    const ax = points[i - 1][0];
    const az = points[i - 1][1];
    const segment = Math.hypot(points[i][0] - ax, points[i][1] - az);
    if (remaining <= segment || i === points.length - 1) {
      const t = segment > 0 ? Math.min(1, remaining / segment) : 0;
      return { x: ax + (points[i][0] - ax) * t, z: az + (points[i][1] - az) * t, index: i, t };
    }
    remaining -= segment;
  }
  const last = points[points.length - 1];
  return { x: last[0], z: last[1], index: points.length - 1, t: 1 };
}

/**
 * Join two legs that meet at a sharp switchback apex (end of `a`, start of `b`).
 * Both legs are trimmed back to where they are one hairpin diameter apart and joined by a
 * semicircle that bulges toward the apex.
 */
function joinHairpin(a, b, radius) {
  const reversedA = a.slice().reverse();
  const limit = Math.min(pathLength(a), pathLength(b)) * 0.8;
  let distance = radius;
  let endA = pointAlong(reversedA, distance);
  let startB = pointAlong(b, distance);
  while (distance < limit && Math.hypot(endA.x - startB.x, endA.z - startB.z) < radius * 2) {
    distance += 2;
    endA = pointAlong(reversedA, distance);
    startB = pointAlong(b, distance);
  }
  const apex = a[a.length - 1];
  const cx = (endA.x + startB.x) * 0.5;
  const cz = (endA.z + startB.z) * 0.5;
  const arcRadius = Math.hypot(endA.x - startB.x, endA.z - startB.z) * 0.5;
  const startAngle = Math.atan2(endA.z - cz, endA.x - cx);
  const apexAngle = Math.atan2(apex[1] - cz, apex[0] - cx);
  // Sweep half a turn in whichever direction passes the apex side.
  let toApex = apexAngle - startAngle;
  while (toApex > Math.PI) toApex -= Math.PI * 2;
  while (toApex < -Math.PI) toApex += Math.PI * 2;
  const direction = toApex >= 0 ? 1 : -1;
  const arcSteps = Math.max(6, Math.ceil((Math.PI * arcRadius) / 4));

  const keptA = reversedA.slice(endA.index).reverse();
  const joined = keptA.concat([[endA.x, endA.z]]);
  for (let i = 1; i < arcSteps; i += 1) {
    const angle = startAngle + direction * Math.PI * (i / arcSteps);
    joined.push([cx + Math.cos(angle) * arcRadius, cz + Math.sin(angle) * arcRadius]);
  }
  joined.push([startB.x, startB.z]);
  return joined.concat(b.slice(startB.index));
}

/** Append `next` to `path`, dropping the duplicated joint point. */
function appendLeg(path, next) {
  return path.length ? path.concat(next.slice(1)) : next.slice();
}

/** Resample to evenly spaced points. Closed paths return points without a repeated end. */
export function resamplePath(points, spacing, closed) {
  const source = closed ? points.concat([points[0]]) : points;
  const total = pathLength(source);
  const count = Math.max(4, Math.round(total / spacing));
  const step = total / count;
  const result = [];
  let segment = 1;
  let walked = 0;
  let segmentLength = Math.hypot(source[1][0] - source[0][0], source[1][1] - source[0][1]);
  const samples = closed ? count : count + 1;
  for (let i = 0; i < samples; i += 1) {
    const target = Math.min(total, i * step);
    while (segment < source.length - 1 && walked + segmentLength < target) {
      walked += segmentLength;
      segment += 1;
      segmentLength = Math.hypot(source[segment][0] - source[segment - 1][0], source[segment][1] - source[segment - 1][1]);
    }
    const t = segmentLength > 0 ? Math.min(1, Math.max(0, (target - walked) / segmentLength)) : 0;
    result.push([
      source[segment - 1][0] + (source[segment][0] - source[segment - 1][0]) * t,
      source[segment - 1][1] + (source[segment][1] - source[segment - 1][1]) * t,
    ]);
  }
  return result;
}

/** Laplacian smoothing. `pinStart`/`pinEnd` points of an open path are left untouched. */
export function smoothPath(points, iterations, closed, pinStart = 1, pinEnd = 1) {
  const count = points.length;
  let current = points.map((point) => [point[0], point[1]]);
  let next = points.map((point) => [point[0], point[1]]);
  for (let pass = 0; pass < iterations; pass += 1) {
    for (let i = 0; i < count; i += 1) {
      if (!closed && (i < pinStart || i >= count - pinEnd)) {
        next[i][0] = current[i][0];
        next[i][1] = current[i][1];
        continue;
      }
      const before = current[(i - 1 + count) % count];
      const after = current[(i + 1) % count];
      next[i][0] = current[i][0] * 0.5 + (before[0] + after[0]) * 0.25;
      next[i][1] = current[i][1] * 0.5 + (before[1] + after[1]) * 0.25;
    }
    const swap = current;
    current = next;
    next = swap;
  }
  return current;
}

function finishPath(raw, spacing, closed, pinStart = 1, pinEnd = 1) {
  // Smooth at the final spacing (sigma ~ spacing * sqrt(iterations / 2) ~ 8 m), then even out the spacing again.
  const dense = resamplePath(raw, spacing, closed);
  const smoothed = smoothPath(dense, 32, closed, pinStart, pinEnd);
  return resamplePath(smoothed, spacing, closed);
}

/** Closed loop around the mountain. Returns { points, legAltitude(bearing) }. */
export function buildLoopPlan(shape, world) {
  const legs = world.loop;
  let path = [];
  let pending = null;
  for (let i = 0; i < legs.length; i += 1) {
    const leg = legs[i];
    const points = sampleLeg(shape, leg, leg.alt[0], leg.alt[1]);
    if (pending) {
      path = joinHairpin(path, points, world.road.hairpinRadius);
    } else {
      path = appendLeg(path, points);
    }
    pending = leg.hairpin ? leg : null;
  }
  path.pop(); // the last leg ends where the first begins
  return finishPath(path, world.road.spacing, true);
}

/** Altitude the loop is designed to have at `bearing` on the leg that carries the spur junction. */
function loopAltitudeAt(world, bearing) {
  for (const leg of world.loop) {
    const low = Math.min(leg.from, leg.to);
    const high = Math.max(leg.from, leg.to);
    if (bearing >= low && bearing <= high) {
      return lerp(leg.alt[0], leg.alt[1], (bearing - leg.from) / (leg.to - leg.from));
    }
  }
  return world.loop[0].alt[0];
}

/**
 * Summit spur. Starts on the loop centreline (sharing its direction) and ends at the plaza centre.
 * `loopPoints` is the finished loop path; the spur's first metres are copied from it so the fork is tangent.
 */
export function buildSpurPlan(shape, world, loopPoints) {
  const spur = world.spur;
  const spacing = world.road.spacing;
  const theta = spur.junctionBearing * DEG2RAD;
  const nominalRadius = shape.radiusFor(theta, loopAltitudeAt(world, spur.junctionBearing));
  const nominalX = Math.cos(theta) * nominalRadius;
  const nominalZ = Math.sin(theta) * nominalRadius;
  let junctionIndex = 0;
  let best = Infinity;
  for (let i = 0; i < loopPoints.length; i += 1) {
    const d = Math.hypot(loopPoints[i][0] - nominalX, loopPoints[i][1] - nominalZ);
    if (d < best) {
      best = d;
      junctionIndex = i;
    }
  }

  // Lead-in copied from the loop, in the loop's driving direction.
  const leadCount = Math.round(14 / spacing);
  let path = [];
  for (let i = 0; i <= leadCount; i += 1) path.push(loopPoints[(junctionIndex + i) % loopPoints.length].slice());
  const leadEnd = path[path.length - 1];
  const leadBearing = Math.atan2(leadEnd[1], leadEnd[0]) / DEG2RAD;

  let altitude = loopAltitudeAt(world, spur.junctionBearing);
  let pending = null;
  spur.legs.forEach((leg, index) => {
    let points;
    if (index === 0) {
      // Peel away uphill from the loop over the first few degrees.
      const offset = (bearing) => -spur.forkOffset * smoothstep(0, spur.forkSpan, bearing - spur.junctionBearing);
      const all = sampleLeg(shape, leg, altitude, leg.altTo, offset);
      const wrappedLead = leadBearing < leg.from - 180 ? leadBearing + 360 : leadBearing;
      const skipUntil = wrappedLead + (10 / nominalRadius) / DEG2RAD;
      points = [leadEnd.slice()];
      for (let i = 0; i < all.length; i += 1) {
        const bearing = leg.from + ((leg.to - leg.from) * i) / (all.length - 1);
        if (bearing > skipUntil) points.push(all[i]);
      }
    } else {
      points = sampleLeg(shape, leg, altitude, leg.altTo);
    }
    path = pending ? joinHairpin(path, points, world.road.hairpinRadius) : appendLeg(path, points);
    pending = leg.hairpin ? leg : null;
    altitude = leg.altTo;
  });
  path.push([0, 0]); // run in to the summit plaza
  const pinned = leadCount + 1;
  return { points: finishPath(path, spacing, false, pinned, 2), junctionIndex };
}
