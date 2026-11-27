"""
Raijin GT: an original Japanese AWD twin-turbo grand tourer in the R35 class, built and exported
from Blender (run via the BlenderMCP socket, or `blender --background --python`).

Dimensions follow the class benchmark (published R35 figures): 4.71 m long, 1.895 m wide, 1.37 m
tall, 2.78 m wheelbase, ~1.59/1.60 m track, 255/40 R20 front and 285/35 R20 rear tyres, 390 mm
front discs. The styling is original (no badges or copied trade dress): long bonnet with a raised
crown, fenders that stand above the bonnet edges with swept headlamps, vents behind the front wheels,
a high roof falling into a fastback, a short deck with a ducktail wing, quad ring tail lamps and
quad exhausts.

The body is one watertight loft of cross-sections along the car (y forward), each ring carrying the
underbody, wheel-well liners, the arch cut-out (sections are dense around each axle so the arches
read round), the flanks with their shoulder crease, and a greenhouse that collapses onto the bonnet
and the deck outside the cabin. Lamps, grille, aero and trim are separate solids placed by ray
casts onto the body. Export: src/assets/cars/raijin.glb with nodes body, RJ_ExteriorCabin and
wheel_FL/FR/RL/RR (ModelCar's contract), materials RJ_* (finished in src/vehicle/cars.js).
"""
import importlib.util
import json
import math
import os
import struct
import bpy
from mathutils import Vector

REPO = '/Users/harshitbisht/Desktop/Slop-drift/Slop-Drift/'
GLB_OUT = os.path.join(REPO, 'src/assets/cars/raijin.glb')
BLEND_OUT = os.path.join(REPO, 'tools/blender/cars/raijin_gt.blend')

# The sedan script's watertight MeshBuilder (lofts, lathes, bevelled boxes, pipes).
_spec = importlib.util.spec_from_file_location('tokyo_sedan', os.path.join(REPO, 'tools/blender/cars/build_tokyo_sedan.py'))
_sedan = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_sedan)
MeshBuilder = _sedan.MeshBuilder

# Blender frame: x right, y forward, z up (the GLB export turns y forward into the game's -Z).
LENGTH_FRONT, LENGTH_REAR = 2.36, -2.35
AXLE_FRONT_Y, AXLE_REAR_Y = 1.40, -1.38          # 2.78 m wheelbase
HALF_TRACK = 0.80                                # ~1.60 m track
WHEEL_RADIUS = 0.355                             # 20 in rim, 255/40 and 285/35 tyres
TYRE_FRONT, TYRE_REAR = 0.255, 0.285
ARCH_RADIUS = 0.405
FLOOR_Z = 0.16
WELL_X = 0.58

MATS = {
    # name: (base colour, metallic, roughness, emission colour, emission strength, alpha)
    'RJ_Paint': ((0.80, 0.81, 0.83), 0.6, 0.25, None, 0, 1),
    'RJ_Carbon': ((0.03, 0.03, 0.035), 0.2, 0.32, None, 0, 1),
    'RJ_DarkTrim': ((0.025, 0.026, 0.03), 0.05, 0.7, None, 0, 1),
    'RJ_Metal': ((0.78, 0.8, 0.83), 0.95, 0.18, None, 0, 1),
    'RJ_Rim': ((0.16, 0.17, 0.19), 0.85, 0.3, None, 0, 1),
    'RJ_Disc': ((0.42, 0.43, 0.45), 0.9, 0.34, None, 0, 1),
    'RJ_Caliper': ((0.7, 0.06, 0.06), 0.3, 0.35, None, 0, 1),
    'RJ_Tyre': ((0.025, 0.025, 0.028), 0.0, 0.88, None, 0, 1),
    'RJ_Glass': ((0.05, 0.08, 0.1), 0.1, 0.05, None, 0, 0.4),
    'RJ_Headlamp_Lens': ((0.16, 0.18, 0.21), 0.85, 0.05, None, 0, 1),      # smoked housing (lit in game)
    'RJ_DRL': ((0.95, 0.97, 1.0), 0.0, 0.2, (0.95, 0.98, 1.0), 3.0, 1),
    'RJ_Tail_Lamp': ((0.55, 0.03, 0.03), 0.1, 0.18, (1.0, 0.05, 0.04), 0.6, 1),
    'RJ_Exhaust_Tip': ((0.62, 0.6, 0.6), 0.95, 0.2, None, 0, 1),
    'RJ_Exhaust_Bore': ((0.02, 0.02, 0.02), 0.0, 0.95, None, 0, 1),
    'RJ_Interior': ((0.04, 0.04, 0.045), 0.0, 0.8, None, 0, 1),
    'RJ_LampHousing': ((0.012, 0.013, 0.016), 0.6, 0.08, None, 0, 1),      # gloss-black headlamp shell
    'RJ_Mesh': ((0.07, 0.075, 0.085), 0.4, 0.45, None, 0, 1),              # grille and valance mesh
    'RJ_Leather': ((0.36, 0.13, 0.04), 0.0, 0.55, None, 0, 1),             # tan semi-aniline cabin
    'RJ_Screen': ((0.01, 0.02, 0.04), 0.0, 0.2, (0.3, 0.6, 1.0), 0.8, 1),  # gauges and centre display
    'RJ_Amber': ((0.85, 0.42, 0.04), 0.0, 0.15, (1.0, 0.5, 0.05), 0.2, 1),  # side markers
    'RJ_RearFog': ((0.4, 0.02, 0.02), 0.0, 0.2, (1.0, 0.05, 0.04), 0.1, 1), # rear fog lamp and reflectors
}


