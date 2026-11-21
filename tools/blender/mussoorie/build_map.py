"""
Mussoorie map: authored in Blender, exported to the game by export_map.py.

Run inside Blender (Scripting tab, or over the BlenderMCP socket). It rebuilds three collections:

  MSR_Terrain     one grid mesh, 641 x 641 samples at 4 m (2560 m square). Sculpt it freely;
                  the exporter ray-casts it, so topology may change.
  MSR_Roads       two POLY curves: Road_Loop (closed circuit) and Road_Spur (Landour climb to
                  Lal Tibba). Edit the points; the exporter resamples them and the game grades them.
  MSR_Props       prototype buildings, parked far outside the map (x = 4000 m). One mesh per prop.
  MSR_Placements  linked duplicates of the prototypes, placed around the town. Move, rotate,
                  duplicate (Alt+D) or delete them; the exporter writes one record per object.
  MSR_Labels      empties naming landmarks (minimap labels and milestone text).

Axes: Blender +X east, +Y north, +Z up. The game uses +X east, -Z north, +Y up.

Geography (stylised, ~0.55 horizontal and vertical compression of the real town):
  the ridge runs west to east. Library Chowk is at the west end, Mall Road runs along the south
  (Doon valley) flank to Picture Palace and Kulri, Camel's Back Road returns along the north
  (Himalaya) flank, and Landour climbs east from Kulri past the Clock Tower and Char Dukan to
  Lal Tibba, the highest point. Game height y maps to real altitude as y / 0.55 + 1650 m.
"""

import math
import bpy
import bmesh
import numpy as np

SIZE = 641
CELL = 4.0
HALF = (SIZE - 1) * CELL / 2  # 1280 m
WATER_LEVEL = 30.0
PROP_PARK_X = 4000.0

# Ridge crest: (x, y, altitude). Distances in metres, altitude in game metres.
CREST = [
    (-1400, -260, 95),
    (-1180, -210, 150),
    (-960, -120, 200),   # Library Chowk knob
    (-760, -60, 212),
    (-600, -10, 216),
    (-440, 80, 248),     # Gun Hill
    (-320, 70, 220),     # Kulri saddle
    (-120, 50, 232),
    (140, 20, 258),
    (400, 10, 282),
    (690, 30, 304),      # Clock Tower ridge
    (860, 80, 322),
    (1000, 180, 346),    # Lal Tibba
    (1180, 260, 300),
    (1400, 330, 230),
]

# Gaussian knobs (x, y, height, radius): Gun Hill and Lal Tibba crowns, Camel's Back hump.
KNOBS = [
    (-440, 90, 26, 70),
    (1000, 185, 14, 90),
    (-700, 190, 10, 60),
]

# Lakes (x, y, radius, bottom). Mussoorie Lake below town on the Doon side.
LAKES = [
    (-560, -760, 120, 22.0),
]

# Road control points, (x, y) in metres. Consecutive points are joined by a Catmull-Rom spline.
# Hairpins are three points close together. Named spans are recorded for prop placement.
LOOP = [
    # Mall Road, east to west along the Doon flank. Starts near Picture Palace.
    ("mall", (-300, -10)),
    ("mall", (-420, -20)),
    ("mall", (-560, -60)),
    ("mall", (-700, -105)),
    ("mall", (-840, -150)),
    # Library Chowk, the bend round the west knob.
    ("library", (-950, -195)),
    ("library", (-1040, -215)),
    # Down toward Company Garden on the south-west slope, two hairpins.
    ("company", (-1120, -260)),
    ("company", (-1050, -330)),
    ("company", (-1000, -360)),
    ("company", (-1035, -400)),
    ("company", (-1150, -420)),
    ("company", (-1240, -400)),
    ("company", (-1290, -340)),
    # Round the low west end of the ridge onto the north side.
    ("kempty", (-1300, -230)),
    ("kempty", (-1260, -110)),
    ("kempty", (-1180, 0)),
    # Happy Valley, then a switchback up toward Camel's Back.
    ("happy", (-1080, 90)),
    ("happy", (-990, 150)),
    ("happy", (-882, 186)),
    ("happy", (-945, 234)),
    ("happy", (-1000, 250)),
    ("happy", (-960, 300)),
    ("happy", (-860, 300)),
    # Camel's Back Road, west to east along the Himalaya flank.
    ("camels", (-760, 280)),
    ("camels", (-640, 250)),
    ("camels", (-520, 240)),
    ("camels", (-400, 215)),
    ("camels", (-300, 170)),
    # Kulri, over the saddle and back to Picture Palace.
    ("kulri", (-230, 110)),
    ("kulri", (-215, 40)),
    ("kulri", (-250, 5)),
]

SPUR = [
    # Leaves the loop just east of the Kulri bend and climbs the Landour flank.
    ("landour", (-232, 22)),
    ("landour", (-160, 10)),
    ("landour", (-40, -30)),
    ("landour", (100, -70)),
    ("landour", (240, -95)),
    ("landour", (322, -108)),
    ("landour", (382, -70)),   # hairpin
    ("landour", (322, -32)),
    ("landour", (212, -28)),
    ("landour", (126, 6)),     # hairpin
    ("landour", (212, 42)),
    ("landour", (360, 5)),
    ("landour", (500, -25)),
    ("clock", (620, -40)),
    ("clock", (720, -30)),     # Clock Tower
    ("chardukan", (820, -10)),
    ("chardukan", (900, 30)),  # Char Dukan
    ("sisters", (950, 80)),
    ("sisters", (930, 130)),
    ("laltibba", (960, 165)),
    ("laltibba", (1000, 182)), # Lal Tibba plaza centre
]

PLAZA = (1000, 182)
PLAZA_RADIUS = 22.0

# Nag Tibba (stylised): a big cone north of town across the Camel's Back valley, climbed by a stacked
# switchback road up its south face (Stelvio-style: ~200 m legs, 14 m hairpins about 36 m apart up the
# slope), then a straight final run to the summit car park. Raw coordinates, fitted below.
PEAK = {
    "center": (-420, 867),
    "height": 315.0,     # added to the valley floor; the summit reads about 2,450 m
    "radius": 640.0,     # footprint of the cone
    "power": 1.25,       # >1: concave flanks, steepest toward the top
    "round": 160.0,      # summit rounding (m): a broad top for the car park
    "plaza_radius": 26.0,
    "hairpin": 14.0,     # hairpin centreline radius
    "drift": 12.0,       # how far each leg moves up-slope between its hairpins
    "leg": 280.0,        # target leg length (m)
    "top": 105.0,        # last hairpin radius from the summit; a straight run finishes the climb
}

# The authored layout is fitted inside the grid (with room for the framing ranges) by one transform.
FIT_SCALE = 0.9
FIT_SHIFT = (70.0, 20.0)


def fit(x, y):
    return (x * FIT_SCALE + FIT_SHIFT[0], y * FIT_SCALE + FIT_SHIFT[1])


CREST = [(*fit(x, y), h) for x, y, h in CREST]
KNOBS = [(*fit(x, y), h, r * FIT_SCALE) for x, y, h, r in KNOBS]
LAKES = [(*fit(x, y), r, b) for x, y, r, b in LAKES]
LOOP = [(n, fit(*p)) for n, p in LOOP]
SPUR = [(n, fit(*p)) for n, p in SPUR]
PLAZA = fit(*PLAZA)
PEAK["center"] = fit(*PEAK["center"])


