"""
Watertight Tokyo Drift Rally 4-Door Sedan generator & GLB exporter.
Runs inside Blender (via Blender MCP socket on port 9876 or `--background --python`).

Every solid component is verified watertight with strictly positive signed volume (outward normals)
BEFORE combining, and every single-sided glass/livery sheet is explicitly oriented outward —
guaranteeing zero backface-culling holes in Three.js (`THREE.FrontSide`).
"""
import json
import math
import os
import struct
import bpy
import bmesh
from mathutils import Vector, Matrix

REPO = '/Users/harshitbisht/Desktop/Slop-drift/Slop-Drift/'
MAPS_DIR = os.path.join(REPO, 'tools/blender/cars/tokyo_maps')
GLB_OUT = os.path.join(REPO, 'src/assets/cars/tokyo.glb')
BLEND_OUT = os.path.join(REPO, 'tools/blender/cars/tokyo_sedan.blend')

AXLE_FRONT_Y = 1.35
AXLE_REAR_Y = -1.35
HALF_TRACK = 0.855
WHEEL_RADIUS = 0.340
TYRE_WIDTH = 0.258


class MeshBuilder:
    """Bmesh collector that enforces outward orientation per solid component before merging."""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.slots = []
        self.uvs = []
        self.smooth = []

    def add_oriented_face(self, pts, mat, expected_dir=None, uv_coords=None, smooth=True):
        pts_v = [Vector(p) for p in pts]
        if len(pts_v) >= 3 and expected_dir is not None:
            n = (pts_v[1] - pts_v[0]).cross(pts_v[2] - pts_v[0])
            if n.dot(Vector(expected_dir)) < 0.0:
                pts = list(reversed(pts))
                if uv_coords is not None:
                    uv_coords = list(reversed(uv_coords))
        self._raw_face(pts, mat, uv_coords, smooth)

    def _raw_face(self, pts, mat, uv_coords=None, smooth=True):
        idx = len(self.verts)
        self.verts.extend(pts)
        self.faces.append(tuple(range(idx, idx + len(pts))))
        self.slots.append(mat)
        self.smooth.append(smooth)
        if uv_coords is None:
            pts_v = [Vector(p) for p in pts]
            if len(pts_v) >= 3:
                n = (pts_v[1] - pts_v[0]).cross(pts_v[2] - pts_v[0])
                ax = max(range(3), key=lambda k: abs(n[k]))
                u_i, v_i = [i for i in range(3) if i != ax]
                uv_coords = [(p[u_i] * 0.65, p[v_i] * 0.65) for p in pts]
            else:
                uv_coords = [(0.0, 0.0) for _ in pts]
        self.uvs.append(uv_coords)

    def append_solid(self, build_fn):
        """Build one closed solid component in an isolated bmesh, verify positive signed volume, and merge."""
        sub = MeshBuilder()
        build_fn(sub)
        if not sub.faces:
            return
        me_tmp = self._make_temp_mesh(sub)
        bm2 = bmesh.new()
        bm2.from_mesh(me_tmp)
        uv_lay = bm2.loops.layers.uv.active
        bmesh.ops.remove_doubles(bm2, verts=bm2.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm2, faces=bm2.faces)
        if bm2.calc_volume(signed=True) < 0.0:
            bmesh.ops.reverse_faces(bm2, faces=bm2.faces)

        used = list(dict.fromkeys(sub.slots))
        bm2.faces.ensure_lookup_table()
        for f in bm2.faces:
            pts = [tuple(v.co) for v in f.verts]
            uvs = [tuple(l[uv_lay].uv) for l in f.loops] if uv_lay else None
            mat_name = used[f.material_index]
            self._raw_face(pts, mat_name, uv_coords=uvs, smooth=f.smooth)

        bm2.free()
        bpy.data.meshes.remove(me_tmp)

    def _make_temp_mesh(self, sub):
        me = bpy.data.meshes.new('_tmp_solid')
        me.from_pydata(sub.verts, [], sub.faces)
        used = list(dict.fromkeys(sub.slots))
        slot_map = {k: i for i, k in enumerate(used)}
        for k in used:
            me.materials.append(None)
        me.polygons.foreach_set('material_index', [slot_map[s] for s in sub.slots])
        me.polygons.foreach_set('use_smooth', sub.smooth)
        uv_layer = me.uv_layers.new(name='UVMap')
        for poly, poly_uv in zip(me.polygons, sub.uvs):
            for loop_idx, uv in zip(poly.loop_indices, poly_uv):
                uv_layer.data[loop_idx].uv = uv
        me.update()
        return me

    # ---- Primitives cleanly built inside isolated outward solids ----

    def loft_solid(self, rings, mat_fn, cap_start_mat=None, cap_end_mat=None, smooth=True):
        """Loft a watertight closed solid across ordered rings."""
        def _build(sub):
            n = len(rings[0])
            m = len(rings)
            if cap_start_mat:
                sub._raw_face(list(reversed(rings[0])), cap_start_mat, smooth=False)
            for j in range(m - 1):
                a, b = rings[j], rings[j + 1]
                for i in range(n):
                    ni = (i + 1) % n
                    mat = mat_fn(j, i) if callable(mat_fn) else mat_fn
                    sub._raw_face([a[i], a[ni], b[ni], b[i]], mat, smooth=smooth)
            if cap_end_mat:
                sub._raw_face(rings[-1], cap_end_mat, smooth=False)
        self.append_solid(_build)

    def closed_torus_strip(self, loop_rings, mat, smooth=True):
        """Watertight closed torus (each ring is a closed cross-section, swept circularly around wheel)."""
        def _build(sub):
            m = len(loop_rings)
            n = len(loop_rings[0])
            for j in range(m):
                nj = (j + 1) % m
                a, b = loop_rings[j], loop_rings[nj]
                for i in range(n):
                    ni = (i + 1) % n
                    sub._raw_face([a[i], a[ni], b[ni], b[i]], mat, smooth=smooth)
        self.append_solid(_build)

    def box(self, cx, cy, cz, sx, sy, sz, mat, bevel=0.012, rot_x=0.0, rot_y=0.0, rot_z=0.0, smooth=True):
        def _build(sub):
            hx, hy, hz = sx * 0.5, sy * 0.5, sz * 0.5
            r = min(bevel, hx * 0.55, hy * 0.55)
            lip = min(r * 0.48, hz * 0.22)
            rot = Matrix.Rotation(rot_z, 3, 'Z') @ Matrix.Rotation(rot_y, 3, 'Y') @ Matrix.Rotation(rot_x, 3, 'X')
            center = Vector((cx, cy, cz))
            rings = []
            for dz, off in [(-hz, lip), (-hz + lip, 0.0), (hz - lip, 0.0), (hz, lip)]:
                u, v = hx - off, hy - off
                pts = [
                    (-u + r, -v), (u - r, -v), (u, -v + r), (u, v - r),
                    (u - r, v), (-u + r, v), (-u, v - r), (-u, -v + r),
                ]
                rings.append([tuple(center + (rot @ Vector((px, py, dz)))) for px, py in pts])
            sub._raw_face(list(reversed(rings[0])), mat, smooth=False)
            n = len(rings[0])
            for a, b in zip(rings, rings[1:]):
                for i in range(n):
                    ni = (i + 1) % n
                    sub._raw_face([a[i], a[ni], b[ni], b[i]], mat, smooth=smooth)
            sub._raw_face(rings[-1], mat, smooth=False)
        self.append_solid(_build)

    def lathe(self, a, b, profile, mat, segs=24, smooth=True, uv_cyl=False):
        def _build(sub):
            origin = Vector(a)
            axis = Vector(b) - origin
            if axis.length < 1e-6:
                return
            ax_n = axis.normalized()
            u_dir = ax_n.orthogonal().normalized()
            v_dir = ax_n.cross(u_dir).normalized()
            dirs = [u_dir * math.cos(i * math.tau / segs) + v_dir * math.sin(i * math.tau / segs) for i in range(segs)]
            rings = [[tuple(origin + axis * t + rad * q) for q in dirs] for t, rad in profile]
            if profile[0][1] > 1e-5:
                sub._raw_face(list(reversed(rings[0])), mat, smooth=False)
            for k in range(len(rings) - 1):
                t0, _ = profile[k]
                t1, _ = profile[k + 1]
                ra, rb = rings[k], rings[k + 1]
                for i in range(segs):
                    ni = (i + 1) % segs
                    uvs = [(i / segs, t0), ((i + 1) / segs, t0), ((i + 1) / segs, t1), (i / segs, t1)] if uv_cyl else None
                    sub._raw_face([ra[i], ra[ni], rb[ni], rb[i]], mat, uv_coords=uvs, smooth=smooth)
            if profile[-1][1] > 1e-5:
                sub._raw_face(rings[-1], mat, smooth=False)
        self.append_solid(_build)

    def bar(self, a, b, radius, mat, segs=12, smooth=True):
        self.lathe(a, b, [(0.0, radius), (1.0, radius)], mat, segs=segs, smooth=smooth)

    def hollow_pipe(self, a, b, outer_r, inner_r, mat_outer, mat_inner, segs=28):
        """Watertight thick-walled burnt-titanium cannon shell with closed annular back & deep bore."""
        def _build(sub):
            origin = Vector(a)
            end_v = Vector(b)
            axis = end_v - origin
            if axis.length < 1e-6:
                return
            ax_n = axis.normalized()
            u_dir = ax_n.orthogonal().normalized()
            v_dir = ax_n.cross(u_dir).normalized()
            dirs = [u_dir * math.cos(i * math.tau / segs) + v_dir * math.sin(i * math.tau / segs) for i in range(segs)]
            r_mid = (outer_r + inner_r) * 0.5
            r_back_in = inner_r * 0.85

            outer_back = [tuple(origin + outer_r * q) for q in dirs]
            outer_front = [tuple(end_v + (outer_r * 0.97) * q) for q in dirs]
            lip_front = [tuple(end_v + ax_n * 0.009 + r_mid * q) for q in dirs]
            inner_front = [tuple(end_v + inner_r * q) for q in dirs]
            inner_back = [tuple(origin + ax_n * 0.03 + r_back_in * q) for q in dirs]

            # Build closed loop connecting outer skin -> lip -> inner bore -> closed rear baffle
            strips = [
                (outer_back, outer_front, 0.0, 0.92, mat_outer),
                (outer_front, lip_front, 0.92, 1.0, mat_outer),
                (lip_front, inner_front, 1.0, 0.96, mat_outer),
                (inner_front, inner_back, 0.0, 1.0, mat_inner),
            ]
            for ra, rb, v0, v1, mat in strips:
                for i in range(segs):
                    ni = (i + 1) % segs
                    uvs = [(i / segs, v0), ((i + 1) / segs, v0), ((i + 1) / segs, v1), (i / segs, v1)]
                    sub._raw_face([ra[i], ra[ni], rb[ni], rb[i]], mat, uv_coords=uvs, smooth=True)
            # Connect back outer flange edge cleanly to back baffle disk
            sub._raw_face(list(reversed(outer_back)), mat_outer, smooth=False)
            sub._raw_face(inner_back, mat_inner, smooth=False)
        self.append_solid(_build)

    def tube_path(self, points, radius, mat, segs=12):
        def _build(sub):
            pts = [Vector(p) for p in points]
            rings = []
            up_ref = Vector((0.0, 0.0, 1.0))
            prev_u = None
            for idx, pt in enumerate(pts):
                if idx == 0:
                    tangent = (pts[1] - pts[0]).normalized()
                elif idx == len(pts) - 1:
                    tangent = (pts[-1] - pts[-2]).normalized()
                else:
                    tangent = ((pts[idx] - pts[idx - 1]).normalized() + (pts[idx + 1] - pts[idx]).normalized()).normalized()
                if prev_u is None:
                    ref = up_ref if abs(tangent.z) < 0.92 else Vector((1.0, 0.0, 0.0))
                    u = tangent.cross(ref).normalized()
                else:
                    u = (prev_u - tangent * prev_u.dot(tangent)).normalized()
                v = tangent.cross(u).normalized()
                prev_u = u
                rings.append([tuple(pt + (u * math.cos(k * math.tau / segs) + v * math.sin(k * math.tau / segs)) * radius) for k in range(segs)])
            sub._raw_face(list(reversed(rings[0])), mat, smooth=False)
            for a, b in zip(rings, rings[1:]):
                for i in range(segs):
                    ni = (i + 1) % segs
                    sub._raw_face([a[i], a[ni], b[ni], b[i]], mat, smooth=True)
            sub._raw_face(rings[-1], mat, smooth=False)
        self.append_solid(_build)

    def to_object(self, name, mats, collection, sharp_angle_deg=44):
        """Export combined guaranteed-outward mesh without global recalc_face_normals overriding orientation."""
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts, [], self.faces)
        used = list(dict.fromkeys(self.slots))
        for k in used:
            me.materials.append(mats[k])
        slot_map = {k: i for i, k in enumerate(used)}
        me.polygons.foreach_set('material_index', [slot_map[s] for s in self.slots])
        me.polygons.foreach_set('use_smooth', self.smooth)
        uv_layer = me.uv_layers.new(name='UVMap')
        for poly, poly_uv in zip(me.polygons, self.uvs):
            for loop_idx, uv in zip(poly.loop_indices, poly_uv):
                uv_layer.data[loop_idx].uv = uv
        me.update()

        # Weld ONLY identical vertices inside same curvature regions while splitting crisp creases,
        # NEVER calling recalc_face_normals across disconnected/open parts!
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        thresh = math.radians(sharp_angle_deg)
        sharp_edges = [
            e for e in bm.edges
            if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > thresh
        ]
        if sharp_edges:
            bmesh.ops.split_edges(bm, edges=sharp_edges)
        bm.normal_update()
        bm.to_mesh(me)
        bm.free()

        obj = bpy.data.objects.new(name, me)
        collection.objects.link(obj)
        return obj