def make_materials():
    mats = {}
    for name, (col, metal, rough, emit, strength, alpha) in MATS.items():
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = (*col, 1)
        bsdf.inputs['Metallic'].default_value = metal
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Alpha'].default_value = alpha
        if emit:
            bsdf.inputs['Emission Color'].default_value = (*emit, 1)
            bsdf.inputs['Emission Strength'].default_value = strength
        m.diffuse_color = (*col, alpha)
        if alpha < 1:
            try:
                m.surface_render_method = 'BLENDED'
            except AttributeError:
                m.blend_method = 'BLEND'
        mats[name] = m
    return mats


# ------------------------------------------------------------------ body profile (all functions of y)

def bump(y, c, w):
    d = abs(y - c) / w
    return math.cos(d * math.pi / 2) ** 2 if d < 1 else 0.0


def half_width(y):
    # Coke-bottle plan: flared front and rear fenders, a waist through the doors.
    hw = 0.905 + 0.04 * bump(y, AXLE_FRONT_Y, 0.8) + 0.043 * bump(y, AXLE_REAR_Y, 0.85)
    if y > 1.95:
        hw *= 1 - 0.09 * ((y - 1.95) / 0.41) ** 2
    if y < -2.0:
        hw *= 1 - 0.05 * ((-2.0 - y) / 0.35) ** 2
    return hw


def rocker_z(y):
    if y > 1.95:
        return 0.215 - 0.03 * (y - 1.95) / 0.41
    if y < -1.95:
        return 0.215 + 0.1 * (-1.95 - y) / 0.4
    return 0.215


def belt_z(y):
    """The fender and waist line: high over the front wheels, rising toward the tail."""
    if y >= 0.82:
        return 0.93 - 0.14 * ((y - 0.82) / 1.54) ** 1.3
    if y >= -1.55:
        return 0.93 + 0.05 * (0.82 - y) / 2.37
    return 0.98 + 0.01 * (-1.55 - y) / 0.8


def centre_z(y):
    """Centreline height: bonnet crown, windscreen, roof, fastback, deck and ducktail."""
    if y > 0.82:
        return 0.955 - 0.2 * ((y - 0.82) / 1.54) ** 1.25
    if y > 0.02:
        t = (0.82 - y) / 0.8
        return 0.955 + (1.348 - 0.955) * (1 - (1 - t) ** 1.7)
    if y > -0.45:
        return 1.365 - 0.35 * (y + 0.2) ** 2
    if y > -1.55:
        t = (-0.45 - y) / 1.1
        return 1.343 - 0.31 * t ** 1.3
    t = min(1.0, (-1.55 - y) / 0.8)
    return 1.033 + 0.02 * t + 0.035 * max(0.0, (t - 0.75) / 0.25) ** 2


def arch_z(y):
    """Lower edge of the flank: the rocker, or the arch over a wheel (round above the axle, vertical below)."""
    for c in (AXLE_FRONT_Y, AXLE_REAR_Y):
        d = abs(y - c)
        if d < ARCH_RADIUS:
            return WHEEL_RADIUS + math.sqrt(ARCH_RADIUS ** 2 - d * d)
    return rocker_z(y)


def ring(y):
    """Closed cross-section: right half bottom to top, then the left half back down."""
    hw = half_width(y)
    zr = rocker_z(y)
    za = max(arch_z(y), zr)
    zb = belt_z(y)
    zs = zb - 0.13
    zc = centre_z(y)
    w_belt = hw * 0.965
    gh = zc - (zb + 0.015)
    wb = (w_belt - 0.035, zb + 0.015)
    z_wt = zb + 0.015 + max(0.002, gh - 0.07)
    x_wt = wb[0] - min(0.17, 0.5 * max(0.0, gh - 0.07))
    k = min(1.0, max(0.0, gh) / 0.3)
    # Over the bonnet and deck the 'roof edge' becomes the crown: edges 4 cm below the centre.
    roof_edge = (x_wt - 0.07 * k - 0.01, zc - 0.025 * k - 0.04 * (1 - k))
    half = [
        (0.0, FLOOR_Z),
        (WELL_X, FLOOR_Z),
        (WELL_X, max(FLOOR_Z + 0.004, za - 0.02)),
        (hw * 0.955, za),
        (hw * 0.962, za + (zs - za) * 0.45),          # concave scoop along the doors
        (hw, zs),
        (w_belt, zb),
        wb,
        (x_wt, z_wt),
        roof_edge,
        (0.0, zc),
    ]
    # Round the nose and tail: the last few sections shrink toward the bumper centre.
    sx = sz = 1.0
    if y > 2.26:
        t = (y - 2.26) / (LENGTH_FRONT - 2.26)
        sx, sz = 1 - 0.08 * t * t, 1 - 0.24 * t * t      # blunt, wide nose (corner intakes sit on the face)
    elif y < -2.27:
        t = (-2.27 - y) / (-2.27 - LENGTH_REAR)
        sx, sz = 1 - 0.07 * t * t, 1 - 0.1 * t * t
    cz = 0.5
    right = [(x * sx, y, cz + (z - cz) * sz) for x, z in half]
    left = [(-x, yy, z) for x, yy, z in reversed(right[1:-1])]
    return right + left