# ---------------------------------------------------------------- utilities


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def catmull_rom(points, closed, step=4.0):
    """Densify control points with a centripetal Catmull-Rom spline, roughly `step` metres apart."""
    pts = [np.array(p, dtype=float) for p in points]
    n = len(pts)
    out = []
    segments = n if closed else n - 1
    for i in range(segments):
        p0 = pts[(i - 1) % n] if (closed or i > 0) else pts[0] * 2 - pts[1]
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        p3 = pts[(i + 2) % n] if (closed or i + 2 < n) else p2 * 2 - p1
        length = np.linalg.norm(p2 - p1)
        count = max(2, int(math.ceil(length / step)))
        t0 = 0.0
        t1 = t0 + max(np.linalg.norm(p1 - p0), 1e-3) ** 0.5
        t2 = t1 + max(np.linalg.norm(p2 - p1), 1e-3) ** 0.5
        t3 = t2 + max(np.linalg.norm(p3 - p2), 1e-3) ** 0.5
        for k in range(count):
            t = t1 + (t2 - t1) * k / count
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    if not closed:
        out.append(pts[-1])
    return np.array(out)


def span_ranges(spec, dense, closed):
    """Map each named span to the dense indices nearest its control points."""
    ranges = {}
    for name, p in spec:
        d = np.hypot(dense[:, 0] - p[0], dense[:, 1] - p[1])
        i = int(np.argmin(d))
        lo, hi = ranges.get(name, (i, i))
        ranges[name] = (min(lo, i), max(hi, i))
    return ranges


def value_noise(x, y, seed):
    """Smooth 2D value noise on a unit lattice, vectorised over arrays."""
    xi = np.floor(x).astype(np.int64)
    yi = np.floor(y).astype(np.int64)
    xf = x - xi
    yf = y - yi

    def h(ix, iy):
        n = (ix * 374761393 + iy * 668265263 + seed * 2147483647) & 0xFFFFFFFF
        n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
        return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0 * 2 - 1

    u = xf * xf * (3 - 2 * xf)
    v = yf * yf * (3 - 2 * yf)
    a = h(xi, yi)
    b = h(xi + 1, yi)
    c = h(xi, yi + 1)
    d = h(xi + 1, yi + 1)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v


def fbm(x, y, scale, octaves, seed):
    total = np.zeros_like(x)
    amp = 1.0
    freq = 1.0 / scale
    norm = 0.0
    for o in range(octaves):
        total += value_noise(x * freq, y * freq, seed + o * 17) * amp
        norm += amp
        amp *= 0.5
        freq *= 2.03
    return total / norm


def crest_field(X, Y):
    """Signed distance to the crest polyline (north positive) and the crest altitude at the nearest point."""
    best = np.full(X.shape, np.inf)
    signed = np.zeros(X.shape)
    alt = np.zeros(X.shape)
    along = np.zeros(X.shape)
    run = 0.0
    for (ax, ay, ah), (bx, by, bh) in zip(CREST[:-1], CREST[1:]):
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy
        length = math.sqrt(length2)
        t = np.clip(((X - ax) * dx + (Y - ay) * dy) / length2, 0, 1)
        px = ax + t * dx
        py = ay + t * dy
        d = np.hypot(X - px, Y - py)
        closer = d < best
        best = np.where(closer, d, best)
        side = np.sign(dx * (Y - ay) - dy * (X - ax))  # +1 left of travel (travel is eastward) = north
        signed = np.where(closer, d * side, signed)
        alt = np.where(closer, ah + t * (bh - ah), alt)
        along = np.where(closer, run + t * length, along)
        run += length
    return signed, alt, along


def box_blur(A, k):
    """Mean over a (2k+1)^2 window via summed-area table, edges clamped."""
    pad = np.pad(A, k + 1, mode="edge")
    cs = pad.cumsum(0).cumsum(1)
    n = 2 * k + 1
    out = cs[n:, n:] - cs[:-n, n:] - cs[n:, :-n] + cs[:-n, :-n]
    return out[: A.shape[0], : A.shape[1]] / (n * n)


def road_distance_field(polylines, X, Y, reach=160.0):
    """Distance from every grid node to the nearest road polyline, capped at `reach`."""
    field = np.full(X.shape, reach)
    step = CELL
    for line in polylines:
        for p in line[::2]:
            ix = int(round((p[0] + HALF) / step))
            iy = int(round((p[1] + HALF) / step))
            r = int(reach / step) + 1
            x0, x1 = max(0, ix - r), min(SIZE, ix + r + 1)
            y0, y1 = max(0, iy - r), min(SIZE, iy + r + 1)
            if x0 >= x1 or y0 >= y1:
                continue
            d = np.hypot(X[y0:y1, x0:x1] - p[0], Y[y0:y1, x0:x1] - p[1])
            field[y0:y1, x0:x1] = np.minimum(field[y0:y1, x0:x1], d)
    return field


def sample_bilinear(H, x, y):
    gx = np.clip((x + HALF) / CELL, 0, SIZE - 1.001)
    gy = np.clip((y + HALF) / CELL, 0, SIZE - 1.001)
    ix = gx.astype(int)
    iy = gy.astype(int)
    fx = gx - ix
    fy = gy - iy
    top = H[iy, ix] * (1 - fx) + H[iy, ix + 1] * fx
    bottom = H[iy + 1, ix] * (1 - fx) + H[iy + 1, ix + 1] * fx
    return top * (1 - fy) + bottom * fy


def grade_limit(z, spacing, max_grade, closed, passes=6):
    z = z.copy()
    step = max_grade * spacing
    n = len(z)
    for _ in range(passes):
        rng = range(1, n + (n if closed else 0))
        for i in rng:
            a, b = (i - 1) % n, i % n
            z[b] = min(max(z[b], z[a] - step), z[a] + step)
        for i in range(n * (2 if closed else 1) - 2, -1, -1):
            a, b = (i + 1) % n, i % n
            z[b] = min(max(z[b], z[a] - step), z[a] + step)
    return z


def smooth1d(z, sigma, closed):
    r = int(sigma * 3)
    k = np.exp(-np.arange(-r, r + 1) ** 2 / (2 * sigma * sigma))
    k /= k.sum()
    if closed:
        padded = np.concatenate([z[-r:], z, z[:r]])
        return np.convolve(padded, k, mode="same")[r:-r]
    padded = np.concatenate([np.full(r, z[0]), z, np.full(r, z[-1])])
    return np.convolve(padded, k, mode="same")[r:-r]


# ---------------------------------------------------------------- terrain


def peak_bump(X, Y):
    cx, cy = PEAK["center"]
    r = np.hypot(X - cx, Y - cy)
    # Round the tip only: r_eff = r^2 / 2a inside `round`, r - a/2 outside (continuous with its slope),
    # so the footprint is unchanged.
    a = PEAK["round"]
    r_eff = np.where(r < a, r * r / (2 * a), r - a / 2)
    return PEAK["height"] * np.clip(1 - r_eff / (PEAK["radius"] - a / 2), 0, 1) ** PEAK["power"]