def load_img(filename, colorspace='sRGB'):
    path = os.path.join(MAPS_DIR, filename)
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = colorspace
    return img


def make_materials():
    mats = {}

    def pbr(name, color, metal=0.0, rough=0.5, clearcoat=0.0, tex=None, emit=None, emit_strength=0.0, alpha=1.0):
        mat = bpy.data.materials.new(name)
        mat.diffuse_color = (*color, alpha)
        mat.use_nodes = True
        # Match Three.js THREE.FrontSide culling right inside Blender viewport & EEVEE!
        mat.use_backface_culling = True
        nt = mat.node_tree
        bsdf = nt.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*color, 1.0)
        bsdf.inputs['Metallic'].default_value = metal
        bsdf.inputs['Roughness'].default_value = rough
        if 'Coat Weight' in bsdf.inputs:
            bsdf.inputs['Coat Weight'].default_value = clearcoat
        if tex:
            node = nt.nodes.new('ShaderNodeTexImage')
            node.image = load_img(tex)
            nt.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
        if emit and 'Emission Color' in bsdf.inputs:
            bsdf.inputs['Emission Color'].default_value = (*emit, 1.0)
            bsdf.inputs['Emission Strength'].default_value = emit_strength
        if alpha < 1.0:
            bsdf.inputs['Alpha'].default_value = alpha
            if hasattr(mat, 'blend_method'):
                mat.blend_method = 'BLEND'
        mats[name] = mat
        return mat

    pbr('Tokyo_Paint', (0.76, 0.24, 0.04), metal=0.38, rough=0.18, clearcoat=0.92)
    pbr('Tokyo_Livery', (1.0, 1.0, 1.0), metal=0.22, rough=0.28, clearcoat=0.65, tex='tokyo-livery.jpg')
    pbr('Tokyo_Carbon', (0.11, 0.12, 0.13), metal=0.18, rough=0.34, clearcoat=0.45, tex='carbon-twill.png')
    pbr('Tokyo_DarkTrim', (0.045, 0.048, 0.052), metal=0.08, rough=0.72)
    pbr('Tokyo_Metal', (0.76, 0.79, 0.82), metal=0.88, rough=0.22)
    pbr('Tokyo_Exhaust_Tip', (1.0, 1.0, 1.0), metal=0.92, rough=0.16, tex='burnt-titanium.png')
    pbr('Tokyo_Exhaust_Bore', (0.018, 0.014, 0.016), metal=0.05, rough=0.95)
    pbr('Tokyo_AccentRed', (0.78, 0.045, 0.025), metal=0.15, rough=0.36, clearcoat=0.4)
    pbr('Tokyo_Plate', (0.93, 0.92, 0.88), metal=0.04, rough=0.42)
    pbr('Tokyo_Rim', (0.64, 0.45, 0.18), metal=0.84, rough=0.24, clearcoat=0.35)
    pbr('Tokyo_Disc', (0.38, 0.40, 0.43), metal=0.88, rough=0.32)
    pbr('Tokyo_Tyre', (0.035, 0.038, 0.040), metal=0.0, rough=0.86)
    pbr('Tokyo_Glass', (0.10, 0.16, 0.20), metal=0.12, rough=0.06, clearcoat=0.95, alpha=0.40)
    pbr('Tokyo_Headlamp_Lens', (0.94, 0.97, 1.0), metal=0.18, rough=0.10, emit=(0.98, 0.94, 0.84), emit_strength=1.5)
    pbr('Tokyo_Fog_Lens', (0.98, 0.92, 0.72), metal=0.15, rough=0.12, emit=(1.0, 0.88, 0.56), emit_strength=1.35)
    pbr('Tokyo_Tail_Lamp', (0.72, 0.02, 0.02), metal=0.12, rough=0.16, emit=(1.0, 0.08, 0.04), emit_strength=1.6)
    pbr('Tokyo_Amber', (0.86, 0.42, 0.02), metal=0.12, rough=0.22, emit=(1.0, 0.52, 0.04), emit_strength=0.65)
    pbr('Tokyo_Cage', (0.65, 0.68, 0.71), metal=0.58, rough=0.36)
    return mats


