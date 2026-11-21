"""
Export the Mussoorie map from Blender to the game (see build_map.py for the scene layout).

Writes to <repo>/src/assets/maps/mussoorie/:
  map.json     roads, plaza, water, prop records, placements and labels (game coordinates)
  terrain.bin  641 x 641 heights, uint16 little-endian, quantised between map.json grid.min/max
  props.glb    one node per prototype building, each at its own origin

Game coordinates: x = Blender X, y = Blender Z, z = -Blender Y. Yaw carries over unchanged.
Set OUT_DIR below (or bpy.context.scene["msr_out_dir"]) if the repo lives elsewhere.
"""

import json
import math
import os
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import interpolate_bezier

OUT_DIR = bpy.context.scene.get("msr_out_dir") or "/Users/harshitbisht/Desktop/Slop-drift/Slop-Drift/src/assets/maps/mussoorie"
SIZE = 641
CELL = 4.0
HALF = (SIZE - 1) * CELL / 2
ALTITUDE = {"scale": 1 / 0.55, "offset": 1650}  # displayed metres = y * scale + offset


def terrain_heights():
    obj = bpy.data.objects["Terrain"]
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    matrix = obj.matrix_world
    count = len(mesh.vertices)
    identity = all(abs(matrix[i][j] - (1 if i == j else 0)) < 1e-6 for i in range(4) for j in range(4))
    if count == SIZE * SIZE and identity:
        co = np.empty(count * 3, dtype=np.float32)
        mesh.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        expected_x = np.tile(np.arange(SIZE) * CELL - HALF, SIZE)
        if np.abs(co[:, 0] - expected_x).max() < 1e-2:
            evaluated.to_mesh_clear()
            return co[:, 2].reshape(SIZE, SIZE)
    # Sculpted or re-topologised: ray-cast straight down at every grid node.
    bvh = BVHTree.FromObject(evaluated, depsgraph)
    inverse = matrix.inverted()
    heights = np.zeros((SIZE, SIZE), dtype=np.float32)
    down = (inverse.to_3x3() @ Vector((0, 0, -1))).normalized()
    last = 0.0
    for iy in range(SIZE):
        y = iy * CELL - HALF
        for ix in range(SIZE):
            x = ix * CELL - HALF
            origin = inverse @ Vector((x, y, 5000))
            hit = bvh.ray_cast(origin, down)
            if hit[0] is not None:
                last = (matrix @ hit[0]).z
            heights[iy, ix] = last
    evaluated.to_mesh_clear()
    return heights


def curve_points(obj):
    matrix = obj.matrix_world
    spline = obj.data.splines[0]
    closed = bool(spline.use_cyclic_u)
    pts = []
    if spline.type == "BEZIER":
        bp = spline.bezier_points
        n = len(bp)
        for i in range(n if closed else n - 1):
            a, b = bp[i], bp[(i + 1) % n]
            seg = interpolate_bezier(a.co, a.handle_right, b.handle_left, b.co, 12)
            pts.extend(seg[:-1])
        if not closed:
            pts.append(bp[-1].co)
    else:
        pts = [Vector(p.co[:3]) for p in spline.points]
    world = [matrix @ Vector(p) for p in pts]
    return [(p.x, -p.y, p.z - 0.3) for p in world], closed


def r2(v):
    return round(float(v), 2)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    scene = bpy.context.scene

    heights = terrain_heights()
    lo = float(heights.min()) - 1.0
    hi = float(heights.max()) + 1.0
    # Blender rows run south to north (+Y); the game grid rows run north to south (+Z), so flip.
    game = heights[::-1, :]
    quantised = np.round((game - lo) / (hi - lo) * 65535).astype("<u2")
    with open(os.path.join(OUT_DIR, "terrain.bin"), "wb") as f:
        f.write(quantised.tobytes())

    roads = []
    for name, obj_name in (("loop", "Road_Loop"), ("spur", "Road_Spur"), ("peak", "Road_Peak")):
        obj = bpy.data.objects.get(obj_name)
        if obj is None:
            continue
        pts, closed = curve_points(obj)
        roads.append({
            "name": name,
            "closed": closed,
            "points": [r2(c) for p in pts for c in (p[0], p[1])],
            "heights": [r2(p[2]) for p in pts],
        })

    props = []
    for obj in bpy.data.collections["MSR_Props"].objects:
        props.append({"name": obj.name, "size": [r2(v) for v in obj.get("msr_size", [8, 8])]})

    placements = []
    for obj in bpy.data.collections["MSR_Placements"].objects:
        prop = obj.get("msr_prop") or obj.data.name
        proto = bpy.data.objects.get(prop)
        w, d = proto["msr_size"] if proto and "msr_size" in proto else (8.0, 8.0)
        record = {
            "prop": prop,
            "x": r2(obj.location.x),
            "z": r2(-obj.location.y),
            "yaw": round(obj.rotation_euler.z, 4),
            "scale": r2(obj.scale.x),
            "w": r2(w * obj.scale.x),
            "d": r2(d * obj.scale.y),
        }
        if obj.get("msr_label"):
            record["label"] = obj["msr_label"]
        placements.append(record)

    labels = [
        {"name": obj["msr_label"], "x": r2(obj.location.x), "z": r2(-obj.location.y)}
        for obj in bpy.data.collections["MSR_Labels"].objects
        if obj.get("msr_label")
    ]

    plaza = scene.get("msr_plaza", [1000, 182, 22])
    plazas = [{"id": "laltibba", "road": "spur", "label": "Lal Tibba", "x": r2(plaza[0]), "z": r2(-plaza[1]), "radius": r2(plaza[2])}]
    peak = scene.get("msr_peak_plaza")
    if peak and any(r["name"] == "peak" for r in roads):
        plazas.append({"id": "nagtibba", "road": "peak", "label": "Nag Tibba", "x": r2(peak[0]), "z": r2(-peak[1]), "radius": r2(peak[2])})
    data = {
        "version": 2,
        "name": "Mussoorie",
        "grid": {"size": SIZE, "cell": CELL, "min": lo, "max": hi, "file": "terrain.bin"},
        "waterLevel": float(scene.get("msr_water_level", 30.0)),
        "altitude": ALTITUDE,
        "plaza": {"x": r2(plaza[0]), "z": r2(-plaza[1]), "radius": r2(plaza[2])},
        "plazas": plazas,
        "roads": roads,
        "props": props,
        "placements": placements,
        "labels": labels,
    }
    with open(os.path.join(OUT_DIR, "map.json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))

    # Props: move each prototype to the origin for export, then put it back in its parking slot.
    parked = {}
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.data.collections["MSR_Props"].objects:
        parked[obj.name] = obj.location.copy()
        obj.location = (0, 0, 0)
        obj.hide_set(False)
        obj.select_set(True)
    try:
        bpy.ops.export_scene.gltf(
            filepath=os.path.join(OUT_DIR, "props.glb"),
            export_format="GLB",
            use_selection=True,
            export_apply=True,
            export_yup=True,
            export_materials="EXPORT",
            export_normals=True,
            export_texcoords=False,
            export_cameras=False,
            export_lights=False,
            export_animations=False,
        )
    finally:
        for obj in bpy.data.collections["MSR_Props"].objects:
            obj.location = parked[obj.name]
            obj.select_set(False)

    sizes = {name: os.path.getsize(os.path.join(OUT_DIR, name)) for name in ("map.json", "terrain.bin", "props.glb")}
    print("MSR exported to", OUT_DIR, sizes, "placements", len(placements), "height", round(lo), round(hi))


main()