def build_heights(loop_xy, spur_xy, peak_xy=None):
    coords = np.arange(SIZE) * CELL - HALF
    X, Y = np.meshgrid(coords, coords)  # row = y, column = x

    signed, crest_alt, along = crest_field(X, Y)
    south = signed < 0
    width = np.where(south, 330.0, 430.0)
    floor = np.where(south, 40.0, 58.0)
    d = np.abs(signed)
    H = floor + (crest_alt - floor) / (1 + (d / width) ** 2)
    # The nearest-segment crest field has creases on the bisectors between segments; two box blurs
    # (~50 m) remove them without moving the ridge.
    H = box_blur(box_blur(H, 12), 12)
    d = box_blur(d, 12)

    # Spurs and gullies run downhill (north-south here), so the noise is stretched along Y.
    flank = smoothstep(50, 260, d) * (1 - 0.5 * smoothstep(700, 1100, d))
    warp = fbm(X, Y, 420, 2, 11) * 90
    H += fbm(X + warp, Y * 0.28, 110, 3, 5) * 26 * flank
    H += fbm(X, Y, 260, 4, 3) * 18 * flank
    H += fbm(X, Y, 60, 3, 7) * 4.5 * smoothstep(20, 120, d)

    for kx, ky, kh, kr in KNOBS:
        H += kh * np.exp(-((X - kx) ** 2 + (Y - ky) ** 2) / (2 * kr * kr))
    H += peak_bump(X, Y)

    # Distant ranges framing the map, highest to the north (the Himalayan side).
    edge = (np.abs(X) ** 4 + np.abs(Y) ** 4) ** 0.25
    rim = smoothstep(1050, 1270, edge)
    north = smoothstep(-200, 900, Y)
    H += rim * (60 + 140 * north) * (0.7 + 0.3 * fbm(X, Y, 200, 2, 21))

    # Calm the relief along the roads so the carved bed meets gentle ground.
    roads_d = road_distance_field([loop_xy, spur_xy] + ([peak_xy] if peak_xy is not None else []), X, Y)
    keep = smoothstep(18, 120, roads_d)
    calm = H.copy()
    # Low-pass the terrain near roads: a coarse box blur stands in for "the hillside without the bumps".
    blur = box_blur(H, 9)
    H = calm * keep + blur * (1 - keep)

    for lx, ly, lr, bottom in LAKES:
        r = np.hypot(X - lx, Y - ly)
        bowl = 1 - smoothstep(lr * 0.55, lr * 1.25, r)
        H = H * (1 - bowl) + np.minimum(H, bottom) * bowl
        rimband = (1 - smoothstep(lr * 1.2, lr * 2.0, r)) * (r > lr * 1.2)
        H = np.maximum(H, WATER_LEVEL + 1.2) * rimband + H * (1 - rimband)

    return X, Y, H, roads_d


def polar(theta, r):
    cx, cy = PEAK["center"]
    return np.array([cx + r * math.cos(theta), cy + r * math.sin(theta)])


def build_peak_road(loop_xy, loop_spans):
    """Stacked switchbacks up the south face of the peak, from the nearest point of Camel's Back Road.

    Each leg runs across the face (around the cone) while drifting `drift` metres up-slope, then a
    14 m hairpin turns it back one hairpin diameter higher, so consecutive apexes are drift + 2 * hairpin
    apart up the fall line. Legs are centred on the face so the stack is seen from below; the last
    hairpin is followed by a straight run up to the summit plaza."""
    c = np.array(PEAK["center"])
    lo, hi = loop_spans["camels"]
    span = loop_xy[lo:hi + 1]
    j = lo + int(np.argmin(np.hypot(span[:, 0] - c[0], span[:, 1] - c[1])))
    start = loop_xy[j]
    theta0 = math.atan2(start[1] - c[1], start[0] - c[0])
    distance = float(np.hypot(*(start - c)))
    h = PEAK["hairpin"]
    drift = PEAK["drift"]

    points = [start]
    # Leave Camel's Back square-on, then head up the valley to the foot of the stack.
    toward = (c - start) / distance
    for d in (30.0, 70.0):
        points.append(start + toward * d)
    r = min(distance - 80.0, PEAK["radius"] * 0.8)
    points.append(polar(theta0, r))

    sign = 1
    theta = theta0
    legs = 0
    while r - drift - 2 * h > PEAK["top"]:
        half = min(0.75, (PEAK["leg"] / 2) / r)
        theta_end = theta0 + sign * half
        length = abs(theta_end - theta) * r
        steps = max(2, int(length / 30))
        for k in range(1, steps + 1):
            t = k / steps
            points.append(polar(theta + (theta_end - theta) * t, r - drift * t))
        # Hairpin: a semicircle round a centre one hairpin radius further up-slope, bulging past the leg end.
        centre_r = r - drift - h
        tangent = np.array([-math.sin(theta_end), math.cos(theta_end)]) * sign
        radial = np.array([math.cos(theta_end), math.sin(theta_end)])
        pc = polar(theta_end, centre_r)
        for phi in (math.pi / 4, math.pi / 2, 3 * math.pi / 4):
            points.append(pc + h * (math.cos(phi) * radial + math.sin(phi) * tangent))
        r = centre_r - h
        points.append(polar(theta_end, r))
        theta = theta_end
        sign = -sign
        legs += 1

    # Back across to the middle of the face, then straight up to the top.
    points.append(polar(theta0 + (theta - theta0) * 0.35, r - 6))
    points.append(polar(theta0, r * 0.55))
    points.append(c.copy())
    print("peak road: %d legs, junction loop index %d" % (legs, j))
    return np.array(points), j, legs


def road_profile(xy, H, closed, start_z=None):
    z = sample_bilinear(H, xy[:, 0], xy[:, 1]) - 1.0
    if start_z is not None:
        # A branch leaves its parent road at the parent's height (the game pins the fork the same way).
        s0 = np.concatenate([[0], np.cumsum(np.hypot(np.diff(xy[:, 0]), np.diff(xy[:, 1])))])
        z = z + (start_z - z) * (1 - smoothstep(20, 120, s0))
    seg = np.hypot(np.diff(xy[:, 0]), np.diff(xy[:, 1]))
    spacing = float(seg.mean())
    z = smooth1d(z, 22 / spacing, closed)
    if not closed:
        # Arrive level at the plaza, the same way the game grades it (World.buildMapRoads).
        s = np.concatenate([[0], np.cumsum(seg)])
        total = s[-1]
        arrival = float(np.interp(total - 110, s, z))
        z = z + (arrival - z) * smoothstep(total - 150, total - 70, s)
    z = grade_limit(z, spacing, 0.10, closed)
    return smooth1d(z, 10 / spacing, closed)