def half_width_at(y):
    base = 0.892
    if y > 1.66:
        t = (y - 1.66) / 0.56
        base -= 0.15 * (t * t)
    elif y < -1.66:
        t = (-1.66 - y) / 0.54
        base -= 0.12 * (t * t)
    return base


def wheel_well_inward(y):
    inward = 0.0
    for ay in (AXLE_FRONT_Y, AXLE_REAR_Y):
        d = abs(y - ay)
        if d < 0.39:
            inward = max(inward, 0.21 * math.cos((d / 0.39) * math.pi * 0.5))
    return inward


def door_widths(y):
    hw = half_width_at(y)
    inw = wheel_well_inward(y)
    w_bot = max(0.46, hw - 0.04 - inw)
    w_mid = max(0.50, hw - inw * 0.82)
    w_shoulder = hw * 0.955
    w_deck = hw * 0.89
    return w_bot, w_mid, w_shoulder, w_deck


def build_sedan_body(mats, collection):
    mb = MeshBuilder()

    def belt_z(y):
        if y >= 0.78:
            t = (y - 0.78) / (2.20 - 0.78)
            return 0.885 - 0.295 * (t ** 1.15)
        elif y >= -1.48:
            t = (0.78 - y) / (0.78 + 1.48)
            return 0.885 + 0.080 * t
        else:
            t = (-1.48 - y) / (2.18 - 1.48)
            return 0.965 - 0.042 * t

    def rock_z(y):
        if y > 1.75:
            return 0.20 + 0.06 * ((y - 1.75) / 0.45)
        if y < -1.75:
            return 0.20 + 0.09 * ((-1.75 - y) / 0.43)
        return 0.185

    # --- SECTION A: Front Nose & Hood Solid (watertight) ---
    front_ys = [2.20, 2.11, 1.98, 1.80, 1.58, 1.35, 1.12, 0.92, 0.76]
    front_rings = []
    for y in front_ys:
        w_bot, w_mid, w_sh, w_deck = door_widths(y)
        zr, zb = rock_z(y), belt_z(y)
        zm = zr * 0.48 + zb * 0.52
        bulge = 0.032 * max(0.0, math.sin(max(0.0, min(1.0, (2.12 - y) / 1.34)) * math.pi))
        front_rings.append([
            (0.0, y, zr - 0.025),
            (w_bot, y, zr),
            (w_mid, y, zm),
            (w_sh, y, zb * 0.94 + zr * 0.06),
            (w_deck, y, zb),
            (w_deck * 0.54, y, zb + 0.022 + bulge * 0.6),
            (0.0, y, zb + 0.034 + bulge),
            (-w_deck * 0.54, y, zb + 0.022 + bulge * 0.6),
            (-w_deck, y, zb),
            (-w_sh, y, zb * 0.94 + zr * 0.06),
            (-w_mid, y, zm),
            (-w_bot, y, zr),
        ])

    def front_mat(j, i):
        ym = (front_ys[j] + front_ys[j + 1]) * 0.5
        if 0.84 <= ym <= 2.04 and i in (4, 5, 6, 7):
            return 'Tokyo_Carbon'
        if abs(ym - AXLE_FRONT_Y) < 0.26 and i in (1, 10):
            return 'Tokyo_DarkTrim'
        if j == 0 and i in (0, 11, 1, 10):
            return 'Tokyo_DarkTrim'
        return 'Tokyo_Paint'

    mb.loft_solid(front_rings, front_mat, cap_start_mat='Tokyo_DarkTrim', cap_end_mat='Tokyo_DarkTrim')

    # --- SECTION B: Watertight U-Shaped Cabin Shell (closed front/rear bulkhead walls!) ---
    cabin_ys = [0.76, 0.52, 0.24, -0.05, -0.34, -0.65, -0.94, -1.22, -1.48]
    u_rings = []
    for y in cabin_ys:
        w_bot, w_mid, w_sh, w_deck = door_widths(y)
        zr, zb = rock_z(y), belt_z(y)
        zm = zr * 0.45 + zb * 0.55
        w_inner = w_deck * 0.84
        u_rings.append([
            (0.0, y, 0.25),
            (w_inner * 0.85, y, 0.25),
            (w_inner, y, zb - 0.015),
            (w_deck, y, zb),
            (w_sh, y, zb * 0.93 + zr * 0.07),
            (w_mid, y, zm),
            (w_bot, y, zr),
            (0.0, y, zr - 0.02),
            (-w_bot, y, zr),
            (-w_mid, y, zm),
            (-w_sh, y, zb * 0.93 + zr * 0.07),
            (-w_deck, y, zb),
            (-w_inner, y, zb - 0.015),
            (-w_inner * 0.85, y, 0.25),
        ])

    def cabin_mat(j, i):
        ym = (cabin_ys[j] + cabin_ys[j + 1]) * 0.5
        if i in (0, 1, 12, 13, 6, 7):
            return 'Tokyo_DarkTrim'
        if abs(ym - AXLE_REAR_Y) < 0.25 and i in (5, 8):
            return 'Tokyo_DarkTrim'
        return 'Tokyo_Paint'

    mb.loft_solid(u_rings, cabin_mat, cap_start_mat='Tokyo_DarkTrim', cap_end_mat='Tokyo_DarkTrim')

    # --- SECTION C: Closed Rear Trunk & Bumper Solid (watertight!) ---
    rear_ys = [-1.48, -1.62, -1.78, -1.94, -2.07, -2.18]
    rear_rings = []
    for y in rear_ys:
        w_bot, w_mid, w_sh, w_deck = door_widths(y)
        zr, zb = rock_z(y), belt_z(y)
        zm = zr * 0.45 + zb * 0.55
        rear_rings.append([
            (0.0, y, zr - 0.02),
            (w_bot, y, zr),
            (w_mid, y, zm),
            (w_sh, y, zb * 0.92 + zr * 0.08),
            (w_deck, y, zb),
            (w_deck * 0.54, y, zb + 0.016),
            (0.0, y, zb + 0.022),
            (-w_deck * 0.54, y, zb + 0.016),
            (-w_deck, y, zb),
            (-w_sh, y, zb * 0.92 + zr * 0.08),
            (-w_mid, y, zm),
            (-w_bot, y, zr),
        ])

    def rear_mat(j, i):
        ym = (rear_ys[j] + rear_ys[j + 1]) * 0.5
        if abs(ym - AXLE_REAR_Y) < 0.24 and i in (1, 10):
            return 'Tokyo_DarkTrim'
        if i in (0, 11):
            return 'Tokyo_DarkTrim'
        return 'Tokyo_Paint'

    mb.loft_solid(rear_rings, rear_mat, cap_start_mat='Tokyo_DarkTrim', cap_end_mat='Tokyo_Paint')

    # --- SECTION D: 4-Door Notchback Greenhouse, Solid Pillars & Outward Glass ---
    roof_y_f, roof_y_r = 0.24, -0.94
    cowl_y, deck_y = 0.76, -1.48
    roof_z = 1.385
    roof_hw = 0.595
    belt_z_f, belt_z_m, belt_z_r = 0.885, 0.925, 0.965
    belt_hw = 0.790

    mb.box(0.0, (roof_y_f + roof_y_r) * 0.5, roof_z - 0.008, (roof_hw - 0.04) * 2.0, abs(roof_y_f - roof_y_r) + 0.04, 0.038, 'Tokyo_Carbon', bevel=0.018)

    for side in (-1, 1):
        a_bot = (side * belt_hw, cowl_y, belt_z_f)
        a_top = (side * roof_hw, roof_y_f, roof_z - 0.012)
        c_top = (side * roof_hw * 0.98, roof_y_r, roof_z - 0.016)
        mb.bar(a_bot, a_top, 0.036, 'Tokyo_Paint', 12)
        mb.bar(a_top, c_top, 0.036, 'Tokyo_Paint', 12)

        # Solid watertight C-pillar lofted prism (never inverted!)
        c_ft = (side * (roof_hw * 0.99), roof_y_r + 0.09, roof_z - 0.016)
        c_fb = (side * (belt_hw * 0.98), deck_y + 0.25, belt_z_r - 0.01)
        c_bt = (side * roof_hw * 0.98, roof_y_r, roof_z - 0.016)
        c_bb = (side * belt_hw * 0.97, deck_y, belt_z_r)
        outer = [c_ft, c_bt, c_bb, c_fb]
        inner = [(side * (roof_hw - 0.075), p[1], p[2]) for p in outer]
        mb.loft_solid([outer, inner], 'Tokyo_Paint', cap_start_mat='Tokyo_Paint', cap_end_mat='Tokyo_DarkTrim', smooth=True)

        b_y = -0.34
        mb.box(side * ((belt_hw + roof_hw) * 0.49), b_y, (belt_z_m + roof_z) * 0.5, 0.036, 0.082, roof_z - belt_z_m + 0.02, 'Tokyo_DarkTrim', bevel=0.008)
        mx = side * (belt_hw + 0.13)
        mb.bar((side * (belt_hw - 0.02), 0.50, belt_z_f + 0.025), (mx - side * 0.03, 0.46, belt_z_f + 0.07), 0.016, 'Tokyo_DarkTrim', 8)
        mb.box(mx, 0.44, belt_z_f + 0.08, 0.125, 0.088, 0.062, 'Tokyo_Paint', bevel=0.022, rot_z=side * 0.16)
        mb.box(side * 0.858, 0.04, 0.84, 0.026, 0.135, 0.025, 'Tokyo_DarkTrim', bevel=0.005)
        mb.box(side * 0.858, -0.66, 0.86, 0.026, 0.135, 0.025, 'Tokyo_DarkTrim', bevel=0.005)

        # Explicitly outward-oriented transparent door panes (x*side > 0)
        f_glass = [
            (side * (belt_hw * 0.96), cowl_y - 0.04, belt_z_f),
            (side * (roof_hw * 0.97), roof_y_f - 0.02, roof_z - 0.025),
            (side * (roof_hw * 0.97), b_y + 0.035, roof_z - 0.025),
            (side * (belt_hw * 0.96), b_y + 0.035, belt_z_m),
        ]
        mb.add_oriented_face(f_glass, 'Tokyo_Glass', expected_dir=(side, 0.0, 0.25), smooth=True)
        r_glass = [
            (side * (belt_hw * 0.96), b_y - 0.035, belt_z_m),
            (side * (roof_hw * 0.97), b_y - 0.035, roof_z - 0.025),
            (side * (roof_hw * 0.97), roof_y_r + 0.09, roof_z - 0.025),
            (side * (belt_hw * 0.96), deck_y + 0.25, belt_z_r),
        ]
        mb.add_oriented_face(r_glass, 'Tokyo_Glass', expected_dir=(side, 0.0, 0.25), smooth=True)

    # Explicitly outward-oriented front windshield (+Y, +Z) and rear window (-Y, +Z)
    mb.add_oriented_face([
        (-belt_hw * 0.96, cowl_y, belt_z_f),
        (belt_hw * 0.96, cowl_y, belt_z_f),
        (roof_hw * 0.97, roof_y_f, roof_z - 0.02),
        (-roof_hw * 0.97, roof_y_f, roof_z - 0.02),
    ], 'Tokyo_Glass', expected_dir=(0.0, 1.0, 1.0), smooth=True)
    for x0 in (-0.42, 0.04):
        mb.bar((x0, cowl_y + 0.02, belt_z_f + 0.015), (x0 + 0.36, cowl_y - 0.14, belt_z_f + 0.135), 0.007, 'Tokyo_DarkTrim', 6)

    mb.add_oriented_face([
        (belt_hw * 0.95, deck_y, belt_z_r),
        (-belt_hw * 0.95, deck_y, belt_z_r),
        (-roof_hw * 0.96, roof_y_r, roof_z - 0.02),
        (roof_hw * 0.96, roof_y_r, roof_z - 0.02),
    ], 'Tokyo_Glass', expected_dir=(0.0, -1.0, 1.0), smooth=True)

    # --- SECTION E: Hood Bulge + Vents + Roof Scoop + Vortex Fins ---
    hood_mid_y = 1.44
    hood_bulge_z = lambda y: belt_z(y) + 0.034 + 0.032 * max(0.0, math.sin(max(0.0, min(1.0, (2.12 - y) / 1.34)) * math.pi))
    mb.box(0.0, hood_mid_y, hood_bulge_z(hood_mid_y) - 0.002, 0.50, 0.78, 0.032, 'Tokyo_Carbon', bevel=0.014, rot_x=-0.195)
    for k in range(5):
        vy = 1.20 + k * 0.090
        vz = hood_bulge_z(vy) - 0.006
        for sx in (-0.33, 0.33):
            mb.box(sx, vy, vz, 0.16, 0.042, 0.016, 'Tokyo_DarkTrim', bevel=0.004, rot_x=-0.34)
    for sx in (-0.42, 0.42):
        pz = belt_z(1.94) + 0.030
        mb.lathe((sx, 1.94, pz - 0.008), (sx, 1.94, pz + 0.008), [(0.0, 0.018), (1.0, 0.015)], 'Tokyo_AccentRed', 12)

    mb.box(0.0, 0.04, roof_z + 0.042, 0.34, 0.40, 0.070, 'Tokyo_Carbon', bevel=0.022)
    mb.box(0.0, 0.245, roof_z + 0.040, 0.28, 0.02, 0.044, 'Tokyo_DarkTrim', bevel=0.005)
    for x in (-0.44, -0.26, -0.09, 0.09, 0.26, 0.44):
        mb.box(x, roof_y_r + 0.05, roof_z + 0.020, 0.014, 0.075, 0.028, 'Tokyo_Carbon', bevel=0.004)

    # --- SECTION F: Watertight Solid Widebody Overfender Arches, Mudflaps, Skirts & Outward Livery ---
    for side in (-1, 1):
        for axle in (AXLE_FRONT_Y, AXLE_REAR_Y):
            steps = 22
            arch_rings = []
            for i in range(steps + 1):
                t = math.pi * i / steps
                c, s = math.cos(t), math.sin(t)
                z0 = 0.30 + 0.404 * s
                y0 = axle + 0.404 * c
                z1 = 0.30 + 0.502 * s
                y1 = axle + 0.502 * c
                # Closed 4-corner solid arch cross-section (inner flange -> outer edge -> arch crest -> back wall)
                arch_rings.append([
                    (side * 0.992, y0, z0),
                    (side * 0.870, y1, z1),
                    (side * 0.855, y1 * 0.998 + axle * 0.002, z1 - 0.018),
                    (side * 0.920, y0, z0),
                ])

            def arch_mat(j, i):
                return 'Tokyo_DarkTrim' if i == 3 else 'Tokyo_Paint'

            mb.loft_solid(arch_rings, arch_mat, cap_start_mat='Tokyo_DarkTrim', cap_end_mat='Tokyo_DarkTrim', smooth=True)

            for k in range(1, 8):
                a = math.pi * k / 8.0
                mb.bar((side * 0.935, axle + 0.464 * math.cos(a), 0.30 + 0.464 * math.sin(a)),
                       (side * 0.958, axle + 0.464 * math.cos(a), 0.30 + 0.464 * math.sin(a)), 0.0085, 'Tokyo_Metal', 8)
            mf_y = axle - 0.47
            mb.box(side * 0.84, mf_y, 0.16, 0.27, 0.020, 0.24, 'Tokyo_AccentRed', bevel=0.004, rot_x=-0.10)
            mb.box(side * 0.84, mf_y - 0.003, 0.078, 0.26, 0.024, 0.052, 'Tokyo_DarkTrim', bevel=0.004, rot_x=-0.10)
            mb.box(side * 0.77, axle - 0.13, 0.34, 0.072, 0.115, 0.145, 'Tokyo_AccentRed', bevel=0.014, rot_x=0.35)

        mb.box(side * 0.905, 0.0, 0.165, 0.105, 1.70, 0.055, 'Tokyo_Carbon', bevel=0.012)
        pts_liv = [
            (side * 0.864, +0.80, 0.25),
            (side * 0.864, -0.80, 0.25),
            (side * 0.897, -0.80, 0.56),
            (side * 0.897, +0.80, 0.56),
        ]
        uv_liv = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
        mb.add_oriented_face(pts_liv, 'Tokyo_Livery', expected_dir=(side, 0.0, 0.0), uv_coords=uv_liv, smooth=True)

    # --- SECTION G: Front Intercooler, Splitter, Quad Fog Pod & Headlamps ---
    mb.box(0.0, 2.18, 0.34, 0.84, 0.07, 0.18, 'Tokyo_DarkTrim', bevel=0.01)
    mb.box(0.0, 2.208, 0.34, 0.76, 0.03, 0.15, 'Tokyo_Metal', bevel=0.006)
    for k in range(6):
        mb.box(0.0, 2.226, 0.28 + k * 0.024, 0.74, 0.010, 0.006, 'Tokyo_DarkTrim', bevel=0.002)
    mb.box(0.0, 2.13, 0.162, 1.66, 0.22, 0.024, 'Tokyo_Carbon', bevel=0.012)
    for side in (-1, 1):
        for cz in (0.27, 0.37):
            mb.box(side * 0.80, 2.02, cz, 0.090, 0.14, 0.012, 'Tokyo_Carbon', bevel=0.004, rot_y=side * 0.18, rot_z=side * 0.10)
        hx = side * 0.54
        mb.box(hx, 2.135, 0.618, 0.31, 0.095, 0.088, 'Tokyo_DarkTrim', bevel=0.015, rot_x=-0.12, rot_z=-side * 0.15)
        mb.bar((hx - side * 0.055, 2.15, 0.618), (hx - side * 0.055, 2.196, 0.615), 0.029, 'Tokyo_Metal', 16)
        mb.bar((hx - side * 0.055, 2.196, 0.615), (hx - side * 0.055, 2.205, 0.615), 0.023, 'Tokyo_Headlamp_Lens', 16)
        mb.bar((hx + side * 0.055, 2.138, 0.618), (hx + side * 0.055, 2.182, 0.615), 0.026, 'Tokyo_Headlamp_Lens', 16)
        mb.box(side * 0.68, 2.095, 0.612, 0.044, 0.075, 0.064, 'Tokyo_Amber', bevel=0.008, rot_z=-side * 0.22)

    mb.box(0.0, 2.19, 0.495, 0.72, 0.075, 0.115, 'Tokyo_Carbon', bevel=0.018)
    for lx in (-0.26, -0.088, 0.088, 0.26):
        mb.bar((lx, 2.195, 0.495), (lx, 2.238, 0.495), 0.052, 'Tokyo_DarkTrim', 20)
        mb.bar((lx, 2.238, 0.495), (lx, 2.246, 0.495), 0.043, 'Tokyo_Fog_Lens', 20)
    mb.box(-0.30, 2.235, 0.235, 0.074, 0.052, 0.014, 'Tokyo_AccentRed', bevel=0.006)

    # --- SECTION H: Rear GT Wing, Tail Clusters, Diffuser & Watertight Hollow Cannon Exhausts ---
    mb.box(0.0, -2.02, 1.29, 1.66, 0.25, 0.026, 'Tokyo_Carbon', bevel=0.010, rot_x=-0.12)
    for side in (-1, 1):
        mb.box(side * 0.42, -1.94, 1.11, 0.024, 0.13, 0.34, 'Tokyo_Carbon', bevel=0.007, rot_x=0.14)
        mb.box(side * 0.845, -2.02, 1.30, 0.020, 0.32, 0.17, 'Tokyo_Carbon', bevel=0.009)
        mb.box(side * 0.858, -2.06, 1.33, 0.010, 0.19, 0.030, 'Tokyo_AccentRed', bevel=0.004)
        rx = side * 0.56
        mb.box(rx, -2.16, 0.77, 0.36, 0.06, 0.105, 'Tokyo_DarkTrim', bevel=0.016, rot_z=side * 0.10)
        for dx, rad in ((-0.085, 0.036), (0.045, 0.036)):
            tx = side * (0.54 + dx)
            ty_back = -2.17 - abs(dx) * 0.05
            mb.bar((tx, ty_back, 0.77), (tx, -2.202, 0.77), rad, 'Tokyo_Tail_Lamp', 18)
        mb.box(side * 0.71, -2.135, 0.765, 0.055, 0.06, 0.065, 'Tokyo_Amber', bevel=0.008, rot_z=side * 0.14)

    mb.box(0.0, -2.182, 0.63, 0.32, 0.022, 0.135, 'Tokyo_Plate', bevel=0.004)
    mb.box(0.0, -2.205, 0.23, 0.070, 0.060, 0.014, 'Tokyo_AccentRed', bevel=0.005)
    mb.box(0.0, -2.10, 0.215, 1.34, 0.18, 0.068, 'Tokyo_DarkTrim', bevel=0.012)
    for sx in (-0.30, -0.15, 0.0, 0.15, 0.30):
        mb.box(sx, -2.11, 0.195, 0.020, 0.21, 0.095, 'Tokyo_Carbon', bevel=0.005)

    mb.tube_path([(0.0, -0.58, 0.22), (0.0, -1.45, 0.22)], 0.030, 'Tokyo_Metal', segs=12)
    for side in (-1, 1):
        mb.tube_path(
            [(0.0, -1.42, 0.22), (side * 0.28, -1.62, 0.22), (side * 0.46, -1.80, 0.218), (side * 0.51, -1.94, 0.218)],
            0.028, 'Tokyo_Metal', segs=14,
        )
        m_start = Vector((side * 0.49, -1.88, 0.22))
        m_dir = Vector((side * 0.19, -1.0, 0.11)).normalized()
        m_mid = m_start + m_dir * 0.28
        m_tip = m_mid + m_dir * 0.18
        mb.lathe(tuple(m_start), tuple(m_mid), [(0.0, 0.042), (0.14, 0.076), (0.88, 0.076), (1.0, 0.066)], 'Tokyo_Metal', segs=28, uv_cyl=True)
        mb.hollow_pipe(tuple(m_mid - m_dir * 0.01), tuple(m_tip), outer_r=0.064, inner_r=0.055, mat_outer='Tokyo_Exhaust_Tip', mat_inner='Tokyo_Exhaust_Bore', segs=28)

    return mb.to_object('body', mats, collection, sharp_angle_deg=44)


