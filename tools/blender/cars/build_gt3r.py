"""Build the 992 GT3 R interpretation from the game's GT scan and baked skin.

First run gt3r_textures.py with gt.glb and an output directory. Invoke Blender
in background mode with this script, then -- MAP_DIRECTORY EDITABLE_BLEND.
"""
import json
import math
import struct
import runpy
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

here = Path(__file__).resolve().parent
assets = here.parents[2] / 'src/assets/cars'
maps, blend = map(lambda p: Path(p).resolve(), sys.argv[sys.argv.index('--')+1:])
Panels = runpy.run_path(str(here/'build_rally_kit.py'))['Panels']
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(assets/'gt.glb'))
body = bpy.data.objects['body']
bs = body.data.materials[0].node_tree.nodes.get('Principled BSDF')
skin = bs.inputs['Base Color'].links[0].from_node
skin.image = bpy.data.images.load(str(maps/'race-skin.png'))
skin.image.alpha_mode = 'CHANNEL_PACKED'
bm = bmesh.new()
bm.from_mesh(body.data)
wing = [f for f in bm.faces if f.calc_center_median().y < -1.57 and f.calc_center_median().z > .919]
bmesh.ops.delete(bm, geom=wing, context='FACES')
for v in bm.verts:
    x,y,z = v.co
    axle, tip = (1.12,1.998) if y>=0 else (1.125,2.003)
    d = abs(y)
    v.co.y = math.copysign(min(d,axle)*1.2535/axle + max(0,d-axle)*(2.3095-1.2535)/(tip-axle), y)
    v.co.x *= 1.06 + .05 * math.exp(-((d-axle)/.58)**2)
bm.to_mesh(body.data)
bm.free()
body.data.update()
bpy.context.view_layer.update()

def material(name,color,metal,rough,base=None,normal=None,roughmap=None):
    mat = bpy.data.materials.new('GT3R_'+name)
    mat.diffuse_color = (*color,1)
    mat.use_nodes = True
    tree = mat.node_tree
    shader = tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color,1)
    shader.inputs['Metallic'].default_value = metal
    shader.inputs['Roughness'].default_value = rough
    for name, socket in [(base,'Base Color'),(roughmap,'Roughness'),(normal,'Normal')]:
        if not name:
            continue
        tex = tree.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(str(maps/name),check_existing=True)
        if socket != 'Base Color':
            tex.image.colorspace_settings.name = 'Non-Color'
        output = tex.outputs['Color']
        if socket == 'Normal':
            node = tree.nodes.new('ShaderNodeNormalMap')
            node.inputs['Strength'].default_value = .48
            tree.links.new(output,node.inputs['Color'])
            output = node.outputs['Normal']
        tree.links.new(output,shader.inputs[socket])
    return mat

mats = {
    'carbon':material('Carbon',(.04,.04,.04),.22,.37,'twill.png','twill-normal.png'),
    'led':material('LightGuide',(.82,.92,1),.22,.20),
    'glass':material('Glazing',(.15,.21,.23),.12,.10),
    'cage':material('Cage',(.63,.67,.68),.42,.44),
    'belt':material('Harness',(.52,.039,.022),0,.84),
    'lens':material('Lens',(.017,.032,.040),.32,.18),
    'void':material('Vent',(.009,.014,.016),.09,.72),
    'rim':material('Bronze',(.44,.24,.083),.77,.36),
    'disc':material('Iron',(.22,.235,.24),.82,.43),
    'hub':material('Centrelock',(.68,.6,.44),.85,.29),
    'tag':material('Number',(.9,.92,.88),.05,.41,'roundel.png'),
    'front':material('FrontSlick',(.04,.04,.04),0,.83,'slick-front.png','rubber-normal.png','slick-rough.png'),
    'rear':material('RearSlick',(.04,.04,.04),0,.83,'slick-rear.png','rubber-normal.png','slick-rough.png'),
}

