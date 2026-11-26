"""Make a lightweight shared race-grid LOD from SlopDrift's own GT3 asset."""
import bpy
from pathlib import Path
from mathutils import Vector
root=Path(__file__).resolve().parents[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root/'src/assets/cars/gt3r.glb'))
objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
# Bake hierarchy before decimation; retaining the world matrix preserves all wheel positions.
for o in objects:
    m=o.matrix_world.copy()
    o.parent=None
    o.matrix_world=m
paints={}
def mat(name,rgb,metal):
    m=bpy.data.materials.new(name)
    m.diffuse_color=(*rgb,1)
    m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(*rgb,1)
    bs.inputs['Metallic'].default_value=metal
    bs.inputs['Roughness'].default_value=.48
    return m
for name,rgb,metal in [('Team enamel',(.7,.7,.7),.35),('Rubber and carbon',(.023,.026,.029),.1),('Glazing',(.047,.088,.112),.42),('Alloy',(.42,.37,.30),.66),('Lens',(.71,.76,.76),.25)]:
    paints[name]=mat(name,rgb,metal)
for o in objects:
    bpy.context.view_layer.objects.active=o
    mod=o.modifiers.new('Grid distance LOD','DECIMATE')
    mod.ratio=.09
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for slot in o.material_slots:
        name=slot.material.name if slot.material else ''
        target='Rubber and carbon'
        if name=='GT_Body':target='Team enamel'
        elif 'Glaz' in name or 'Lens' in name:target='Glazing'
        elif 'Bronze' in name or 'Iron' in name or 'centrelock' in name.lower():target='Alloy'
        elif 'Guide' in name or 'Number' in name:target='Lens'
        slot.material=paints[target]
for o in bpy.context.selected_objects:o.select_set(False)
for o in objects:o.select_set(True)
bpy.context.view_layer.objects.active=objects[0]
bpy.ops.object.join()
o=bpy.context.object;o.name='APEX grid GT'
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
bpy.ops.export_scene.gltf(filepath=str(root/'src/assets/maps/apex-grid-gt.glb'),export_format='GLB',use_selection=True,export_texcoords=False,export_yup=True)
print('Grid GT triangles',sum(len(p.vertices)-2 for p in o.data.polygons))