def build_exterior_cabin(mats, collection):
    c = MeshBuilder()
    c.box(0.0, 0.48, 0.80, 1.32, 0.32, 0.16, 'Tokyo_Carbon', bevel=0.024)
    for side in (-1, 1):
        nodes = [
            (side * 0.58, 0.56, 0.42),
            (side * 0.54, 0.22, 1.32),
            (side * 0.54, -0.35, 1.33),
            (side * 0.54, -0.88, 1.31),
            (side * 0.57, -1.14, 0.56),
        ]
        for a, b in zip(nodes, nodes[1:]):
            c.bar(a, b, 0.021, 'Tokyo_Cage', 10)
        c.bar((side * 0.56, 0.42, 0.44), (side * 0.55, -0.35, 0.78), 0.019, 'Tokyo_Cage', 8)
    for y in (0.21, -0.35, -0.88):
        c.bar((-0.54, y, 1.32), (0.54, y, 1.32), 0.020, 'Tokyo_Cage', 8)
    c.bar((-0.53, -0.35, 1.30), (0.53, -0.88, 0.56), 0.019, 'Tokyo_Cage', 8)
    for sx in (-0.36, 0.36):
        c.box(sx, -0.20, 0.36, 0.40, 0.42, 0.085, 'Tokyo_DarkTrim', bevel=0.028)
        c.box(sx, -0.40, 0.70, 0.38, 0.105, 0.62, 'Tokyo_DarkTrim', bevel=0.032, rot_x=-0.14)
        c.box(sx, -0.44, 0.98, 0.27, 0.105, 0.17, 'Tokyo_DarkTrim', bevel=0.038)
        for bs in (-0.072, 0.072):
            c.box(sx + bs, -0.33, 0.70, 0.040, 0.022, 0.40, 'Tokyo_AccentRed', bevel=0.005, rot_x=-0.14)
    c.bar((-0.36, 0.46, 0.76), (-0.36, 0.20, 0.87), 0.021, 'Tokyo_DarkTrim', 10)
    c.lathe((-0.36, 0.21, 0.865), (-0.36, 0.18, 0.878), [(0.0, 0.162), (1.0, 0.162)], 'Tokyo_DarkTrim', segs=18)
    return c.to_object('Tokyo_ExteriorCabin', mats, collection, sharp_angle_deg=44)


