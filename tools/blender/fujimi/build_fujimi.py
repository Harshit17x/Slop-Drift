"""Build the Fujimi Rally map in Blender (scene "Fujimi").

Run from Blender's Scripting tab or over the BlenderMCP socket. It (re)creates the FJ_ collections:
  FJ_Road        the closed track centreline (mesh vertex chain, travel order, 2 m spacing)
  FJ_Props       prototype meshes at the origin (street face = local -Y, along-road = local +X)
  FJ_Placements  linked duplicates of the prototypes: move, rotate, duplicate or delete freely
  FJ_Zones       empties marking the drift clipping zones
  FJ_Backdrop    Mount Fuji, the far skyline and the tyre-mark decals (exported as placed)
  FJ_City       the dense city, merged per 700 m chunk (exported as placed)
Then run export_fujimi.py to write src/assets/maps/fujimi/. Re-running this script discards hand edits.
Facade materials name the repo textures the game puts on them (tokyo-office, tokyo-flats, a shop atlas,
a sign atlas); the GLB carries no images.

Axes: Blender +X east, +Y north, +Z up. Game: +X east, -Z north, +Y up.
"""
import bpy
import math
import random
import numpy as np
import bmesh

SEED = 2611
HALF = 7.0                      # asphalt half width (game config road.halfWidth)
RAIL = HALF + 0.6 + 0.55        # collision line: halfWidth + shoulder + railOffset
QUAY_Y = -246.0                 # water south of this line
FUJI = (-3150.0, -1380.0)       # summit, WSW of the course
TOWER = (-980.0, 460.0)         # lattice tower (the game loads tokyo-tower.glb here)
REACH = 170.0                   # metres from the track: no buildings beyond (keeps the map light)
LAMP_REACH = 120.0

# Travel order. The 460 m waterfront straight runs west, straight at Fuji, into the 42 m drift bowl.
CONTROL = [(270, -215), (-190, -215), (-262, -213), (-318, -192), (-346, -150), (-334, -110), (-290, -90), (-240, -92),
           (-180, -80), (-120, -52), (-104, 8), (-172, 58), (-244, 110), (-232, 196), (-130, 226), (-40, 190), (60, 206),
           (160, 232), (258, 226), (318, 176), (300, 128), (236, 140), (196, 110), (210, 60), (150, 14), (140, -50),
           (196, -90), (300, -92), (342, -150)]
CREST = 6.0                     # metres: the north straight rises over the canal bridge
GRAVEL = ((300, 128), (140, -50))   # the Container Snake is a gravel rally sector between these points
ROOT = '/Users/harshitbisht/Desktop/Slop-drift/Slop-Drift/src/assets/maps/'

rng = random.Random(SEED)

# ------------------------------------------------------------------ scene and collections

scene = bpy.data.scenes.get('Fujimi') or bpy.data.scenes.new('Fujimi')
scene.unit_settings.system = 'METRIC'
for win in bpy.context.window_manager.windows:
    win.scene = scene
