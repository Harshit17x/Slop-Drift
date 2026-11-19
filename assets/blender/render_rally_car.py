"""Studio lighting, camera and turntable renders for the Blender rally car."""
import bpy
import math
from mathutils import Vector

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 1280
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
try:
    scene.eevee.taa_render_samples = 96
except Exception:
    pass
for attr, value in (("use_raytracing", True), ("use_shadows", True), ("use_volumetric_shadows", False)):
    try:
        setattr(scene.eevee, attr, value)
    except Exception:
        pass
try:
    scene.view_settings.look = 'AgX - Medium High Contrast'
except Exception:
    pass
scene.view_settings.exposure = 0.0

# ---------------------------------------------------------------- world
world = bpy.data.worlds.new("StudioWorld")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.012, 0.015, 0.020, 1.0)
bg.inputs[1].default_value = 1.0

# ---------------------------------------------------------------- ground
if "StudioFloor" not in bpy.data.objects:
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    floor = bpy.context.object
    floor.name = "StudioFloor"
    m = bpy.data.materials.new("Floor")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.020, 0.023, 0.027, 1)
    b.inputs["Roughness"].default_value = 0.62
    b.inputs["Metallic"].default_value = 0.15
    floor.data.materials.append(m)

# ---------------------------------------------------------------- lights
def area(name, loc, target, energy, size, color=(1, 1, 1)):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = energy
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = loc
    direction = Vector(target) - Vector(loc)
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = direction.to_track_quat('-Z', 'Y')
    return obj


for old in list(bpy.data.objects):
    if old.type == 'LIGHT':
        bpy.data.objects.remove(old, do_unlink=True)

area("Key", (6.6, 2.4, 3.4), (0, 0.4, 0.8), 1250, 4.0, (1.0, 0.96, 0.90))
area("Fill", (-5.6, 2.4, 2.6), (0, 0.2, 0.7), 380, 6.0, (0.62, 0.76, 1.0))
area("Rim", (-6.0, -3.2, 2.2), (0, -0.6, 0.9), 620, 4.0, (0.82, 0.90, 1.0))
area("Top", (0.0, -0.6, 6.4), (0, -0.6, 0.6), 130, 3.2, (1.0, 1.0, 1.0))
area("FrontKick", (0.6, 7.4, 1.2), (0, 1.2, 0.6), 300, 4.0, (1.0, 0.85, 0.7))
area("SideKick", (6.5, 0.8, 1.7), (0, 0.2, 0.7), 110, 3.0, (1.0, 0.92, 0.82))

# Soft cabin fill so the interior shot has readable detail.
cabin_data = bpy.data.lights.new("CabinFill", 'POINT')
cabin_data.energy = 18.0
cabin_data.color = (1.0, 0.92, 0.82)
cabin_data.shadow_soft_size = 0.4
cabin = bpy.data.objects.new("CabinFill", cabin_data)
scene.collection.objects.link(cabin)
cabin.location = (0.0, -0.15, 1.24)

# ---------------------------------------------------------------- camera
cam_data = bpy.data.cameras.new("StudioCam")
cam_data.lens = 62
cam = bpy.data.objects.new("StudioCam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

SHOTS = [
    ("hero_front", (4.4, 5.4, 3.25), (0.0, 0.20, 0.70), 52, 0.0),
    ("hero_rear", (-4.4, -5.2, 3.25), (0.0, -0.25, 0.72), 52, 0.0),
    ("side", (7.6, 0.10, 1.30), (0.0, 0.0, 0.78), 55, -0.95),
    ("front", (0.10, 7.6, 1.35), (0.0, 1.2, 0.62), 58, -0.35),
    ("top", (0.0, -0.05, 8.2), (0.0, -0.05, 0.70), 35, 0.0),
    ("cockpit", (0.0, -0.78, 1.26), (-0.08, 0.55, 0.95), 18, 0.0),
]

import os
try:
    HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:
    HERE = os.getcwd()
out_dir = os.path.join(HERE, "renders")
os.makedirs(out_dir, exist_ok=True)

for name, loc, target, lens, exposure in SHOTS:
    scene.view_settings.exposure = exposure
    cam.location = loc
    direction = Vector(target) - Vector(loc)
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = direction.to_track_quat('-Z', 'Y')
    cam.data.lens = lens
    scene.render.filepath = os.path.join(out_dir, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", name)

print("STUDIO_OK")
