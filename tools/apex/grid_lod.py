"""Build Apex's fictional GT coupe from authored cross-sections, in metres."""
import math
from pathlib import Path
import bpy
import bmesh

root = Path(__file__).resolve().parents[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
vertices, faces, finishes = [], [], []
materials = []
def material(name, rgb, metallic, roughness, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    shader = m.node_tree.nodes.get('Principled BSDF')
    for key, value in [('Base Color', (*rgb, 1)), ('Roughness', roughness), ('Metallic', metallic),
                       ('Emission Color', (*rgb, 1)), ('Emission Strength', emission)]:
        shader.inputs[key].default_value = value
    if name in ('Team enamel','Glazing'):shader.inputs['Coat Weight'].default_value=.45
    materials.append(m)
    return len(materials) - 1
paint=material('Team enamel',(.49,.53,.55),.5,.33)
carbon=material('Rubber and carbon',(.018,.022,.025),.12,.73)
glass=material('Glazing',(.078,.126,.143),.48,.12)
alloy=material('Alloy',(.40,.34,.24),.8,.30)
lamp=material('Headlamp',(.83,.90,.94),.28,.20,.18)
tail=material('Tail lamp',(.92,.025,.012),.12,.25,.65)
def face(points, finish):
    start=len(vertices)
    vertices.extend(points)
    faces.append(tuple(range(start,start+len(points))))
    finishes.append(finish)
def box(x,y,z,w,l,h,finish):
    v=[(x+a*w/2,y+b*l/2,z+c*h/2) for c in (-1,1) for b in (-1,1) for a in (-1,1)]
    for seq in [(0,2,3,1),(4,5,7,6),(0,1,5,4),(1,3,7,5),(3,2,6,7),(2,0,4,6)]:
        face([v[i] for i in seq],finish)
# Sections across the rear haunch, wheel arches, cabin, bonnet and front splitter.
stations=[(-2.22,.89,.64,.26),(-2.08,1.00,.77,.22),(-1.76,1.01,.77,.18),
 (-1.59,1.03,.79,.55),(-1.40,1.04,.80,.70),(-1.22,1.03,.78,.68),(-1.02,1.01,.74,.49),
 (-.89,.99,.71,.17),(-.39,.97,.72,.15),(.36,.98,.71,.15),(.87,1.00,.70,.16),
 (1.04,1.02,.72,.50),(1.24,1.04,.76,.69),(1.42,1.04,.76,.70),(1.63,1.03,.72,.53),
 (1.80,1.01,.66,.19),(2.08,.98,.51,.19),(2.24,.88,.42,.19)]
def section(y,w,h,b):
    return [(-w*.91,y,b),(-w,y,b+.04),(-w,y,h-.09),(-w*.89,y,h),
            (-w*.49,y,h-.025),(0,y,h-.045),(w*.49,y,h-.025),(w*.89,y,h),(w,y,h-.09),(w,y,b+.04),(w*.91,y,b)]
rings=[section(*s) for s in stations]
for a,b in zip(rings,rings[1:]):
    for j in range(len(a)):
        k=(j+1)%len(a); face([a[j],a[k],b[k],b[j]],carbon if j in (0,9,10) else paint)
face(rings[0],paint);face(rings[-1][::-1],carbon)
# Pillars and glass follow their own roof profile, enclosed above the belt line.
cab=[(-1.36,.73,.76,.78),(-.63,.64,.72,1.13),(-.42,.61,.71,1.20),
     (.28,.61,.70,1.19),(.48,.63,.69,1.14),(1.06,.77,.69,.72)]
for idx,(a,b) in enumerate(zip(cab,cab[1:])):
    def top(s,sign): return (sign*s[1],s[0],s[3])
    for sign in (-1,1):
        face([(sign*.84,a[0],a[2]),top(a,sign),top(b,sign),(sign*.84,b[0],b[2])],paint if idx in (0,4) else glass)
        for s in [a]:
            y,w,base,roof=s
            face([(sign*.848,y,base),(sign*w,y,roof),(sign*w,y+.034,roof),(sign*.848,y+.034,base)],carbon)
    face([top(a,-1),top(a,1),top(b,1),top(b,-1)],glass if idx in (0,4) else paint)
for side in (-1,1):
    box(side*.994,-.01,.15,.12,1.88,.085,carbon)
    box(side*.91,.44,.80,.24,.052,.052,carbon);box(side*1.07,.46,.84,.18,.20,.10,paint)
    # Recessed swept lamp pocket and two rising light guides flush with the bonnet.
    face([(side*.59,2.15,.474),(side*.92,2.00,.557),(side*.953,1.84,.643),(side*.71,1.96,.586)],carbon)
    face([(side*.62,2.13,.490),(side*.906,2.004,.56),(side*.923,1.965,.58),(side*.65,2.09,.513)],lamp)
    face([(side*.75,2.022,.552),(side*.898,1.944,.598),(side*.905,1.909,.615),(side*.77,1.989,.569)],lamp)
    box(side*.77,-2.185,.636,.40,.072,.041,tail)
    for offset in range(4):
        box(side*(.68+.075*offset),2.22,.337,.034,.055,.112,carbon)
    face([(side*.90,2.22,.234),(side*1.01,2.03,.28),(side*1.055,1.95,.34),(side*.946,2.19,.286)],carbon)
    for j in range(4):box(side*.52,1.54+j*.072,.71-j*.023,.32,.037,.026,carbon)
    box(side*.58,-1.92,.87,.09,.18,.44,carbon);box(side*1.00,-1.97,1.085,.039,.42,.18,carbon)
box(0,-1.96,1.10,2.02,.36,.062,carbon)
box(0,2.12,.153,1.99,.37,.064,carbon);box(0,-2.08,.19,1.97,.32,.073,carbon)
for i in range(-3,4):box(i*.22,-2.135,.22,.026,.32,.13,carbon)
face([(-.61,2.265,.225),(.61,2.265,.225),(.53,2.265,.365),(-.53,2.265,.365)],carbon)
for y in (.265,.307,.347):box(0,2.267,y,1.02,.009,.006,alloy)
# Factory racing stripe along the bonnet, following the original panel crown.
for a,b in zip(stations[10:],stations[11:]):
    if a[0]<1.04:continue
    for x,w in [(.27,.11),(.422,.027)]:
        face([(x,a[0],a[2]-.022),(x+w,a[0],a[2]-.018),(x+w,b[0],b[2]-.018),(x,b[0],b[2]-.022)],alloy)
# Tyre shoulder rings, recessed rim, brake disc and paired swept spokes.
for y in (-1.32,1.34):
    for side in (-1,1):
        n=20; centre=.347
        def pt(x,r,a):return (side*x,y+r*math.cos(a),centre+r*math.sin(a))
        for i in range(n):
            angle=i*math.tau/n; end=(i+1)*math.tau/n
            rings=[(.77,.30),(.80,.346),(.985,.346),(1.008,.302),(1.008,.226),(.977,.204)]
            for (x,r),(xx,rr) in zip(rings,rings[1:]):
                face([pt(x,r,angle),pt(x,r,end),pt(xx,rr,end),pt(xx,rr,angle)],carbon if r>.226 else alloy)
            face([pt(.978,0,angle),pt(.978,.203,angle),pt(.978,.203,end)],carbon)
        for i in range(10):
            a=i*math.tau/10
            face([pt(1.012,.047,a-.27),pt(1.012,.207,a-.06),pt(1.012,.211,a+.065),pt(1.012,.050,a+.26)],alloy)
        box(side*1.01,y,centre,.036,.108,.108,alloy)
mesh=bpy.data.meshes.new('APEX GT coupe');mesh.from_pydata(vertices,[],faces);mesh.update()
for m in materials:mesh.materials.append(m)
for poly,idx in zip(mesh.polygons,finishes):poly.material_index=idx
bm=bmesh.new();bm.from_mesh(mesh)
bmesh.ops.remove_doubles(bm,verts=bm.verts,dist=.0001)
bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
bm.to_mesh(mesh);bm.free()
car=bpy.data.objects.new('APEX GT coupe',mesh);bpy.context.collection.objects.link(car)
car.select_set(True);bpy.context.view_layer.objects.active=car
bpy.ops.export_scene.gltf(filepath=str(root/'src/assets/maps/apex-grid-distant.glb'),export_format='GLB',use_selection=True,export_yup=True)
bevel=car.modifiers.new('Edge catches','BEVEL');bevel.width=.011;bevel.segments=2;bevel.limit_method='ANGLE';bevel.angle_limit=.68
bpy.ops.object.modifier_apply(modifier=bevel.name)
for poly in mesh.polygons:
    if poly.material_index in (paint,glass):poly.use_smooth=True
normal=car.modifiers.new('Panel normals','WEIGHTED_NORMAL');normal.keep_sharp=True
bpy.ops.object.modifier_apply(modifier=normal.name)
bpy.ops.export_scene.gltf(filepath=str(root/'src/assets/maps/apex-grid-gt.glb'),export_format='GLB',use_selection=True,export_yup=True)
print('Grid GT triangles',sum(len(p.vertices)-2 for p in mesh.polygons))