def build_wheel(name, side, y_pos, mats, collection):
    """Watertight tyre torus + closed rim barrel + disc + 6-spoke TE37 bronze face."""
    w = MeshBuilder()
    r = WHEEL_RADIUS
    hw = TYRE_WIDTH * 0.5
    segs = 40

    # Closed tyre cross-section looping from outer sidewall -> tread -> inner sidewall -> inner bead bridge!
    tyre_profile = [
        (0.84 * hw, 0.212),
        (0.98 * hw, 0.252),
        (1.00 * hw, r - 0.028),
        (0.90 * hw, r - 0.008),
        (0.68 * hw, r),
        (-0.68 * hw, r),
        (-0.90 * hw, r - 0.008),
        (-1.00 * hw, r - 0.028),
        (-0.98 * hw, 0.252),
        (-0.84 * hw, 0.212),
        (-0.76 * hw, 0.206),
        (0.76 * hw, 0.206),
    ]
    tyre_rings = [
        [(side * x_off, rad * math.cos(a), rad * math.sin(a)) for x_off, rad in tyre_profile]
        for a in [math.tau * i / segs for i in range(segs)]
    ]
    w.closed_torus_strip(tyre_rings, 'Tokyo_Tyre', smooth=True)

    # Closed solid metallic wheel rim barrel torus cross-section!
    barrel_profile = [
        (0.95 * hw, 0.228),
        (0.92 * hw, 0.210),
        (0.32 * hw, 0.194),
        (-0.78 * hw, 0.196),
        (-0.86 * hw, 0.224),
        (-0.88 * hw, 0.232),
        (0.32 * hw, 0.206),
        (0.92 * hw, 0.232),
    ]
    barrel_rings = [
        [(side * x_off, rad * math.cos(a), rad * math.sin(a)) for x_off, rad in barrel_profile]
        for a in [math.tau * i / segs for i in range(segs)]
    ]
    w.closed_torus_strip(barrel_rings, 'Tokyo_Rim', smooth=True)

    w.lathe((side * 0.015, 0.0, 0.0), (side * 0.038, 0.0, 0.0), [(0.0, 0.168), (1.0, 0.168)], 'Tokyo_Disc', segs=28)
    w.lathe((side * 0.02, 0.0, 0.0), (side * 0.072, 0.0, 0.0), [(0.0, 0.068), (0.7, 0.066), (1.0, 0.056)], 'Tokyo_Rim', segs=20)
    w.bar((side * 0.068, 0.0, 0.0), (side * 0.084, 0.0, 0.0), 0.030, 'Tokyo_Metal', 12)

    for k in range(6):
        ang = math.tau * k / 6.0
        ca, sa = math.cos(ang), math.sin(ang)
        perp_y, perp_z = -sa, ca
        spoke_rings = []
        for x_s, w_s, r_s in [(0.062, 0.025, 0.052), (0.082, 0.022, 0.135), (0.104, 0.020, 0.210)]:
            cy, cz = r_s * ca, r_s * sa
            spoke_rings.append([
                (side * (x_s + 0.013), cy + perp_y * w_s, cz + perp_z * w_s),
                (side * (x_s + 0.013), cy - perp_y * w_s, cz - perp_z * w_s),
                (side * (x_s - 0.014), cy - perp_y * w_s * 1.15, cz - perp_z * w_s * 1.15),
                (side * (x_s - 0.014), cy + perp_y * w_s * 1.15, cz + perp_z * w_s * 1.15),
            ])
        w.loft_solid(spoke_rings, 'Tokyo_Rim', cap_start_mat='Tokyo_Rim', cap_end_mat='Tokyo_Rim', smooth=False)
        lx, ly, lz = side * 0.074, 0.044 * ca, 0.044 * sa
        w.bar((lx - side * 0.008, ly, lz), (lx + side * 0.010, ly, lz), 0.008, 'Tokyo_Metal', 6)

    obj = w.to_object(name, mats, collection, sharp_angle_deg=45)
    obj.location = (side * HALF_TRACK, y_pos, r)
    return obj


