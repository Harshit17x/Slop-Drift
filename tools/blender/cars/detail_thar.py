"""Rebuild Thar ROXX trim and cabin on an imported, rigged thar.glb in Blender.

Call build(output_path) in the scene containing body and the four named wheel pivots.
Only the two generated meshes are replaced on subsequent runs.
"""
import math
from pathlib import Path

import bpy
from mathutils import Vector


class Parts:
    """Build connected cross sections and keep one mesh per visibility group."""

    def __init__(self):
        self.vertices = []
        self.faces = []
        self.face_materials = []
        self.materials = []

    def loft(self, sections, material):
        if material not in self.materials:
            self.materials.append(material)
        start = len(self.vertices)
        n = len(sections[0])
        for ring in sections:
            self.vertices.extend(ring)
        faces = [tuple(range(n - 1, -1, -1))]
        for i in range(len(sections) - 1):
            for j in range(n):
                k = (j + 1) % n
                faces.append((i*n+j, i*n+k, (i+1)*n+k, (i+1)*n+j))
        end = (len(sections) - 1) * n
        faces.append(tuple(range(end, end+n)))
        self.faces.extend(tuple(start + v for v in f) for f in faces)
        self.face_materials.extend([self.materials.index(material)] * len(faces))

    def pad(self, center, dims, material, radius=0.012, rake=0):
        # Chamfered horizontal section, with a smaller bevel around top and bottom.
        x, y, z = center
        w, d, h = (v / 2 for v in dims)
        r = min(radius, w * 0.6, d * 0.6)
        bevel = min(r * 0.45, h * 0.4)
        rings = []
        for dz, inset in [(-h, bevel), (-h + bevel, 0), (h - bevel, 0), (h, bevel)]:
            a, b = w - inset, d - inset
            corners = [(-a+r,-b),(a-r,-b),(a,-b+r),(a,b-r),
                       (a-r,b),(-a+r,b),(-a,b-r),(-a,-b+r)]
            rings.append([(x+dx, y+dy+rake*dz, z+dz) for dx,dy in corners])
        self.loft(rings, material)

    def rod(self, start, end, radius, material, sides=8):
        a, b = Vector(start), Vector(end)
        axis = (b-a).normalized()
        u = axis.orthogonal().normalized()
        v = axis.cross(u)
        directions = [radius * (u*math.cos(i*math.tau/sides) + v*math.sin(i*math.tau/sides)) for i in range(sides)]
        self.loft([[tuple(center + offset) for offset in directions] for center in [a,b]], material)

    def finish(self, name, parent=None):
        old = bpy.data.objects.get(name)
        if old:
            if not old.get('thar_generated'):
                raise ValueError(f'Unexpected object named {name}')
            bpy.data.objects.remove(old, do_unlink=True)
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.vertices, [], self.faces)
        for material in self.materials:
            mesh.materials.append(bpy.data.materials[material])
        mesh.polygons.foreach_set('material_index', self.face_materials)
        # Match the shell's vertex-colour format so trim and body share paint and lamp materials.
        color = mesh.color_attributes.new(name='Color', type='BYTE_COLOR', domain='CORNER')
        color.data.foreach_set('color', [1.0] * (len(color.data) * 4))
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.data.objects['body'].users_collection[0].objects.link(obj)
        obj.parent = parent
        obj['thar_generated'] = True
        return obj


def exterior():
    p = Parts()
    steel, dark, silver = 'Thar_Trim_Steel', 'Thar_Cladding', 'Thar_Step_Silver'
    # Folded front bash plate. The middle row is interrupted by four drainage slots.
    bands = [(-0.59,-0.43),(-0.31,-0.22),(-0.08,0.08),(0.22,0.31),(0.43,0.59)]
    for z0,z1,y0,y1,spans in [
        (0.30,0.36,1.94,2.04,[(-0.56,0.56)]),
        (0.36,0.43,2.04,2.117,bands),
        (0.43,0.48,2.117,2.132,[(-0.59,0.59)])]:
        for left,right in spans:
            p.loft([[(left,y-0.013,z),(right,y-0.013,z),(right,y,z),(left,y,z)]
                    for y,z in [(y0,z0),(y1,z1)]],silver)
    # Recess six radiator openings behind body-coloured uprights and a split waist.
    p.pad((0,1.945,0.979),(0.718,0.020,0.244),dark)
    for z in [0.862,1.096]:
        p.pad((0,1.958,z),(0.741,0.032,0.024),'Thar_Paint')
    for i in range(-3,4):
        p.pad((i*0.117,1.963,0.979),(0.023,0.025,0.22),'Thar_Paint',0.006)
    p.pad((0,1.963,0.965),(0.713,0.025,0.016),'Thar_Paint')
    for i in range(6):
        x = (i-2.5)*0.117
        for z in [0.90,0.926,0.997,1.024,1.051]:
            p.pad((x,1.956,z),(0.092,0.01,0.007),steel,0.002)
    for side in [-1,1]:
        for x in [0.52,0.18]:
            p.rod((side*x,2.12,0.45),(side*x,2.14,0.45),0.014,steel,6)
        # Extended running boards, ribbed rubber tread and a bright folded outer edge.
        p.pad((side*0.915,-0.13,0.345),(0.15,1.93,0.065),dark,0.06)
        p.pad((side*0.982,-0.13,0.349),(0.024,1.79,0.034),silver)
        for i in range(14):
            p.pad((side*0.929,-0.91+i*0.12,0.382),(0.10,0.033,0.013),steel)
        # Raised longitudinal rails follow the hardtop and return into cast feet.
        for y in [-1.77,-0.08]:
            p.pad((side*0.65,y,1.918),(0.10,0.19,0.076),dark,0.035)
        rail = [(side*0.65,-1.83,1.93),(side*0.65,-1.68,1.982),
                (side*0.65,-0.17,1.982),(side*0.65,-0.025,1.93)]
        for a,b in zip(rail,rail[1:]):
            p.rod(a,b,0.021,steel,10)
        # Horseshoe running light and central projector blade on the upright nose.
        x, y, z = side*0.49, 1.941, 0.997
        arc = [(x+side*0.093*math.cos(math.radians(t)), y, z+0.093*math.sin(math.radians(t)))
               for t in range(-150,151,12)]
        for a,b in zip(arc,arc[1:]):
            p.rod(a,b,0.007,'Thar_Headlamp_DRL',6)
        p.rod((x-0.062,y,z),(x+0.062,y,z),0.006,'Thar_Chrome')
        # Wrap a slim red signature around the outer edge of each tail lamp.
        tail = [(0.74,1.096),(0.823,1.096),(0.846,1.074),(0.846,0.927),
                (0.823,0.907),(0.74,0.907)]
        for (x1,z1),(x2,z2) in zip(tail,tail[1:]):
            p.rod((side*x1,-2.182,z1),(side*x2,-2.182,z2),0.009,'Thar_Tail_Lamp')
    return p


