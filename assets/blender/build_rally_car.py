"""Build the Slop-Drift rally car in Blender (front = +Y, up = +Z, ground = 0).

Run inside Blender through the MCP bridge so the result can be inspected, saved
and exported from the live session.
"""
import bpy
import bmesh
import math
from mathutils import Vector, Matrix

# ---------------------------------------------------------------- scene reset
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
for coll in list(bpy.data.collections):
    if coll.name.startswith("RallyCar"):
        bpy.data.collections.remove(coll)
for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.curves,
                   bpy.data.lights, bpy.data.cameras, bpy.data.images):
    for block in list(datablocks):
        if block.users == 0:
            datablocks.remove(block)

scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1.0

ROOT = bpy.data.collections.new("RallyCar")
scene.collection.children.link(ROOT)


def link(obj):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    ROOT.objects.link(obj)
    return obj


# ---------------------------------------------------------------- materials
def material(name, color, metallic=0.0, rough=0.5, coat=0.0, coat_rough=0.30,
             transmission=0.0, emission=None, strength=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = rough
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = coat_rough
    if transmission:
        bsdf.inputs["Transmission Weight"].default_value = transmission
        bsdf.inputs["IOR"].default_value = 1.45
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    return m


PAINT = material("Paint_Red", (0.340, 0.011, 0.019), metallic=0.25, rough=0.42, coat=0.38, coat_rough=0.36)
CARBON = material("Carbon", (0.012, 0.013, 0.015), metallic=0.0, rough=0.68, coat=0.08, coat_rough=0.4)
TRIM = material("Trim", (0.008, 0.010, 0.012), metallic=0.05, rough=0.68)
SATIN = material("Satin", (0.090, 0.100, 0.115), metallic=0.65, rough=0.42)
GLASS = material("Glass", (0.014, 0.028, 0.038), metallic=0.18, rough=0.06, alpha=0.58)
LENS = material("LampGlass", (0.020, 0.035, 0.050), metallic=0.25, rough=0.12)
WARM = material("LampOn", (1.0, 0.93, 0.78), rough=0.2, emission=(1.0, 0.88, 0.66), strength=2.6)
TAILRED = material("Tail", (0.30, 0.008, 0.010), rough=0.35, emission=(1.0, 0.03, 0.02), strength=2.2)
AMBER = material("Amber", (1.0, 0.45, 0.05), rough=0.3, emission=(1.0, 0.38, 0.02), strength=1.8)
LIME = material("Lime", (0.62, 0.95, 0.10), rough=0.42, emission=(0.35, 0.6, 0.02), strength=0.35)
WHITE = material("Board", (0.92, 0.93, 0.90), rough=0.5)
BLACKTEXT = material("Ink", (0.02, 0.02, 0.025), rough=0.6)
RUBBER = material("Tyre", (0.020, 0.021, 0.023), rough=0.88)
RIM = material("Rim", (0.62, 0.64, 0.67), metallic=1.0, rough=0.26)
DISC = material("BrakeDisc", (0.22, 0.22, 0.24), metallic=0.9, rough=0.45)
HARNESS = material("Harness", (0.55, 0.015, 0.02), rough=0.75)
FABRIC = material("Fabric", (0.045, 0.05, 0.058), rough=0.95)
CAGE = material("CageSteel", (0.55, 0.57, 0.60), metallic=1.0, rough=0.28)
GAUGE = material("Gauge", (0.06, 0.40, 0.55), rough=0.3, emission=(0.10, 0.50, 0.70), strength=1.1)


# ---------------------------------------------------------------- geometry helpers
def mesh_object(name, verts, faces, mat, shade_smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    obj.data.materials.append(mat)
    if shade_smooth:
        for poly in me.polygons:
            poly.use_smooth = True
    return obj


def body_ring(w, zb, zs, zt):
    """Cross-section of the main shell, 13 points from bottom centre round to top centre."""
    half = [
        (0.0, zb),
        (w * 0.62, zb),
        (w, zb + 0.09),
        (w, zs),
        (w * 0.965, zs + (zt - zs) * 0.42),
        (w * 0.72, zt - 0.01),
        (0.0, zt),
    ]
    pts = list(half)
    pts += [(-x, z) for x, z in reversed(half[1:-1])]
    return pts


def loft(name, stations, mat, points_fn, shade_smooth=False, closed=True):
    rings = []
    for st in stations:
        raw = points_fn(*st[1:])
        rings.append([(x, st[0], z) for x, z in raw])
    verts = [p for ring in rings for p in ring]
    n = len(rings[0])
    faces = []
    for i in range(len(rings) - 1):
        a = i * n
        b = (i + 1) * n
        for j in range(n if closed else n - 1):
            k = (j + 1) % n
            faces.append((a + j, a + k, b + k, b + j))
    faces.append(tuple(range(n - 1, -1, -1)))
    last = (len(rings) - 1) * n
    faces.append(tuple(last + j for j in range(n)))
    return mesh_object(name, verts, faces, mat, shade_smooth)


def box(name, size, loc, mat, rot=None, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (size[0], size[1], size[2])
    if rot:
        obj.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    link(obj)
    obj.data.materials.append(mat)
    if bevel > 0:
        mod = obj.modifiers.new("Bevel", 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = 'ANGLE'
    return obj


def cylinder(name, radius, depth, loc, mat, axis='Z', verts=32, bevel=0.0):
    rot = {'Z': (0, 0, 0), 'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth,
                                        location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    link(obj)
    obj.data.materials.append(mat)
    if bevel > 0:
        mod = obj.modifiers.new("Bevel", 'BEVEL')
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = 'ANGLE'
    return obj


def torus(name, major, minor, loc, mat, axis='X', maj_seg=28, min_seg=8):
    rot = {'Z': (0, 0, 0), 'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0)}[axis]
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                     major_segments=maj_seg, minor_segments=min_seg,
                                     location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    link(obj)
    obj.data.materials.append(mat)
    return obj


def arch_trim(name, loc, radius, width, thick, mat, a0=-14.0, a1=194.0, seg=30, ring=8):
    """Flare tube swept around a wheel arch at constant X, open at the body line."""
    cx, cy, cz = loc
    verts, faces = [], []
    for i in range(seg + 1):
        t = math.radians(a0 + (a1 - a0) * i / seg)
        ny, nz = math.cos(t), math.sin(t)
        py, pz = cy + radius * ny, cz + radius * nz
        for j in range(ring):
            phi = 2.0 * math.pi * j / ring
            ox = math.cos(phi) * width
            orad = math.sin(phi) * thick
            verts.append((cx + ox, py + ny * orad, pz + nz * orad))
    for i in range(seg):
        for j in range(ring):
            k = (j + 1) % ring
            a = i * ring + j
            b = i * ring + k
            c = (i + 1) * ring + k
            d = (i + 1) * ring + j
            faces.append((a, b, c, d))
    faces.append(tuple(range(ring - 1, -1, -1)))
    last = seg * ring
    faces.append(tuple(last + j for j in range(ring)))
    return mesh_object(name, verts, faces, mat, shade_smooth=True)


def arch_well(name, x, y, cz, radius, depth, mat, a0=-14.0, a1=194.0, seg=24):
    """Closed half-disc liner that fills a wheel arch without dipping below the body."""
    verts, faces = [], []
    arc = []
    for i in range(seg + 1):
        t = math.radians(a0 + (a1 - a0) * i / seg)
        arc.append((y + radius * math.cos(t), cz + radius * math.sin(t)))
    for xoff in (-depth / 2, depth / 2):
        verts.append((x + xoff, y, cz))
        for py, pz in arc:
            verts.append((x + xoff, py, pz))
    hub_a, hub_b = 0, seg + 2
    for i in range(seg):
        faces.append((hub_a, hub_a + 1 + i, hub_a + 2 + i))
        faces.append((hub_b, hub_b + 2 + i, hub_b + 1 + i))
        faces.append((hub_a + 1 + i, hub_b + 1 + i, hub_b + 2 + i, hub_a + 2 + i))
    faces.append((hub_a, hub_b, hub_b + 1, hub_a + 1))
    faces.append((hub_a, hub_a + seg + 1, hub_b + seg + 1, hub_b))
    return mesh_object(name, verts, faces, mat)


def bar(name, a, b, thickness, depth, mat, bevel=0.0):
    a, b = Vector(a), Vector(b)
    direction = b - a
    length = direction.length
    obj = box(name, (thickness, length, depth), ((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), mat, bevel=bevel)
    quat = direction.to_track_quat('Y', 'Z')
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = quat
    return obj


def tube(name, a, b, radius, mat, verts=12):
    a, b = Vector(a), Vector(b)
    direction = b - a
    obj = cylinder(name, radius, direction.length, ((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), mat, axis='Z', verts=verts)
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = direction.to_track_quat('Z', 'Y')
    return obj


def text_mesh(name, body, size, mat, matrix, extrude=0.004):
    curve = bpy.data.curves.new(name + "_curve", 'FONT')
    curve.body = body
    curve.size = size
    curve.align_x = 'CENTER'
    curve.align_y = 'CENTER'
    curve.extrude = extrude
    obj = bpy.data.objects.new(name, curve)
    ROOT.objects.link(obj)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    mesh_obj = link(bpy.data.objects.new(name, me))
    bpy.data.objects.remove(obj, do_unlink=True)
    mesh_obj.data.materials.append(mat)
    mesh_obj.matrix_world = matrix
    return mesh_obj


# ---------------------------------------------------------------- body shell
BODY_STATIONS = [
    (-2.16, 0.60, 0.36, 0.50, 0.66),
    (-2.09, 0.80, 0.26, 0.58, 0.80),
    (-1.95, 0.88, 0.18, 0.63, 0.87),
    (-1.70, 0.90, 0.14, 0.67, 0.91),
    (-1.20, 0.90, 0.12, 0.70, 0.94),
    (-0.60, 0.90, 0.12, 0.72, 0.95),
    (0.00, 0.90, 0.12, 0.72, 0.95),
    (0.60, 0.89, 0.12, 0.71, 0.93),
    (1.20, 0.87, 0.13, 0.68, 0.90),
    (1.70, 0.84, 0.14, 0.63, 0.85),
    (1.98, 0.78, 0.17, 0.56, 0.77),
    (2.13, 0.66, 0.22, 0.46, 0.64),
    (2.16, 0.52, 0.30, 0.40, 0.52),
]
body = loft("Body", BODY_STATIONS, PAINT, body_ring, shade_smooth=False)

# Wheel arches cut into the shell, then a painted lip around each opening.
CUTTERS = []
for axle_y in (1.275, -1.275):
    for side in (-1, 1):
        cutter = cylinder("ArchCutter", 0.445, 0.62, (side * 0.76, axle_y, 0.36), TRIM, axis='X', verts=32)
        CUTTERS.append(cutter)
bpy.ops.object.select_all(action='DESELECT')
for cutter in CUTTERS:
    # Bake the transform so the boolean sees clean world-space geometry.
    bpy.context.view_layer.objects.active = cutter
    cutter.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    cutter.select_set(False)
for cutter in CUTTERS:
    cutter.select_set(True)
bpy.context.view_layer.objects.active = CUTTERS[0]
bpy.ops.object.join()
cutter = bpy.context.object
cutter.name = "ArchCutter"
cutter.matrix_world.identity()
mod = body.modifiers.new("Arches", 'BOOLEAN')
mod.operation = 'DIFFERENCE'
mod.object = cutter
mod.solver = 'EXACT'
bpy.context.view_layer.objects.active = body
bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.data.objects.remove(cutter, do_unlink=True)

# Open the cabin so the cockpit is not buried under the body's top deck.
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, -0.465, 0.550))
cabin_cut = bpy.context.object
cabin_cut.name = "CabinCutter"
cabin_cut.scale = (1.620, 2.530, 1.160)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
link(cabin_cut)
cabin_cut.data.materials.append(FABRIC)
mod = body.modifiers.new("Cabin", 'BOOLEAN')
mod.operation = 'DIFFERENCE'
mod.object = cabin_cut
mod.solver = 'EXACT'
bpy.context.view_layer.objects.active = body
bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.data.objects.remove(cabin_cut, do_unlink=True)

for obj in list(ROOT.objects):
    if obj.name.startswith("ArchCutter"):
        bpy.data.objects.remove(obj, do_unlink=True)

bevel = body.modifiers.new("BodyBevel", 'BEVEL')
bevel.width = 0.014
bevel.segments = 2
bevel.limit_method = 'ANGLE'
bevel.angle_limit = math.radians(38)

# ---------------------------------------------------------------- glasshouse
GLASS_STATIONS = [
    (0.82, 0.775, 0.905, 0.95),
    (0.55, 0.785, 0.915, 1.10),
    (0.34, 0.782, 0.920, 1.32),
    (0.21, 0.778, 0.922, 1.412),
    (-0.20, 0.760, 0.930, 1.420),
    (-0.95, 0.745, 0.930, 1.425),
    (-1.22, 0.752, 0.928, 1.34),
    (-1.58, 0.775, 0.922, 0.98),
    (-1.70, 0.785, 0.862, 0.918),
]


def glass_ring(w, zb, zt):
    return [(-w, zb), (-w * 0.965, zt), (w * 0.965, zt), (w, zb)]


glass = loft("Glass", GLASS_STATIONS, GLASS, glass_ring, shade_smooth=True, closed=False)

# Roof panel over the glass, with a slight dome.
roof = box("Roof", (1.50, 1.34, 0.055), (0, -0.40, 1.428), PAINT, bevel=0.022)

# Pillars over the glass so the cabin reads with body-coloured frames.
PILLARS = [
    ((0.772, 0.80, 0.912), (0.748, 0.24, 1.405)),
    ((0.762, -0.56, 0.925), (0.744, -0.60, 1.418)),
    ((0.760, -1.44, 0.922), (0.744, -1.00, 1.420)),
]
for side in (-1, 1):
    for i, (a, b) in enumerate(PILLARS):
        bar(f"Pillar_{side}_{i}", (side * a[0], a[1], a[2]), (side * b[0], b[1], b[2]), 0.055, 0.085, PAINT)
# Windscreen and rear screen headers.
bar("HeaderFront", (-0.746, 0.235, 1.407), (0.746, 0.235, 1.407), 0.090, 0.050, PAINT)
bar("HeaderRear", (-0.744, -1.00, 1.418), (0.744, -1.00, 1.418), 0.090, 0.050, PAINT)
# Beltline trim under the side glass.
for side in (-1, 1):
    bar(f"Belt_{side}", (side * 0.79, 0.78, 0.905), (side * 0.775, -1.58, 0.905), 0.035, 0.05, TRIM)

# ---------------------------------------------------------------- wheels
def tyre_ring(name, loc, r=0.34, width=0.235, mat=RUBBER):
    """Open-centred tyre so the rim, spokes and brake disc actually read."""
    minor = width * 0.33
    major = r - minor
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                     major_segments=36, minor_segments=14,
                                     location=loc, rotation=(0, math.pi / 2, 0))
    obj = bpy.context.object
    obj.name = name
    link(obj)
    obj.data.materials.append(mat)
    obj.scale = (1.0, 1.0, (width / 2) / minor)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def ring_band(name, loc, outer, inner, depth, mat, verts=44):
    """Hollow cylinder about X: rim barrel with open ends."""
    v, f = [], []
    hx = depth / 2
    for i in range(verts):
        a = i * math.tau / verts
        c, sn = math.cos(a), math.sin(a)
        v += [(hx, c * outer, sn * outer), (-hx, c * outer, sn * outer),
              (hx, c * inner, sn * inner), (-hx, c * inner, sn * inner)]
    for i in range(verts):
        j = (i + 1) % verts
        a0, b0, c0, d0 = i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 3
        a1, b1, c1, d1 = j * 4, j * 4 + 1, j * 4 + 2, j * 4 + 3
        f += [(a0, a1, b1, b0), (c0, d0, d1, c1), (a0, c0, c1, a1), (b0, b1, d1, d0)]
    obj = mesh_object(name, v, f, mat, shade_smooth=False)
    obj.location = loc
    return obj


def wheel(name, x, y, r=0.34, width=0.235):
    s = math.copysign(1.0, x)
    face = x + s * (width / 2 - 0.020)
    tyre_ring(name + "_Tyre", (x, y, r), r, width)
    ring_band(name + "_Barrel", (x - s * 0.012, y, r), 0.190, 0.172, 0.190, RIM)
    cylinder(name + "_Disc", 0.155, 0.022, (x - s * 0.045, y, r), DISC, axis='X', verts=28)
    cylinder(name + "_Hub", 0.052, 0.030, (face, y, r), SATIN, axis='X', verts=18)
    torus(name + "_Lip", 0.184, 0.012, (face, y, r), RIM, axis='X', maj_seg=36, min_seg=8)
    for i in range(8):
        angle = i * math.tau / 8
        spoke = box(f"{name}_Spoke{i}", (0.026, 0.135, 0.030),
                    (face, y + math.cos(angle) * 0.118, r + math.sin(angle) * 0.118), RIM, bevel=0.005)
        spoke.rotation_euler = (angle, 0, 0)
    box(name + "_Caliper", (0.048, 0.09, 0.125), (x + s * 0.02, y - 0.115, r + 0.015), LIME, bevel=0.012)
    arch_well(name + "_Well", x - s * 0.20, y, r, 0.455, 0.02, TRIM)
    return name


for side in (-1, 1):
    wheel(f"WheelF{side}", side * 0.78, 1.275)
    wheel(f"WheelR{side}", side * 0.78, -1.275)
    for axle_y in (1.275, -1.275):
        arch_trim(f"ArchLip{side}_{axle_y}", (side * 0.915, axle_y, 0.36), 0.452, 0.045, 0.035, CARBON)

# ---------------------------------------------------------------- front end
box("Bumper_F", (1.68, 0.30, 0.30), (0, 2.02, 0.45), PAINT, bevel=0.05)
box("Splitter", (1.74, 0.16, 0.035), (0, 2.14, 0.235), CARBON, bevel=0.008)
box("Intake", (1.02, 0.06, 0.17), (0, 2.155, 0.40), CARBON)
for i in range(7):
    box(f"IntakeSlat{i}", (0.016, 0.02, 0.15), (-0.42 + i * 0.14, 2.185, 0.40), SATIN)
box("Grille", (0.66, 0.05, 0.17), (0, 2.14, 0.64), TRIM)
for i in range(6):
    box(f"GrilleSlat{i}", (0.014, 0.02, 0.15), (-0.25 + i * 0.10, 2.168, 0.64), SATIN)
box("Badge", (0.15, 0.030, 0.060), (0, 2.178, 0.645), LIME, bevel=0.008)

for side in (-1, 1):
    x = side * 0.585
    box(f"LampPod{side}", (0.50, 0.11, 0.20), (x, 2.085, 0.645), PAINT, bevel=0.03)
    for dx in (-0.105, 0.105):
        cylinder(f"Projector{side}{dx}", 0.058, 0.03, (x + dx, 2.155, 0.635), TRIM, axis='Y', verts=20)
        cylinder(f"ProjectorLens{side}{dx}", 0.046, 0.014, (x + dx, 2.172, 0.635), LENS, axis='Y', verts=20)
        torus(f"ProjectorRing{side}{dx}", 0.052, 0.007, (x + dx, 2.176, 0.635), SATIN, axis='Y', maj_seg=20, min_seg=6)
    box(f"DRL{side}", (0.42, 0.02, 0.018), (x, 2.168, 0.735), WARM)
    box(f"Indicator{side}", (0.055, 0.02, 0.035), (x + side * 0.20, 2.165, 0.555), AMBER)
    # Round rally lamp in the bumper.
    cylinder(f"RallyLampHousing{side}", 0.095, 0.07, (side * 0.60, 2.13, 0.415), CARBON, axis='Y', verts=24)
    cylinder(f"RallyLampLens{side}", 0.075, 0.02, (side * 0.60, 2.172, 0.415), WARM, axis='Y', verts=24)
    torus(f"RallyLampRing{side}", 0.083, 0.009, (side * 0.60, 2.178, 0.415), SATIN, axis='Y', maj_seg=24, min_seg=6)
    torus(f"TowHook{side}", 0.038, 0.010, (side * 0.44, 2.185, 0.31), HARNESS, axis='Y', maj_seg=18, min_seg=6)
    box(f"Canard{side}", (0.20, 0.10, 0.014), (side * 0.80, 2.06, 0.30), CARBON, rot=(0, side * 0.1, 0))

# ---------------------------------------------------------------- rear end
box("Bumper_R", (1.68, 0.26, 0.32), (0, -2.04, 0.44), PAINT, bevel=0.05)
box("Diffuser", (1.46, 0.30, 0.05), (0, -2.02, 0.235), CARBON)
for i in range(5):
    box(f"DiffuserFin{i}", (0.014, 0.26, 0.10), (-0.46 + i * 0.23, -2.02, 0.30), SATIN)
for side in (-1, 1):
    box(f"TailLight{side}", (0.46, 0.05, 0.13), (side * 0.555, -2.135, 0.675), TRIM, bevel=0.015)
    for i in range(3):
        box(f"TailBar{side}{i}", (0.05, 0.02, 0.10), (side * 0.555 + (i - 1) * 0.13, -2.168, 0.675), TAILRED)
    box(f"Reverse{side}", (0.11, 0.03, 0.05), (side * 0.30, -2.15, 0.50), WHITE)
    cylinder(f"Exhaust{side}", 0.058, 0.240, (side * 0.62, -2.160, 0.320), SATIN, axis='Y', verts=18)
    cylinder(f"ExhaustBore{side}", 0.044, 0.235, (side * 0.62, -2.155, 0.320), TRIM, axis='Y', verts=18)

# Rear wing: plane, endplates and swan-neck supports.
box("WingPlane", (1.52, 0.34, 0.045), (0, -1.66, 1.315), CARBON, rot=(-0.12, 0, 0), bevel=0.01)
box("WingGurney", (1.50, 0.02, 0.07), (0, -1.82, 1.335), CARBON)
for side in (-1, 1):
    box(f"WingEndplate{side}", (0.028, 0.40, 0.20), (side * 0.755, -1.66, 1.30), CARBON, bevel=0.008)
    for dy in (-0.09, 0.09):
        bar(f"WingStay{side}{dy}", (side * 0.50, -1.60 + dy, 0.925), (side * 0.52, -1.63 + dy, 1.30), 0.035, 0.05, CARBON)

# Mirrors, handles and side vents.
for side in (-1, 1):
    tube(f"MirrorStalk{side}", (side * 0.885, 0.63, 0.935), (side * 0.965, 0.60, 0.975), 0.017, SATIN)
    box(f"Mirror{side}", (0.075, 0.165, 0.085), (side * 0.995, 0.595, 0.975), PAINT, bevel=0.030)
    box(f"MirrorGlass{side}", (0.010, 0.115, 0.055), (side * 1.032, 0.595, 0.975), SATIN, bevel=0.006)
    box(f"Handle{side}", (0.030, 0.17, 0.035), (side * 0.912, -0.15, 0.80), SATIN, bevel=0.008)
    for i in range(3):
        box(f"Vent{side}{i}", (0.022, 0.045, 0.075), (side * 0.905, -0.72 - i * 0.075, 0.80), TRIM)

# ---------------------------------------------------------------- rally extras
for side in (-1, 1):
    box(f"SideSkirt{side}", (0.060, 1.62, 0.090), (side * 0.905, -0.12, 0.300), CARBON, bevel=0.012)
    box(f"MudFlapF{side}", (0.235, 0.014, 0.280), (side * 0.865, 0.800, 0.165), CARBON, bevel=0.006)
    box(f"MudFlapR{side}", (0.235, 0.014, 0.280), (side * 0.865, -1.750, 0.165), CARBON, bevel=0.006)
    box(f"BonnetVentPanel{side}", (0.230, 0.270, 0.008), (side * 0.44, 1.130, 0.914), TRIM, rot=(-0.05, 0, 0))
    for i in range(3):
        box(f"BonnetVentSlat{side}{i}", (0.195, 0.034, 0.012),
            (side * 0.44, 1.050 + i * 0.080, 0.920), SATIN, rot=(-0.05, 0, 0))

cylinder("FuelCap", 0.055, 0.020, (0.903, -1.34, 0.815), SATIN, axis='X', verts=20)
torus("FuelRing", 0.056, 0.008, (0.914, -1.34, 0.815), TRIM, axis='X', maj_seg=20, min_seg=6)
box("TowMountR", (0.17, 0.030, 0.060), (0, -2.195, 0.340), CARBON, bevel=0.008)
torus("TowStrapR", 0.048, 0.013, (0, -2.215, 0.340), HARNESS, axis='Y', maj_seg=22, min_seg=7)

# Hatch number board, laid on the rear deck.
HATCH_TILT = 0.464
hatch_plate = box("HatchPlate", (0.520, 0.220, 0.010), (0, -1.868, 0.842), WHITE,
                  rot=(HATCH_TILT, 0, 0), bevel=0.006)
hatch_mat = Matrix(((1, 0, 0),
                    (0, math.cos(HATCH_TILT), -math.sin(HATCH_TILT)),
                    (0, math.sin(HATCH_TILT), math.cos(HATCH_TILT)))).to_4x4()
hatch_mat.translation = Vector((0, -1.868, 0.842)) + Vector((0, -math.sin(HATCH_TILT), math.cos(HATCH_TILT))) * 0.008
text_mesh("HatchNo", "27", 0.150, BLACKTEXT, hatch_mat)

# ---------------------------------------------------------------- cockpit
FLOOR_Z = 0.42
box("Floor", (1.60, 2.50, 0.05), (0, -0.45, FLOOR_Z), FABRIC)
box("Dash", (1.44, 0.34, 0.22), (0, 0.55, 0.79), FABRIC, rot=(-0.12, 0, 0), bevel=0.02)
box("DashTop", (1.38, 0.26, 0.045), (0, 0.58, 0.905), FABRIC, bevel=0.01)
box("DashFace", (1.30, 0.040, 0.200), (0, 0.375, 0.790), TRIM, rot=(-0.12, 0, 0), bevel=0.010)
for dx in (-0.42, -0.30):
    cylinder(f"Gauge{dx}", 0.055, 0.020, (dx, 0.345, 0.858), GAUGE, axis='Y', verts=20)
    torus(f"GaugeRim{dx}", 0.058, 0.006, (dx, 0.338, 0.858), SATIN, axis='Y', maj_seg=20, min_seg=6)
box("DashScreen", (0.240, 0.020, 0.130), (0.06, 0.345, 0.862), GAUGE, bevel=0.008)
box("ShiftLight", (0.220, 0.020, 0.026), (-0.36, 0.455, 0.933), LIME)
for i, dx in enumerate((0.19, 0.25, 0.31)):
    box(f"DashSwitch{i}", (0.030, 0.014, 0.040), (dx, 0.348, 0.780), SATIN)
tube("SteeringColumn", (-0.36, 0.560, 0.820), (-0.36, 0.290, 0.868), 0.022, TRIM)
steer = torus("SteeringWheel", 0.165, 0.020, (-0.36, 0.270, 0.885), TRIM, axis='Y', maj_seg=28, min_seg=8)
steer.rotation_euler = (math.radians(68), 0, 0)
box("SteeringHub", (0.090, 0.050, 0.090), (-0.36, 0.270, 0.885), CARBON, rot=(math.radians(22), 0, 0))

# Headliner, visors and cabin mirror.
box("Headliner", (1.56, 1.26, 0.030), (0, -0.38, 1.395), FABRIC)
for side in (-1, 1):
    box(f"Visor{side}", (0.40, 0.16, 0.035), (side * 0.40, 0.225, 1.352), FABRIC, rot=(-0.12, 0, 0), bevel=0.012)
    box(f"PillarTrim{side}", (0.050, 0.30, 0.120), (side * 0.755, 0.05, 1.360), FABRIC)
tube("MirrorStem", (0, 0.240, 1.400), (0, 0.215, 1.330), 0.012, TRIM)
box("RearMirror", (0.240, 0.040, 0.078), (0, 0.212, 1.312), TRIM, bevel=0.020)
box("DomeLight", (0.160, 0.100, 0.020), (0, -0.360, 1.376), WARM)

# Centre console, shifter, handbrake and pedals.
box("Console", (0.240, 0.620, 0.160), (0, 0.00, 0.500), FABRIC, bevel=0.020)
tube("Shifter", (0, 0.020, 0.575), (0, -0.020, 0.700), 0.012, SATIN)
cylinder("ShiftKnob", 0.032, 0.050, (0, -0.020, 0.720), TRIM, axis='Z', verts=14)
tube("Handbrake", (0.150, 0.100, 0.575), (0.150, 0.000, 0.650), 0.014, SATIN)
tube("HandbrakeGrip", (0.150, 0.000, 0.650), (0.150, -0.100, 0.660), 0.020, TRIM)
for i, dx in enumerate((-0.44, -0.36, -0.28)):
    box(f"Pedal{i}", (0.055, 0.012, 0.075), (dx, 0.620, 0.470), SATIN, rot=(0.35, 0, 0), bevel=0.004)

for side in (-1, 1):
    x = side * 0.36
    box(f"SeatBase{side}", (0.44, 0.46, 0.10), (x, -0.42, 0.55), FABRIC, bevel=0.03)
    box(f"SeatBack{side}", (0.42, 0.13, 0.62), (x, -0.66, 0.86), FABRIC, rot=(0.18, 0, 0), bevel=0.03)
    box(f"SeatHead{side}", (0.28, 0.11, 0.16), (x, -0.76, 1.20), FABRIC, rot=(0.14, 0, 0), bevel=0.03)
    for dx in (-0.12, 0.12):
        bar(f"Harness{side}{dx}", (x + dx, -0.60, 1.16), (x + dx * 0.7, -0.34, 0.60), 0.045, 0.012, HARNESS)
    box(f"DoorCard{side}", (0.030, 1.30, 0.34), (side * 0.800, -0.20, 0.60), FABRIC)
    box(f"Armrest{side}", (0.055, 0.60, 0.050), (side * 0.785, -0.22, 0.700), FABRIC, bevel=0.015)
    box(f"DoorHandleIn{side}", (0.020, 0.120, 0.030), (side * 0.775, 0.05, 0.780), SATIN, bevel=0.006)

# Roll cage through the cabin.
CAGE_TUBES = [
    ((-0.70, 0.70, 0.93), (-0.62, 0.13, 1.40)),
    ((0.70, 0.70, 0.93), (0.62, 0.13, 1.40)),
    ((0.62, 0.13, 1.40), (-0.62, 0.13, 1.40)),
    ((-0.66, -0.92, 0.94), (-0.64, -0.92, 1.42)),
    ((0.66, -0.92, 0.94), (0.64, -0.92, 1.42)),
    ((-0.66, -0.92, 1.42), (0.66, -0.92, 1.42)),
    ((-0.62, 0.13, 1.40), (-0.64, -0.92, 1.41)),
    ((0.62, 0.13, 1.40), (0.64, -0.92, 1.41)),
    ((-0.70, 0.70, 0.95), (-0.66, -0.92, 0.95)),
    ((0.70, 0.70, 0.95), (0.66, -0.92, 0.95)),
]
for i, (a, b) in enumerate(CAGE_TUBES):
    tube(f"Cage{i}", a, b, 0.026, CAGE, verts=10)

# Fire extinguisher and a spare wheel well cover.
cylinder("Extinguisher", 0.055, 0.26, (0.42, -0.10, 0.62), HARNESS, axis='Y', verts=14)
box("Tunnel", (0.18, 1.10, 0.10), (0, -0.20, 0.48), FABRIC)

# ---------------------------------------------------------------- livery
# Door number boards.
for side in (-1, 1):
    plate = box(f"DoorPlate{side}", (0.010, 0.66, 0.40), (side * 0.918, -0.16, 0.70), WHITE, bevel=0.006)
    # Columns are the text's right, up and normal axes: readable from each side of the car.
    side_matrix = Matrix(((0, 0, side), (side, 0, 0), (0, 1, 0))).to_4x4()
    mat = side_matrix.copy()
    mat.translation = Vector((side * 0.9250, -0.16, 0.695))
    text_mesh(f"DoorNo{side}", "27", 0.30, BLACKTEXT, mat)
    mat2 = side_matrix.copy()
    mat2.translation = Vector((side * 0.9250, -0.16, 0.875))
    text_mesh(f"DoorName{side}", "SLOP DRIFT RALLY", 0.036, BLACKTEXT, mat2)

# Roof number board, laid flat.
roof_board = box("RoofPlate", (0.56, 0.34, 0.012), (0, -0.35, 1.462), LIME, bevel=0.004)
roof_mat = Matrix(((1, 0, 0), (0, 1, 0), (0, 0, 1))).to_4x4()
roof_mat.translation = Vector((0, -0.35, 1.4735))
text_mesh("RoofNo", "27", 0.22, BLACKTEXT, roof_mat)

# Bonnet and hatch stripes, split to follow the panel slopes.
for side in (-1, 1):
    x = side * 0.19
    box(f"BonnetStripeA{side}", (0.145, 0.95, 0.008), (x, 1.52, 0.878), WHITE, rot=(-0.10, 0, 0))
    box(f"BonnetStripeB{side}", (0.145, 0.55, 0.008), (x, 1.02, 0.916), WHITE, rot=(-0.05, 0, 0))
    box(f"RoofStripe{side}", (0.145, 0.36, 0.008), (x, 0.03, 1.461), WHITE)
    box(f"RoofStripeB{side}", (0.145, 0.34, 0.008), (x, -0.80, 1.461), WHITE)
    box(f"HatchStripe{side}", (0.145, 0.34, 0.008), (x, -1.87, 0.838), WHITE, rot=(0.464, 0, 0))

# Bonnet pins, wipers and roof vent.
for side in (-1, 1):
    cylinder(f"BonnetPin{side}", 0.014, 0.02, (side * 0.62, 1.86, 0.80), SATIN, axis='Z', verts=10)
bar("Wiper", (-0.34, 0.86, 0.955), (0.06, 0.74, 1.02), 0.010, 0.016, TRIM)
box("RoofScoop", (0.32, 0.30, 0.075), (0, 0.52, 1.492), CARBON, bevel=0.02)
box("RoofScoopMouth", (0.24, 0.024, 0.050), (0, 0.665, 1.478), TRIM)
box("RoofScoopLip", (0.30, 0.030, 0.012), (0, 0.675, 1.512), CARBON)
for i in range(3):
    box(f"RoofScoopFin{i}", (0.010, 0.26, 0.040), ((i - 1) * 0.075, 0.52, 1.500), CARBON)
cylinder("Antenna", 0.008, 0.34, (0.44, -1.30, 1.60), TRIM, axis='Z', verts=8)

# ---------------------------------------------------------------- tidy
for obj in ROOT.objects:
    obj.select_set(False)

print("BUILD_OK", len(ROOT.objects), "objects")