def body_sections():
    ys = set()
    y = LENGTH_REAR
    while y < LENGTH_FRONT - 0.12:
        ys.add(round(y, 4))
        near = min(abs(y - AXLE_FRONT_Y), abs(y - AXLE_REAR_Y))
        y += 0.04 if near < ARCH_RADIUS + 0.06 else 0.09
    for c in (AXLE_FRONT_Y, AXLE_REAR_Y):        # the vertical arch edges below the axle
        for s in (-1, 1):
            ys.add(round(c + s * ARCH_RADIUS, 4))
            ys.add(round(c + s * (ARCH_RADIUS - 0.004), 4))
    for extra in (2.26, 2.3, 2.33, 2.35, LENGTH_FRONT, -2.27, -2.31, -2.335, LENGTH_REAR):
        ys.add(extra)
    return sorted(ys)


def face_material(y, a, b):
    """Material of the ring segment between half-ring indices a < b at station y."""
    if b <= 1:
        return 'RJ_DarkTrim'                                          # underbody
    if b <= 3:
        return 'RJ_DarkTrim'                                          # wheel-well liner and arch lip
    if (a, b) == (3, 4) and y > 2.26:
        return 'RJ_DarkTrim'                                          # bumper corner intakes
    if (a, b) == (4, 5) and 0.8 < y < 1.0:
        return 'RJ_DarkTrim'                                          # fender vent behind the front wheel
    cabin = centre_z(y) - belt_z(y) > 0.14
    if (a, b) == (6, 7) and -1.05 < y < 0.6 and cabin:
        return 'RJ_DarkTrim'                                          # window surround
    if (a, b) == (7, 8) and cabin:
        return 'RJ_Glass' if -1.05 < y < 0.6 else 'RJ_Paint'          # side glass, A and C pillars
    if b >= 9 or (a, b) == (8, 9):
        if 0.06 < y < 0.8 or -1.42 < y < -0.58:
            return 'RJ_Glass'                                         # windscreen, rear window
        if (a, b) == (8, 9) and -1.05 < y < 0.6:
            return 'RJ_DarkTrim'                                      # glass upper frame
    return 'RJ_Paint'


def build_body(mats, col):
    mb = MeshBuilder()
    sections = body_sections()
    rings = [ring(y) for y in sections]
    n = len(rings[0])

    def half_index(i):
        return i if i <= 10 else n - i

    def mat_fn(j, i):
        ym = (sections[j] + sections[j + 1]) * 0.5
        a, b = sorted((half_index(i), half_index((i + 1) % n)))
        return face_material(ym, a, b)

    mb.loft_solid(rings, mat_fn, cap_start_mat='RJ_Paint', cap_end_mat='RJ_Paint')   # rear panel, front bumper
    obj = mb.to_object('body', mats, col, sharp_angle_deg=38)
    return obj, sections


def cast(obj, origin, direction):
    ok, loc, normal, _ = obj.ray_cast(Vector(origin), Vector(direction))
    return (loc, normal) if ok else (None, None)


def clip_line(poly, p, d):
    """Parameter range of the line p + t*d inside a convex counter-clockwise (x, z) polygon, or None."""
    t0, t1 = -1e9, 1e9
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        nx, nz = -(b[1] - a[1]), b[0] - a[0]
        num = (p[0] - a[0]) * nx + (p[1] - a[1]) * nz
        den = d[0] * nx + d[1] * nz
        if abs(den) < 1e-9:
            if num < 0:
                return None
            continue
        if den > 0:
            t0 = max(t0, -num / den)
        else:
            t1 = min(t1, -num / den)
    return (t0, t1) if t1 - t0 > 0.012 else None


def chamfer(poly, r):
    """Soften each corner of an (x, z) polygon with two points r from the corner."""
    out = []
    for i in range(len(poly)):
        p, a, b = Vector((*poly[i], 0)), Vector((*poly[i - 1], 0)), Vector((*poly[(i + 1) % len(poly)], 0))
        out += [tuple((p + (a - p).normalized() * r)[:2]), tuple((p + (b - p).normalized() * r)[:2])]
    return out


def plate(mb, poly, y_back, y_front, mat):
    """A prism of an (x, z) outline standing on the nose or tail face (y_front is the visible face)."""
    mb.loft_solid([[(x, y_back, z) for x, z in poly], [(x, y_front, z) for x, z in poly]], mat, cap_start_mat=mat, cap_end_mat=mat)


def mesh(mb, poly, y, pitch=0.034, radius=0.0028):
    """Diamond mesh: two sets of diagonal bars clipped to the opening."""
    for d in ((0.7071, 0.7071), (0.7071, -0.7071)):
        n = (-d[1], d[0])
        c = -1.2
        while c < 1.2:
            p = (n[0] * c, n[1] * c)
            seg = clip_line(poly, p, d)
            if seg:
                a = (p[0] + d[0] * seg[0], y, p[1] + d[1] * seg[0])
                b = (p[0] + d[0] * seg[1], y, p[1] + d[1] * seg[1])
                mb.bar(a, b, radius, 'RJ_Mesh', segs=4)
            c += pitch