# Separate the inset glass faces from the opaque surround. Retain a narrow painted
# gasket at the edges and front-face cull the panes seen from the driver camera.
glass=mats['glass']
glass.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value=.43
glass.use_backface_culling=True
body.data.materials.append(glass)
# Clip triangles to convex pane outlines; classifying whole triangles leaves
# jagged opaque islands along the pillars on the low-poly source scan.
source=body.data
source.calc_loop_triangles()
uv_in=source.uv_layers.active.data
verts,faces,uvs,normals,slots=[],[],[],[],[]
# Signed distances in final chassis space; a positive value is inside the pane.
panes=[
    [(0,-1,0,.724),(0,1,0,-.13),(1,0,0,.646),(-1,0,0,.646),(0,0,1,-.862)],
    [(0,1,0,1.53),(0,-1,0,-.78),(1,0,0,.608),(-1,0,0,.608),(0,0,1,-.88)],
]
for side in [-1,1]:
    common=[(side,0,0,-.619),(0,0,1,-.856),(-.36*side,0,-1,1.392),
            (0,-1,-1.60,1.83),(0,1,-1.90,2.79)]
    panes.extend([common+[(0,1,0,.237)], common+[(0,-1,0,-.335)]])
def distance(v,plane):
    x,y,z=v[0]
    a,b,c,d=plane
    return a*x+b*y+c*z+d
def split(poly,plane):
    inside,outside=[],[]
    for i,cur in enumerate(poly):
        prev=poly[i-1]
        dp,dc=distance(prev,plane),distance(cur,plane)
        if (dp>0)!=(dc>0):
            f=dp/(dp-dc)
            cross=tuple(a.lerp(b,f) for a,b in zip(prev,cur))
            inside.append(cross)
            outside.append(cross)
        (inside if dc>0 else outside).append(cur)
    return inside,outside
def emit(poly,slot):
    if len(poly)<3:
        return
    start=len(verts)
    faces.append(tuple(range(start,start+len(poly))))
    for co,uv,no in poly:
        verts.append(co); uvs.append(uv); normals.append(no.normalized())
    slots.append(slot)
for tri in source.loop_triangles:
    poly=[(source.vertices[source.loops[i].vertex_index].co.copy(),uv_in[i].uv.copy(),
           source.corner_normals[i].vector.copy()) for i in tri.loops]
    remaining=[poly]
    if max(v[0].z for v in poly)>.85:
        for planes in panes:
            scraps=[]
            for piece in remaining:
                if any(all(distance(v,plane)<=0 for v in piece) for plane in planes):
                    scraps.append(piece)
                    continue
                clipped=piece
                for plane in planes:
                    clipped,outside=split(clipped,plane)
                    if len(outside)>=3:
                        scraps.append(outside)
                    if len(clipped)<3:
                        break
                emit(clipped,1)
            remaining=scraps
    for piece in remaining:
        emit(piece,0)
shell=bpy.data.meshes.new('GT3 R skinned shell and windows')
shell.from_pydata(verts,[],faces)
for mat in source.materials:
    shell.materials.append(mat)
shell.polygons.foreach_set('material_index',slots)
shell.update()
shell.normals_split_custom_set_from_vertices(normals)
uv_out=shell.uv_layers.new(name='Body UV')
uv_out.data.foreach_set('uv',[value for uv in uvs for value in uv])
body.data=shell
bpy.context.view_layer.update()

def decal(name,point,material,nx,ny):
    verts = [point(i/nx,j/ny) for j in range(ny+1) for i in range(nx+1)]
    faces = []
    for j in range(ny):
        for i in range(nx):
            a = j*(nx+1)+i
            faces.append((a,a+1,a+nx+2,a+nx+1))
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(verts,[],faces)
    mesh.materials.append(material)
    uv=mesh.uv_layers.new()
    for loop in mesh.loops:
        j,i=divmod(loop.vertex_index,nx+1)
        uv.data[loop.index].uv=(i/nx,j/ny)
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent=body

def height(x,y):
    hit,p,_,_=body.ray_cast((x,y,2.3),(0,0,-1))
    if not hit:
        raise RuntimeError(f'No panel below {(x,y)}')
    return p.z

