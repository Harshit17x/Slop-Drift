"""Build the Slop-Drift rally car, save the .blend and export a GLB next to this script.

    blender --background --python assets/blender/build_and_export.py
"""
import os
import runpy

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
runpy.run_path(os.path.join(HERE, "build_rally_car.py"), run_name="__main__")

blend_path = os.path.join(HERE, "slop_drift_rally_car.blend")
glb_path = os.path.join(HERE, "slop_drift_rally_car.glb")

bpy.ops.wm.save_as_mainfile(filepath=blend_path)

bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.data.collections["RallyCar"].all_objects:
    obj.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=glb_path,
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_cameras=False,
    export_lights=False,
)

tris = 0
for obj in bpy.data.collections["RallyCar"].all_objects:
    if obj.type == 'MESH':
        tris += sum(len(poly.vertices) - 2 for poly in obj.data.polygons)
print("SAVED", blend_path)
print("EXPORTED", glb_path, os.path.getsize(glb_path), "bytes,", tris, "tris")
