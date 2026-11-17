// Every number that shapes the mountain and its roads. Angles are degrees, lengths metres.
//
// Coordinates: +X east, -Z north, +Y up. Polar angles are measured from +X toward +Z, so 90° is south.
// Roads are described as legs in (bearing, altitude) space and placed on the matching contour of the
// smooth base mountain, which is what makes them hug the slope like a real mountain road.

export const WORLD = Object.freeze({
  seed: 76421,

  grid: Object.freeze({
    cell: 2, // metres between height samples
    size: 1281, // samples per side -> 2560 m square, centred on the origin
  }),

  mountain: Object.freeze({
    peakHeight: 520,
    valleyFloor: 40,
    baseRadius: 1080,
    profilePower: 1.6, // >1 gives a concave flank that steepens toward the summit
    summitRounding: 0.1, // fraction of baseRadius over which the tip is rounded into a dome
    // Angular lobes of the footprint: [harmonic, amplitude, phase]. They become the spurs and bowls the road winds around.
    lobes: Object.freeze([
      [2, 0.1, 0.7],
      [3, 0.085, 2.1],
      [5, 0.05, 4.4],
      [7, 0.03, 1.3],
      [11, 0.016, 5.2],
    ]),
    ridgeAmplitude: 30,
    ridgeScale: 290,
    detailAmplitude: 15,
    detailScale: 130,
    microAmplitude: 1.1,
    microScale: 14,
    rimStart: 1130, // distance from the peak where the surrounding ranges begin to rise
    rimHeight: 210,
    lake: Object.freeze({ x: 930, z: -640, radius: 250, depth: 16 }),
    waterLevel: 33,
    snowLine: 400,
    treeLine: 365,
  }),

  erosion: Object.freeze({
    droplets: 90000,
    radius: 3,
    inertia: 0.05,
    capacity: 4,
    minCapacity: 0.01,
    deposit: 0.3,
    erode: 0.3,
    evaporate: 0.01,
    gravity: 4,
    lifetime: 30,
    strength: 0.55, // scales how much each droplet moves; 1 is Lague's default
  }),

  road: Object.freeze({
    spacing: 2, // metres between centreline samples
    halfWidth: 4.6, // asphalt half width on straights
    hairpinExtraWidth: 1.3, // added to halfWidth in the tightest corners
    shoulder: 1.4, // gravel strip flush with the asphalt
    verge: 1.6, // strip that slopes down to the carved bed
    vergeDrop: 0.3,
    bedMargin: 3, // carved flat ground beyond the verge; must exceed the grid cell diagonal
    cutSlope: 1.6, // rise per metre of rock cut above the road
    fillSlope: 1.3, // drop per metre of embankment below the road
    corridorClear: 24, // large-scale terrain detail is fully suppressed within this distance of a road
    corridorFade: 150, // ...and fully restored beyond this distance
    sink: 1, // road sits this far below the smooth base so it is mostly in cut
    maxGrade: 0.105,
    hairpinRadius: 18,
    bankGain: 2.4, // bank slope = curvature * gain
    maxBank: 0.09, // ~5 degrees
    railOffset: 0.55, // guardrail distance beyond the shoulder edge
    railHeight: 0.85,
    railDropThreshold: 1.3, // rail a side when the natural ground there is this far below the road
  }),

  // Closed loop. Each leg sweeps bearing `from`->`to` while altitude goes `alt[0]`->`alt[1]`.
  // `hairpin: true` joins a leg to the next with a switchback. `wiggle` is [amplitude m, cycles].
  loop: Object.freeze([
    { from: 90, to: 150, alt: [76, 122], wiggle: [9, 3] },
    { from: 150, to: 207, alt: [122, 176], wiggle: [7, 2], hairpin: true },
    { from: 207, to: 170, alt: [176, 208], wiggle: [5, 1], hairpin: true },
    { from: 170, to: 250, alt: [208, 268], wiggle: [8, 3] },
    { from: 250, to: 287, alt: [268, 280], wiggle: [5, 1] },
    { from: 287, to: 352, alt: [280, 228], wiggle: [7, 2], hairpin: true },
    { from: 352, to: 318, alt: [228, 201], wiggle: [5, 1], hairpin: true },
    { from: 318, to: 402, alt: [201, 130], wiggle: [9, 3] },
    { from: 402, to: 450, alt: [130, 76], wiggle: [8, 2] },
  ]),

  // Dead-end spur from the pass to the summit plaza. Starts on the loop at `junctionBearing`.
  spur: Object.freeze({
    junctionBearing: 270,
    forkOffset: 15, // extra uphill offset that peels the spur away from the loop
    forkSpan: 13, // degrees of bearing over which that offset ramps in
    // One switchback, then a spiral that winds almost twice around the summit. Each hairpin on slopes this
    // steep costs ~20 m of climb, so the legs are kept gentle enough to win it back.
    // `smooth` irons out the small footprint lobes, which would otherwise kink the road where the radius is small.
    legs: Object.freeze([
      { from: 270, to: 396, altTo: 332, wiggle: [6, 3], hairpin: true },
      { from: 396, to: -292, altTo: 512, wiggle: [5, 8], smooth: 14 },
    ]),
    plazaRadius: 22,
  }),
});