kit=Panels()
# Separate foil skins, swan-neck mounts, vertical endplates and diffuser strakes.
foil=[(-.21,.044),(-.19,.018),(.13,-.017),(.205,-.012),(.21,.002),(.11,.018),(-.155,.05)]
kit.loft([[(x,-1.99+dy,1.19+dz+.018*abs(x)) for dy,dz in foil] for x in [-.98,0,.98]],'carbon')
for side in [-1,1]:
    x=.42*side
    bracket=[(-1.78,.80),(-1.84,.80),(-2.01,1.17),(-2.02,1.238),(-1.91,1.239),(-1.87,1.205),(-1.94,1.205)]
    kit.loft([[(x+offset,y,z) for y,z in bracket] for offset in [-.012,.012]],'carbon')
    kit.box(.985*side,-1.99,1.208,.017,.47,.125,'carbon')
    kit.box(.93*side,-.05,.132,.09,1.56,.036,'carbon')
    for x in [.24,.52,.74]:
        kit.loft([[(side*x+off,y,z) for y,z in [(-2.25,.12),(-2.24,.22),(-1.71,.15),(-1.72,.10)]] for off in [-.008,.008]],'carbon')
    for level in range(2):
        kit.loft([[(side*x,y,z+dz+.07*level) for x,y,z in [(.81,2.10,.26),(.91,1.99,.28),(.98,1.72,.36),(.92,1.74,.34)]] for dz in [0,.012]],'carbon')
    # Oval pods with four light guides and a central projector on each front wing.
    # Fit the lens contour to the fender rather than attaching a flat sprite.
    cx,cy=side*.705,1.72
    def lenspoint(theta,scale,dz):
        x=cx+.145*math.cos(theta)*scale
        y=cy+.228*math.sin(theta)*scale
        return (x,y,height(x,y)+dz)
    lensrings=[[lenspoint(math.tau*i/40,r,dz) for i in range(40)] for r,dz in [(1,.010),(.95,.018),(.48,.025)]]
    kit.loft(lensrings,'lens')
    for sx in [-1,1]:
        for sy in [-1,1]:
            px,py=cx+.075*sx,cy+.097*sy
            lo,hi=px-.028,px+.028
            kit.bar((lo,py,height(lo,py)+.031),(hi,py,height(hi,py)+.031),.009,'led',10)
    for i in range(28):
        a,b=math.tau*i/28,math.tau*(i+1)/28
        kit.bar(lenspoint(a,.40,.033),lenspoint(b,.40,.033),.005,'disc',6)
    def door(u,v):
        y=side*(u-.5)*.56+.03
        z=.373+v*.363
        hit,p,_,_=body.ray_cast((side*2,y,z),(-side,0,0))
        if not hit:
            raise RuntimeError('Missing door surface')
        return (p.x+side*.004,y,z)
    decal('Door number '+str(side),door,mats['tag'],10,7)
    # Recessed black radiator exits and blade lips follow the curved bonnet.
    x=side*.255
    def scoop(u,v):
        sx=x+(u-.5)*(.23+.045*v)
        sy=1.02+.47*v
        return sx,sy,height(sx,sy)+.004
    decal('Radiator exit '+str(side),scoop,mats['void'],6,8)
    for y in [1.09,1.18,1.27,1.36,1.45]:
        ends=[(xx,y,height(xx,y)+.014) for xx in [x-.108,x+.108]]
        kit.bar(*ends,.012,'carbon')
outline=[(-.83,1.76),(-.95,1.82),(-.94,2.02),(-.77,2.19),(-.46,2.293),(0,2.32),(.46,2.293),(.77,2.19),(.94,2.02),(.95,1.82),(.83,1.76)]
kit.loft([[(x,y,z) for x,y in outline] for z in [.105,.132]],'carbon')
roof=height(0,-.18)
kit.loft([[(x,y,z) for x,z in [(-w,base),(w,base),(w*.79,top),(-w*.79,top)]] for y,w,base,top in [(-.75,.09,roof-.10,roof+.004),(-.42,.145,roof-.017,roof+.078),(-.17,.16,roof-.012,roof+.095)]],'carbon')
kit.box(0,-.166,roof+.047,.25,.014,.060,'void')
# Rounded trapezoidal radiator mouth with recessed horizontal grille slats.
def nose(x,z,offset):
    hit,p,_,_=body.ray_cast((x,3,z),(0,-1,0))
    if not hit:
        raise RuntimeError(f'Missing front bumper at {(x,z)}')
    return (x,p.y+offset,z)