def flatten_roadbeds(X, Y, H, roads):
    """Press the terrain onto each road profile inside a narrow corridor, so Blender shows the road
    sitting in its cut. The game re-carves precisely; this is for authoring and preview."""
    best = np.full(H.shape, 1e9)
    target = H.copy()
    for xy, z in roads:
        for p, h in zip(xy, z):
            ix = int(round((p[0] + HALF) / CELL))
            iy = int(round((p[1] + HALF) / CELL))
            r = 12
            x0, x1 = max(0, ix - r), min(SIZE, ix + r + 1)
            y0, y1 = max(0, iy - r), min(SIZE, iy + r + 1)
            d = np.hypot(X[y0:y1, x0:x1] - p[0], Y[y0:y1, x0:x1] - p[1])
            sub_best = best[y0:y1, x0:x1]
            closer = d < sub_best
            sub_best[closer] = d[closer]
            target[y0:y1, x0:x1][closer] = h
    w = 1 - smoothstep(9, 40, best)
    H = H * (1 - w) + target * w
    # Summit plazas: a level disc at each open road's arrival height, blended into the hill.
    for (px, py, radius), (xy, z) in zip([(PLAZA[0], PLAZA[1], PLAZA_RADIUS), (*PEAK["center"], PEAK["plaza_radius"])], roads[1:]):
        r = np.hypot(X - px, Y - py)
        w = 1 - smoothstep(radius + 6, radius + 70, r)
        H = H * (1 - w) + float(z[-1]) * w
    return H


# ---------------------------------------------------------------- blender scene


def reset_collection(name):
    coll = bpy.data.collections.get(name)
    if coll:
        for obj in list(coll.objects):
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if data is not None and getattr(data, "users", 1) == 0:
                if isinstance(data, bpy.types.Mesh):
                    bpy.data.meshes.remove(data)
                elif isinstance(data, bpy.types.Curve):
                    bpy.data.curves.remove(data)
    else:
        coll = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(coll)
    return coll


def material(name, color, roughness=0.8, metallic=0.0, emission=None):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    mat.diffuse_color = (*color, 1.0)
    return mat


def srgb(hex_value):
    r = ((hex_value >> 16) & 255) / 255
    g = ((hex_value >> 8) & 255) / 255
    b = (hex_value & 255) / 255
    to_lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (to_lin(r), to_lin(g), to_lin(b))


def build_terrain_object(H, coll):
    xs = np.arange(SIZE) * CELL - HALF
    X, Y = np.meshgrid(xs, xs)
    verts = np.stack([X.ravel(), Y.ravel(), H.ravel()], axis=1).astype(np.float32)
    i = np.arange(SIZE - 1)
    I, J = np.meshgrid(i, i)
    a = (J * SIZE + I).ravel()
    quads = np.stack([a, a + 1, a + SIZE + 1, a + SIZE], axis=1)
    mesh = bpy.data.meshes.new("MSR_TerrainMesh")
    mesh.vertices.add(len(verts))
    mesh.vertices.foreach_set("co", verts.ravel())
    mesh.loops.add(quads.size)
    mesh.loops.foreach_set("vertex_index", quads.ravel().astype(np.int32))
    mesh.polygons.add(len(quads))
    mesh.polygons.foreach_set("loop_start", (np.arange(len(quads)) * 4).astype(np.int32))
    mesh.polygons.foreach_set("loop_total", np.full(len(quads), 4, dtype=np.int32))
    mesh.update(calc_edges=True)
    mesh.validate()
    mesh.polygons.foreach_set("use_smooth", np.ones(len(quads), dtype=bool))
    obj = bpy.data.objects.new("Terrain", mesh)
    coll.objects.link(obj)
    obj.data.materials.append(material("MSR_Ground", srgb(0x4A5A34), 0.95))
    obj["msr_role"] = "terrain"
    return obj


def build_road_curve(name, xy, z, closed, coll, spans):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    spline = curve.splines.new("POLY")
    spline.points.add(len(xy) - 1)
    for k, (p, h) in enumerate(zip(xy, z)):
        spline.points[k].co = (float(p[0]), float(p[1]), float(h) + 0.3, 1.0)
    spline.use_cyclic_u = closed
    curve.bevel_depth = 0.0
    curve.extrude = 4.6  # ribbon preview of the asphalt width
    obj = bpy.data.objects.new(name, curve)
    coll.objects.link(obj)
    obj.data.materials.append(material("MSR_Asphalt", srgb(0x2B2B2D), 0.9))
    obj["msr_role"] = "road"
    obj["msr_closed"] = closed
    for span, (lo, hi) in spans.items():
        obj["span_" + span] = [lo, hi]
    return obj


# ---------------------------------------------------------------- props

PALETTE = {
    "whitewash": srgb(0xEDE6D3),
    "cream": srgb(0xE8D9AE),
    "pastel_blue": srgb(0xB9CCD6),
    "pastel_pink": srgb(0xE3C2B8),
    "ochre": srgb(0xD8A84A),
    "tin_red": srgb(0xA2301F),
    "tin_green": srgb(0x2F5A3A),
    "stone": srgb(0x7B766C),
    "dark_stone": srgb(0x4A463F),
    "timber": srgb(0x5A3A24),
    "black": srgb(0x14110D),
    "glass": srgb(0x2A3540),
    "marigold": srgb(0xF2B01E),
    "tarp_blue": srgb(0x2A6FB0),
    "steel": srgb(0x8C9196),
    "rock": srgb(0x6E675C),
    "flag_green": srgb(0x2E7D4F),
    "saffron": srgb(0xE07A1F),
}


def mats():
    return {k: material("MSR_" + k, v, 0.35 if k == "glass" else 0.85, 0.6 if k == "steel" else 0.0) for k, v in PALETTE.items()}


