"""
Step 2 of the car pipeline (after normalize.py): cut each car's four wheels out of the body as their
own objects (origin on the axle, so the game can spin and steer them), separate brake discs and
canonical PBR material slots (plus BVH vertex AO on Thar and PBR maps via build_gt_textures.py on GT),
thin heavy meshes, and export <repo>/src/assets/cars/<key>.glb with nodes body, wheel_FL, wheel_FR,
wheel_RL, wheel_RR.
Prints the measured wheel layout, which goes into src/vehicle/cars.js.
"""
import bpy, bmesh, mathutils, json, math, os, random
from mathutils import Vector
from mathutils.bvhtree import BVHTree

REPO = '/Users/harshitbisht/Desktop/Slop-drift/Slop-Drift/'
# Axle y (front +), inner/outer x of the tyre and the radius, read off the side renders and wheels probe.
SPEC = {
    'gt': {'axle': 1.12, 'rear': -1.125, 'xi': 0.6, 'r': 0.335, 'margin': 0.012, 'ratio': 1.0},
    # clear: a box (x half-width, y range, z range) where faces turned toward the cabin are removed: the
    # source model backs its windscreen with an opaque panel that would fill the view from the driver's seat.
    # margin 0.030 captures outer tyre lugs (~0.431m) cleanly without leaving treads on the arch.
    'thar': {'axle': 1.473, 'rear': -1.473, 'xi': 0.66, 'r': 0.415, 'margin': 0.030, 'ratio': 0.35, 'clear': (0.86, (0.35, 1.05), (1.2, 1.92))},
}


def compact_materials(obj):
    me = obj.data
    used = sorted({p.material_index for p in me.polygons if p.material_index < len(me.materials)})
    old_indices = [p.material_index for p in me.polygons]
    remap = {old_i: new_i for new_i, old_i in enumerate(used)}
    kept = [me.materials[i] for i in used]
    me.materials.clear()
    for m in kept:
        me.materials.append(m)
    if me.polygons:
        me.polygons.foreach_set('material_index', [remap.get(i, 0) for i in old_indices])


def bake_vertex_ao(obj, num_rays=20, max_dist=1.2):
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    bvh = BVHTree.FromBMesh(bm)
    rng = random.Random(42)
    ao = []
    for v in bm.verts:
        n = v.normal.normalized()
        if n.length < 1e-4:
            ao.append(0.85)
            continue
        up = Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))
        t1 = n.cross(up).normalized()
        t2 = n.cross(t1).normalized()
        origin = v.co + n * 0.003
        hits = 0.0
        for i in range(num_rays):
            phi = 2.0 * math.pi * ((i + rng.random() * 0.5) / num_rays)
            cos_t = math.sqrt((i + 0.5) / num_rays)
            sin_t = math.sqrt(max(0.0, 1.0 - cos_t * cos_t))
            d = (n * cos_t + t1 * (sin_t * math.cos(phi)) + t2 * (sin_t * math.sin(phi))).normalized()
            if d.z < -0.15:
                hits += 0.35
                continue
            loc, _, _, dist = bvh.ray_cast(origin, d, max_dist)
            if loc is not None:
                hits += max(0.15, 1.0 - dist / max_dist)
        ao.append(max(0.18, min(1.0, 1.0 - (hits / num_rays) * 0.72)))
    smoothed = list(ao)
    for _ in range(2):
        nxt = list(smoothed)
        for v in bm.verts:
            nbrs = [e.other_vert(v).index for e in v.link_edges]
            if nbrs:
                nxt[v.index] = smoothed[v.index] * 0.55 + (sum(smoothed[ni] for ni in nbrs) / len(nbrs)) * 0.45
        smoothed = nxt
    bm.free()

    for ca in list(me.color_attributes):
        me.color_attributes.remove(ca)
    ca = me.color_attributes.new(name='Color', type='BYTE_COLOR', domain='CORNER')
    for poly in me.polygons:
        for li in poly.loop_indices:
            val = smoothed[me.loops[li].vertex_index]
            ca.data[li].color = (val, val, val, 1.0)
    idx = me.color_attributes.find('Color')
    me.color_attributes.active_color_index = idx
    me.color_attributes.render_color_index = idx


