import sys

import bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
src, out, name, lod0 = args[0], args[1], args[2], int(args[3])
longest = float(args[4]) if len(args) > 4 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(meshes) > 1:
    bpy.ops.object.join()
scan = bpy.context.view_layer.objects.active
for o in list(bpy.context.scene.objects):
    if o is not scan:
        bpy.data.objects.remove(o)
scan.name = scan.data.name = "scan"
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.object.mode_set(mode="OBJECT")

co = [v.co for v in scan.data.vertices]
lo = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
hi = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
scale = longest / max(hi - lo) if longest else 1.0
scan.data.transform(Matrix.Scale(scale, 4) @ Matrix.Translation(-Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))))


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


print(f"{name}: {triangles(scan)} triangles, {(hi - lo) * scale} m")
for level, target in enumerate([lod0, lod0 // 4, lod0 // 16]):
    lod = scan.copy()
    lod.data = scan.data.copy()
    lod.name = lod.data.name = f"{name}_LOD{level}"
    bpy.context.scene.collection.objects.link(lod)
    decimate = lod.modifiers.new("decimate", "DECIMATE")
    decimate.ratio = min(1.0, target / triangles(scan))
    decimate.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = lod
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    print(f"  {lod.name}: {triangles(lod)} triangles")
bpy.data.objects.remove(scan)

bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_vertex_color="NONE")