def opening(mb, poly, y_face, frame=0.022, back=0.03, pitch=0.034, out=1.0):
    """A framed, meshed intake on a flat face. out = +1 on the nose (faces +y), -1 on the tail."""
    outer = chamfer(poly, 0.03)
    inner = chamfer(shrink(poly, frame), 0.02)
    plate(mb, outer, y_face - out * back, y_face + out * 0.006, 'RJ_Carbon')
    plate(mb, inner, y_face, y_face + out * 0.009, 'RJ_Exhaust_Bore')
    mesh(mb, inner, y_face + out * 0.012, pitch)


def shrink(poly, d):
    """Inset a convex (x, z) polygon by roughly d (towards its centroid, scaled per axis)."""
    cx = sum(p[0] for p in poly) / len(poly)
    cz = sum(p[1] for p in poly) / len(poly)
    w = max(abs(p[0] - cx) for p in poly)
    h = max(abs(p[1] - cz) for p in poly)
    return [(cx + (x - cx) * (1 - d / w), cz + (z - cz) * (1 - d / h)) for x, z in poly]


def headlamp(mb, body, s):
    """Swept headlamp: a gloss-black shell wrapping the nose corner and running back up the fender,
    three projector lenses on the front, an LED signature along the lower edge with an upturn at the inner end."""
    stations = []
    for k in range(17):
        t = k / 16
        if t <= 0.42:                                   # across the nose face
            u = t / 0.42
            x, zc, h = 0.41 + 0.28 * u, 0.598 + 0.024 * u, 0.112 - 0.012 * u
            hits = [cast(body, (x, 6, z), (0, -1, 0)) for z in (zc + h / 2, zc - h / 2)]
        elif t <= 0.6:                                  # around the corner
            u = (t - 0.42) / 0.18
            ang = u * math.pi / 2
            d = Vector((-math.sin(ang), -math.cos(ang), 0))
            guess = Vector((0.69 + 0.1 * u, 2.36 - 0.1 * u, 0))
            zc, h = 0.622 + 0.048 * u, 0.1 - 0.012 * u
            hits = [cast(body, guess - d * 2 + Vector((0, 0, z)), d) for z in (zc + h / 2, zc - h / 2)]
        else:                                           # back along the fender, tapering to a point
            u = (t - 0.6) / 0.4
            y, zc, h = 2.26 - 0.32 * u, 0.67 + 0.1 * u, 0.082 * (1 - u) ** 0.85 + 0.012
            hits = [cast(body, (3, y, z), (-1, 0, 0)) for z in (zc + h / 2, zc - h / 2)]
        if any(p is None for p, _ in hits):
            continue
        stations.append(hits)
    rings = []
    for (pt, nt), (pb, nb) in stations:
        rings.append([tuple(pt + nt * 0.012), tuple(pb + nb * 0.012), tuple(pb - nb * 0.01), tuple(pt - nt * 0.01)])
    rings = [[(s * x, y, z) for x, y, z in r] for r in rings]
    mb.loft_solid(rings, 'RJ_LampHousing', cap_start_mat='RJ_LampHousing', cap_end_mat='RJ_LampHousing')
    # LED signature along the lower edge, from just outboard of the inner projector to the fender tip.
    led = [tuple(pb + nb * 0.015 + Vector((0, 0, 0.008))) for (_, _), (pb, nb) in stations[1:]]
    mb.tube_path([(s * x, y, z) for x, y, z in led], 0.0045, 'RJ_DRL', segs=6)
    # Three projectors across the nose face, chrome bezels.
    yf = stations[0][0][0].y + 0.012
    for x, z, r in ((0.47, 0.606, 0.026), (0.545, 0.611, 0.025), (0.618, 0.617, 0.023)):
        mb.lathe((s * x, yf - 0.004, z), (s * x, yf + 0.007, z), [(0, r + 0.007), (1, r + 0.006)], 'RJ_Metal', segs=20)
        mb.lathe((s * x, yf + 0.005, z), (s * x, yf + 0.016, z), [(0, r), (0.6, r * 0.9), (1, r * 0.55)], 'RJ_Headlamp_Lens', segs=20)


def side_x(y, z, lo=4, hi=5):
    """Body surface x on the flank between ring points lo and hi at height z."""
    r = ring(y)
    (xa, _, za), (xb, _, zb) = r[lo], r[hi]
    t = min(1.0, max(0.0, (z - za) / (zb - za)))
    return xa + (xb - xa) * t