out = {}
for key, sp in SPEC.items():
    body = bpy.data.objects[f'{key}_body']
    for o in list(bpy.data.objects):
        if o.name.startswith(f'{key}_wheel'):
            bpy.data.objects.remove(o)
    if key == 'thar':
        # Weld SketchUp split vertices so WeightedNormal & BVH AO shade cleanly across panels.
        bm = bmesh.new(); bm.from_mesh(body.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0003)
        bm.to_mesh(body.data); bm.free()

    corners = {'FL': (-1, sp['axle']), 'FR': (1, sp['axle']), 'RL': (-1, sp['rear']), 'RR': (1, sp['rear'])}
    layout = {}
    margin = sp.get('margin', 0.012)
    for name, (side, yc) in corners.items():
        r = sp['r']
        bm = bmesh.new(); bm.from_mesh(body.data)
        sel = []
        for f in bm.faces:
            ok = True
            for v in f.verts:
                p = v.co
                if p.x * side < sp['xi'] - 0.03 or (p.y - yc) ** 2 + (p.z - r) ** 2 > (r + margin) ** 2:
                    ok = False; break
            if ok: sel.append(f)
        # Copy the wheel faces to a new mesh, then delete them from the body.
        wm = bmesh.new()
        vmap = {}
        layers_uv = bm.loops.layers.uv.active
        wuv = wm.loops.layers.uv.new() if layers_uv else None
        for f in sel:
            vs = []
            for v in f.verts:
                if v not in vmap: vmap[v] = wm.verts.new(v.co - mathutils.Vector((0, yc, r)) + mathutils.Vector((0, 0, 0)))
                vs.append(vmap[v])
            try:
                nf = wm.faces.new(vs)
                nf.material_index = f.material_index
                if wuv:
                    for a, b in zip(nf.loops, f.loops): a[wuv].uv = b[layers_uv].uv
            except ValueError:
                pass
        # Recentre on the wheel's own axis: x at the middle of the tyre.
        xs = [v.co.x for v in wm.verts]
        cx = (min(xs) + max(xs)) / 2 if xs else side * (sp['xi'] + 0.12)
        for v in wm.verts: v.co.x -= cx
        zs = [v.co.z for v in wm.verts]
        mesh = bpy.data.meshes.new(f'{key}_wheel_{name}')
        for m in body.data.materials: mesh.materials.append(m)
        wm.to_mesh(mesh); wm.free()
        obj = bpy.data.objects.new(f'{key}_wheel_{name}', mesh)
        body.users_collection[0].objects.link(obj)
        obj.location = (cx, yc, r)
        bmesh.ops.delete(bm, geom=sel, context='FACES')
        bm.to_mesh(body.data); bm.free()
        layout[name] = {'x': round(cx, 3), 'y': round(yc, 3), 'r': round(r, 3), 'faces': len(sel), 'top': round(max(zs) if zs else 0, 3), 'bottom': round(min(zs) if zs else 0, 3)}
    if sp.get('clear'):
        hx, (y0, y1), (z0, z1) = sp['clear']
        bm = bmesh.new(); bm.from_mesh(body.data)
        bm.normal_update()
        inner = [f for f in bm.faces if f.normal.y < -0.3 and abs(f.calc_center_median().x) < hx
                 and y0 < f.calc_center_median().y < y1 and z0 < f.calc_center_median().z < z1]
        bmesh.ops.delete(bm, geom=inner, context='FACES')
        bm.to_mesh(body.data); bm.free()
        layout['cleared'] = len(inner)
    body.data.update()
    # Thin the heavy mesh: dissolve flat SketchUp fans first, then collapse.
    objs = [body] + [bpy.data.objects[f'{key}_wheel_{n}'] for n in corners]
    if sp['ratio'] < 1:
        for o in objs:
            m1 = o.modifiers.new('flat', 'DECIMATE'); m1.decimate_type = 'DISSOLVE'; m1.angle_limit = 0.035
            m2 = o.modifiers.new('thin', 'DECIMATE'); m2.ratio = sp['ratio'] if o is body else 0.25
            bpy.context.view_layer.objects.active = o
            for m in (m1, m2): bpy.ops.object.modifier_apply(modifier=m.name)
    for o in objs:
        compact_materials(o)
    if key == 'thar':
        for o in objs:
            bake_vertex_ao(o, num_rays=20, max_dist=1.2 if o is body else 0.5)
    # Export with plain node names.
    names = {o: o.name for o in objs}
    body.name = 'body'
    for n in corners: bpy.data.objects[f'{key}_wheel_{n}'].name = f'wheel_{n}'
    for scene in bpy.data.scenes:  # objects selected in other scenes would be exported too
        for layer in scene.view_layers:
            for o in scene.objects:
                o.select_set(o in objs, view_layer=layer)
    try:
        bpy.ops.export_scene.gltf(
            filepath=f'{REPO}src/assets/cars/{key}.glb',
            export_format='GLB',
            use_selection=True,
            export_apply=True,
            export_yup=True,
            export_cameras=False,
            export_lights=False,
            export_animations=False,
            export_vertex_color='NAME' if key == 'thar' else 'NONE',
            export_vertex_color_name='Color' if key == 'thar' else '',
            export_all_vertex_colors=False,
        )
    finally:
        for o, n in names.items(): o.name = n
    out[key] = {'layout': layout, 'tris': sum(len(o.data.polygons) for o in objs)}
print(json.dumps(out))
