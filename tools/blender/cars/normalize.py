"""
Step 1 of the car pipeline: import the source GLBs from <repo>/cars into a "Cars" scene, join each
car into one mesh, and put it in the game's frame: metres, front toward Blender +Y (the game's -Z
after glTF export), centred left/right, centred between the axles, wheels on z = 0.
Run inside Blender (BlenderMCP execute_code, or Text editor > Run).
"""
import bpy, mathutils, math

REPO = '/Users/harshitbisht/Desktop/Slop-drift/Slop-Drift/'
CARS = {
    # yaw turns the source front to +Y; scale gives a wheelbase close to the real car's.
    'gt': {'file': 'cars/3d-porsche-911-gt3-rs-sports-car.glb', 'yaw': 180, 'scale': 2.1},
    'thar': {'file': 'cars/mahindra_-_thar_roxx.glb', 'yaw': -90, 'scale': 0.0254},
}

sc = bpy.data.scenes.get('Cars') or bpy.data.scenes.new('Cars')
bpy.context.window.scene = sc
for o in list(sc.objects):
    bpy.data.objects.remove(o)

for key, car in CARS.items():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=REPO + car['file'])
    new = [o for o in bpy.data.objects if o not in before]
    col = bpy.data.collections.get(key) or bpy.data.collections.new(key)
    if col.name not in [c.name for c in sc.collection.children]:
        sc.collection.children.link(col)
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        col.objects.link(o)
    col.hide_render = False
    meshes = [o for o in new if o.type == 'MESH' and len(o.data.polygons)]
    # Bake parent transforms (Sketchfab files carry their Z-up turn on an empty) before deleting the empties.
    world = {o: o.matrix_world.copy() for o in meshes}
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.parent = None
        o.data = o.data.copy()
        o.data.transform(world[o])
        o.matrix_world = mathutils.Matrix.Identity(4)
        o.select_set(True)
    for o in new:
        if o not in meshes:
            bpy.data.objects.remove(o)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = f'{key}_body'
    m = mathutils.Matrix.Rotation(math.radians(car['yaw']), 4, 'Z') @ mathutils.Matrix.Scale(car['scale'], 4)
    body.data.transform(m)
    vs = [v.co for v in body.data.vertices]
    zmin = min(v.z for v in vs)
    h = max(v.z for v in vs) - zmin
    low = [v for v in vs if v.z < zmin + 0.03 * h]
    cx = (min(v.x for v in vs) + max(v.x for v in vs)) / 2
    cy = (min(v.y for v in low) + max(v.y for v in low)) / 2  # between the axles
    body.data.transform(mathutils.Matrix.Translation((-cx, -cy, -zmin)))
    body.data.update()
print('normalized')