def tail_lamp(mb, x, z, r, ys):
    """Ring tail lamp in a body-colour cup: chrome bezel, red lens with an LED ring, chrome reflector dome."""
    mb.lathe((x, ys + 0.02, z), (x, ys - 0.022, z), [(0, r + 0.03), (0.8, r + 0.026), (1, r + 0.018)], 'RJ_Paint', segs=32)
    mb.lathe((x, ys - 0.018, z), (x, ys - 0.03, z), [(0, r + 0.008), (1, r + 0.006)], 'RJ_Metal', segs=32)
    mb.lathe((x, ys - 0.026, z), (x, ys - 0.034, z), [(0, r), (1, r * 0.98)], 'RJ_Tail_Lamp', segs=32)
    ring_pts = [(x + 0.74 * r * math.cos(a), ys - 0.035, z + 0.74 * r * math.sin(a)) for a in [k * math.tau / 28 for k in range(29)]]
    mb.tube_path(ring_pts, 0.0065, 'RJ_Tail_Lamp', segs=5)
    mb.lathe((x, ys - 0.03, z), (x, ys - 0.052, z), [(0, r * 0.5), (0.4, r * 0.46), (1, r * 0.2)], 'RJ_Metal', segs=24)
    mb.lathe((x, ys - 0.05, z), (x, ys - 0.056, z), [(0, r * 0.18), (1, r * 0.12)], 'RJ_Glass', segs=12)


def build_details(body, mats, col):
    """Lamps, grille, aero, mirrors, handles and exhausts: separate solids joined into the body mesh."""
    mb = MeshBuilder()
    bpy.context.view_layer.update()

    # ---- nose: big trapezoid main grille, slim upper grille under a chrome bar, corner intakes with LED bars
    loc, _ = cast(body, (0, 6, 0.44), (0, -1, 0))
    yf = loc.y if loc else LENGTH_FRONT
    opening(mb, [(-0.49, 0.27), (0.49, 0.27), (0.41, 0.545), (-0.41, 0.545)], yf, frame=0.03)
    opening(mb, [(-0.32, 0.565), (0.32, 0.565), (0.35, 0.63), (-0.35, 0.63)], yf, frame=0.012, pitch=0.028)
    mb.tube_path([(-0.375, yf + 0.014, 0.642), (-0.31, yf + 0.016, 0.572), (0.31, yf + 0.016, 0.572), (0.375, yf + 0.014, 0.642)],
                 0.0075, 'RJ_Metal', segs=8)
    for s in (-1, 1):
        poly = [(0.57, 0.285), (0.69, 0.285), (0.675, 0.51), (0.585, 0.51)]
        if s < 0:
            poly = [(-x, z) for x, z in reversed(poly)]
        opening(mb, poly, yf, frame=0.016, pitch=0.026)
        mb.box(s * 0.63, yf + 0.014, 0.478, 0.072, 0.012, 0.026, 'RJ_DRL', bevel=0.004)
        for dx in (-0.018, 0.0, 0.018):
            mb.box(s * (0.63 + dx), yf + 0.019, 0.478, 0.003, 0.004, 0.028, 'RJ_DarkTrim', bevel=0.0)
        headlamp(mb, body, s)
        hit, n = cast(body, (s * 3, 1.88, 0.58), (-s, 0, 0))                 # amber side marker
        if hit:
            mb.box(hit.x + n.x * 0.003, 1.88, 0.58, 0.008, 0.075, 0.02, 'RJ_Amber', bevel=0.003)
    mb.box(0, yf - 0.06, 0.215, 1.34, 0.14, 0.06, 'RJ_DarkTrim', bevel=0.02)            # lower lip
    mb.box(0, LENGTH_FRONT - 0.09, 0.175, 1.66, 0.24, 0.028, 'RJ_Carbon', bevel=0.012)   # carbon splitter

    # ---- tail: four ring lamps high on the panel, black valance, meshed exhaust surrounds, rear fog, reflectors
    loc, _ = cast(body, (0, -6, 0.6), (0, 1, 0))
    yr = loc.y if loc else LENGTH_REAR
    for x, r in ((-0.625, 0.096), (-0.405, 0.088), (0.405, 0.088), (0.625, 0.096)):
        tail_lamp(mb, x, 0.875, r, yr)
    plate(mb, chamfer([(-0.74, 0.29), (0.74, 0.29), (0.74, 0.47), (-0.74, 0.47)], 0.04), yr + 0.02, yr - 0.008, 'RJ_DarkTrim')
    for s in (-1, 1):
        poly = [(0.33, 0.295), (0.66, 0.295), (0.66, 0.445), (0.33, 0.445)]
        if s < 0:
            poly = [(-x, z) for x, z in reversed(poly)]
        opening(mb, poly, yr - 0.008, frame=0.014, back=0.004, pitch=0.026, out=-1)
        for x in (0.425, 0.565):
            mb.hollow_pipe((s * x, yr + 0.16, 0.37), (s * x, yr - 0.05, 0.37), 0.057, 0.046, 'RJ_Exhaust_Tip', 'RJ_Exhaust_Bore', segs=28)
        mb.box(s * 0.715, yr - 0.008, 0.6, 0.016, 0.012, 0.12, 'RJ_RearFog', bevel=0.004)
    mb.box(0, yr - 0.014, 0.4, 0.1, 0.012, 0.032, 'RJ_RearFog', bevel=0.005)
    mb.box(0, -2.18, 0.235, 1.1, 0.36, 0.05, 'RJ_Carbon', bevel=0.01)                  # diffuser and strakes
    for x in (-0.24, -0.08, 0.08, 0.24):
        mb.box(x, -2.2, 0.27, 0.012, 0.34, 0.08, 'RJ_Carbon', bevel=0.004)

    # ---- flanks: chrome strake in the fender vent, skirts, chrome handles, mirrors on stalks
    for s in (-1, 1):
        strake = [(0.975, 0.52), (0.925, 0.535), (0.875, 0.69), (0.825, 0.71)]
        mb.tube_path([(s * (side_x(y, z) + 0.008), y, z) for y, z in strake], 0.008, 'RJ_Metal', segs=8)
        hw = half_width(-0.2)
        mb.box(s * (hw * 0.955 + 0.012), -0.02, 0.235, 0.05, 1.9, 0.05, 'RJ_Carbon', bevel=0.012)
        mb.box(s * (half_width(-0.25) * 0.985 + 0.006), -0.25, 0.83, 0.014, 0.16, 0.022, 'RJ_Metal', bevel=0.006)
        mx = s * (half_width(0.62) * 0.86 + 0.14)
        mb.box(mx, 0.6, 1.0, 0.19, 0.1, 0.1, 'RJ_Paint', bevel=0.045, rot_z=s * 0.12)
        mb.box(mx, 0.55, 0.998, 0.165, 0.012, 0.078, 'RJ_Glass', bevel=0.02, rot_z=s * 0.12)
        mb.box(mx, 0.6, 0.952, 0.17, 0.085, 0.012, 'RJ_DarkTrim', bevel=0.005, rot_z=s * 0.12)
        mb.bar((mx - s * 0.06, 0.62, 0.97), (s * (half_width(0.62) * 0.86 - 0.02), 0.63, 0.93), 0.014, 'RJ_Paint', segs=8)

    # ---- raised wing on two stalks with end plates
    loc, _ = cast(body, (0, -2.12, 3), (0, 0, -1))
    zd = loc.z if loc else 1.06
    mb.box(0, -2.14, zd + 0.14, 1.5, 0.21, 0.026, 'RJ_Carbon', bevel=0.01, rot_x=-0.07)
    for s in (-1, 1):
        mb.box(s * 0.5, -2.12, zd + 0.07, 0.025, 0.12, 0.14, 'RJ_Paint', bevel=0.008)
        mb.box(s * 0.755, -2.15, zd + 0.12, 0.012, 0.25, 0.085, 'RJ_Carbon', bevel=0.004)

    details = mb.to_object('RJ_Details', mats, col, sharp_angle_deg=40)
    # Join into the body so the game gets one 'body' node.
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    details.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    return body


