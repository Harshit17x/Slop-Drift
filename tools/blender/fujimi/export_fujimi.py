"""Export the Fujimi scene to the game (src/assets/maps/fujimi/).

layout.json  the track centreline, every placement grouped by prototype, the drift zones and landmarks
fujimi.glb   the prototypes (FJ_Props, read at their own origin) and the backdrop (FJ_Backdrop, as placed)

Hand edits in the FJ_ collections survive: move/duplicate/delete placements, move road vertices (keep
their order), move zone empties. Blender (x, y, z) becomes game (x, z, -y); a yaw about Blender Z is the
same yaw about game Y.
"""
import bpy
import json
import math
from pathlib import Path

ROOT = Path('/Users/harshitbisht/Desktop/Slop-drift/Slop-Drift')
OUT = ROOT / 'src/assets/maps/fujimi'
BLEND = ROOT / 'tools/blender/fujimi/fujimi.blend'
OUT.mkdir(parents=True, exist_ok=True)
scene = bpy.data.scenes['Fujimi']
r2 = lambda v: round(float(v), 2)

road = bpy.data.objects['FJ_Road'].data
points, heights = [], []
for v in road.vertices:
    points += [r2(v.co.x), r2(-v.co.y)]
    heights.append(r2(v.co.z))

groups = {}
for obj in bpy.data.collections['FJ_Placements'].objects:
    proto = obj.data.name
    g = groups.setdefault(proto, {'t': []})
    x, y, z = obj.location
    g['t'] += [r2(x), r2(z), r2(-y), round(obj.rotation_euler.z % (2 * math.pi), 3)]
    for key, field in (('fj_tint', 'tint'), ('fj_variant', 'variant')):
        if key in obj:
            g.setdefault(field, []).append(int(obj[key]))

zones = [{'name': f'Clip {k + 1}', 'x': r2(e.location.x), 'z': r2(-e.location.y), 'radius': float(e.get('fj_radius', 30))}
         for k, e in enumerate(sorted(bpy.data.collections['FJ_Zones'].objects, key=lambda o: o.get('fj_index', 0)))]

# Solid obstacles: tyre islands and boulders the car collides with (circles in the ground plane).
solids = [{'x': r2(o.location.x), 'z': r2(-o.location.y), 'r': float(o['fj_solid'])}
          for o in bpy.data.collections['FJ_Placements'].objects if 'fj_solid' in o]
fuji = bpy.data.objects['BG_Fuji']
layout = {
    'version': 1,
    'name': 'Fujimi Rally',
    'road': {'name': 'Fujimi Rally', 'closed': True, 'points': points, 'heights': heights},
    # Metres along the road: the gravel rally sector and the crest.
    'gravel': list(bpy.data.objects['FJ_Road'].get('fj_gravel', [])),
    'crest': list(bpy.data.objects['FJ_Road'].get('fj_crest', [])),
    'placements': groups,
    'zones': zones,
    'solids': solids,
    'tower': {'x': -980.0, 'z': -460.0},
    'fuji': {'x': r2(fuji.location.x), 'z': r2(-fuji.location.y)},
    'labels': [{'name': 'Waterfront Straight', 'x': 40.0, 'z': 215.0}, {'name': 'Container Snake', 'x': 230.0, 'z': -60.0},
               {'name': 'Fuji Bowl', 'x': -320.0, 'z': 150.0}, {'name': 'Canal Crest', 'x': 80.0, 'z': -215.0}],
}
(OUT / 'layout.json').write_text(json.dumps(layout, separators=(',', ':')))

for obj in scene.objects:
    obj.select_set(False)
export = [o for name in ('FJ_Props', 'FJ_Backdrop', 'FJ_City') for o in bpy.data.collections[name].objects]
for obj in export:
    obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT / 'fujimi.glb'), export_format='GLB', use_selection=True,
                          export_image_format='NONE', export_normals=False,   # textures come from the game; it shades flat
                           export_vertex_color='ACTIVE',
                          export_yup=True, export_apply=False, export_extras=False, export_materials='EXPORT',
                          export_meshopt_compression_enable=True)
for obj in export:
    obj.select_set(False)
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), copy=True)
print({'placements': sum(len(g['t']) // 4 for g in groups.values()), 'protos': len(groups), 'zones': len(zones),
       'layout_kb': round((OUT / 'layout.json').stat().st_size / 1024), 'glb_kb': round((OUT / 'fujimi.glb').stat().st_size / 1024)})