for centre,halfwidth in [(0,.38),(-.64,.153),(.64,.153)]:
    rings=[]
    for scale,offset in [(1,.014),(.92,.019)]:
        ring=[]
        for i in range(36):
            a=math.tau*i/36
            dx=math.copysign(abs(math.cos(a))**.52,math.cos(a))
            dz=math.copysign(abs(math.sin(a))**.60,math.sin(a))
            ring.append(nose(centre+dx*halfwidth*scale*(1-.08*dz),.34+dz*.085*scale,offset))
        rings.append(ring)
    for i in range(36):
        j=(i+1)%36
        kit.face([rings[0][i],rings[0][j],rings[1][j],rings[1][i]],'carbon')
        kit.face([nose(centre,.34,.022),rings[1][i],rings[1][j]],'void')
    for z in [.300,.328,.356,.384]:
        points=[nose(centre+halfwidth*.84*k/6,z,.029) for k in range(-6,7)]
        for a,b in zip(points,points[1:]):
            kit.bar(a,b,.005,'carbon',6)

kit.finish('Endurance aero',mats).parent=body

# Low-cost exterior driver cell visible through the polycarbonate windows.
# The cockpit camera swaps this for the live display, driver and steering rig.
cell=Panels()
cell.box(0,-.04,.29,1.53,1.6,.055,'void')
cell.box(0,.51,.809,1.49,.35,.135,'carbon',.035)
cell.box(0,-.85,.65,1.39,.16,.58,'void',.045)
for side in [-1,1]:
    nodes=[(side*.64,.65,.49),(side*.64,.62,.80),(side*.54,.14,1.16),(side*.54,-.54,1.16),(side*.64,-.63,.31)]
    for a,b in zip(nodes,nodes[1:]):
        cell.bar(a,b,.023,'cage')
    cell.bar((side*.64,.53,.44),(side*.62,-.58,.76),.021,'cage')
for y in [-.54,.14]:
    cell.bar((-.54,y,1.16),(.54,y,1.16),.022,'cage')
cell.bar((-.54,-.54,1.16),(.61,-.61,.41),.022,'cage')
cell.box(-.335,-.19,.38,.43,.46,.10,'void',.038)
cell.box(-.335,-.40,.69,.43,.13,.60,'carbon',.044)
cell.box(-.335,-.44,.985,.33,.14,.20,'void',.055)
for side in [-1,1]:
    cell.box(-.335+side*.14,-.375,.98,.068,.16,.14,'void',.020)
    cell.box(-.335+side*.075,-.319,.72,.043,.01,.44,'belt')
    cell.box(-.335+side*.212,-.24,.66,.054,.16,.33,'void',.021)
cell.box(-.335,.275,.91,.26,.036,.12,'void')
cell.box(-.335,.13,.77,.248,.033,.11,'carbon',.02)
for side in [-1,1]:
    cell.bar((-.335+side*.143,.13,.70),(-.335+side*.156,.15,.843),.016,'void')
cell.finish('GT3R_ExteriorCabin',mats)

