"""Build the APEX timing pylon in an isolated factory-startup Blender process."""
from pathlib import Path
import bpy
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
root = Path(__file__).resolve().parents[2]
def material(name, rgb, metal=0, rough=.65):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get("Principled BSDF")
    for key, value in (("Base Color", (*rgb, 1)), ("Metallic", metal), ("Roughness", rough)):
        bs.inputs[key].default_value = value
    return m
steel = material("Galvanized lattice", (.23,.26,.27), .65)
black = material("Display housing", (.025,.035,.041), .35)
red = material("Vermilion enamel", (.39,.042,.025), .32)
cement = material("Cast plinth", (.26,.26,.24))
def part(name, pos, dim, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    o = bpy.context.object
    o.name = name
    o.dimensions = dim
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(mat)
    return o
def strut(a,b):
    a,b=Vector(a),Vector(b)
    beam=part("Welded brace",(a+b)*.5,(.11,.11,(b-a).length),steel)
    beam.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
part("Slab", (0,0,.27), (6,3.4,.54), cement)
for x in (-1.75,1.75):
    for y in (-.68,.68):part("Tower upright",(x,y,13.1),(.23,.23,25.8),steel)
for z in range(1,24,3):
    for y in (-.68,.68):
        strut((-1.75,y,z),(1.75,y,z+3))
        strut((1.75,y,z),(-1.75,y,z+3))
    for x in (-1.75,1.75):strut((x,-.68,z),(x,.68,z+3))
part("Timing cabinet",(0,0,16.9),(4.6,1.85,14.3),black)
part("Crown",(0,0,24.7),(5.1,2,1.95),red)
for z in [10+i*1.38 for i in range(11)]:part("Module edge",(0,-.939,z),(4.53,.048,.06),steel)
part("Antenna",(1,0,27),(.11,.11,3.9),steel)
# Merge into one node, preserving material sections.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.join()
o=bpy.context.object
o.name="Apex timing pylon"
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
bpy.ops.export_scene.gltf(filepath=str(root/"src/assets/maps/apex-pylon.glb"),export_format="GLB",export_yup=True)
print("Pylon mesh",len(o.data.vertices),"vertices",len(o.data.polygons),"faces")