def wheel_ring(cx, cy, cz, radius, tilt):
    """Points of a circle of the given radius facing the driver (plane tilted back by `tilt`)."""
    up = Vector((0, -math.sin(tilt), math.cos(tilt)))
    return [tuple(Vector((cx, cy, cz)) + radius * (math.cos(a) * Vector((1, 0, 0)) + math.sin(a) * up))
            for a in [k * math.tau / 24 for k in range(25)]]


def build_cabin(mats, col):
    """Interior seen through the glass: tan leather dash, binnacle with four gauges, centre display,
    carbon console, sport buckets, two rear seats, door cards and a three-spoke wheel (left-hand drive)."""
    mb = MeshBuilder()
    L, I = 'RJ_Leather', 'RJ_Interior'
    mb.box(0, -0.3, 0.27, 1.46, 2.1, 0.04, I, bevel=0.01)                              # floor
    mb.box(0, 0.56, 0.84, 1.44, 0.34, 0.2, I, bevel=0.05)                              # dash body
    mb.box(0, 0.5, 0.95, 1.38, 0.26, 0.03, L, bevel=0.012)                             # leather dash top
    mb.box(0, 0.4, 0.86, 1.36, 0.02, 0.05, L, bevel=0.008)                             # stitched leather band
    mb.box(-0.38, 0.43, 1.0, 0.4, 0.15, 0.08, I, bevel=0.03)                           # gauge binnacle hood
    for x, z, r in ((-0.47, 0.935, 0.05), (-0.37, 0.935, 0.058), (-0.285, 0.95, 0.03), (-0.285, 0.9, 0.025)):
        mb.lathe((x, 0.37, z), (x, 0.362, z), [(0, r + 0.006), (1, r + 0.006)], 'RJ_Metal', segs=18)
        mb.lathe((x, 0.364, z), (x, 0.358, z), [(0, r), (1, r)], 'RJ_Screen', segs=18)
    mb.box(0, 0.44, 0.71, 0.32, 0.14, 0.34, I, bevel=0.03)                             # centre stack
    mb.box(0, 0.37, 0.83, 0.24, 0.012, 0.13, 'RJ_Screen', bevel=0.006, rot_x=0.18)    # centre display
    mb.box(0, 0.372, 0.73, 0.22, 0.012, 0.035, 'RJ_Metal', bevel=0.004)               # vents / climate strip
    mb.box(0, 0.02, 0.5, 0.26, 0.82, 0.16, 'RJ_Carbon', bevel=0.03)                   # carbon tunnel
    mb.box(0, -0.32, 0.6, 0.2, 0.32, 0.05, L, bevel=0.02)                              # armrest
    mb.bar((0, 0.16, 0.58), (0, 0.13, 0.66), 0.014, 'RJ_Metal', segs=8)                # selector
    mb.lathe((0, 0.13, 0.66), (0, 0.125, 0.71), [(0, 0.022), (0.6, 0.024), (1, 0.012)], I, segs=10)
    for s in (-1, 1):
        x = s * 0.38
        mb.box(x, -0.25, 0.43, 0.42, 0.5, 0.1, L, bevel=0.03)                          # cushion
        for e in (-1, 1):
            mb.box(x + e * 0.21, -0.25, 0.48, 0.07, 0.48, 0.12, L, bevel=0.03)        # cushion bolsters
            mb.box(x + e * 0.2, -0.53, 0.8, 0.08, 0.14, 0.52, L, bevel=0.03, rot_x=0.2)   # back bolsters
        mb.box(x, -0.54, 0.79, 0.36, 0.1, 0.6, L, bevel=0.04, rot_x=0.2)               # backrest
        mb.box(x, -0.6, 0.79, 0.4, 0.04, 0.56, I, bevel=0.015, rot_x=0.2)              # black shell
        mb.box(x, -0.6, 1.13, 0.26, 0.11, 0.16, L, bevel=0.04, rot_x=0.2)              # integral headrest
        mb.box(s * 0.36, -1.02, 0.55, 0.4, 0.38, 0.1, L, bevel=0.04)                   # rear seat
        mb.box(s * 0.36, -1.2, 0.8, 0.38, 0.1, 0.46, L, bevel=0.04, rot_x=0.3)
        mb.box(s * 0.765, -0.25, 0.72, 0.05, 1.35, 0.36, I, bevel=0.02)                # door card
        mb.box(s * 0.738, -0.25, 0.8, 0.012, 0.95, 0.09, L, bevel=0.006)               # leather insert
        mb.box(s * 0.735, -0.1, 0.66, 0.05, 0.45, 0.04, L, bevel=0.012)                # door armrest
    mb.box(0, -1.08, 0.62, 0.18, 0.5, 0.22, I, bevel=0.03)                             # rear console
    # Three-spoke wheel: tan rim, dark side spokes, silver lower spoke, hub and column.
    cx, cy, cz, tilt = -0.38, 0.27, 0.9, 0.36
    mb.tube_path(wheel_ring(cx, cy, cz, 0.18, tilt), 0.017, L, segs=8)
    up = Vector((0, -math.sin(tilt), math.cos(tilt)))
    c = Vector((cx, cy, cz))
    mb.lathe(tuple(c + Vector((0, 0.03, 0.01))), tuple(c - Vector((0, 0.025, 0.009))), [(0, 0.06), (1, 0.055)], I, segs=16)
    for dirv, mat in ((Vector((1, 0, 0)), I), (Vector((-1, 0, 0)), I)):
        mb.bar(tuple(c + dirv * 0.05), tuple(c + dirv * 0.17), 0.016, mat, segs=6)
    for e in (-1, 1):
        mb.bar(tuple(c - up * 0.04 + Vector((e * 0.02, 0, 0))), tuple(c - up * 0.17 + Vector((e * 0.035, 0, 0))), 0.009, 'RJ_Metal', segs=6)
    mb.bar(tuple(c + Vector((0, 0.03, 0.01))), (cx, 0.43, 0.94), 0.03, I, segs=10)
    return mb.to_object('RJ_ExteriorCabin', mats, col, sharp_angle_deg=50)


