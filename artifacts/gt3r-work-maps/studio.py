import bpy
from mathutils import Vector
from pathlib import Path
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=18
scene.cycles.use_denoising=True
scene.cycles.max_bounces=4
scene.render.threads_mode='FIXED'
scene.render.threads=6
world=bpy.data.worlds.new('Studio ambient')
scene.world=world
world.use_nodes=True
world.node_tree.nodes.get('Background').inputs[0].default_value=(.25,.29,.34,1)
world.node_tree.nodes.get('Background').inputs[1].default_value=.33
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.004))
mat=bpy.data.materials.new('Charcoal concrete')
mat.use_nodes=True
bs=mat.node_tree.nodes.get('Principled BSDF')
bs.inputs['Base Color'].default_value=(.043,.052,.058,1)
bs.inputs['Roughness'].default_value=.44
bpy.context.object.data.materials.append(mat)
def aim(obj,point):
    obj.rotation_euler=(Vector(point)-obj.location).to_track_quat('-Z','Y').to_euler()
def softbox(name,point,size,power,color):
    lamp=bpy.data.lights.new(name,'AREA')
    lamp.energy=power; lamp.shape='DISK';lamp.size=size;lamp.color=color
    obj=bpy.data.objects.new(name,lamp)
    scene.collection.objects.link(obj);obj.location=point;aim(obj,(0,0,.5))
softbox('Front overhead',(-3.2,4,5.5),5,1400,(1,.93,.82))
softbox('Roof reflection',(2,-2,5.2),3,1400,(.78,.88,1))
softbox('Flank strip',(-4,-3,2.7),2.8,780,(.74,.9,1))
softbox('Nose fill',(3,4,2),2.2,560,(1,.91,.77))
bpy.ops.object.camera_add(location=(-5.8,5.55,2.18))
cam=bpy.context.object;aim(cam,(0,-.04,.55));cam.data.lens=48;scene.camera=cam
scene.render.resolution_x=960;scene.render.resolution_y=540;scene.render.resolution_percentage=100
scene.render.filepath='C:/Users/RIYAN/Desktop/Ex/GamEX/gt3r-work-maps/garage.png'
bpy.ops.render.render(write_still=True)
