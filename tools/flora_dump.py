import json
import sys

import bmesh
import bpy
import numpy as np

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))


def import_gltf(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if job.get("pick"):
        for o in list(meshes):
            if not o.name.startswith(job["pick"]):
                bpy.data.objects.remove(o)
        meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def corner_arrays(me, matrix):
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    loops = np.empty(nt * 3, np.int32)
    me.loop_triangles.foreach_get("loops", loops)
    tri_mat = np.empty(nt, np.int32)
    me.loop_triangles.foreach_get("material_index", tri_mat)
    loop_vert = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", loop_vert)
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    nor = np.empty(len(me.loops) * 3, np.float32)
    me.corner_normals.foreach_get("vector", nor)
    nor = nor.reshape(-1, 3)
    uv_layer = me.uv_layers.active
    uv = np.empty(len(me.loops) * 2, np.float32)
    uv_layer.uv.foreach_get("vector", uv)
    uv = uv.reshape(-1, 2)
    m = np.array(matrix, dtype=np.float64)
    pos = co[loop_vert[loops]].astype(np.float64) @ m[:3, :3].T + m[:3, 3]
    nrm = nor[loops].astype(np.float64) @ np.linalg.inv(m[:3, :3]).T
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-12)
    uvs = uv[loops].copy()
    uvs[:, 1] = 1.0 - uvs[:, 1]
    return pos, nrm, uvs, tri_mat


def yup(a):
    return np.stack([a[:, 0], a[:, 2], -a[:, 1]], axis=1)


def make_object(me_name, bm):
    me = bpy.data.meshes.new(me_name)
    bm.to_mesh(me)
    obj = bpy.data.objects.new(me_name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def drop_faces(bm, keep):
    doomed = [f for f in bm.faces if not keep(f)]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")


def evaluated_copy(obj, depsgraph):
    ev = obj.evaluated_get(depsgraph)
    me = bpy.data.meshes.new_from_object(ev, depsgraph=depsgraph)
    attr = me.attributes.get("UVMap")
    if not me.uv_layers and attr is not None and attr.data_type == "FLOAT_VECTOR":
        vals = np.empty(len(attr.data) * 3, np.float32)
        attr.data.foreach_get("vector", vals)
        me.attributes.remove(attr)
        layer = me.uv_layers.new(name="UVMap")
        layer.uv.foreach_set("vector", vals.reshape(-1, 3)[:, :2].ravel())
    return me


def decimated(me, target, merge, materials):
    bm = bmesh.new()
    bm.from_mesh(me)
    if merge:
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    count = len(bm.faces)
    out = bpy.data.meshes.new("dec")
    bm.to_mesh(out)
    bm.free()
    obj = bpy.data.objects.new("dec", out)
    bpy.context.scene.collection.objects.link(obj)
    for mat in materials:
        out.materials.append(mat)
    if target and target < count:
        mod = obj.modifiers.new("decimate", "DECIMATE")
        mod.ratio = target / count
        mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    return bpy.data.meshes.new_from_object(obj.evaluated_get(dg), depsgraph=dg)


if "gltf" in job:
    source_obj = import_gltf(job["gltf"])
else:
    source_obj = bpy.data.objects[job["object"]]

dg = bpy.context.evaluated_depsgraph_get()
raw = evaluated_copy(source_obj, dg)
materials = list(raw.materials)
mat_names = np.array([m.name if m else "" for m in materials])
matrix = source_obj.matrix_world.copy()
shift = np.zeros(3)
if job.get("origin") == "object":
    shift[:2] = np.array(source_obj.matrix_world.translation)[:2]


def finish(pos, nrm, uv, tri_mat, scale=1.0, base=None):
    pos = yup(pos - shift)
    nrm = yup(nrm)
    if base is not None:
        pos = pos * scale - base
    return pos.astype(np.float32), nrm.astype(np.float32), uv.astype(np.float32), tri_mat.astype(np.int32)


rp, rn, ru, rm = corner_arrays(raw, matrix)

foliage = job.get("foliage")
decimate_tag = job.get("decimate", "")
kind = np.zeros(len(mat_names), np.int32)
for k, n in enumerate(mat_names):
    if foliage and foliage in n:
        kind[k] = 2
    elif decimate_tag in n:
        kind[k] = 0
    else:
        kind[k] = 1
tri_kind = kind[rm]

normalise = job.get("normalise")
scale = 1.0
base = None
ypos = yup(rp - shift)
if normalise:
    lo, hi = ypos.min(0), ypos.max(0)
    scale = normalise["longest"] / float(np.max(hi - lo)) if normalise.get("longest") else 1.0
    base = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]) * scale


def subset(mask):
    tri = np.repeat(mask, 3)
    return finish(rp[tri], rn[tri], ru[tri], rm[mask], scale, base)


def save(data, prefix, p, n, u, m):
    data[prefix + "_pos"], data[prefix + "_nor"], data[prefix + "_uv"], data[prefix + "_mat"] = p, n, u, m


for out in job["outputs"]:
    data = {"mat_names": mat_names}
    save(data, "foliage", *subset(tri_kind == 2))
    save(data, "branch", *subset(tri_kind == 1))
    if out["target"] == -1:
        save(data, "solid", *subset(tri_kind == 0))
    else:
        bm = bmesh.new()
        bm.from_mesh(raw)
        drop_faces(bm, lambda f: kind[f.material_index] == 0)
        me = bpy.data.meshes.new("solid")
        bm.to_mesh(me)
        bm.free()
        dec = decimated(me, out["target"], out.get("merge", False), materials)
        p, n, u, m = corner_arrays(dec, matrix)
        save(data, "solid", *finish(p, n, u, m, scale, base))
    np.savez(out["out"], **data)
    print("wrote", out["out"], len(data["solid_mat"]), "solid tris")
