"""Build the Minato night landmark in the active Blender scene and export its selected mesh."""
import bpy
import math
from mathutils import Vector
from pathlib import Path

def make_tower(destination):
    verts, faces, materials = [], [], []
    def beam(start, end, radius, mat, sides=6):
        a, b = Vector(start), Vector(end)
        direction = (b-a).normalized()
        normal = direction.cross(Vector((0,0,1)))
        if normal.length < 0.01:
            normal = direction.cross(Vector((1,0,0)))
        normal.normalize()
        tangent = direction.cross(normal)
        first = len(verts)
        for p in [a,b]:
            for k in range(sides):
                angle = k*math.tau/sides
                verts.append(tuple(p+radius*(normal*math.cos(angle)+tangent*math.sin(angle))))
        for k in range(sides):
            n=(k+1)%sides
            faces.append((first+k,first+n,first+sides+n,first+sides+k))
            materials.append(mat)
        faces.append(tuple(first+k for k in reversed(range(sides))))
        faces.append(tuple(first+sides+k for k in range(sides)))
        materials.extend([mat,mat])
    profile=[(0,24),(12,18),(25,13),(39,9),(54,7),(71,6),(87,5.2),(103,4.2),(119,3),(136,1.5),(150,.7)]
    def ring(z,w):
        return [(-w,-w,z),(w,-w,z),(w,w,z),(-w,w,z)]
    for i,((z,w),(z2,w2)) in enumerate(zip(profile,profile[1:])):
        a,b=ring(z,w),ring(z2,w2)
        for k in range(4):
            n=(k+1)%4
            beam(a[k],b[k],max(.32,w*.052),0)
            beam(a[k],a[n],max(.23,w*.031),1)
            beam(a[k],b[n],max(.19,w*.022),1)
            beam(a[n],b[k],max(.19,w*.022),0)
    for z,w in [(68,9),(116,5.4)]:
        beam((0,0,z),(0,0,z+3.7),w,2,12)
        for h in [z-.4,z+1,z+3.8]:
            beam((0,0,h),(0,0,h+.45),w*1.05,1,12)
    for k in range(10):
        beam((0,0,148+k*2.5),(0,0,150.5+k*2.5),max(.16,.9-k*.074),k%2)
    mesh=bpy.data.meshes.new('Minato lattice')
    mesh.from_pydata(verts,[],faces)
    mesh.update()
    obj=bpy.data.objects.new('Minato transmission tower',mesh)
    bpy.context.scene.collection.objects.link(obj)
    for name,color,power in [('Vermilion steel',(1,.115,.014,1),1.7),('Golden floodlight',(1,.52,.1,1),2.1),('Observation windows',(.34,.70,.96,1),.65)]:
        m=bpy.data.materials.new(name)
        m.diffuse_color=color
        m.use_nodes=True
        bs=m.node_tree.nodes.get('Principled BSDF')
        bs.inputs['Base Color'].default_value=color
        bs.inputs['Emission Color'].default_value=color
        bs.inputs['Emission Strength'].default_value=power
        mesh.materials.append(m)
    for poly,idx in zip(mesh.polygons,materials):
        poly.material_index=idx
    selected=list(bpy.context.selected_objects)
    active=bpy.context.view_layer.objects.active
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    bpy.ops.export_scene.gltf(filepath=str(destination),export_format='GLB',use_selection=True)
    obj.select_set(False)
    for old in selected: old.select_set(True)
    bpy.context.view_layer.objects.active=active
    return {'vertices':len(verts),'polygons':len(faces),'bytes':Path(destination).stat().st_size}