def glb_inspect(path):
    raw = open(path, 'rb').read()
    jlen = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20 + jlen])
    return {'totalBytes': len(raw), 'nodes': [n['name'] for n in doc.get('nodes', [])]}


def build_and_export():
    scene = bpy.data.scenes.get('Tokyo_Sedan') or bpy.data.scenes.new('Tokyo_Sedan')
    if bpy.context.window:
        bpy.context.window.scene = scene
    for obj in list(scene.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for m in list(bpy.data.materials):
        if m.name.startswith('Tokyo_') or m.name == 'Material':
            bpy.data.materials.remove(m)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)

    mats = make_materials()
    col = scene.collection
    body = build_sedan_body(mats, col)
    cabin = build_exterior_cabin(mats, col)
    wheels = [
        build_wheel('wheel_FL', -1, AXLE_FRONT_Y, mats, col),
        build_wheel('wheel_FR', +1, AXLE_FRONT_Y, mats, col),
        build_wheel('wheel_RL', -1, AXLE_REAR_Y, mats, col),
        build_wheel('wheel_RR', +1, AXLE_REAR_Y, mats, col),
    ]
    export_objs = [body, cabin] + wheels

    cam_data = bpy.data.cameras.new('GarageCam')
    cam_obj = bpy.data.objects.new('GarageCam', cam_data)
    col.objects.link(cam_obj)
    cam_obj.location = (-4.6, 4.9, 1.55)
    cam_obj.rotation_euler = (Vector((0.0, 0.0, 0.58)) - cam_obj.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam_obj

    light_data = bpy.data.lights.new('StudioKey', type='AREA')
    light_data.energy = 380
    light_data.size = 4.5
    light_obj = bpy.data.objects.new('StudioKey', light_data)
    col.objects.link(light_obj)
    light_obj.location = (-3.0, 3.6, 3.9)
    light_obj.rotation_euler = (Vector((0, 0, 0.5)) - light_obj.location).to_track_quat('-Z', 'Y').to_euler()

    bpy.ops.file.pack_all()
    for s in bpy.data.scenes:
        for vl in s.view_layers:
            for o in s.objects:
                o.select_set(o in export_objs, view_layer=vl)

    os.makedirs(os.path.dirname(GLB_OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=GLB_OUT,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_image_format='AUTO',
    )
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)

    return {
        'glb': glb_inspect(GLB_OUT),
        'tris': sum(len(o.data.polygons) for o in export_objs),
    }


if __name__ == '__main__':
    print(build_and_export())