def wheel(name,side,front):
    bpy.data.objects.remove(bpy.data.objects[name],do_unlink=True)
    radius,width,track=(.340,.30,.86) if front else (.355,.31,.87)
    # Cross-section from the outer bead across the crown to the inboard bead.
    profile=[(.46,.228),(.51,.265),(.5,radius-.027),(.45,radius-.009),(.36,radius-.001),
             (.17,radius),(-.17,radius),(-.36,radius-.001),(-.45,radius-.009),
             (-.5,radius-.027),(-.51,.265),(-.46,.228)]
    tyre=Panels()
    count=64
    def pt(j,i):
        x,r=profile[j]
        a=side*math.tau*i/count
        return (side*x*width,r*math.cos(a),r*math.sin(a))
    for j in range(len(profile)-1):
        for i in range(count):
            tyre.face([pt(j,i),pt(j+1,i),pt(j+1,i+1),pt(j,i+1)],'front' if front else 'rear')
    root=tyre.finish(name,mats)
    for f in root.data.polygons:
        j,i=divmod(f.index,count)
        f.use_smooth=True
        uv=root.data.uv_layers.active
        for l,(di,dj) in zip(f.loop_indices,[(0,0),(0,1),(1,1),(1,0)]):
            uv.data[l].uv=((i+di)/count,1-(j+dj)/(len(profile)-1))
    root.location=(side*track,1.2535 if front else -1.2535,radius)
    alloy=Panels()
    def ring(x,r,a):
        return (side*x,r*math.cos(a),r*math.sin(a))
    for i in range(48):
        a,b=[math.tau*k/48 for k in [i,i+1]]
        for xi,ri,xj,rj in [(.144,.235,.146,.217),(.146,.217,.047,.204)]:
            alloy.face([ring(xi,ri,a),ring(xi,ri,b),ring(xj,rj,b),ring(xj,rj,a)],'rim')
    alloy.lathe((side*.045,0,0),(side*.067,0,0),[(0,.186),(1,.186)],'disc',48)
    for i in range(10):
        a=math.tau*i/10
        for branch in [-1,1]:
            corners=[(.043,a-.12),(.113,a-.066),(.216,a+branch*.11-.029),
                     (.219,a+branch*.11+.035),(.112,a+.065),(.044,a+.12)]
            alloy.loft([[ring(x-.038*(1-r/.219),r,theta) for r,theta in corners] for x in [.119,.143]],'rim')
        for j in range(3):
            a0=a+j*.060
            c=ring(.068,.15+j*.010,a0)
            alloy.bar(c,(c[0]+side*.001,c[1],c[2]),.004,'void',6)
    alloy.lathe((side*.097,0,0),(side*.146,0,0),[(0,.054),(.68,.054),(1,.046)],'rim',24)
    alloy.bar((side*.142,0,0),(side*.156,0,0),.032,'hub',6)
    alloy.finish(name+'_centrelock',mats).parent=root

for front,label in [(True,'F'),(False,'R')]:
    for side,end in [(-1,'L'),(1,'R')]:
        wheel('wheel_'+label+end,side,front)
bpy.ops.file.pack_all()
bpy.context.preferences.filepaths.save_version=0
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active
            space.shading.color_type='TEXTURE'
            space.region_3d.view_distance=5.5
            space.region_3d.view_location=(0,0,.55)
            space.region_3d.view_rotation=Vector((3.6,4.5,1.7)).to_track_quat('Z','Y')
# Alpha is reserved for the game's garage paint mask. Link during glTF export to retain the channel.
tree=body.data.materials[0].node_tree
tree.links.new(skin.outputs['Alpha'],bs.inputs['Alpha'])
bpy.ops.export_scene.gltf(filepath=str(assets/'gt3r.glb'),export_format='GLB',export_image_format='AUTO')

# Store the packed alpha as data. Generic glTF viewers should draw the shell opaque.
asset=assets/'gt3r.glb'
raw=asset.read_bytes()
length=struct.unpack_from('<I',raw,12)[0]
doc=json.loads(raw[20:20+length])
body_material=next(m for m in doc['materials'] if m['name']=='GT_Body')
body_material.pop('alphaMode',None)
js=json.dumps(doc,separators=(',',':')).encode()
js+=b' '*(-len(js)%4)
binary=raw[20+length:]
asset.write_bytes(struct.pack('<4sIII4s',b'glTF',2,20+len(js)+len(binary),len(js),b'JSON')+js+binary)

# The optional cockpit snapshot comes from the animated Three.js driver rig.
# Keep it in its own collection for editing while the game uses the smaller cabin
# mesh for garage, chase and remote-player views.
tree.links.remove(bs.inputs['Alpha'].links[0])
cockpit_file=maps/'driver-cell.glb'
if cockpit_file.is_file():
    before=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(cockpit_file))
    collection=bpy.data.collections.new('Driver cockpit - full detail')
    bpy.context.scene.collection.children.link(collection)
    for obj in set(bpy.data.objects)-before:
        for old in list(obj.users_collection):
            old.objects.unlink(obj)
        collection.objects.link(obj)
    collection.hide_viewport=True
    collection.hide_render=True
bpy.ops.object.select_all(action='DESELECT')
bpy.context.scene.name='911 GT3 R - Endurance 92'
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