def build_wheel(name, side, y_pos, width, mats, col):
    """Staggered 20 in tyre, gunmetal forged wheel (ten Y-spokes), 390 mm disc, caliper."""
    w = MeshBuilder()
    r = WHEEL_RADIUS
    hw = width * 0.5
    segs = 44
    rim_r = 0.254                                                    # 20 in rim
    tyre_profile = [
        (0.84 * hw, rim_r + 0.006), (0.98 * hw, rim_r + 0.04), (1.0 * hw, r - 0.03), (0.9 * hw, r - 0.008),
        (0.66 * hw, r), (-0.66 * hw, r), (-0.9 * hw, r - 0.008), (-1.0 * hw, r - 0.03),
        (-0.98 * hw, rim_r + 0.04), (-0.84 * hw, rim_r + 0.006), (-0.76 * hw, rim_r), (0.76 * hw, rim_r),
    ]
    rings = [[(side * x, rad * math.cos(a), rad * math.sin(a)) for x, rad in tyre_profile]
             for a in [math.tau * i / segs for i in range(segs)]]
    w.closed_torus_strip(rings, 'RJ_Tyre', smooth=True)
    barrel = [
        (0.95 * hw, rim_r + 0.016), (0.92 * hw, rim_r), (0.3 * hw, rim_r - 0.014), (-0.8 * hw, rim_r - 0.012),
        (-0.88 * hw, rim_r + 0.012), (-0.9 * hw, rim_r + 0.02), (0.3 * hw, rim_r - 0.002), (0.92 * hw, rim_r + 0.02),
    ]
    rings = [[(side * x, rad * math.cos(a), rad * math.sin(a)) for x, rad in barrel]
             for a in [math.tau * i / segs for i in range(segs)]]
    w.closed_torus_strip(rings, 'RJ_Rim', smooth=True)
    # 390 mm disc with a drilled-look darker hub hat, centre lock-style hub.
    w.lathe((side * -0.02, 0, 0), (side * 0.012, 0, 0), [(0, 0.195), (1, 0.195)], 'RJ_Disc', segs=32)
    w.lathe((side * 0.005, 0, 0), (side * 0.03, 0, 0), [(0, 0.09), (1, 0.09)], 'RJ_DarkTrim', segs=20)
    w.lathe((side * 0.02, 0, 0), (side * 0.085, 0, 0), [(0, 0.072), (0.7, 0.068), (1, 0.05)], 'RJ_Rim', segs=20)
    w.bar((side * 0.08, 0, 0), (side * 0.098, 0, 0), 0.028, 'RJ_Metal', 12)
    # Ten Y-spokes: each splits into two slim arms toward the rim.
    for k in range(10):
        base = math.tau * k / 10
        for arm in (-0.085, 0.085):
            ang = base + arm
            ca, sa = math.cos(ang), math.sin(ang)
            ba, bs = math.cos(base), math.sin(base)
            spoke = []
            for x_s, w_s, r_s, use_base in [(0.072, 0.017, 0.06, True), (0.09, 0.011, 0.14, False), (0.106, 0.0095, rim_r - 0.012, False)]:
                cc, ss = (ba, bs) if use_base else (ca, sa)
                cy, cz = r_s * cc, r_s * ss
                py, pz = -ss, cc
                spoke.append([
                    (side * (x_s + 0.012), cy + py * w_s, cz + pz * w_s),
                    (side * (x_s + 0.012), cy - py * w_s, cz - pz * w_s),
                    (side * (x_s - 0.012), cy - py * w_s * 1.15, cz - pz * w_s * 1.15),
                    (side * (x_s - 0.012), cy + py * w_s * 1.15, cz + pz * w_s * 1.15),
                ])
            w.loft_solid(spoke, 'RJ_Rim', cap_start_mat='RJ_Rim', cap_end_mat='RJ_Rim', smooth=False)
        if k % 2 == 0:                                               # five lug nuts
            lx, ly, lz = side * 0.086, 0.04 * math.cos(base + math.pi / 10), 0.04 * math.sin(base + math.pi / 10)
            w.bar((lx - side * 0.006, ly, lz), (lx + side * 0.01, ly, lz), 0.007, 'RJ_Metal', 6)
    obj = w.to_object(name, mats, col, sharp_angle_deg=45)
    obj.location = (side * HALF_TRACK, y_pos, r)
    return obj