for c in [c for c in bpy.data.collections if c.name.startswith('FJ_')]:
    for o in list(c.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(c)
for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
    for item in [i for i in block if i.users == 0]:
        block.remove(item)


def collection(name, hide=False):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    c.hide_render = hide
    return c


C_ROAD, C_PROPS, C_PLACE, C_ZONES, C_BACK, C_CITY = (collection(n) for n in
    ('FJ_Road', 'FJ_Props', 'FJ_Placements', 'FJ_Zones', 'FJ_Backdrop', 'FJ_City'))

# ------------------------------------------------------------------ textures (repo art, for the viewport)


def image(name):
    try:
        return bpy.data.images.load(ROOT + name, check_existing=True)
    except RuntimeError:
        return None


# Facade atlases (make_facades.py): four 1024 px slots each; metres covered by one repeat of each slot.
# A facade UV is (slot * 100 + u, v); the game's shader picks the slot and tiles it with fract().
SPANS = {'res': [(11.0, 15.0), (14.4, 18.0), (14.4, 18.0), (14.4, 18.0)],
         'office': [(14.0, 17.5), (12.0, 22.8), (12.0, 22.8), (12.0, 22.8)]}
OUT_DIR = ROOT + 'fujimi/'
# Atlases the game composes (2048 x 1024, image origin top-left): 4 x 2 shop slots; ads 2 x 2 + 8 sign blades.
SHOP_SLOTS = ('grill', 'market', 'ramen', 'gamehall', 'workshop', 'zakkyo', 'ramen', 'market')


def atlas_uv(px0, py0, px1, py1, w=2048, h=1024):
    """Corner UVs (bottom-left, bottom-right, top-right, top-left) of an image-space rectangle."""
    a, b = (px0 + 2) / w, (px1 - 2) / w
    lo, hi = 1 - (py1 - 2) / h, 1 - (py0 + 2) / h
    return [(a, lo), (b, lo), (b, hi), (a, hi)]


def shop_uv(slot):
    return atlas_uv((slot % 4) * 512, (slot // 4) * 512, (slot % 4 + 1) * 512, (slot // 4 + 1) * 512)


def ad_uv(k):
    return atlas_uv((k % 2) * 512, (k // 2) * 512, (k % 2 + 1) * 512, (k // 2 + 1) * 512)


def blade_uv(k):
    return atlas_uv(1024 + k * 128, 0, 1024 + (k + 1) * 128, 1024)


# ------------------------------------------------------------------ materials


def material(name, color=(0.8, 0.8, 0.8), rough=0.6, metal=0.0, emit=None, strength=1.0, vcol=False, tex=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if vcol:
        node = nt.nodes.new('ShaderNodeVertexColor')
        node.layer_name = 'Color'
        nt.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
    if tex:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = tex
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        nt.links.new(t.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = strength
    elif emit:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1)
        bsdf.inputs['Emission Strength'].default_value = strength
    m.diffuse_color = (*color, 1)
    return m


M = {
    'kit': material('FJ_kit', rough=0.62, metal=0.1, vcol=True),
    'lamp': material('FJ_lamp', (1, 0.95, 0.85), emit=(1, 0.93, 0.8), strength=4),
    'cyan': material('FJ_neon_cyan', (0.2, 0.95, 1), emit=(0.2, 0.95, 1), strength=3),
    'magenta': material('FJ_neon_magenta', (1, 0.2, 0.7), emit=(1, 0.2, 0.7), strength=3),
    'red': material('FJ_neon_red', (1, 0.08, 0.05), emit=(1, 0.08, 0.05), strength=3),
    'amber': material('FJ_neon_amber', (1, 0.6, 0.1), emit=(1, 0.6, 0.1), strength=3),
    'white': material('FJ_neon_white', (1, 1, 1), emit=(1, 1, 1), strength=2.5),
    # Game: tokyo-office / tokyo-flats tiled, the shop atlas, the ad + blade atlas, unlit vertex-colour neon.
    'office': material('FJ_tex_office', rough=0.3, metal=0.3, tex=image('fujimi/office-atlas.webp'), strength=0.6),
    'res': material('FJ_tex_res', rough=0.75, tex=image('fujimi/res-atlas.webp'), strength=0.5),
    'fuji': material('FJ_fuji', rough=1),                                  # game: fujimi/fuji.webp, unlit
    'dirt': material('FJ_dirt', (0.35, 0.28, 0.2), rough=1, vcol=True),   # game: alpha from vertex colour
    'shops': material('FJ_tex_shops', rough=0.5, tex=image('tokyo-shops.webp'), strength=0.8),
    'signs': material('FJ_tex_signs', rough=0.4, tex=image('tokyo-ad2.webp'), strength=1),
    'glow': material('FJ_glow', vcol=True, emit=(1, 1, 1), strength=2),
    'billboard': material('FJ_billboard', (0.6, 0.6, 0.6), rough=0.4),     # game: tokyo-ad0..3 / start screen
    'skid': material('FJ_skid', (0.02, 0.02, 0.02), rough=0.9, vcol=True),
    'backdrop': material('FJ_backdrop', rough=1, vcol=True),               # game: unlit vertex colours
}

# ------------------------------------------------------------------ mesh builder


class MB:
    """Flat-shaded mesh: every face has its own corners, a colour, a material slot and per-corner UVs."""

    def __init__(self):
        self.v, self.f, self.col, self.uv, self.mat = [], [], [], [], []
        self.xf = None          # (cos, sin, x, y, z) applied to every face while set

    def face(self, pts, color=(0.5, 0.5, 0.5), mat='kit', uvs=None):
        i = len(self.v)
        if self.xf:
            c, sn, ox, oy, oz = self.xf
            pts = [(ox + c * x - sn * y, oy + sn * x + c * y, oz + z) for x, y, z in pts]
        self.v.extend(pts)
        self.f.append(tuple(range(i, i + len(pts))))
        self.col.append(color if len(color) == 4 else (*color, 1))
        self.mat.append(mat)
        self.uv.append(uvs or [(0, 0)] * len(pts))

    def box(self, x0, x1, y0, y1, z0, z1, color=(0.5, 0.5, 0.5), mat='kit', sides=None, top=None, bottom=False,
            facade=None):
        """Axis-aligned box. facade=(atlas, u0, v0) maps the four walls into a window atlas."""
        c = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        u = 0.0
        for k in range(4):
            (ax, ay), (bx, by) = c[k], c[(k + 1) % 4]
            uvs = None
            m = sides or mat
            if facade:
                atlas, u0, v0 = facade[:3]
                span_u, span_v = facade[3:]
                length = math.hypot(bx - ax, by - ay)
                uvs = [(u0 + u / span_u, v0 + z0 / span_v), (u0 + (u + length) / span_u, v0 + z0 / span_v),
                       (u0 + (u + length) / span_u, v0 + z1 / span_v), (u0 + u / span_u, v0 + z1 / span_v)]
                u += length
                m = atlas
            self.face([(ax, ay, z0), (bx, by, z0), (bx, by, z1), (ax, ay, z1)], color, m, uvs)
        self.face([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], top or color, mat)
        if bottom:
            self.face([(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)], color, mat)

    def cyl(self, cx, cy, profile, n=8, color=(0.4, 0.4, 0.4), mat='kit', cap=True, colors=None):
        """Lathe around Z through (cx, cy). profile = [(z, r), ...] bottom to top."""
        for j in range(len(profile) - 1):
            (za, ra), (zb, rb) = profile[j], profile[j + 1]
            col = colors[j] if colors else color
            for k in range(n):
                a, b = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
                self.face([(cx + ra * math.cos(a), cy + ra * math.sin(a), za), (cx + ra * math.cos(b), cy + ra * math.sin(b), za),
                           (cx + rb * math.cos(b), cy + rb * math.sin(b), zb), (cx + rb * math.cos(a), cy + rb * math.sin(a), zb)], col, mat)
        if cap:
            z, r = profile[-1]
            self.face([(cx + r * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n), z) for k in range(n)],
                      colors[-1] if colors else color, mat)

    def prism(self, profile, x0, x1, color, mat='kit'):
        """Extrude a closed YZ profile (counter-clockwise seen from +X) along X."""
        n = len(profile)
        for k in range(n):
            (ya, za), (yb, zb) = profile[k], profile[(k + 1) % n]
            self.face([(x0, ya, za), (x0, yb, zb), (x1, yb, zb), (x1, ya, za)], color, mat)
        self.face([(x1, y, z) for y, z in profile], color, mat)
        self.face([(x0, y, z) for y, z in reversed(profile)], color, mat)

    def build(self, name, coll, location=(0, 0, 0)):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.v, [], self.f)
        names = sorted(set(self.mat), key=self.mat.index)
        for n in names:
            mesh.materials.append(M[n])
        mesh.polygons.foreach_set('material_index', [names.index(m) for m in self.mat])
        colors = mesh.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
        uv = mesh.uv_layers.new(name='UVMap')
        loop_colors, loop_uv = [], []
        for poly in mesh.polygons:
            for j in range(poly.loop_total):
                loop_colors.extend(self.col[poly.index])
                loop_uv.extend(self.uv[poly.index][j])
        colors.data.foreach_set('color', loop_colors)
        uv.data.foreach_set('uv', loop_uv)
        mesh.color_attributes.active_color = colors
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        obj.location = location
        coll.objects.link(obj)
        return obj

# ------------------------------------------------------------------ the track


def catmull(points, n=40, alpha=0.5):
    p = np.array(points, float)
    out = []
    for i in range(len(p)):
        p0, p1, p2, p3 = p[i - 1], p[i], p[(i + 1) % len(p)], p[(i + 2) % len(p)]
        t1 = np.linalg.norm(p1 - p0) ** alpha
        t2 = t1 + np.linalg.norm(p2 - p1) ** alpha
        t3 = t2 + np.linalg.norm(p3 - p2) ** alpha
        for t in np.linspace(t1, t2, n, endpoint=False):
            a1 = (t1 - t) / t1 * p0 + t / t1 * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / t2 * a1 + t / t2 * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    return np.array(out)


def resample(points, step):
    closed = np.vstack([points, points[:1]])
    seg = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    n = int(round(cum[-1] / step))
    s = np.linspace(0, cum[-1], n, endpoint=False)
    return np.stack([np.interp(s, cum, closed[:, 0]), np.interp(s, cum, closed[:, 1])], 1)


track = resample(catmull(CONTROL), 2.0)
N = len(track)
tangent = np.roll(track, -1, 0) - np.roll(track, 1, 0)
tangent /= np.linalg.norm(tangent, axis=1)[:, None]
right = np.stack([tangent[:, 1], -tangent[:, 0]], 1)
d1 = (np.roll(track, -1, 0) - np.roll(track, 1, 0)) / 4
d2 = (np.roll(track, -1, 0) - 2 * track + np.roll(track, 1, 0)) / 4
curv = (d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0]) / np.linalg.norm(d1, axis=1) ** 3
curv = np.convolve(np.concatenate([curv[-7:], curv, curv[:7]]), np.ones(15) / 15, 'valid')   # + = left turn
# The crest: the longest run of the north straight, lifted on a smooth sin^2 profile.
north = (track[:, 1] > 150) & (track[:, 0] > -70) & (track[:, 0] < 230)
runs, start_i = [], None
for i in range(N + 1):
    on = i < N and north[i]
    if on and start_i is None:
        start_i = i
    if not on and start_i is not None:
        runs.append((start_i, i))
        start_i = None
c0, c1 = max(runs, key=lambda r: r[1] - r[0])
g0 = int(np.argmin(np.hypot(*(track - GRAVEL[0]).T)))
g1 = int(np.argmin(np.hypot(*(track - GRAVEL[1]).T)))
# Elevation: smooth sin^2 hills (centre index, half width in samples, metres). The waterfront straight
# and the start stay level with the quay; everything else rises and falls on walls or banks.
idx_of = lambda p: int(np.argmin(np.hypot(*(track - np.array(p)).T)))
HILLS = [(idx_of((-336, -140)), 100, 2.5),        # Fuji Bowl on a raised platform
         (idx_of((-238, 140)), 70, 4.5),          # Neon Hill through the north-west sweep
         ((c0 + c1) // 2, (c1 - c0) // 2, CREST),  # Canal Crest
         ((g0 + g1) // 2, 55, 3.0)]               # the gravel rally hump
HGT = np.zeros(N)
for centre, half, amp in HILLS:
    k = np.arange(N)
    d = (k - centre + N // 2) % N - N // 2
    HGT += np.where(np.abs(d) < half, amp * np.cos(np.pi * d / (2 * half)) ** 2, 0)
GRAVEL_IDX = (g0, g1)            # travel order: g0 < g1
on_gravel = lambda i: g0 <= i % N <= g1
road = bpy.data.meshes.new('FJ_Road')
road.from_pydata([(x, y, float(HGT[i])) for i, (x, y) in enumerate(track)], [(i, (i + 1) % N) for i in range(N)], [])
FJ_ROAD_META = {'gravel': [g0 * 2.0, g1 * 2.0], 'crest': [c0 * 2.0, c1 * 2.0]}
bpy.data.objects.new('FJ_Road', road)
C_ROAD.objects.link(bpy.data.objects['FJ_Road'])
bpy.data.objects['FJ_Road']['fj_gravel'] = FJ_ROAD_META['gravel']
bpy.data.objects['FJ_Road']['fj_crest'] = FJ_ROAD_META['crest']


def nearest(x, y):
    d = np.hypot(track[:, 0] - x, track[:, 1] - y)
    i = int(d.argmin())
    return i, float(d[i])


def offset_line(side, off, i0=0, i1=N):
    """Points and tangents of the line `off` metres to one side (side +1 = right of travel)."""
    idx = np.arange(i0, i1) % N
    return track[idx] + right[idx] * side * off, idx


# Corners: apex index, radius, turn direction.
corners = []
radius = 1 / np.maximum(np.abs(curv), 1e-9)
i = 0
while i < N:
    if radius[i] < 60:
        j = i
        while j < N and radius[j] < 60:
            j += 1
        apex = i + int(np.argmin(radius[i:j]))
        corners.append({'apex': apex, 'r': float(radius[apex]), 'left': curv[apex] > 0, 'a': i, 'b': j})
        i = j
    i += 1

# ------------------------------------------------------------------ prototypes

PROTOS = {}


def proto(name, mb, size):
    obj = mb.build(name, C_PROPS)
    obj['fj_size'] = list(size)
    PROTOS[name] = obj
    return obj


RED, WHITE, GREY, DARK, BLACK = (0.78, 0.07, 0.05), (0.82, 0.82, 0.8), (0.42, 0.43, 0.45), (0.12, 0.13, 0.15), (0.035, 0.035, 0.04)

# Jersey barrier, 2 m, painted red or white. Profile faces the road on -Y.
jersey = [(-0.3, 0), (0.3, 0), (0.3, 0.08), (0.17, 0.26), (0.08, 0.81), (-0.08, 0.81), (-0.17, 0.26), (-0.3, 0.08)]
for tag, col in (('R', RED), ('W', WHITE)):
    mb = MB()
    mb.prism(jersey, -0.99, 0.99, col)
    proto(f'K_Barrier{tag}', mb, (2, 0.6))

# Tyre wall: 4 columns of 3 tyres stacked flat, with a belt band facing the road.
for tag, band in (('R', RED), ('W', WHITE), ('B', (0.06, 0.2, 0.62))):
    mb = MB()
    for c in range(4):
        cx = -0.93 + c * 0.62
        prof, cols = [], []
        for t in range(3):
            z = t * 0.24
            prof += [(z, 0.27), (z + 0.03, 0.31), (z + 0.21, 0.31)]
            cols += [BLACK, BLACK, BLACK]
        prof.append((0.72, 0.27))
        mb.cyl(cx, 0, prof, 8, BLACK, colors=cols)
        mb.cyl(cx, 0, [(0.705, 0.17), (0.72, 0.17)], 8, (0.01, 0.01, 0.01), cap=True)
    mb.face([(-1.24, -0.315, 0.2), (1.24, -0.315, 0.2), (1.24, -0.315, 0.55), (-1.24, -0.315, 0.55)], band)
    proto(f'K_Tyres{tag}', mb, (2.48, 0.64))

# Kerb: flat, 2 m red + 2 m white, sits on the road edge.
mb = MB()
for k, col in enumerate((RED, WHITE)):
    x0 = -2 + 2 * k
    mb.face([(x0, -0.5, 0.025), (x0 + 2, -0.5, 0.025), (x0 + 2, 0.5, 0.06), (x0, 0.5, 0.06)], col)
proto('K_Kerb', mb, (4, 1))

# Floodlight mast: 15 m pole, crossarm with three lamps aimed at the road.
mb = MB()
mb.box(-0.45, 0.45, -0.45, 0.45, 0, 0.5, (0.35, 0.35, 0.36))
mb.cyl(0, 0, [(0.5, 0.2), (14.5, 0.12)], 8, GREY)
mb.box(-2.1, 2.1, -0.12, 0.12, 14.3, 14.55, GREY)
for x in (-1.6, 0, 1.6):
    mb.box(x - 0.45, x + 0.45, -0.55, -0.1, 13.6, 14.3, DARK)
    mb.face([(x - 0.4, -0.56, 13.65), (x + 0.4, -0.56, 13.65), (x + 0.4, -0.56, 14.25), (x - 0.4, -0.56, 14.25)], mat='lamp')
    mb.face([(x - 0.4, -0.55, 13.6), (x - 0.4, -0.1, 13.6), (x + 0.4, -0.1, 13.6), (x + 0.4, -0.55, 13.6)], mat='lamp')
proto('K_Mast', mb, (1, 1))

# LED chevron board on legs. It faces oncoming cars; L points to local -X (left as the driver sees it).
ARROW = [(-0.14, 1.12), (0.06, 1.12), (0.34, 1.5), (0.06, 1.88), (-0.14, 1.88), (0.14, 1.5)]
for tag, sign in (('L', -1), ('R', 1)):
    mb = MB()
    for x in (-0.55, 0.55):
        mb.box(x - 0.04, x + 0.04, -0.04, 0.04, 0, 1.0, GREY)
    mb.box(-0.8, 0.8, -0.06, 0.06, 1.0, 2.0, (0.25, 0.02, 0.02))
    for a in (-0.42, 0.18):
        pts = [(sign * (x + a + 0.12), -0.07, z) for x, z in ARROW]
        mb.face(pts if sign > 0 else pts[::-1], mat='white')
    proto(f'K_Chevron{tag}', mb, (1.6, 0.2))

# Clipping-zone post: white pole with a glowing cap (the game tints it per zone).
mb = MB()
mb.cyl(0, 0, [(0, 0.09), (1.5, 0.07)], 8, WHITE, colors=[WHITE])
mb.cyl(0, 0, [(1.5, 0.11), (2.1, 0.11)], 8, mat='cyan')
proto('K_ClipPost', mb, (0.3, 0.3))

# Shipping container (tinted per instance in the game).
mb = MB()
mb.box(-6.1, 6.1, -1.22, 1.22, 0, 2.59, (0.85, 0.85, 0.85), top=(0.62, 0.62, 0.62))
for k in range(15):            # corrugation as light/dark bands painted on the long sides
    x = -5.6 + k * 0.8
    mb.face([(x, -1.225, 0.15), (x + 0.32, -1.225, 0.15), (x + 0.32, -1.225, 2.44), (x, -1.225, 2.44)], (0.66, 0.66, 0.66))
    mb.face([(x + 0.32, 1.225, 0.15), (x, 1.225, 0.15), (x, 1.225, 2.44), (x + 0.32, 1.225, 2.44)], (0.66, 0.66, 0.66))
proto('K_Container', mb, (12.2, 2.44))

# Grandstand: six rows of seats under a lit canopy, facing the road.
mb = MB()
for row in range(6):
    y0 = -2.5 + row * 0.9
    mb.box(-10, 10, y0, 3.5, 0, 0.6 + row * 0.55, (0.3, 0.31, 0.33), top=(0.08, 0.18, 0.5) if row % 2 else (0.75, 0.75, 0.76))
for x in (-9.6, 0, 9.6):
    mb.box(x - 0.15, x + 0.15, 3.2, 3.5, 0, 7.2, GREY)
mb.box(-10.5, 10.5, -3.2, 3.7, 7.2, 7.45, (0.2, 0.21, 0.23))
mb.face([(-10, -2.9, 7.19), (-10, 3.4, 7.19), (10, 3.4, 7.19), (10, -2.9, 7.19)], mat='lamp')
proto('K_Grandstand', mb, (21, 7))

# Start gantry: pylons stand behind the barriers, LED screen above the road.
mb = MB()
for x in (-RAIL - 1.2, RAIL + 1.2):
    mb.box(x - 0.6, x + 0.6, -0.6, 0.6, 0, 8.4, (0.16, 0.17, 0.19))
    mb.box(x - 0.62, x + 0.62, -0.62, -0.6, 0.4, 7.8, mat='magenta')
mb.box(-RAIL - 1.2, RAIL + 1.2, -0.5, 0.5, 6.6, 8.4, (0.16, 0.17, 0.19))
mb.face([(-6.5, -0.52, 6.75), (6.5, -0.52, 6.75), (6.5, -0.52, 8.25), (-6.5, -0.52, 8.25)], mat='billboard',
        uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
mb.face([(-6.5, 0.52, 8.25), (6.5, 0.52, 8.25), (6.5, 0.52, 6.75), (-6.5, 0.52, 6.75)], mat='billboard',
        uvs=[(1, 1), (0, 1), (0, 0), (1, 0)])
proto('K_Gantry', mb, (2 * RAIL + 3.6, 1.2))

# Roadside billboard on two legs (the game puts original ad art on the face).
mb = MB()
for x in (-3, 3):
    mb.box(x - 0.15, x + 0.15, -0.15, 0.15, 0, 4, GREY)
mb.box(-4.3, 4.3, -0.2, 0.2, 4, 8.6, DARK)
mb.face([(-4.1, -0.21, 4.2), (4.1, -0.21, 4.2), (4.1, -0.21, 8.4), (-4.1, -0.21, 8.4)], mat='billboard',
        uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
for x in (-3, 0, 3):
    mb.box(x - 0.2, x + 0.2, -0.9, -0.2, 8.6, 8.75, mat='lamp')
proto('K_Billboard', mb, (8.6, 0.4))

# Cone stack (decoration behind the barriers).
mb = MB()
for k, (x, y) in enumerate(((0, 0), (0.6, 0.1), (0.3, 0.55))):
    h = 0.7 + 0.08 * k
    mb.cyl(x, y, [(0, 0.2), (h * 0.45, 0.13), (h * 0.62, 0.1), (h, 0.03)], 8,
           colors=[(0.95, 0.35, 0.02), (0.9, 0.9, 0.9), (0.95, 0.35, 0.02)])
proto('K_Cones', mb, (1, 1))

# Quay edge with bollards.
mb = MB()
mb.box(-10, 10, -0.6, 0.6, -2.5, 0.25, (0.33, 0.33, 0.32))
for x in (-6, 4):
    mb.cyl(x, 0.1, [(0.25, 0.18), (0.7, 0.14), (0.8, 0.24), (0.86, 0.2)], 8, (0.15, 0.15, 0.16))
proto('K_Quay', mb, (20, 1.2))

# Ship-to-shore crane: red and white portal legs, boom over the water, aviation lights.
mb = MB()
CR = (0.72, 0.1, 0.08)
for x in (-9, 9):
    for y in (-8, 8):
        mb.box(x - 0.7, x + 0.7, y - 0.7, y + 0.7, 0, 44, CR)
    mb.box(x - 0.8, x + 0.8, -8.5, 8.5, 18, 19.5, CR)
mb.box(-10, 10, -9, 9, 44, 47, CR)
mb.box(-1.5, 1.5, -62, 30, 46, 49, WHITE)
mb.box(-1.2, 1.2, -6, 6, 47, 64, CR)
mb.box(-4, 4, -10, -2, 40, 44, (0.6, 0.6, 0.62))
for y in (-62, 30):
    mb.box(-0.5, 0.5, y - 0.5, y + 0.5, 49, 50, mat='red')
mb.box(-0.5, 0.5, -0.5, 0.5, 64, 65, mat='red')
proto('K_Crane', mb, (20, 18))

# Harbour warehouse: pitched roof, roller doors, a strip of lit clerestory windows.
mb = MB()
W, D, H = 40, 24, 11
mb.box(-W / 2, W / 2, -D / 2, D / 2, 0, H, (0.36, 0.4, 0.44), top=(0.22, 0.23, 0.25))
mb.face([(-W / 2, -D / 2, H), (W / 2, -D / 2, H), (W / 2, 0, H + 3), (-W / 2, 0, H + 3)], (0.24, 0.25, 0.27))
mb.face([(W / 2, D / 2, H), (-W / 2, D / 2, H), (-W / 2, 0, H + 3), (W / 2, 0, H + 3)], (0.24, 0.25, 0.27))
for x in (-W / 2, W / 2):
    s = 1 if x > 0 else -1
    pts = [(x, -D / 2, H), (x, D / 2, H), (x, 0, H + 3)]
    mb.face(pts if s > 0 else pts[::-1], (0.36, 0.4, 0.44))
for k in range(4):
    x = -15 + k * 10
    mb.face([(x - 3, -D / 2 - 0.05, 0), (x + 3, -D / 2 - 0.05, 0), (x + 3, -D / 2 - 0.05, 5.5), (x - 3, -D / 2 - 0.05, 5.5)],
            (0.62, 0.55, 0.2) if k % 2 else (0.5, 0.52, 0.55))
    mb.box(x - 0.4, x + 0.4, -D / 2 - 0.5, -D / 2 - 0.05, 6.2, 6.5, mat='lamp')
mb.face([(-W / 2 + 1, -D / 2 - 0.05, 8.5), (W / 2 - 1, -D / 2 - 0.05, 8.5), (W / 2 - 1, -D / 2 - 0.05, 9.6),
         (-W / 2 + 1, -D / 2 - 0.05, 9.6)], mat='amber')
proto('B_Warehouse', mb, (W, D))


# Street lamp: 7.5 m pole with an arm over the street (local -Y).
mb = MB()
mb.cyl(0, 0, [(0, 0.11), (7.4, 0.07)], 6, (0.2, 0.21, 0.22))
mb.box(-0.05, 0.05, -1.7, 0, 7.3, 7.42, (0.2, 0.21, 0.22))
mb.box(-0.2, 0.2, -2.0, -1.4, 7.15, 7.35, DARK)
mb.face([(-0.18, -1.98, 7.14), (-0.18, -1.42, 7.14), (0.18, -1.42, 7.14), (0.18, -1.98, 7.14)], mat='lamp')
proto('K_StreetLamp', mb, (0.3, 2))


def rock(mb, cx, cy, size, col, seed, squash=0.7, z0=0.0, uniform=False, detail=1):
    """An irregular low-poly rock: a jittered icosphere, flattened, sat a little into the ground."""
    rr = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=detail, radius=1.0)   # 1: 20 faces (rocks), 2: 80 (foliage)
    stretch = rr.uniform(0.9, 1.35)
    for v in bm.verts:
        k = rr.uniform(0.78, 1.18) * size
        v.co.x, v.co.y, v.co.z = v.co.x * k * stretch, v.co.y * k, max(-0.3, v.co.z) * k * squash
    for f in bm.faces:
        shade = 1.0 if uniform else rr.uniform(0.75, 1.15) * (0.8 + 0.25 * f.normal.z)
        mb.face([(v.co.x + cx, v.co.y + cy, v.co.z + size * 0.15 + z0) for v in f.verts], tuple(c * shade for c in col))
    bm.free()


ROCK = (0.36, 0.33, 0.3)
mb = MB()
rock(mb, 0, 0, 0.42, ROCK, 1)
rock(mb, 0.5, 0.2, 0.22, (0.4, 0.36, 0.31), 2)
proto('K_Rock', mb, (1.2, 0.8))
mb = MB()
for k in range(6):
    rock(mb, rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), rng.uniform(0.05, 0.12), (0.24, 0.22, 0.2), 10 + k, 0.6)
proto('K_Pebble', mb, (1.2, 1.2))
mb = MB()
rock(mb, 0, 0, 1.05, (0.3, 0.29, 0.28), 21, 0.75)
rock(mb, 0.7, -0.4, 0.5, (0.33, 0.31, 0.29), 22)
proto('K_Boulder', mb, (2.4, 2.0))
# Tyre island: four bolted columns of tyres with a reflective band and a cyan marker light.
mb = MB()
for ox, oy in ((-0.32, -0.32), (0.32, -0.32), (-0.32, 0.32), (0.32, 0.32)):
    prof = []
    for t in range(4):
        z = t * 0.24
        prof += [(z, 0.27), (z + 0.03, 0.31), (z + 0.21, 0.31)]
    prof.append((0.96, 0.27))
    mb.cyl(ox, oy, prof, 8, BLACK)
mb.cyl(0, 0, [(0.4, 0.66), (0.62, 0.66)], 12, WHITE, cap=False)
mb.cyl(0, 0, [(0.96, 0.05), (1.5, 0.05)], 6, GREY)
mb.cyl(0, 0, [(1.5, 0.09), (1.75, 0.09)], 6, mat='cyan')
proto('K_TyreStack', mb, (1.4, 1.4))

# Trees and a bush: low-poly canopies of jittered blobs on tapered trunks (tinted per instance in the game).
BARK = (0.24, 0.18, 0.13)


def tree(name, trunk_h, trunk_r, blobs, col, lean=0.0):
    mb = MB()
    mb.cyl(0, 0, [(0, trunk_r), (trunk_h * 0.6, trunk_r * 0.8), (trunk_h, trunk_r * 0.55)], 6, BARK)
    for k, (ox, oy, oz, r, sq) in enumerate(blobs):
        # One colour per blob so the game can weld and smooth-shade the canopy.
        rock(mb, ox + lean * oz, oy, r, tuple(c * (0.9 + 0.1 * k) for c in col), sum(map(ord, name)) + k, sq, oz - r * 0.5, uniform=True, detail=2)
    proto(name, mb, (3, 3))


tree('K_TreeRound', 3.4, 0.22, [(0, 0, 4.6, 2.5, 0.85), (0.9, 0.6, 5.6, 1.9, 0.8), (-0.8, -0.5, 5.2, 1.7, 0.8)], (0.055, 0.12, 0.03))
tree('K_TreeTall', 3.0, 0.2, [(0, 0, 3.8, 1.5, 1.0), (0.2, 0.1, 5.4, 1.35, 1.0), (0, -0.1, 6.8, 1.0, 1.0)], (0.065, 0.14, 0.035))
tree('K_TreeSakura', 2.4, 0.2, [(0, 0, 3.4, 2.2, 0.75), (0.8, -0.5, 4.0, 1.6, 0.7)], (0.72, 0.42, 0.5))
tree('K_TreePine', 3.6, 0.18, [(0.6, 0, 3.4, 1.7, 0.42), (1.2, 0.4, 4.6, 1.4, 0.42), (1.6, -0.2, 5.6, 1.0, 0.45)], (0.025, 0.065, 0.03), lean=0.12)
mb = MB()
rock(mb, 0, 0, 0.8, (0.05, 0.11, 0.03), 77, 0.8, uniform=True, detail=2)
rock(mb, 0.7, 0.3, 0.6, (0.06, 0.12, 0.035), 78, 0.8, uniform=True, detail=2)
proto('K_Bush', mb, (1.6, 1.2))

for i, obj in enumerate(PROTOS.values()):        # park the prototypes in a row, out of the way
    obj.location = (i * 60 - 600, 2400, 0)

# ------------------------------------------------------------------ placements

placed = []          # (x, y, radius) footprints for spacing checks


def place(name, x, y, yaw, tint=None, z=0.0, variant=None, solid=None):
    src = PROTOS[name]
    obj = bpy.data.objects.new(name, src.data)
    obj.location = (x, y, float(z))
    obj.rotation_euler = (0, 0, yaw)
    if solid:
        obj['fj_solid'] = solid
    if tint is not None:
        obj['fj_tint'] = tint
    if variant is not None:
        obj['fj_variant'] = variant
    C_PLACE.objects.link(obj)
    return obj


def face_road_yaw(i, side):
    """Local -Y faces the road from `side` of point i; local +X runs back against travel on the right."""
    t = tangent[i]
    ax, ay = -side * t[0], -side * t[1]
    return math.atan2(ay, ax)


def along(side, off, step, i0=0, i1=N, every=None):
    """Positions every `step` metres along the offset line; yields (x, y, index)."""
    pts, idx = offset_line(side, off, i0, i1)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    s = step / 2
    while s < cum[-1]:
        k = int(np.searchsorted(cum, s) - 1)
        k = max(0, min(k, len(seg) - 1))
        f = (s - cum[k]) / max(seg[k], 1e-6)
        p = pts[k] + (pts[k + 1] - pts[k]) * f
        yield float(p[0]), float(p[1]), int(idx[k])
        s += step


def outside_tight(i, side, limit):
    r = radius[i]
    outside = 1 if curv[i] > 0 else -1
    return r < limit and side == outside


START = 20   # gantry index (40 m: the game's loop start)

# Barriers and tyre walls, both sides, all the way round.
for side in (-1, 1):
    k = 0
    for x, y, i in along(side, RAIL + 0.32, 2.0):
        tyre = any(outside_tight((i + d) % N, side, 42) for d in (-6, 0, 6))
        if tyre:
            continue
        place('K_BarrierR' if (k // 1) % 2 else 'K_BarrierW', x, y, face_road_yaw(i, side), z=HGT[i])
        k += 1
    k = 0
    for x, y, i in along(side, RAIL + 0.33, 2.48):
        if any(outside_tight((i + d) % N, side, 42) for d in (-6, 0, 6)):
            place(('K_TyresR', 'K_TyresW', 'K_TyresB')[k % 3], x, y, face_road_yaw(i, side), z=HGT[i])
            k += 1

zones = []
for n, c in enumerate(corners):
    apex, inside = c['apex'], (-1 if c['left'] else 1)
    if c['r'] < 60 and not on_gravel(apex):      # kerbs on the inside of tarmac apexes
        for x, y, i in along(inside, HALF - 0.5, 4.0, apex - 9, apex + 10):
            place('K_Kerb', x, y, face_road_yaw(i, inside), z=HGT[i])
    if c['r'] < 46:      # clipping zone on the outside
        out = -inside
        for d in (-14, -7, 0, 7, 14):
            j = (apex + d) % N
            p = track[j] + right[j] * out * (RAIL + 1.3)
            place('K_ClipPost', float(p[0]), float(p[1]), 0.0, z=HGT[j])
        zp = track[apex] + right[apex] * out * (HALF - 1.5)
        e = bpy.data.objects.new(f'Zone_{len(zones) + 1}', None)
        e.location = (float(zp[0]), float(zp[1]), 0)
        e.empty_display_size = 6
        e['fj_index'] = apex
        e['fj_radius'] = round(c['r'], 1)
        C_ZONES.objects.link(e)
        zones.append(e)
    if c['r'] < 36:      # LED chevrons ahead of the turn-in
        out = -inside
        for d in (-26, -18, -10, -2):
            j = (apex + d) % N
            p = track[j] + right[j] * out * (RAIL + 1.6)
            place('K_ChevronL' if c['left'] else 'K_ChevronR', float(p[0]), float(p[1]), math.atan2(right[j][1], right[j][0]), z=HGT[j])

# Floodlight masts every ~56 m, alternating sides.
for k, i in enumerate(range(8, N, 28)):
    side = 1 if k % 2 else -1
    if outside_tight(i, side, 45):
        side = -side
    p = track[i] + right[i] * side * (RAIL + 3.2)
    if side == -1 and p[1] < QUAY_Y + 3:
        side = 1
        p = track[i] + right[i] * side * (RAIL + 3.2)
    place('K_Mast', float(p[0]), float(p[1]), face_road_yaw(i, side), z=HGT[i])
    placed.append((float(p[0]), float(p[1]), 2))

# Start gantry across the road; grandstands on the inside of the straight and the first hairpin.
g = place('K_Gantry', float(track[START][0]), float(track[START][1]), math.atan2(tangent[START][1], tangent[START][0]) + math.pi / 2)
for i, side in ((55, 1), (100, 1), (corners[0]['apex'], 1 if corners[0]['left'] else -1)):
    p = track[i] + right[i] * side * (RAIL + 5.2)
    place('K_Grandstand', float(p[0]), float(p[1]), face_road_yaw(i, side), z=HGT[i])
    placed.append((float(p[0]), float(p[1]), 12))

# Billboards and cone stacks on the outside of the bigger corners.
ads = 0
for c in corners:
    out = 1 if c['left'] else -1
    j = (c['apex'] + 12) % N
    if c['r'] < 55 and ads < 8:
        p = track[j] + right[j] * out * (RAIL + 9)
        if p[1] > QUAY_Y + 6:
            place('K_Billboard', float(p[0]), float(p[1]), face_road_yaw(j, out), variant=ads % 4, z=HGT[j])
            placed.append((float(p[0]), float(p[1]), 6))
            ads += 1
    j = (c['apex'] - 20) % N
    p = track[j] + right[j] * out * (RAIL + 3)
    place('K_Cones', float(p[0]), float(p[1]), rng.uniform(0, 6.28), z=HGT[j])

# Quay along the waterfront and cranes on the east wharf.
for x in range(-480, 520, 20):
    place('K_Quay', float(x), QUAY_Y - 0.6, 0.0)
for x in (560, 640, 720):
    place('K_Crane', float(x), -330.0, 0.0)

# Solid obstacles (the game collides with fj_solid radii): a tyre-island slalom on the waterfront
# straight before the Fuji Bowl, and boulders that pinch the gravel sector. Each leaves a 3 m+ lane.
SOLIDS = 0
for i, lat in ((130, 3.2), (150, -3.2), (170, 3.2)):
    p = track[i] + right[i] * lat
    place('K_TyreStack', float(p[0]), float(p[1]), 0.0, z=HGT[i], solid=0.78)
    SOLIDS += 1
for k, i in enumerate(range(g0 + 25, g1 - 10, 34)):
    lat = (HALF - 0.9) * (1 if k % 2 else -1)
    p = track[i] + right[i] * lat
    place('K_Boulder', float(p[0]), float(p[1]), rng.uniform(0, 6.28), z=HGT[i] - 0.15, solid=1.05)
    SOLIDS += 1
# Loose rocks on the gravel shoulders and pebbles strewn across the gravel and its track-out.
for _ in range(60):
    i = rng.randint(g0, g1)
    side = rng.choice((-1, 1))
    p = track[i] + right[i] * side * rng.uniform(HALF + 0.5, RAIL - 0.25)
    place('K_Rock', float(p[0]), float(p[1]), rng.uniform(0, 6.28), z=HGT[i])
for _ in range(170):
    i = rng.randint(g0 - 5, g1 + 25) % N
    p = track[i] + right[i] * rng.uniform(-HALF + 0.5, HALF - 0.5)
    place('K_Pebble', float(p[0]), float(p[1]), rng.uniform(0, 6.28), z=HGT[i])

# Dirt: gravel dragged onto the tarmac after the sector, dust on the outside of corners, road grime.
dirt = MB()


def blob(i, lateral, size, alpha):
    c = track[i] + right[i] * lateral
    z = float(HGT[i]) + 0.024
    n = 14
    ring = [size * rng.uniform(0.6, 1.25) for _ in range(n)]
    for k in range(n):
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        pa = (c[0] + ring[k] * math.cos(a0), c[1] + ring[k] * math.sin(a0), z)
        pb = (c[0] + ring[(k + 1) % n] * math.cos(a1), c[1] + ring[(k + 1) % n] * math.sin(a1), z)
        # u runs 0 at the centre to 1 at the rim (the game's alpha ramp); the tint carries the strength.
        dirt.face([(float(c[0]), float(c[1]), z), pa, pb], (1 - alpha * 0.8,) * 3, 'dirt', [(0, 0.5), (1, 0.5), (1, 0.5)])


for k in range(26):
    blob((g1 + 2 + k * 2) % N, rng.uniform(-4.5, 4.5), rng.uniform(1.5, 3.5) * (1 - k / 30), 0.85 * (1 - k / 30))
for k in range(12):
    blob((g0 - 2 - k * 2) % N, rng.uniform(-4, 4), rng.uniform(1.2, 2.5), 0.5 * (1 - k / 14))
for c in corners:
    out = 1 if c['left'] else -1
    for _ in range(4):
        blob((c['apex'] + rng.randint(-12, 12)) % N, out * rng.uniform(HALF - 2.2, HALF - 0.6), rng.uniform(1.0, 2.2), 0.45)
for _ in range(40):
    blob(rng.randrange(N), rng.uniform(-5, 5), rng.uniform(0.6, 1.6), 0.28)


def infield(x, y):
    inside = False
    for k in range(N):
        (ax, ay), (bx, by) = track[k], track[(k + 1) % N]
        if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
            inside = not inside
    return inside


def clear_of_track(x, y, r, margin):
    return nearest(x, y)[1] > RAIL + margin + r


def free(x, y, r):
    return all(math.hypot(x - a, y - b) > r + rr + 2 for a, b, rr in placed)


# Container stacks in the infield yard and along the east wharf.
CONTAINER_TINTS = [0xb5372a, 0x1d5fa8, 0x2f7d4f, 0xd7d4cc, 0xd7791f, 0x6c2f8c, 0x9aa1a8]
for x0, y0, x1, y1, yaw in ((150, 150, 270, 200, 0.0), (220, -40, 300, 40, math.pi / 2), (380, -235, 520, -180, 0.0),
                            (-60, -170, 40, -120, 0.0)):
    for x in np.arange(x0, x1, 13.5):
        for y in np.arange(y0, y1, 3.2):
            if not clear_of_track(x, y, 6.4, 4) or not free(x, y, 3):
                continue
            levels = rng.choice((1, 1, 2, 2, 3))
            for lv in range(levels):
                place('K_Container', float(x), float(y), yaw, tint=rng.choice(CONTAINER_TINTS), z=lv * 2.6)
            placed.append((float(x), float(y), 6.3))

# ------------------------------------------------------------------ the city

# Warehouses along the east wharf stay instanced prototypes.
for x in np.arange(392, 900, 50.0):
    for y in np.arange(-205, 70, 34.0):
        if nearest(x, y)[1] < REACH - 10 and clear_of_track(x, y, 22, 8) and free(x, y, 22):
            place('B_Warehouse', float(x), float(y), 0.0 if rng.random() < 0.5 else math.pi)
            placed.append((float(x), float(y), 22))

FUJI_BEARING = math.atan2(FUJI[1], FUJI[0])
CHUNK = 700.0
WARM, COOL, PINK, CYAN, RED_GLOW = (1, 0.78, 0.5), (0.75, 0.9, 1), (1, 0.25, 0.7), (0.25, 0.95, 1), (1, 0.1, 0.06)
city = {}
BUILT = 0
LOTS = []     # building footprints (centre x, y, half width, half depth), kept clear of trees
LAMPS = 0


def chunk(x, y):
    return city.setdefault((int((x + 1400) // CHUNK), int((y + 1400) // CHUNK)), MB())


def oriented(pts, want):
    a, b, c = (np.array(p) for p in pts[:3])
    n = np.cross(b - a, c - a)
    return pts if float(n @ np.array(want)) >= 0 else pts[::-1]


def wall(mb, ax, ay, bx, by, z0, z1, mat, slot, u0, tint):
    """A facade quad mapped into `slot` of the `mat` atlas, in metres from its own ground."""
    su, sv = SPANS[mat][slot]
    length = math.hypot(bx - ax, by - ay)
    base = slot * 100 + u0
    mb.face([(ax, ay, z0), (bx, by, z0), (bx, by, z1), (ax, ay, z1)], tint, mat,
            [(base, z0 / sv), (base + length / su, z0 / sv), (base + length / su, z1 / sv), (base, z1 / sv)])


def fbox(mb, x0, x1, y0, y1, z0, z1, mat, slot, tint, roof=(0.15, 0.15, 0.16), u0=0.0):
    """A facade-wrapped box: four atlas walls running on round the corners, and a plain roof."""
    edges = [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]
    u = u0
    for a, b in edges:
        wall(mb, *a, *b, z0, z1, mat, slot, u, tint)
        u += math.hypot(b[0] - a[0], b[1] - a[1]) / SPANS[mat][slot][0]
    mb.face([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], roof)


def parapet(mb, x0, x1, y0, y1, z, col=(0.5, 0.5, 0.49)):
    """Roof parapet: an outer face and a cap on each side (12 quads, the inner face is never seen low)."""
    h, t = 1.0, 0.25
    c = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    ci = [(x0 + t, y0 + t), (x1 - t, y0 + t), (x1 - t, y1 - t), (x0 + t, y1 - t)]
    for k in range(4):
        (ax, ay), (bx, by) = c[k], c[(k + 1) % 4]
        (ix, iy), (jx, jy) = ci[k], ci[(k + 1) % 4]
        mb.face([(ax, ay, z), (bx, by, z), (bx, by, z + h), (ax, ay, z + h)], col)
        mb.face([(ax, ay, z + h), (bx, by, z + h), (jx, jy, z + h), (ix, iy, z + h)], np.array(col) * 1.1)
        mb.face([(jx, jy, z), (ix, iy, z), (ix, iy, z + h), (jx, jy, z + h)], np.array(col) * 0.8)


def blade(mb, x, y0, z0, length):
    """Vertical sign sticking out of the front wall, lit on its face and both sides."""
    uv = blade_uv(rng.randrange(8))
    y1, y2 = y0 - 1.3, y0 - 0.1
    mb.box(x - 0.45, x + 0.45, y1, y2, z0, z0 + length, (0.07, 0.07, 0.08))
    mb.face([(x - 0.42, y1 - 0.01, z0 + 0.2), (x + 0.42, y1 - 0.01, z0 + 0.2), (x + 0.42, y1 - 0.01, z0 + length - 0.2),
             (x - 0.42, y1 - 0.01, z0 + length - 0.2)], (1, 1, 1), 'signs', uv)
    for sx in (-1, 1):
        xx = x + sx * 0.46
        pts = [(xx, y1 + 0.05, z0 + 0.2), (xx, y2 - 0.05, z0 + 0.2), (xx, y2 - 0.05, z0 + length - 0.2), (xx, y1 + 0.05, z0 + length - 0.2)]
        mb.face(pts if sx > 0 else [pts[1], pts[0], pts[3], pts[2]], (1, 1, 1), 'signs', uv)


def building(mb, kind, w, d, h, near):
    """Local frame: the street face is at y = -d/2, the footprint centred on the origin."""
    x0, x1, y0, y1 = -w / 2, w / 2, -d / 2, d / 2
    t = rng.uniform(0.78, 1.0)
    tint = (t, t * rng.uniform(0.95, 1.0), t * rng.uniform(0.9, 1.0))
    u0 = rng.randrange(4) * 0.25
    top = h
    if kind == 'zakkyo':
        mb.face([(x0, y0, 0), (x1, y0, 0), (x1, y0, h), (x0, y0, h)], tint, 'shops', shop_uv(5))
        side = rng.choice((0, 3))
        for a, b in (((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
            wall(mb, *a, *b, 0, h, 'res', side, u0, tint)
        mb.face([(x0, y0, h), (x1, y0, h), (x1, y1, h), (x0, y1, h)], (0.15, 0.15, 0.16))
    elif kind == 'office':
        slot = rng.choice((0, 0, 1, 2, 2, 3))
        podium = 0.0
        if near and h > 40 and rng.random() < 0.6:     # podium with a lit lobby, the tower set back above
            podium = rng.choice((7.6, 11.4))
            fbox(mb, x0, x1, y0, y1, 0, podium, 'office', 3, tint, u0=u0)
            parapet(mb, x0, x1, y0, y1, podium)
            x0, x1, y0, y1 = x0 + 2, x1 - 2, y0 + 2.5, y1 - 2
        fbox(mb, x0, x1, y0, y1, podium, h, 'office', slot, tint, u0=u0)
        mb.face([(x0 + 0.5, y0 - 0.03, podium + 0.2), (x1 - 0.5, y0 - 0.03, podium + 0.2), (x1 - 0.5, y0 - 0.03, podium + 3.6),
                 (x0 + 0.5, y0 - 0.03, podium + 3.6)], (0.3, 0.38, 0.48), 'glow') if podium == 0 else None
        if h > 70 and rng.random() < 0.6:          # setback crown
            cw, cd, ch = (x1 - x0) * 0.72, (y1 - y0) * 0.72, h * rng.uniform(0.08, 0.16)
            fbox(mb, -cw / 2, cw / 2, -cd / 2 + (y0 + y1) / 2, cd / 2 + (y0 + y1) / 2, h, h + ch, 'office', slot, tint, u0=u0)
            top = h + ch
            if rng.random() < 0.6:
                glow = rng.choice((COOL, CYAN, PINK))
                mb.box(-cw / 2 - 0.08, cw / 2 + 0.08, -cd / 2 + (y0 + y1) / 2 - 0.08, cd / 2 + (y0 + y1) / 2 + 0.08, top - 1.0, top - 0.5, glow, mat='glow')
        elif near:
            parapet(mb, x0, x1, y0, y1, h, (0.4, 0.42, 0.45))
        w, d = x1 - x0, y1 - y0
    else:
        slot = rng.choice((0, 1, 1, 2, 2, 3)) if kind == 'flats' else rng.choice((0, 2, 3))
        base = 0.0
        if near:
            n = max(1, round(w / 8))
            seg = w / n
            for k in range(n):
                xa, xb = x0 + k * seg, x0 + (k + 1) * seg
                mb.face([(xa, y0, 0), (xb, y0, 0), (xb, y0, 5), (xa, y0, 5)], (1, 1, 1), 'shops', shop_uv(rng.choice((0, 1, 2, 3, 4, 6, 7))))
            mb.box(x0, x1, y0 - 1.2, y0, 4.9, 5.2, (0.12, 0.12, 0.13))
            mb.face([(x0, y0 - 1.2, 4.89), (x0, y0, 4.89), (x1, y0, 4.89), (x1, y0 - 1.2, 4.89)], WARM, 'glow')
            base = 5.0
        su = SPANS['res'][slot][0]
        wall(mb, x0, y0, x1, y0, base, h, 'res', slot, u0, tint)
        u = u0 + w / su
        for a, b in (((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
            wall(mb, *a, *b, 0, h, 'res', slot, u, tint)
            u += math.hypot(b[0] - a[0], b[1] - a[1]) / su
        mb.face([(x0, y0, h), (x1, y0, h), (x1, y1, h), (x0, y1, h)], (0.15, 0.15, 0.16))
        if near and slot in (1, 2):                # real balcony slabs on the floor lines of the texture
            floor = SPANS['res'][slot][1] / 6
            z = math.ceil((base + 0.5) / floor) * floor
            while z < h - 1:
                for yy, sgn in ((y0, -1), (y1, 1)):
                    ya, yb = (yy - 0.9, yy) if sgn < 0 else (yy, yy + 0.9)
                    yo = ya if sgn < 0 else yb             # slab edge, soffit and top: the faces you see
                    mb.face(oriented([(x0 + 0.15, yo, z - 0.2), (x1 - 0.15, yo, z - 0.2), (x1 - 0.15, yo, z), (x0 + 0.15, yo, z)], (0, sgn, 0)), (0.74, 0.73, 0.7))
                    mb.face(oriented([(x0 + 0.15, ya, z - 0.2), (x1 - 0.15, ya, z - 0.2), (x1 - 0.15, yb, z - 0.2), (x0 + 0.15, yb, z - 0.2)], (0, 0, -1)), (0.5, 0.49, 0.47))
                    mb.face(oriented([(x0 + 0.15, ya, z), (x1 - 0.15, ya, z), (x1 - 0.15, yb, z), (x0 + 0.15, yb, z)], (0, 0, 1)), (0.6, 0.6, 0.58))
                z += floor
        if near:
            parapet(mb, x0, x1, y0, y1, h)
    rw, rd = (w * 0.66, d * 0.66) if top > h else (w * 0.9, d * 0.9)
    # Roof clutter: plant rooms, a water tank, an antenna.
    for _ in range(rng.randint(1, 3)):
        bw, bd = rng.uniform(1.5, min(5, rw * 0.4)), rng.uniform(1.5, min(4, rd * 0.4))
        bx, by = rng.uniform(-rw / 2 + bw, rw / 2 - bw), rng.uniform(-rd / 2 + bd, rd / 2 - bd)
        mb.box(bx - bw / 2, bx + bw / 2, by - bd / 2, by + bd / 2, top, top + rng.uniform(1.2, 3), (0.32, 0.33, 0.34))
    if kind != 'office' and rng.random() < 0.4:
        mb.cyl(rw * 0.25, rd * 0.2, [(top, 1.1), (top + 2.4, 1.1)], 6, (0.42, 0.44, 0.46))
    if top > 90:
        mb.box(-0.15, 0.15, -0.15, 0.15, top, top + 9, (0.5, 0.5, 0.5))
        mb.box(-0.3, 0.3, -0.3, 0.3, top + 9, top + 9.6, RED_GLOW, mat='glow')
    if top > 55:
        for sx in (-1, 1):
            mb.box(sx * rw / 2 - 0.5 * sx - 0.25, sx * rw / 2 - 0.5 * sx + 0.25, -0.25, 0.25, top, top + 0.5, RED_GLOW, mat='glow')
    # Rooftop billboard facing the street.
    if w >= 10 and (kind == 'zakkyo' and rng.random() < 0.45 or kind != 'office' and near and rng.random() < 0.2):
        bw = min(w - 1.5, 11)
        bh = bw * 0.5
        for x in (-bw / 2 + 0.6, bw / 2 - 0.6):
            mb.box(x - 0.1, x + 0.1, y0 + 1.5, y0 + 1.7, top, top + 2.2, (0.3, 0.3, 0.32))
        mb.box(-bw / 2, bw / 2, y0 + 1.3, y0 + 1.6, top + 2.2, top + 2.2 + bh, (0.08, 0.08, 0.09))
        mb.face([(-bw / 2 + 0.15, y0 + 1.29, top + 2.35), (bw / 2 - 0.15, y0 + 1.29, top + 2.35),
                 (bw / 2 - 0.15, y0 + 1.29, top + 2.05 + bh), (-bw / 2 + 0.15, y0 + 1.29, top + 2.05 + bh)],
                (1, 1, 1), 'signs', ad_uv(rng.randrange(4)))
    # Vertical neon blade.
    if h > 12 and (kind == 'zakkyo' and rng.random() < 0.75 or kind == 'flats' and near and rng.random() < 0.35):
        blade(mb, rng.choice((x1 - 1.4, x0 + 1.4)), y0 - (1.0 if kind == 'flats' and near else 0), 5.4, min(h - 7, rng.uniform(6, 14)))


PITCH, STREET = 64.0, 12.0
BLOCK = PITCH - STREET
streets_x, streets_y = [], []
for bx in np.arange(-1024, 1000, PITCH):
    streets_x.append(bx - STREET / 2)
    for by in np.arange(QUAY_Y + 30, 1000, PITCH):
        if bx == -1024:
            streets_y.append(by - STREET / 2)
        cx, cy = bx + BLOCK / 2, by + BLOCK / 2
        r = math.hypot(cx, cy)
        if (cx > 360 and cy < 80) or nearest(cx, cy)[1] > REACH + 45:
            continue
        for row in (0, 1):
            x = bx
            while x < bx + BLOCK - 7:
                w = min(rng.uniform(9, 24), bx + BLOCK - x)
                if w < 7:
                    break
                d = rng.uniform(12, BLOCK / 2 - 1)
                lx = x + w / 2
                x += w + rng.choice((0.0, 0.0, 0.5, 1.4))
                set_back = rng.uniform(0, 1.2)
                ly = by + set_back + d / 2 if row == 0 else by + BLOCK - set_back - d / 2
                yaw = 0.0 if row == 0 else math.pi
                rr = math.hypot(w, d) / 2
                dist = nearest(lx, ly)[1]
                if dist - rr < RAIL + 3 or dist > REACH or not free(lx, ly, rr * 0.8):
                    continue
                inside = infield(lx, ly)
                if inside and rng.random() < 0.45:
                    continue
                near = dist < 260
                pick = rng.random()
                # Mix: neon multi-tenant blocks on narrow lots, glass offices, then apartments and low shops.
                if w <= 16 and pick < 0.45:
                    kind, h = 'zakkyo', rng.uniform(18, 30)
                elif r > 200 and pick < 0.75:
                    kind, h = 'office', 24 + rng.random() ** 2 * (50 + 140 * max(0.0, cy / 800))
                elif pick < 0.88:
                    kind, h = 'flats', rng.uniform(12, 40)
                else:
                    kind, h = 'low', rng.uniform(7, 11)
                cap = 200.0
                if math.cos(math.atan2(ly, lx) - FUJI_BEARING) > 0.9:     # keep the view to Fuji open
                    cap = 10 + r * 0.02
                if inside:
                    cap = min(cap, 18)
                h = min(h, cap)
                if h < 14 and kind in ('office', 'zakkyo'):
                    kind = 'low'
                mb = chunk(lx, ly)
                mb.xf = (math.cos(yaw), math.sin(yaw), lx, ly, 0.0)
                building(mb, kind, w, d, h, near)
                mb.xf = None
                BUILT += 1
                LOTS.append((lx, ly, w / 2 + 1.5, d / 2 + 1.5))

# Street lamps every ~40 m along the city streets, alternating sides, arms over the carriageway.
for sx in streets_x:
    for k, y in enumerate(np.arange(QUAY_Y + 20, 900, 40.0)):
        side = 1 if k % 2 else -1
        x = sx + side * (STREET / 2 - 0.6)
        if RAIL + 2 < nearest(x, y)[1] < LAMP_REACH and free(x, y, 0.5) and not (x > 360 and y < 80):
            place('K_StreetLamp', float(x), float(y), math.atan2(-side, 0))
            LAMPS += 1
for sy in streets_y:
    for k, x in enumerate(np.arange(-1000, 1000, 40.0)):
        side = 1 if k % 2 else -1
        y = sy + side * (STREET / 2 - 0.6)
        if y > QUAY_Y + 8 and RAIL + 2 < nearest(x, y)[1] < LAMP_REACH and free(x, y, 0.5) and not (x > 360 and y < 80):
            place('K_StreetLamp', float(x), float(y), math.atan2(0, side))
            LAMPS += 1

for (i, j), mb in city.items():
    mb.build(f'BG_City_{i}_{j}', C_CITY)

# Trees, bushes and lawns fill the open ground around the rally area: parks in the infield and between
# blocks, street trees on the pavements. Never on the road, its walls and banks, a building lot, a
# street carriageway or another prop.
lot_hash = {}
for lot in LOTS:
    for gx in range(int((lot[0] - lot[2]) // 64), int((lot[0] + lot[2]) // 64) + 1):
        for gy in range(int((lot[1] - lot[3]) // 64), int((lot[1] + lot[3]) // 64) + 1):
            lot_hash.setdefault((gx, gy), []).append(lot)


def in_lot(x, y):
    return any(abs(x - lx) < hw and abs(y - ly) < hd for lx, ly, hw, hd in lot_hash.get((int(x // 64), int(y // 64)), ()))


def street_offset(x, y):
    """Distance to the nearest street centreline of the city grid."""
    return min(min(abs(x - sx) for sx in streets_x), min(abs(y - sy) for sy in streets_y))


lawn = MB()
TREES = 0
KINDS = (('K_TreeRound', 0.42), ('K_TreeTall', 0.22), ('K_TreePine', 0.12), ('K_TreeSakura', 0.09), ('K_Bush', 0.15))
for x in np.arange(-640, 640, 11.0):
    for y in np.arange(QUAY_Y + 8, 640, 11.0):
        i, dist = nearest(x, y)
        if dist > REACH + 25 or dist < RAIL + 3.5 + 2.6 * HGT[i] or in_lot(x, y) or not free(x, y, 2.5):
            continue
        off = street_offset(x, y)
        if off < 4.6:                       # carriageway
            continue
        pavement = off < STREET / 2 + 0.5
        if not pavement:                    # open ground becomes lawn
            g = rng.uniform(0.85, 1.1)
            lawn.face([(x - 5.5, y - 5.5, 0.0), (x + 5.5, y - 5.5, 0.0), (x + 5.5, y + 5.5, 0.0), (x - 5.5, y + 5.5, 0.0)],
                      (0.075 * g, 0.12 * g, 0.04 * g))
        if TREES >= 760 or rng.random() > (0.4 if pavement else 0.5):
            continue
        pick, acc = rng.random(), 0.0
        for name, weight in KINDS:
            acc += weight
            if pick <= acc:
                break
        if pavement and name in ('K_Bush', 'K_TreePine'):
            name = 'K_TreeRound'
        jx, jy = (rng.uniform(-3, 3), rng.uniform(-3, 3)) if not pavement else (0.0, 0.0)
        shade = rng.uniform(0.82, 1.0)
        tint = (int(255 * shade * rng.uniform(0.92, 1.0)) << 16) | (int(255 * shade) << 8) | int(255 * shade * rng.uniform(0.85, 1.0))
        place(name, float(x + jx), float(y + jy), rng.uniform(0, 6.28), tint=tint)
        TREES += 1
lawn.build('BG_Lawn', C_BACK)

# Retaining walls carry the barriers over every hill on tarmac; the gravel hump sits on earth banks.
crest = MB()


for i in range(N):
    j = (i + 1) % N
    ha, hb = float(HGT[i]), float(HGT[j])
    if ha < 0.04 and hb < 0.04:
        continue
    for side in (-1, 1):
        def at(k, off):
            p = track[k] + right[k] * side * off
            return float(p[0]), float(p[1])
        out = (float(right[i][0] * side), float(right[i][1] * side), 0.0)
        (ax, ay), (bx, by) = at(i, HALF + 0.9), at(j, HALF + 0.9)
        (cx, cy), (dx, dy) = at(j, RAIL + 0.8), at(i, RAIL + 0.8)
        crest.face(oriented([(ax, ay, ha), (bx, by, hb), (cx, cy, hb), (dx, dy, ha)], (0, 0, 1)), (0.1, 0.1, 0.11))
        if on_gravel(i):
            (ex, ey), (fx, fy) = at(j, RAIL + 0.8 + 2.2 * hb + 0.3), at(i, RAIL + 0.8 + 2.2 * ha + 0.3)
            crest.face(oriented([(dx, dy, ha), (cx, cy, hb), (ex, ey, -0.1), (fx, fy, -0.1)], (out[0], out[1], 1)), (0.27, 0.22, 0.16))
            continue
        (ex, ey), (fx, fy) = at(j, RAIL + 1.1), at(i, RAIL + 1.1)
        crest.face(oriented([(dx, dy, ha), (cx, cy, hb), (cx, cy, hb + 0.35), (dx, dy, ha + 0.35)], (-out[0], -out[1], 0)), (0.5, 0.5, 0.49))
        crest.face(oriented([(dx, dy, ha + 0.35), (cx, cy, hb + 0.35), (ex, ey, hb + 0.35), (fx, fy, ha + 0.35)], (0, 0, 1)), (0.55, 0.55, 0.54))
        crest.face(oriented([(fx, fy, -0.1), (ex, ey, -0.1), (ex, ey, hb + 0.35), (fx, fy, ha + 0.35)], out), (0.42, 0.42, 0.41))
crest.build('BG_Crest', C_BACK)
dirt.build('BG_Dirt', C_BACK)
for poly in bpy.data.objects['BG_Dirt'].data.polygons:
    if poly.normal.z < 0:
        poly.flip()

# ------------------------------------------------------------------ backdrop: far skyline, Mount Fuji, tyre marks

# No far skyline: the city stops a block or two beyond the rally area; only Fuji and the tower stand further out.




def smooth_mesh(name, verts, faces, colors, location=(0, 0, 0)):
    """Shared-vertex mesh with per-vertex RGBA colour (the backdrop and decals are smooth and light)."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(M['backdrop' if name == 'BG_Fuji' else 'skid'])
    attr = mesh.color_attributes.new('Color', 'BYTE_COLOR', 'POINT')
    attr.data.foreach_set('color', np.asarray(colors, np.float32).ravel())
    mesh.color_attributes.active_color = attr
    mesh.shade_smooth()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    C_BACK.objects.link(obj)
    return obj


def value_noise(x, y, seed, period):
    """Smooth value noise in [0, 1]; wraps every `period` cells along x (the angle round the cone)."""
    xi, yi = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    xf, yf = x - xi, y - yi

    def hashed(ix, iy):
        n = ((ix % period).astype(np.uint64) * np.uint64(374761393) + iy.astype(np.uint64) * np.uint64(668265263)
             + np.uint64(seed * 974711)) & np.uint64(0xffffffff)
        n = ((n ^ (n >> np.uint64(13))) * np.uint64(1274126177)) & np.uint64(0xffffffff)
        return ((n ^ (n >> np.uint64(16))) & np.uint64(0xffff)).astype(np.float32) / 65535.0
    u, v = xf * xf * (3 - 2 * xf), yf * yf * (3 - 2 * yf)
    a, b, c, d = hashed(xi, yi), hashed(xi + 1, yi), hashed(xi, yi + 1), hashed(xi + 1, yi + 1)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v


def fbm(x, y, seed, octaves, period):
    total, amp, norm = 0.0, 1.0, 0.0
    for o in range(octaves):
        f = 2 ** o
        total = total + amp * value_noise(x * f, y * f, seed + o, period * f)
        norm += amp
        amp *= 0.5
    return total / norm


FUJI_R, FUJI_H = 2150.0, 960.0


def fuji_height(r, a):
    """Concave cone with a crater, ridged radial gullies, broad lumps and the Hoei shoulder (SE flank)."""
    t = np.clip(r / FUJI_R, 0, 1)
    ang = (a % (2 * np.pi)) / (2 * np.pi)
    h = FUJI_H * (1 - t) ** 2.15 * (1 + 0.35 * t)
    h -= 44 * np.clip(1 - r / 80, 0, 1) ** 2
    g = fbm(ang * 48, t * 5, 7, 4, 48) - 0.5
    ridge = 1 - np.abs(g) * 2                       # 1 on ridges, 0 in gully bottoms
    h += (ridge - 0.55) * 36 * np.sin(np.pi * np.minimum(1, t * 1.7)) * (1 - t) ** 0.6
    h += (fbm(ang * 6, t * 2.5, 3, 3, 6) - 0.5) * 70 * t * (1 - t)
    da = (a + 0.75 + np.pi) % (2 * np.pi) - np.pi
    h += 72 * np.exp(-((t - 0.36) / 0.07) ** 2 - (da / 0.2) ** 2)
    return h, ridge


def fuji():
    """Bake Mount Fuji in morning sun into fujimi/fuji.webp and carry it on a light radial mesh."""
    size = 2048
    cell = 2 * FUJI_R / size
    ys, xs = np.mgrid[0:size, 0:size].astype(np.float32)
    x, y = -FUJI_R + (xs + 0.5) * cell, -FUJI_R + (ys + 0.5) * cell      # row 0 = south (Blender pixels run bottom-up)
    r, a = np.hypot(x, y), np.arctan2(y, x)
    h, ridge = fuji_height(r, a)
    gy, gx = np.gradient(h, cell)
    n = np.stack([-gx, -gy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    az, el = math.radians(115), math.radians(38)        # the game's Fujimi sun (Atmosphere FUJIMI_OVERRIDES)
    sun = np.array([math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el)], np.float32)
    lit = 0.28 + 0.9 * np.clip(n @ sun, 0, None)
    ang = (a % (2 * np.pi)) / (2 * np.pi)
    line = FUJI_H * (0.57 + 0.08 * (fbm(ang * 3, np.zeros_like(ang), 11, 2, 3) - 0.5)) - (1 - ridge) * FUJI_H * 0.2
    breakup = fbm(x / 22, y / 22, 13, 3, 100000) - 0.5
    snow = np.clip((h - line + breakup * 60) / 40, 0, 1)
    steep = np.clip((1 - n[..., 2] - 0.45) * 4, 0, 1) * ridge          # rock shows on steep ridge crests
    snow *= 1 - 0.55 * steep * (h < FUJI_H * 0.85)
    grain = 1 + (fbm(x / 6, y / 6, 17, 2, 100000) - 0.5) * 0.25
    # Daylight: dark volcanic rock, a forest skirt, bright snow going blue in shade, all seen through the
    # blue haze of the bay air, which thickens toward the foot of the mountain.
    rock = np.array([0.07, 0.11, 0.24]) * (lit * grain)[..., None]
    shade = np.clip(lit, 0, 1)[..., None]
    white = np.array([0.66, 0.74, 0.9]) * (1 - shade) + np.array([1.0, 1.0, 1.0]) * shade
    white = white * (0.72 + 0.35 * lit)[..., None]
    forest = np.clip(1 - h / (FUJI_H * 0.28), 0, 1)[..., None]
    rock = rock * (1 - forest) + np.array([0.07, 0.11, 0.12]) * (lit * grain)[..., None] * forest
    col = rock * (1 - snow[..., None]) + white * snow[..., None]
    haze = (0.1 + 0.5 * np.clip(1 - h / (FUJI_H * 0.6), 0, 1) ** 1.4)[..., None] * (1 - 0.7 * snow[..., None])
    col = col * (1 - haze) + np.array([0.45, 0.58, 0.82]) * haze
    col = np.clip(col, 0, 1) ** (1 / 2.2)
    img = bpy.data.images.get('fuji') or bpy.data.images.new('fuji', size, size, alpha=False)
    img.pixels.foreach_set(np.concatenate([col, np.ones((size, size, 1))], -1).astype(np.float32).ravel())
    img.filepath_raw = OUT_DIR + 'fuji.webp'
    img.file_format = 'WEBP'
    img.save()
    tex = M['fuji'].node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = img
    M['fuji'].node_tree.links.new(tex.outputs['Color'], next(nd for nd in M['fuji'].node_tree.nodes if nd.type == 'BSDF_PRINCIPLED').inputs['Base Color'])

    rings, segs = 56, 168
    rr = FUJI_R * (np.arange(rings + 1) / rings) ** 1.3
    aa = 2 * np.pi * np.arange(segs) / segs
    R2, A2 = np.meshgrid(rr, aa, indexing='ij')
    H2, _ = fuji_height(R2, A2)
    X2, Y2 = R2 * np.cos(A2), R2 * np.sin(A2)
    verts = np.stack([X2, Y2, H2], -1).reshape(-1, 3).tolist()
    ix = lambda i, j: i * segs + j % segs
    faces = [(ix(i, j), ix(i + 1, j), ix(i + 1, j + 1), ix(i, j + 1)) for i in range(rings) for j in range(segs)]
    mesh = bpy.data.meshes.new('BG_Fuji')
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(M['fuji'])
    uv = mesh.uv_layers.new(name='UVMap')
    loops = [mesh.vertices[l.vertex_index].co for l in mesh.loops]
    uv.data.foreach_set('uv', [c for co in loops for c in (co.x / (2 * FUJI_R) + 0.5, co.y / (2 * FUJI_R) + 0.5)])
    mesh.update()
    obj = bpy.data.objects.new('BG_Fuji', mesh)
    obj.location = (FUJI[0], FUJI[1], -60)
    C_BACK.objects.link(obj)
    return obj


fuji()

# Tyre marks: pairs of arcs through each tight corner from outside entry to the inside apex.
sv, sf, sc = [], [], []
for c in corners:
    if c['r'] > 50:
        continue
    apex, inside = c['apex'], (-1 if c['left'] else 1)
    for line in range(5):
        lateral0 = -inside * rng.uniform(3.0, 5.2)
        lateral1 = inside * rng.uniform(3.2, 5.4)
        span = rng.randint(22, 34)
        dark = rng.uniform(0.55, 0.95)
        for wheel in (-0.8, 0.8):
            first = len(sv)
            for d in range(-span, span + 1, 2):
                j = (apex + d) % N
                t = (d + span) / (2 * span)
                lat = lateral0 + (lateral1 - lateral0) * math.sin(math.pi * min(t * 1.25, 1) / 2) + (lateral0 - lateral1) * max(0, t - 0.8) * 2.5
                p = track[j] + right[j] * (lat + wheel)
                fade = math.sin(math.pi * t) ** 0.6 * dark
                for e in (-0.13, 0.13):
                    q = p + right[j] * e
                    sv.append((float(q[0]), float(q[1]), float(HGT[j]) + 0.02))
                    sc.append((fade, fade, fade, fade))
            count = (len(sv) - first) // 2
            for k in range(count - 1):
                a0 = first + 2 * k
                sf.append((a0, a0 + 2, a0 + 3, a0 + 1) if inside < 0 else (a0, a0 + 1, a0 + 3, a0 + 2))
skids = smooth_mesh('BG_Skids', sv, sf, sc)
for poly in skids.data.polygons:     # decals face up whichever way the strip was wound
    if poly.normal.z < 0:
        poly.flip()

C_PROPS.hide_viewport = False
result = {
    'buildings': BUILT, 'lamps': LAMPS, 'trees': TREES, 'solids': SOLIDS, 'max_height': round(float(HGT.max()), 2), 'gravel_m': FJ_ROAD_META['gravel'], 'crest_m': FJ_ROAD_META['crest'],
    'length_m': round(float(np.sum(np.linalg.norm(np.diff(np.vstack([track, track[:1]]), axis=0), axis=1)))),
    'corners': len(corners), 'zones': len(zones), 'placements': len(C_PLACE.objects),
    'min_radius': round(float(radius.min()), 1),
}
print(result)
