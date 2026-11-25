"""Author the gravel hatch kit on the imported GameRallyHatch. Run build(path) in Blender.
Coordinates below are chassis-local metres, with the nose facing +Y.
"""
import json
import math
import struct
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


def image(name, rgb, is_data):
    size = rgb.shape[0]
    img = bpy.data.images.new(name, size, size, alpha=False, is_data=is_data)
    rgba = np.ones((size, size, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


def surfaces():
    size = 128
    y, x = np.mgrid[:size, :size]
    wave = np.pi * 2 / size
    rng = np.random.default_rng(27)
    noise = rng.uniform(-1, 1, (size, size))
    twill = np.sin(wave*(16*x+8*y)) * np.cos(wave*(8*x-16*y))
    grain = np.sin(wave*24*y) + 0.25*np.cos(wave*5*x)
    patterns = {
        'Weave': twill*0.63 + noise*0.16, 'Fibre': noise*0.75 + twill*0.27,
        'Brushed': grain*0.44 + noise*0.23, 'Coated': noise*0.30 + np.cos(wave*(x+2*y))*0.14,
        'Rubber': noise*0.55 + np.cos(wave*(x-y)*8)*0.15,
    }
    maps = {}
    for key,h in patterns.items():
        # All three maps use periodic features and wraparound derivatives across the tile boundary.
        dx = np.roll(h,-1,1)-np.roll(h,1,1)
        dy = np.roll(h,-1,0)-np.roll(h,1,0)
        norm = np.stack([-dx*0.34,-dy*0.34,np.ones_like(h)],axis=2)
        norm /= np.linalg.norm(norm,axis=2)[:,:,None]
        mono = lambda a: np.repeat(a[:,:,None],3,axis=2)
        maps[key] = (image('Rally '+key+' colour',mono(0.80 + h*0.15),False),
                     image('Rally '+key+' roughness',mono(0.83+h*0.16),True),
                     image('Rally '+key+' normal',norm*0.5+0.5,True))
    specs = [
        ('Carbon','Weave',(0.035,0.043,0.050),0.22,0.56),
        ('Flock','Fibre',(0.033,0.035,0.041),0,0.96),
        ('Webbing','Weave',(0.69,0.029,0.012),0,0.88),
        ('Rubber','Rubber',(0.032,0.034,0.033),0,0.93),
        ('Steel','Brushed',(0.48,0.51,0.54),0.82,0.48),
        ('Ivory','Coated',(0.88,0.84,0.73),0.12,0.42),
        ('Vermilion','Coated',(0.87,0.048,0.011),0.22,0.42),
        ('Bottle','Coated',(0.025,0.12,0.54),0.68,0.34),
        ('Brass','Brushed',(0.75,0.44,0.12),0.77,0.42),
    ]
    mats={}
    for name,pattern,color,metal,rough in specs:
        mat = bpy.data.materials.new('Rally_'+name)
        mat.use_nodes=True
        mat.diffuse_color=(*color,1)
        tree=mat.node_tree
        bs=tree.nodes.get('Principled BSDF')
        bs.inputs['Metallic'].default_value=metal
        bs.inputs['Base Color'].default_value=(*color,1)
        nodes=[]
        for img in maps[pattern]:
            node=tree.nodes.new('ShaderNodeTexImage')
            node.image=img
            nodes.append(node)
        # glTF recognises a texture multiplied by a factor as baseColorTexture + factor.
        mix=tree.nodes.new('ShaderNodeMixRGB')
        mix.blend_type='MULTIPLY'
        mix.inputs[0].default_value=1
        mix.inputs[2].default_value=(*color,1)
        tree.links.new(nodes[0].outputs['Color'],mix.inputs[1])
        tree.links.new(mix.outputs[0],bs.inputs['Base Color'])
        mul=tree.nodes.new('ShaderNodeMath')
        mul.operation='MULTIPLY'
        tree.links.new(nodes[1].outputs['Color'],mul.inputs[0])
        mul.inputs[1].default_value=rough
        tree.links.new(mul.outputs[0],bs.inputs['Roughness'])
        normal=tree.nodes.new('ShaderNodeNormalMap')
        normal.inputs['Strength'].default_value=0.48
        tree.links.new(nodes[2].outputs['Color'],normal.inputs['Color'])
        tree.links.new(normal.outputs[0],bs.inputs['Normal'])
        mats[name]=mat
    return mats


class Panels:
    def __init__(self):
        self.verts=[]
        self.faces=[]
        self.slots=[]
        self.normals=[]

    def face(self, vertices, mat, normals=None):
        i=len(self.verts)
        self.verts.extend(vertices)
        self.faces.append(tuple(range(i,i+len(vertices))))
        self.slots.append(mat)
        self.normals.extend(normals or [(0,0,0)] * len(vertices))

    def loft(self, rings, mat):
        self.face(list(reversed(rings[0])),mat)
        for a,b in zip(rings,rings[1:]):
            for i in range(len(a)):
                j=(i+1)%len(a)
                self.face([a[i],a[j],b[j],b[i]],mat)
        self.face(rings[-1],mat)

    def box(self,x,y,z,w,d,h,mat,bevel=0.009):
        a,b=w/2,d/2
        r=min(bevel,a*0.55,b*0.55)
        lip=min(r/2,h/5)
        rings=[]
        for dz,offset in [(-h/2,lip),(-h/2+lip,0),(h/2-lip,0),(h/2,lip)]:
            u,v=a-offset,b-offset
            rings.append([(x+i,y+j,z+dz) for i,j in [(-u+r,-v),(u-r,-v),(u,-v+r),(u,v-r),(u-r,v),(-u+r,v),(-u,v-r),(-u,-v+r)]])
        self.loft(rings,mat)

    def lathe(self,a,b,profile,mat,n=16):
        origin=Vector(a)
        axis=Vector(b)-origin
        u=axis.normalized().orthogonal().normalized()
        v=axis.normalized().cross(u)
        directions=[u*math.cos(i*math.tau/n)+v*math.sin(i*math.tau/n) for i in range(n)]
        rings=[[tuple(origin+axis*t+rad*q) for q in directions] for t,rad in profile]
        self.face(list(reversed(rings[0])),mat)
        for k,(a_ring,b_ring) in enumerate(zip(rings,rings[1:])):
            slope=(profile[k+1][1]-profile[k][1]) / ((profile[k+1][0]-profile[k][0])*axis.length)
            normals=[tuple((q-axis.normalized()*slope).normalized()) for q in directions]
            for i in range(n):
                j=(i+1)%n
                self.face([a_ring[i],a_ring[j],b_ring[j],b_ring[i]],mat,
                          [normals[i],normals[j],normals[j],normals[i]] if n>=12 else None)
        self.face(rings[-1],mat)

    def bar(self,a,b,r,mat,n=8):
        self.lathe(a,b,[(0,r),(1,r)],mat,n)

    def finish(self,name,mats):
        mesh=bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts,[],self.faces)
        names=list(dict.fromkeys(self.slots))
        for key in names: mesh.materials.append(mats[key])
        mesh.polygons.foreach_set('material_index',[names.index(m) for m in self.slots])
        mesh.update()
        mesh.normals_split_custom_set_from_vertices(self.normals)
        uv=mesh.uv_layers.new(name='Detail UV')
        for face in mesh.polygons:
            axis=max(range(3),key=lambda i:abs(face.normal[i]))
            a,b=[i for i in range(3) if i!=axis]
            for i in face.loop_indices:
                p=mesh.vertices[mesh.loops[i].vertex_index].co
                uv.data[i].uv=(p[a]*3,p[b]*3)
        obj=bpy.data.objects.new(name,mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def exterior():
    p=Panels()
    # Composite widened arches taper into the sill, with separate peripheral fasteners.
    for side in [-1,1]:
        for axle in [-1.27,1.28]:
            for i in range(16):
                t0,t1=i*math.pi/16,(i+1)*math.pi/16
                def arc(t,r,x):
                    return (side*x,axle+r*math.cos(t),0.255+r*math.sin(t))
                skin=[arc(t0,.443,.996),arc(t1,.443,.996),arc(t1,.52,.944),arc(t0,.52,.944)]
                p.face(skin if side<0 else skin[::-1],'Carbon')
                lip=[arc(t0,.443,.878),arc(t1,.443,.878),skin[1],skin[0]]
                p.face(lip if side<0 else lip[::-1],'Rubber')
            for i in range(1,8):
                a=math.pi*i/8
                y,z=axle+.49*math.cos(a),.255+.49*math.sin(a)
                p.bar((side*.971,y,z),(side*.981,y,z),.009,'Steel',6)
            p.box(side*.81,axle-.47,.134,.288,.038,.25,'Rubber')
            p.box(side*.81,axle-.494,.088,.25,.008,.035,'Vermilion')
        p.box(side*.932,-.03,.245,.091,1.46,.077,'Carbon')
        for i in range(4):
            y=1.15+.115*i
            z=.824-(y-1.15)*.13
            p.box(side*.55,y,z,.24,.075,.024,'Carbon')
            p.bar((side*.45,y-.025,z+.013),(side*.65,y-.025,z+.013),.006,'Steel')
        # Split rear wing and air fences.
        p.box(side*.61,-1.88,1.28,.025,.38,.15,'Carbon')
        p.box(side*.795,-1.88,1.28,.028,.45,.23,'Carbon')
        p.box(side*.797,-2.01,1.35,.035,.155,.025,'Vermilion')
        # Deep recessed headlamp cassette, visible optics and a slim daytime blade.
        p.box(side*.632,2.199,.558,.424,.149,.143,'Carbon',.034)
        p.box(side*.632,2.274,.599,.333,.012,.015,'Ivory')
        for j in range(2):
            x=side*(.55+j*.157)
            p.bar((x,2.259,.55),(x,2.278,.55),.043,'Steel',20)
            p.bar((x,2.278,.55),(x,2.283,.55),.031,'Ivory',20)
        # A bumper cutout surrounds the brake duct on either side of the lower intake.
        p.box(side*.673,2.205,.31,.215,.107,.13,'Carbon',.025)
        for dz in [-.027,.018]:
            p.box(side*.673,2.261,.31+dz,.174,.012,.009,'Steel')
        # Upright tail lamps wrap the hatch corners.
        p.box(side*.682,-2.134,.735,.358,.143,.177,'Carbon',.034)
        for dz in [-.041,.035]:
            p.box(side*.682,-2.211,.735+dz,.299,.013,.027,'Vermilion')
        # Dark liners bridge the flares to the inside of the wheel house.
        for axle in [1.28,-1.27]:
            ring=[(side*.685,axle+.432*math.cos(i*math.pi/24),.235+.432*math.sin(i*math.pi/24)) for i in range(25)]
            p.face(ring+[(side*.685,axle-.432,.12),(side*.685,axle+.432,.12)],'Rubber')
            for a,b in zip(ring,ring[1:]):
                p.face([a,b,(side*.948,b[1],b[2]),(side*.948,a[1],a[2])],'Rubber')
    p.box(0,2.208,.561,.742,.136,.119,'Carbon')
    for i in range(17):
        p.box(-.328+i*.041,2.278,.562,.009,.008,.084,'Flock')
    p.box(0,-2.155,.54,.49,.069,.157,'Carbon',.019)
    p.box(0,-2.195,.54,.407,.012,.104,'Ivory')
    p.box(0,-2.035,1.325,1.62,.152,.030,'Carbon')
    p.box(0,.115,1.460,.414,.37,.115,'Carbon',.044)
    p.box(0,.305,1.459,.32,.013,.064,'Rubber')
    for i in range(11):
        p.box(-.14+i*.028,.314,1.459,.006,.009,.048,'Steel')
    p.box(0,2.249,.383,1.01,.036,.225,'Carbon')
    for i in range(8):
        p.box(0,2.272,.294+i*.025,.86,.013,.009,'Steel')
    for x in [-.35,0,.35]:
        p.box(x,2.28,.382,.017,.012,.181,'Carbon')
    p.box(0,2.192,.159,1.56,.23,.049,'Steel',.023)
    # Fabric tow loop bends back into its recessed mount.
    loop=[(-.50,2.254,.31),(-.51,2.30,.24),(-.56,2.30,.22),(-.58,2.254,.30)]
    for a,b in zip(loop,loop[1:]): p.bar(a,b,.014,'Webbing')
    for x in [-.58,-.29,0,.29,.58]:
        p.box(x,-2.087,.147,.022,.27,.13,'Carbon')
    return p


def cabin():
    p=Panels()
    # Navigator's trip computer, isolated keys and a paper pace-note pad.
    p.box(.42,.365,.815,.29,.057,.135,'Carbon')
    p.box(.396,.331,.829,.178,.012,.066,'Rubber')
    for i in range(4):
        p.box(.515,.333,.779+i*.024,.018,.013,.011,'Ivory')
    p.box(.37,-.115,.492,.246,.29,.029,'Ivory')
    for i in range(9):
        p.box(.35,-.212+i*.026,.509,.12+(i%3)*.021,.003,.002,'Flock')
    for i in range(6):
        p.bar((.249,-.218+i*.043,.507),(.265,-.218+i*.043,.507),.004,'Steel')
    # Deep side bolsters and harness hardware on the two homologation-style seats.
    for sx in [-.37,.38]:
        for side in [-1,1]:
            p.box(sx+side*.208,-.36,.682,.078,.235,.39,'Flock',.033)
            p.box(sx+side*.173,-.474,.954,.073,.20,.13,'Flock',.032)
            x=sx+side*.087
            belt=[(x-.024,-.415,.99),(x+.024,-.415,.99),(x+.024,-.356,.56),(x-.024,-.356,.56)]
            p.face(belt[::-1],'Webbing')
            p.box(x,-.392,.776,.065,.022,.034,'Steel')
        p.box(sx,-.24,.488,.077,.043,.041,'Steel')
    # Bottle mounted transversely behind the seats on rubber-lined saddles.
    y,z=-.86,.49
    p.box(0,y,.323,.68,.30,.036,'Carbon')
    p.lathe((-.36,y,z),(.30,y,z),[(0,.043),(.045,.097),(.12,.129),(.84,.129),(.94,.10),(1,.041)],'Bottle',32)
    for x in [-.20,.151]:
        p.lathe((x-.019,y,z),(x+.019,y,z),[(0,.133),(1,.133)],'Steel',32)
        p.box(x,y-.138,.413,.062,.046,.104,'Steel')
    p.bar((.29,y,z),(.41,y,z),.033,'Brass',8)
    p.bar((.361,y,z),(.361,y,z+.081),.018,'Brass')
    for i in range(6):
        angle=i*math.tau/6
        p.bar((.361,y,z+.081),(.361+.046*math.cos(angle),y+.046*math.sin(angle),z+.081),.013,'Vermilion')
    p.bar((.361,y,z+.069),(.361,y,z+.09),.029,'Vermilion',12)
    p.bar((.405,y,z),(.435,y,z+.05),.013,'Brass')
    p.bar((.435,y-.012,z+.077),(.435,y+.022,z+.077),.047,'Steel',20)
    p.bar((.435,y+.022,z+.077),(.435,y+.024,z+.077),.039,'Ivory',20)
    p.bar((.435,y+.026,z+.077),(.414,y+.026,z+.099),.003,'Vermilion')
    for i in range(9):
        a=math.radians(22+17*i)
        p.bar((.435+.029*math.cos(a),y+.027,z+.077+.029*math.sin(a)),
              (.435+.035*math.cos(a),y+.027,z+.077+.035*math.sin(a)),.0016,'Flock',5)
    line=[(.404,y,z),(.51,y-.02,z-.015),(.55,-.69,.34),(.28,-.38,.26),(.17,.49,.29)]
    for a,b in zip(line,line[1:]): p.bar(a,b,.011,'Steel')
    # Compact guarded arming switch on the centre stack.
    p.box(.127,.297,.64,.077,.027,.083,'Carbon')
    p.box(.127,.272,.677,.068,.044,.014,'Vermilion')
    p.bar((.127,.275,.64),(.127,.254,.655),.007,'Steel')
    return p


def build(path):
    mats=surfaces()
    objects=[exterior().finish('StageExterior',mats),cabin().finish('StageCabin',mats)]
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects: obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(Path(path)),use_selection=True,export_format='GLB',
                              export_animations=False,export_yup=True)
    # Preserve Blender's colour multipliers when the glTF exporter flattens a Multiply node.
    data=Path(path).read_bytes()
    length=struct.unpack_from('<I',data,12)[0]
    doc=json.loads(data[20:20+length])
    names={obj.name:name for obj,name in zip(objects,('StageExterior','StageCabin'))}
    for node in doc['nodes']:
        if node.get('name') in names: node['name']=names[node['name']]
    for material in doc['materials']:
        key=next(k for k,v in mats.items() if v.name==material['name'])
        material['name']='Rally_'+key
        rgba=list(mats[key].diffuse_color)
        material['pbrMetallicRoughness']['baseColorFactor']=rgba
    header=json.dumps(doc,separators=(',',':')).encode()
    header+=b' '*(-len(header)%4)
    tail=data[20+length:]
    Path(path).write_bytes(struct.pack('<4sII',b'glTF',2,20+len(header)+len(tail))+
                           struct.pack('<I4s',len(header),b'JSON')+header+tail)
    # Dock the authored components to the original imported game's chassis only after export.
    chassis=bpy.context.scene.objects.get('CarChassis')
    if chassis:
        for obj in objects: obj.parent=chassis
    return {o.name:len(o.data.polygons) for o in objects}