def studio(scene, col):
    """Soft studio for previews and the garage thumbnail (not exported)."""
    world = bpy.data.worlds.get('RJ_Studio') or bpy.data.worlds.new('RJ_Studio')
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (0.32, 0.34, 0.38, 1)
    bg.inputs['Strength'].default_value = 0.9
    scene.world = world
    for name, loc, energy, size in (('RJ_Key', (-3.2, 3.4, 4.2), 900, 4.0), ('RJ_Fill', (3.6, 1.0, 2.6), 380, 5.0),
                                    ('RJ_Rim', (0.5, -4.5, 3.0), 520, 3.0)):
        data = bpy.data.lights.new(name, type='AREA')
        data.energy = energy
        data.size = size
        light = bpy.data.objects.new(name, data)
        col.objects.link(light)
        light.location = loc
        light.rotation_euler = (Vector((0, 0, 0.5)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    cam = bpy.data.objects.new('RJ_Camera', bpy.data.cameras.new('RJ_Camera'))
    col.objects.link(cam)
    cam.location = (4.4, 5.6, 1.6)
    cam.rotation_euler = (Vector((0, 0.2, 0.55)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 50
    scene.camera = cam


def glb_inspect(path):
    raw = open(path, 'rb').read()
    jlen = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20 + jlen])
    return {'kb': len(raw) // 1024, 'nodes': [n['name'] for n in doc.get('nodes', [])],
            'materials': sorted(m['name'] for m in doc.get('materials', []))}


def build_and_export():
    scene = bpy.data.scenes.get('Raijin_GT') or bpy.data.scenes.new('Raijin_GT')
    for win in bpy.context.window_manager.windows:
        win.scene = scene
    for obj in list(scene.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for me in [m for m in bpy.data.meshes if m.users == 0]:
        bpy.data.meshes.remove(me)
    mats = make_materials()
    col = scene.collection
    body, _ = build_body(mats, col)
    body = build_details(body, mats, col)
    cabin = build_cabin(mats, col)
    wheels = [
        build_wheel('wheel_FL', -1, AXLE_FRONT_Y, TYRE_FRONT, mats, col),
        build_wheel('wheel_FR', +1, AXLE_FRONT_Y, TYRE_FRONT, mats, col),
        build_wheel('wheel_RL', -1, AXLE_REAR_Y, TYRE_REAR, mats, col),
        build_wheel('wheel_RR', +1, AXLE_REAR_Y, TYRE_REAR, mats, col),
    ]
    export_objs = [body, cabin] + wheels
    studio(scene, col)
    for sc in bpy.data.scenes:                      # selection lives per view layer: clear every scene's
        for vl in sc.view_layers:
            for o in sc.objects:
                o.select_set(o in export_objs, view_layer=vl)
    bpy.ops.export_scene.gltf(filepath=GLB_OUT, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_texcoords=True, export_normals=True, export_cameras=False,
                              export_lights=False, export_animations=False)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT, copy=True)
    return {'glb': glb_inspect(GLB_OUT), 'tris': sum(len(o.data.polygons) for o in export_objs)}


if __name__ == '__main__':
    print(build_and_export())