def cabin():
    p = Parts()
    ivory, black, satin = 'Thar_Cabin_Ivory','Thar_Cladding','Thar_Step_Silver'
    # These seats are visible through the exterior glass, including in the garage.
    for x,y in [(-0.41,-0.35),(0.41,-0.35),(-0.42,-1.19),(0,-1.19),(0.42,-1.19)]:
        w = 0.49 if y > -1 else 0.41
        p.pad((x,y,0.79),(w,0.47,0.15),ivory,0.066)
        p.pad((x,y-0.19,1.10),(w,0.145,0.55),ivory,0.052,-0.16)
        for side in [-1,1]:
            p.pad((x+side*(w/2-0.033),y-0.125,1.09),(0.064,0.09,0.44),ivory,0.027,-0.16)
            p.rod((x+side*0.064,y-0.24,1.35),(x+side*0.064,y-0.24,1.425),0.009,satin)
        p.pad((x,y-0.24,1.48),(0.255,0.115,0.155),ivory,0.042)
    p.pad((0,0.52,1.238),(1.58,0.32,0.145),black,0.065)
    p.pad((0,0.37,1.22),(1.54,0.056,0.11),ivory,0.02)
    for x in [0,0.414]:
        p.pad((x,0.305,1.333),(0.31,0.038,0.145),black,0.018)
    # Match the instrument panel, ventilation and grab rail in the interactive cockpit.
    for x,z in [(-0.76,1.25),(-0.078,1.18),(0.078,1.18),(0.76,1.25)]:
        p.rod((x,0.327,z),(x,0.313,z),0.049,satin,20)
        p.rod((x,0.313,z),(x,0.308,z),0.042,black,20)
        for offset in [-0.018,0,0.018]:
            p.rod((x-0.032,0.304,z+offset),(x+0.032,0.304,z+offset),0.003,satin,6)
    for x in [-0.60,-0.23]:
        p.rod((x,0.36,1.22),(x,0.285,1.218),0.018,satin)
    p.rod((-0.61,0.285,1.218),(-0.22,0.285,1.218),0.024,black)
    p.pad((0,-0.11,0.848),(0.23,0.58,0.19),black,0.045)
    p.pad((0,-0.24,0.962),(0.20,0.24,0.07),ivory,0.027)
    p.rod((0.042,0.047,0.91),(0.042,0.015,1.06),0.013,satin)
    p.pad((0.042,0.015,1.06),(0.052,0.069,0.047),black,0.015)
    for side in [-1,1]:
        for y in [-0.25,-1.1]:
            p.pad((side*0.791,y,1.112),(0.054,0.71,0.18),ivory,0.021)
            p.pad((side*0.758,y,1.074),(0.089,0.34,0.055),black,0.021)
            p.rod((side*0.751,y+0.13,1.18),(side*0.751,y+0.23,1.18),0.012,satin)
    x,y,z = 0.414,0.125,1.20
    ring = [(x+0.18*math.cos(i*math.tau/28), y+0.055*math.sin(i*math.tau/28),
             z+0.17*math.sin(i*math.tau/28)) for i in range(28)]
    for i in range(len(ring)):
        p.rod(ring[i-1],ring[i],0.017,black)
    p.pad((x,y,z),(0.155,0.07,0.093),black,0.03)
    for i in [0,14,21]:
        p.rod((x,y,z),ring[i],0.014,satin)
    return p


def build(output):
    body = bpy.data.objects['body']
    mat = bpy.data.materials.get('Thar_Cabin_Ivory') or bpy.data.materials.new('Thar_Cabin_Ivory')
    mat.diffuse_color = (0.72,0.65,0.53,1)
    mat.roughness = 0.72
    trim = exterior().finish('ROXX_trim', body)
    interior = cabin().finish('ROXX_cabin')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [body,trim,interior]+[bpy.data.objects['wheel_'+s] for s in ('FL','FR','RL','RR')]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.export_scene.gltf(filepath=str(Path(output).resolve()), use_selection=True,
        export_yup=True, export_extras=True, export_animations=False, export_cameras=False, export_lights=False,
        export_vertex_color='NAME', export_vertex_color_name='Color')
    return {'trim_faces':len(trim.data.polygons),'cabin_faces':len(interior.data.polygons)}
