"""Restore the game shader's side projection on a game-exported hatch in Blender."""
import math
from pathlib import Path

import bpy
from mathutils import Euler


def apply_graphics(scene, mask_path):
    mask=bpy.data.images.load(str(mask_path),check_existing=True)
    mask.colorspace_settings.name='Non-Color'
    mask.pack()
    materials={}
    for obj in scene.objects:
        if obj.type!='MESH':
            continue
        affected=[m for m in obj.data.materials if m and m.name.split('.')[0] in {'Base_Paint','Base_Trim'}]
        if not affected:
            continue
        mesh=obj.data
        uv=mesh.uv_layers.get('Stage livery') or mesh.uv_layers.new(name='Stage livery')
        flank=mesh.color_attributes.get('Stage sides') or mesh.color_attributes.new(name='Stage sides',type='FLOAT_COLOR',domain='POINT')
        for v in mesh.vertices:
            t=max(0,min(1,(abs(v.co.x)-.72)/.13))
            w=t*t*(3-2*t)
            flank.data[v.index].color=(w,w,w,1)
        for loop in mesh.loops:
            co=mesh.vertices[loop.vertex_index].co
            uv.data[loop.index].uv=((-co.y+2.3)/4.6,co.z/1.5)
        for m in affected: materials[m.name]=m
    for mat in materials.values():
        tree=mat.node_tree
        bs=tree.nodes.get('Principled BSDF')
        if not bs: continue
        coords=tree.nodes.new('ShaderNodeUVMap')
        coords.uv_map='Stage livery'
        tex=tree.nodes.new('ShaderNodeTexImage')
        tex.image=mask
        tex.extension='EXTEND'
        tree.links.new(coords.outputs['UV'],tex.inputs['Vector'])
        rgb=tree.nodes.new('ShaderNodeSeparateColor')
        tree.links.new(tex.outputs['Color'],rgb.inputs[0])
        side=tree.nodes.new('ShaderNodeVertexColor')
        side.layer_name='Stage sides'
        base=bs.inputs['Base Color']
        previous=base.links[0].from_socket if base.is_linked else None
        is_paint=mat.name.split('.')[0]=='Base_Paint'
        channels=[('Red',(.68,.032,.012)),('Green',(.90,.82,.66))] if is_paint else []
        channels.append(('Blue',(.24,.145,.075)))
        for channel,colour in channels:
            mix=tree.nodes.new('ShaderNodeMixRGB')
            weight=rgb.outputs[channel]
            if channel!='Blue':
                mul=tree.nodes.new('ShaderNodeMath')
                mul.operation='MULTIPLY'
                tree.links.new(weight,mul.inputs[0])
                tree.links.new(side.outputs['Color'],mul.inputs[1])
                weight=mul.outputs[0]
            tree.links.new(weight,mix.inputs[0])
            if previous: tree.links.new(previous,mix.inputs[1])
            else: mix.inputs[1].default_value=base.default_value
            mix.inputs[2].default_value=(*colour,1)
            previous=mix.outputs[0]
        tree.links.new(previous,base)
    return len(materials)


def import_workshop(game_export,mask_path):
    scene=bpy.context.scene
    scene.name='Stage 27 - Rally Hatch'
    bpy.ops.import_scene.gltf(filepath=str(Path(game_export)))
    count=apply_graphics(scene,mask_path)
    # The detailed driver's assembly can be enabled for cockpit editing in the outliner.
    # Its chase-view equivalent lives alongside the body and wheels.
    for obj in scene.objects:
        if obj.name.split('.')[0]=='DriverCockpit':
            for part in [obj,*obj.children_recursive]:
                part.hide_set(True)
                part.hide_render=True
    bpy.ops.object.select_all(action='DESELECT')
    for area in bpy.context.screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active
            space.region_3d.view_distance=5.65
            space.region_3d.view_location=(0,0,.76)
            space.region_3d.view_rotation=Euler((1.32,0,2.48)).to_quaternion()
            space.shading.type='MATERIAL'
            space.overlay.show_overlays=False
    bpy.ops.file.pack_all()
    return {'meshes':sum(o.type=='MESH' for o in scene.objects),'livery_materials':count}