class PropBuilder:
    """Builds one mesh from boxes, prisms and cylinders with per-face material indices."""

    def __init__(self, name, materials):
        self.name = name
        self.bm = bmesh.new()
        self.slots = []
        self.materials = materials

    def slot(self, key):
        if key not in self.slots:
            self.slots.append(key)
        return self.slots.index(key)

    def _tag(self, faces, key):
        index = self.slot(key)
        for f in faces:
            f.material_index = index

    def box(self, cx, cy, z0, sx, sy, sz, key):
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = r["verts"]
        bmesh.ops.scale(self.bm, vec=(sx, sy, sz), verts=verts)
        bmesh.ops.translate(self.bm, vec=(cx, cy, z0 + sz / 2), verts=verts)
        self._tag({f for v in verts for f in v.link_faces}, key)

    def gable(self, cx, cy, z0, sx, sy, rise, key, overhang=0.5, axis="x"):
        """Pitched roof with its ridge along X (or Y with axis="y")."""
        hx, hy = sx / 2 + overhang, sy / 2 + overhang
        pts = [(-hx, -hy, 0), (hx, -hy, 0), (hx, hy, 0), (-hx, hy, 0), (-hx, 0, rise), (hx, 0, rise)]
        if axis == "y":
            hx, hy = sy / 2 + overhang, sx / 2 + overhang
            pts = [(hy, -hx, 0), (hy, hx, 0), (-hy, hx, 0), (-hy, -hx, 0), (0, -hx, rise), (0, hx, rise)]
        v = [self.bm.verts.new((cx + a, cy + b, z0 + c)) for a, b, c in pts]
        faces = [
            self.bm.faces.new((v[0], v[1], v[5], v[4])),
            self.bm.faces.new((v[2], v[3], v[4], v[5])),
            self.bm.faces.new((v[1], v[2], v[5])),
            self.bm.faces.new((v[3], v[0], v[4])),
            self.bm.faces.new((v[3], v[2], v[1], v[0])),
        ]
        self._tag(faces, key)

    def pyramid(self, cx, cy, z0, sx, sy, rise, key):
        hx, hy = sx / 2, sy / 2
        v = [self.bm.verts.new(p) for p in [
            (cx - hx, cy - hy, z0), (cx + hx, cy - hy, z0), (cx + hx, cy + hy, z0), (cx - hx, cy + hy, z0), (cx, cy, z0 + rise)]]
        faces = [self.bm.faces.new((v[i], v[(i + 1) % 4], v[4])) for i in range(4)]
        faces.append(self.bm.faces.new((v[3], v[2], v[1], v[0])))
        self._tag(faces, key)

    def cylinder(self, cx, cy, z0, radius, height, key, segments=10, radius_top=None):
        r = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=segments, radius1=radius,
                                  radius2=radius if radius_top is None else radius_top, depth=height)
        verts = r["verts"]
        bmesh.ops.translate(self.bm, vec=(cx, cy, z0 + height / 2), verts=verts)
        self._tag({f for v in verts for f in v.link_faces}, key)

    def windows(self, cx, cy, z0, sx, sy, floors, floor_h, key="glass", side="-y"):
        """Dark window panes slightly proud of the -Y (street) facade."""
        count = max(1, int(sx // 3))
        for f in range(floors):
            for k in range(count):
                x = cx - sx / 2 + (k + 0.5) * sx / count
                self.box(x, cy - sy / 2 - 0.05, z0 + f * floor_h + 1.0, 1.1, 0.12, 1.5, key)

    def finish(self, coll, park_index):
        mesh = bpy.data.meshes.new(self.name)
        self.bm.normal_update()
        self.bm.to_mesh(mesh)
        self.bm.free()
        for key in self.slots:
            mesh.materials.append(self.materials[key])
        obj = bpy.data.objects.new(self.name, mesh)
        obj.location = (PROP_PARK_X, park_index * 40.0, 0)
        coll.objects.link(obj)
        obj["msr_role"] = "prop"
        return obj


def build_props(coll):
    m = mats()
    props = {}
    specs = []

    # Every building stands on a stone plinth that runs 5 m below its origin, so on a slope it
    # reads as a retaining base instead of floating. Street facade faces -Y (the road).
    def cottage(name, wall, roof, sx=9, sy=8, floors=2):
        b = PropBuilder(name, m)
        b.box(0, 0, -5, sx + 0.6, sy + 0.6, 5.3, "dark_stone")
        b.box(0, 0, 0.3, sx, sy, floors * 3.0, wall)
        b.windows(0, 0, 0.3, sx, sy, floors, 3.0)
        b.box(0, -sy / 2 - 1.1, 0.3 + 3.0, sx, 2.2, 0.25, "timber")  # balcony / veranda deck
        b.gable(0, 0, 0.3 + floors * 3.0, sx, sy, 2.6, roof)
        b.box(sx * 0.3, 0.8, 0.3 + floors * 3.0, 0.8, 0.8, 3.4, "stone")  # chimney
        return b

    for name, wall, roof in [
        ("P_Cottage_A", "whitewash", "tin_red"),
        ("P_Cottage_B", "pastel_blue", "tin_green"),
        ("P_Cottage_C", "pastel_pink", "tin_red"),
        ("P_Cottage_D", "cream", "tin_green"),
    ]:
        specs.append((name, cottage(name, wall, roof), (9.6, 11.0)))

    shop = PropBuilder("P_ShopRow", m)
    shop.box(0, 0, -5, 18.6, 10.6, 5.3, "dark_stone")
    shop.box(0, 0, 0.3, 18, 10, 9.6, "cream")
    shop.windows(0, 0, 3.5, 18, 10, 2, 3.0)
    for k in range(4):  # shopfront awnings
        shop.box(-6.75 + k * 4.5, -5.6, 2.6, 4.0, 1.4, 0.18, ["tin_red", "tin_green", "marigold", "tarp_blue"][k])
        shop.box(-6.75 + k * 4.5, -5.04, 0.3, 3.4, 0.1, 2.2, "glass")
    shop.gable(0, 0, 9.9, 18, 10, 3.2, "tin_green")
    specs.append(("P_ShopRow", shop, (18.6, 12.0)))

    library = PropBuilder("P_Library", m)
    library.box(0, 0, -5, 20.6, 13.6, 5.3, "dark_stone")
    library.box(0, 0, 0.3, 20, 13, 8, "ochre")
    library.windows(0, 0, 0.3, 20, 13, 2, 3.6)
    library.gable(0, 0, 8.3, 20, 13, 3.6, "tin_red")
    library.box(0, 0, 8.3, 4, 4, 6.5, "whitewash")
    library.pyramid(0, 0, 14.8, 4.6, 4.6, 4.0, "tin_red")
    specs.append(("P_Library", library, (20.6, 13.6)))

    gazebo = PropBuilder("P_Bandstand", m)
    gazebo.cylinder(0, 0, -3, 5.2, 3.6, "dark_stone", 8)
    for k in range(8):
        a = k / 8 * math.pi * 2
        gazebo.cylinder(math.cos(a) * 4.4, math.sin(a) * 4.4, 0.6, 0.18, 3.2, "whitewash", 6)
    gazebo.cylinder(0, 0, 3.8, 5.4, 2.4, "tin_green", 8, radius_top=0.3)
    specs.append(("P_Bandstand", gazebo, (10.4, 10.4)))

    cinema = PropBuilder("P_PicturePalace", m)
    cinema.box(0, 0, -5, 22.6, 14.6, 5.3, "dark_stone")
    cinema.box(0, 0, 0.3, 22, 14, 11, "whitewash")
    cinema.box(0, -7.15, 7.6, 16, 0.3, 2.4, "tin_red")       # name board
    cinema.box(0, -7.4, 2.8, 12, 2.0, 0.2, "black")           # marquee canopy
    cinema.windows(0, 0, 3.6, 22, 14, 1, 3.0)
    cinema.box(0, 0, 11.3, 22.4, 14.4, 0.6, "dark_stone")
    specs.append(("P_PicturePalace", cinema, (22.6, 15.6)))

    church = PropBuilder("P_Church", m)
    church.box(0, 0, -5, 9.6, 20.6, 5.3, "dark_stone")
    church.box(0, 0, 0.3, 9, 20, 7, "stone")
    church.gable(0, 0, 7.3, 9, 20, 4.2, "tin_red", axis="y")
    church.box(0, -11.5, 0.3, 4.5, 4.5, 14, "stone")
    church.pyramid(0, -11.5, 14.3, 5, 5, 7, "tin_red")
    specs.append(("P_Church", church, (10.0, 24.0)))

    tower = PropBuilder("P_ClockTower", m)
    tower.box(0, 0, -4, 6.6, 6.6, 4.3, "dark_stone")
    tower.box(0, 0, 0.3, 5.4, 5.4, 16, "cream")
    tower.box(0, 0, 16.3, 6.2, 6.2, 0.6, "whitewash")
    for dx, dy in [(0, -2.75), (0, 2.75), (-2.75, 0), (2.75, 0)]:
        tower.box(dx, dy, 13.0, 2.0 if dx == 0 else 0.15, 0.15 if dx == 0 else 2.0, 2.0, "black")  # clock faces
    tower.pyramid(0, 0, 16.9, 6.2, 6.2, 5.5, "tin_red")
    specs.append(("P_ClockTower", tower, (6.6, 6.6)))

    shops4 = PropBuilder("P_CharDukan", m)
    shops4.box(0, 0, -5, 20.6, 7.6, 5.3, "dark_stone")
    for k, wall in enumerate(["whitewash", "pastel_blue", "cream", "pastel_pink"]):
        x = -7.5 + k * 5
        shops4.box(x, 0, 0.3, 4.8, 7, 4.2, wall)
        shops4.box(x, -3.55, 0.3, 3.0, 0.1, 2.4, "glass")
        shops4.box(x, -4.3, 2.8, 4.6, 1.6, 0.15, ["tin_red", "tin_green", "marigold", "tarp_blue"][k])
        shops4.gable(x, 0, 4.5, 4.8, 7, 1.8, "tin_red" if k % 2 == 0 else "tin_green", overhang=0.3)
    specs.append(("P_CharDukan", shops4, (20.6, 9.4)))

    tapri = PropBuilder("P_ChaiTapri", m)
    tapri.box(0, 0, -2, 4.4, 3.4, 2.3, "dark_stone")
    tapri.box(0, 0.4, 0.3, 3.6, 2.4, 2.4, "timber")
    tapri.box(0, -0.9, 0.3, 3.6, 0.6, 1.0, "whitewash")       # counter
    tapri.box(0, -0.2, 2.9, 4.6, 4.0, 0.12, "tarp_blue")      # tarp roof
    tapri.cylinder(-1.0, -0.9, 1.3, 0.25, 0.5, "steel", 8)    # kettle
    tapri.box(0, -3.2, 0.3, 3.4, 0.5, 0.45, "timber")          # bench
    specs.append(("P_ChaiTapri", tapri, (4.6, 7.2)))

    view = PropBuilder("P_LalTibbaView", m)
    view.box(0, 0, -4, 9.6, 9.6, 4.3, "dark_stone")
    view.box(0, 0, 0.3, 9, 9, 3.4, "stone")
    view.box(0, 0, 3.7, 9.6, 9.6, 0.35, "whitewash")
    for k in range(12):
        a = k / 12 * math.pi * 2
        view.cylinder(math.cos(a) * 4.5, math.sin(a) * 4.5, 4.05, 0.07, 1.0, "black", 4)
    view.box(0, 0, 5.0, 9.4, 9.4, 0.08, "black")  # railing top (thin slab)
    view.cylinder(1.5, -2.0, 4.05, 0.12, 1.1, "black", 6)
    view.cylinder(1.5, -2.35, 5.15, 0.18, 0.9, "steel", 8)     # telescope
    view.box(-2.4, 2.4, 4.05, 2.4, 2.4, 2.4, "cream")         # cafe kiosk
    view.gable(-2.4, 2.4, 6.45, 2.4, 2.4, 1.0, "tin_red", overhang=0.3)
    specs.append(("P_LalTibbaView", view, (9.6, 9.6)))

    pylon = PropBuilder("P_RopewayPylon", m)
    pylon.box(0, 0, -2, 2.4, 2.4, 2.3, "dark_stone")
    pylon.cylinder(0, 0, 0.3, 0.45, 14, "steel", 8, radius_top=0.3)
    pylon.box(0, 0, 14.0, 6, 0.5, 0.5, "steel")
    specs.append(("P_RopewayPylon", pylon, (2.4, 2.4)))

    rock = PropBuilder("P_CamelRock", m)
    rock.cylinder(0, 0, -4, 7, 9, "rock", 9, radius_top=4.5)
    rock.cylinder(-3, 0, 4.6, 3.6, 5, "rock", 8, radius_top=2.0)   # hump
    rock.cylinder(4.5, 0, 4.0, 2.4, 6, "rock", 7, radius_top=1.4)  # neck
    rock.cylinder(6.0, 0, 9.6, 1.8, 1.8, "rock", 7)                # head
    specs.append(("P_CamelRock", rock, (16.0, 14.0)))

    # Nag Devta shrine at the summit: stone plinth, whitewashed sanctum, stepped shikhara, saffron flag.
    temple = PropBuilder("P_Temple", m)
    temple.box(0, 0, -3, 8.6, 8.6, 3.4, "dark_stone")
    temple.box(0, 0, 0.4, 8.0, 8.0, 0.6, "stone")
    temple.box(0, 0.6, 1.0, 4.6, 4.6, 3.6, "whitewash")
    temple.box(0, -2.6, 1.0, 3.0, 1.6, 2.6, "whitewash")      # porch
    temple.box(0, -3.45, 1.0, 1.2, 0.1, 2.0, "black")         # doorway
    for k, size in enumerate([4.4, 3.6, 2.8]):
        temple.box(0, 0.6, 4.6 + k * 1.2, size, size, 1.2, "saffron" if k % 2 else "whitewash")
    temple.pyramid(0, 0.6, 8.2, 2.4, 2.4, 2.6, "saffron")
    temple.cylinder(2.8, -2.8, 1.0, 0.08, 8.5, "timber", 6)
    temple.box(3.5, -2.8, 8.0, 1.4, 0.05, 0.9, "saffron")      # flag
    specs.append(("P_Temple", temple, (8.6, 8.6)))

    flags = PropBuilder("P_PrayerFlags", m)
    for x in (-9.0, 9.0):
        flags.cylinder(x, 0, -1.0, 0.1, 6.8, "timber", 6)
    colours = ["tarp_blue", "whitewash", "tin_red", "flag_green", "marigold"]
    for k in range(19):
        t = k / 18
        x = -9.0 + 18.0 * t
        z = 5.4 - 1.6 * (1 - (2 * t - 1) ** 2)                 # sagging string
        flags.box(x, 0, z - 0.55, 0.62, 0.04, 0.55, colours[k % 5])
    specs.append(("P_PrayerFlags", flags, (18.4, 1.2)))

    for index, (name, builder, size) in enumerate(specs):
        obj = builder.finish(coll, index)
        obj["msr_size"] = list(size)
        obj["msr_radius"] = math.hypot(*size) / 2
        props[name] = obj
    return props


# ---------------------------------------------------------------- placement


def frame_at(xy, i):
    n = len(xy)
    a = xy[max(0, i - 2)]
    b = xy[min(n - 1, i + 2)]
    t = b - a
    t = t / (np.linalg.norm(t) + 1e-9)
    right = np.array([t[1], -t[0]])  # right-hand side when travelling along +t
    return xy[i], t, right


ROAD_POINTS = None  # dense road samples, set in main(); placements keep clear of every road


ROAD_CLEARANCE = 10.0  # metres from a road centreline to the nearest wall (asphalt, shoulder, verge, margin)


def rect_clearance(x, y, yaw, w, d):
    """Distance from the footprint rectangle to the nearest road sample, and the direction away from it."""
    rel = ROAD_POINTS - np.array([x, y])
    c, s = math.cos(-yaw), math.sin(-yaw)
    lx = rel[:, 0] * c - rel[:, 1] * s
    ly = rel[:, 0] * s + rel[:, 1] * c
    dist = np.hypot(np.maximum(np.abs(lx) - w / 2, 0), np.maximum(np.abs(ly) - d / 2, 0))
    k = int(np.argmin(dist))
    away = -rel[k] / (np.linalg.norm(rel[k]) + 1e-9)
    return float(dist[k]), away


def place(props, coll, name, x, y, yaw, label=None):
    proto = props[name]
    w, d = proto["msr_size"]
    if ROAD_POINTS is not None:
        # Push the building away from the nearest road until its walls clear it. Give up if that
        # takes it more than 15 m (it was dropped onto another road leg).
        moved = 0.0
        for _ in range(8):
            clearance, away = rect_clearance(x, y, yaw, w, d)
            if clearance >= ROAD_CLEARANCE:
                break
            push = ROAD_CLEARANCE - clearance + 0.5
            x, y = x + away[0] * push, y + away[1] * push
            moved += push
        else:
            return None
        if moved > 15.0:
            return None
    obj = bpy.data.objects.new(name.replace("P_", "I_"), proto.data)
    obj.location = (float(x), float(y), 0.0)
    obj.rotation_euler = (0, 0, float(yaw))
    obj["msr_prop"] = name
    if label:
        obj["msr_label"] = label
    coll.objects.link(obj)
    return obj


def beside(xy, i, side, offset):
    """Point `offset` m to one side of sample i, and the yaw that turns the facade (-Y) to the road."""
    p, t, right = frame_at(xy, i)
    s = 1 if side == "right" else -1
    q = p + right * s * offset
    to_road = -right * s
    yaw = math.atan2(to_road[1], to_road[0]) + math.pi / 2  # rotate local -Y onto to_road
    return q, yaw


def place_beside(props, coll, name, xy, i, side, offset, label=None):
    q, yaw = beside(xy, i, side, offset)
    return place(props, coll, name, q[0], q[1], yaw, label)


def uphill_side(H, xy, i, offset=20):
    p, t, right = frame_at(xy, i)
    r = sample_bilinear(H, np.array([p[0] + right[0] * offset]), np.array([p[1] + right[1] * offset]))[0]
    l = sample_bilinear(H, np.array([p[0] - right[0] * offset]), np.array([p[1] - right[1] * offset]))[0]
    return "right" if r > l else "left"


def build_placements(props, coll, loop_xy, loop_spans, spur_xy, spur_spans, H):
    rng = np.random.default_rng(1827)  # Mussoorie was founded as a resort in the 1820s
    downhill = lambda xy, k: "left" if uphill_side(H, xy, k) == "right" else "right"
    cottages = ["P_Cottage_A", "P_Cottage_B", "P_Cottage_C", "P_Cottage_D"]

    def along(xy, lo, hi, spacing, fn):
        seg = np.hypot(np.diff(xy[:, 0]), np.diff(xy[:, 1]))
        step = max(1, int(spacing / max(seg.mean(), 1e-3)))
        for i in range(lo, hi, step):
            fn(i)

    # Mall Road: shop rows and cottages on the uphill (crest) side, the odd cottage on the valley side.
    lo, hi = loop_spans["mall"]

    def mall(i):
        side = uphill_side(H, loop_xy, i)
        kind = "P_ShopRow" if rng.random() < 0.45 else rng.choice(cottages)
        q, yaw = beside(loop_xy, i, side, 19 + rng.random() * 3)
        place(props, coll, kind, q[0], q[1], yaw)
        if rng.random() < 0.35:
            other = "left" if side == "right" else "right"
            q, yaw = beside(loop_xy, i, other, 18)
            place(props, coll, rng.choice(cottages), q[0], q[1], yaw)

    along(loop_xy, lo + 10, hi, 26, mall)

    i = (lo + hi) // 2
    q, yaw = beside(loop_xy, i, "left" if uphill_side(H, loop_xy, i) == "right" else "right", 22)
    place(props, coll, "P_Church", q[0], q[1], yaw, "Christ Church")

    lo, hi = loop_spans["library"]
    q, yaw = beside(loop_xy, lo, uphill_side(H, loop_xy, lo), 24)
    place(props, coll, "P_Library", q[0], q[1], yaw, "Library Chowk")
    q, yaw = beside(loop_xy, hi, "left" if uphill_side(H, loop_xy, hi) == "right" else "right", 16)
    place(props, coll, "P_Bandstand", q[0], q[1], yaw)

    lo, hi = loop_spans["kulri"]
    q, yaw = beside(loop_xy, hi, uphill_side(H, loop_xy, hi), 22)
    place(props, coll, "P_PicturePalace", q[0], q[1], yaw, "Picture Palace")
    along(loop_xy, lo, hi, 30, lambda k: place_beside(props, coll, "P_ShopRow", loop_xy, k, downhill(loop_xy, k), 20))

    # Gun Hill ropeway: pylons from Kulri up to the knob.
    start = loop_xy[(loop_spans["mall"][0] + 6)]
    top = np.array(fit(-440.0, 90.0))
    for k in range(1, 4):
        p = start + (top - start) * (k / 4)
        place(props, coll, "P_RopewayPylon", p[0], p[1], math.atan2(top[1] - start[1], top[0] - start[0]))

    # Camel's Back: the rock and a chai tapri pull-off with a valley view.
    lo, hi = loop_spans["camels"]
    i = lo + (hi - lo) // 3
    q, yaw = beside(loop_xy, i, "left" if uphill_side(H, loop_xy, i) == "right" else "right", 24)
    place(props, coll, "P_CamelRock", q[0], q[1], yaw, "Camel's Back")
    i = lo + (hi - lo) * 2 // 3
    q, yaw = beside(loop_xy, i, "left" if uphill_side(H, loop_xy, i) == "right" else "right", 13)
    place(props, coll, "P_ChaiTapri", q[0], q[1], yaw, "Chai Tapri")
    along(loop_xy, lo, hi, 70, lambda k: place_beside(props, coll, rng.choice(cottages), loop_xy, k, uphill_side(H, loop_xy, k), 21))

    lo, hi = loop_spans["happy"]
    along(loop_xy, lo, hi, 60, lambda k: place_beside(props, coll, rng.choice(cottages), loop_xy, k, uphill_side(H, loop_xy, k), 20))

    # Landour: cottages on the climb, the Clock Tower, Char Dukan, and the Lal Tibba viewpoint.
    lo, hi = spur_spans["landour"]
    along(spur_xy, lo + 20, hi, 55, lambda k: place_beside(props, coll, rng.choice(cottages), spur_xy, k, uphill_side(H, spur_xy, k), 20))
    lo, hi = spur_spans["clock"]
    q, yaw = beside(spur_xy, hi, uphill_side(H, spur_xy, hi), 15)
    place(props, coll, "P_ClockTower", q[0], q[1], yaw, "Landour Clock Tower")
    lo, hi = spur_spans["chardukan"]
    q, yaw = beside(spur_xy, hi, uphill_side(H, spur_xy, hi), 18)
    place(props, coll, "P_CharDukan", q[0], q[1], yaw, "Char Dukan")
    lo, hi = spur_spans["sisters"]
    q, yaw = beside(spur_xy, lo, "left" if uphill_side(H, spur_xy, lo) == "right" else "right", 20)
    place(props, coll, "P_Church", q[0], q[1], yaw, "Kellogg Church")
    px, py = PLAZA
    place(props, coll, "P_LalTibbaView", px + 34, py + 22, math.atan2(-22, -34) + math.pi / 2, "Lal Tibba")


def build_peak_placements(props, coll, peak_xy, H):
    """Summit shrine, prayer flags and a viewpoint at Nag Tibba; a chai stop at the foot of the climb."""
    cx, cy = PEAK["center"]
    arrive = peak_xy[-12] - peak_xy[-1]
    arrive = arrive / (np.linalg.norm(arrive) + 1e-9)       # from the summit back down the final straight
    across = np.array([-arrive[1], arrive[0]])
    reach = PEAK["plaza_radius"] + 14
    # Shrine opposite the road arrival, facing it; flags strung on either side.
    q = np.array([cx, cy]) - arrive * reach
    yaw = math.atan2(arrive[1], arrive[0]) + math.pi / 2
    place(props, coll, "P_Temple", q[0], q[1], yaw, "Nag Tibba")
    for side in (-1, 1):
        q = np.array([cx, cy]) + across * side * reach - arrive * 8
        place(props, coll, "P_PrayerFlags", q[0], q[1], math.atan2(arrive[1], arrive[0]))
    q = np.array([cx, cy]) + (across * 0.7 - arrive * 0.7) * (reach + 6)
    place(props, coll, "P_LalTibbaView", q[0], q[1], yaw)
    # Chai stop at the bottom of the stack, and a line of flags where the climb begins.
    place_beside(props, coll, "P_ChaiTapri", peak_xy, 40, uphill_side(H, peak_xy, 40), 13, "Nag Tibba Base")
    place_beside(props, coll, "P_PrayerFlags", peak_xy, 70, uphill_side(H, peak_xy, 70), 14)


def build_labels(coll):
    labels = [
        ("Library Chowk", -960, -175), ("Mall Road", -620, -60), ("Gun Hill", -440, 90),
        ("Picture Palace", -300, 0), ("Kulri Bazaar", -240, 60), ("Camel's Back Road", -560, 250),
        ("Happy Valley", -1050, 160), ("Company Garden", -1150, -400), ("Mussoorie Lake", -560, -760),
        ("Landour", 400, -40), ("Clock Tower", 720, -30), ("Char Dukan", 900, 30), ("Sister's Bazaar", 950, 100),
        ("Lal Tibba", 1000, 182),
    ]
    labels = [(n, *fit(x, y)) for n, x, y in labels] + [("Nag Tibba", *PEAK["center"])]
    for name, x, y in labels:
        e = bpy.data.objects.new("L_" + name, None)
        e.empty_display_type = "PLAIN_AXES"
        e.empty_display_size = 12
        e.location = (x, y, 0)
        e["msr_label"] = name
        coll.objects.link(e)


def build_water(coll):
    for k, (x, y, r, bottom) in enumerate(LAKES):
        bpy.ops.mesh.primitive_circle_add(vertices=48, radius=r * 1.3, fill_type="NGON", location=(x, y, WATER_LEVEL))
        obj = bpy.context.active_object
        obj.name = "Water_%d" % k
        for c in obj.users_collection:
            c.objects.unlink(obj)
        coll.objects.link(obj)
        obj.data.materials.append(material("MSR_Water", srgb(0x3B5A66), 0.1))
        obj["msr_role"] = "water"


def main():
    loop_xy = catmull_rom([p for _, p in LOOP], closed=True, step=4.0)
    spur_xy = catmull_rom([p for _, p in SPUR], closed=False, step=4.0)
    loop_spans = span_ranges(LOOP, loop_xy, True)
    spur_spans = span_ranges(SPUR, spur_xy, False)

    peak_ctrl, peak_junction, peak_legs = build_peak_road(loop_xy, loop_spans)
    # Dense centreline: the control points already sit every ~30 m, with the hairpins spelled out.
    peak_xy = catmull_rom(list(map(tuple, peak_ctrl)), closed=False, step=4.0)

    X, Y, H, _ = build_heights(loop_xy, spur_xy, peak_xy)
    loop_z = road_profile(loop_xy, H, True)
    spur_z = road_profile(spur_xy, H, False)
    peak_z = road_profile(peak_xy, H, False, start_z=float(loop_z[peak_junction]))
    H = flatten_roadbeds(X, Y, H, [(loop_xy, loop_z), (spur_xy, spur_z), (peak_xy, peak_z)])

    terrain = reset_collection("MSR_Terrain")
    roads = reset_collection("MSR_Roads")
    props_coll = reset_collection("MSR_Props")
    placements = reset_collection("MSR_Placements")
    labels = reset_collection("MSR_Labels")

    build_terrain_object(H, terrain)
    build_water(terrain)
    build_road_curve("Road_Loop", loop_xy, loop_z, True, roads, loop_spans)
    build_road_curve("Road_Spur", spur_xy, spur_z, False, roads, spur_spans)
    build_road_curve("Road_Peak", peak_xy, peak_z, False, roads, {"peak": [0, len(peak_xy) - 1]})
    props = build_props(props_coll)
    global ROAD_POINTS
    ROAD_POINTS = np.vstack([loop_xy, spur_xy, peak_xy])
    build_placements(props, placements, loop_xy, loop_spans, spur_xy, spur_spans, H)
    build_peak_placements(props, placements, peak_xy, H)
    build_labels(labels)

    # Drop placements onto the terrain so the Blender view is honest (the game re-seats them).
    for obj in placements.objects:
        x, y = obj.location.x, obj.location.y
        obj.location.z = float(sample_bilinear(H, np.array([x]), np.array([y]))[0])

    scene = bpy.context.scene
    scene["msr_water_level"] = WATER_LEVEL
    scene["msr_plaza"] = [PLAZA[0], PLAZA[1], PLAZA_RADIUS]
    scene["msr_peak_plaza"] = [PEAK["center"][0], PEAK["center"][1], PEAK["plaza_radius"]]
    for obj in list(bpy.data.objects):
        if obj.name in ("Cube",) and obj.type == "MESH" and not obj.users_collection[0].name.startswith("MSR_"):
            bpy.data.objects.remove(obj, do_unlink=True)
    scene.unit_settings.system = "METRIC"
    for area in bpy.context.screen.areas if bpy.context.screen else []:
        if area.type == "VIEW_3D":
            area.spaces.active.clip_end = 20000
    print("MSR built: loop %d pts (%.0f m), spur %d pts (%.0f m), height %.0f..%.0f" % (
        len(loop_xy), np.hypot(*np.diff(np.vstack([loop_xy, loop_xy[:1]]), axis=0).T).sum(),
        len(spur_xy), np.hypot(*np.diff(spur_xy, axis=0).T).sum(), H.min(), H.max()))
    print("loop z %.0f..%.0f, spur z %.0f..%.0f" % (loop_z.min(), loop_z.max(), spur_z.min(), spur_z.max()))
    print("peak road %.0f m, z %.0f..%.0f, %d legs" % (np.hypot(*np.diff(peak_xy, axis=0).T).sum(), peak_z.min(), peak_z.max(), peak_legs))


main()
