import json
import math
import re
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
mode, glb, out = argv[0], argv[1], argv[2]
extra = json.loads(argv[3]) if len(argv) > 3 else {}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)

levels = {}
for o in bpy.context.scene.objects:
    if o.type != "MESH":
        continue
    m = re.search(r"^" + re.escape(extra.get("prefix", "")) + r".*?_LOD(\d+)", o.name) if extra.get("prefix") else re.search(r"_LOD(\d+)", o.name)
    if m:
        levels.setdefault(int(m.group(1)), []).append(o)


for o in bpy.context.scene.objects:
    if o.type == "MESH" and not any(o in objs for objs in levels.values()):
        o.hide_render = True


def world_points(objs):
    pts = []
    for o in objs:
        co = np.empty(len(o.data.vertices) * 3, np.float32)
        o.data.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3).astype(np.float64)
        m = np.array(o.matrix_world)
        pts.append(co @ m[:3, :3].T + m[:3, 3])
    p = np.concatenate(pts)
    return np.stack([p[:, 0], p[:, 2], -p[:, 1]], axis=1)


def show(k):
    for lvl, objs in levels.items():
        for o in objs:
            o.hide_render = lvl != k


def basis(theta):
    h = Vector((math.cos(theta), 0, math.sin(theta)))
    n = Vector((-math.sin(theta), 0, math.cos(theta)))
    return h, Vector((0, 1, 0)), n


def to_blender(v):
    return Vector((v.x, -v.z, v.y))


def make_camera(theta, centre_y, width_m, height_m):
    h, up, n = basis(theta)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.sensor_fit = "VERTICAL"
    cam_data.ortho_scale = height_m
    cam_data.clip_start, cam_data.clip_end = 0.1, 400
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    rot = Matrix([to_blender(h), to_blender(up), to_blender(n)]).transposed()
    cam.matrix_world = Matrix.Translation(to_blender(n * 100 + Vector((0, centre_y, 0)))) @ rot.to_4x4()
    bpy.context.scene.camera = cam
    return cam


def setup_render(px_w, px_h, samples, transparent):
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = samples
    s.cycles.use_denoising = False
    s.cycles.max_bounces = 4
    s.cycles.transparent_max_bounces = 96
    s.cycles.filter_width = 1.0
    s.render.resolution_x, s.render.resolution_y = px_w, px_h
    s.render.resolution_percentage = 100
    s.render.film_transparent = transparent
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_mode = "RGBA"
    s.view_settings.view_transform = "Standard"
    s.view_settings.look = "None"


def principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def unlit(mat, normal_pass):
    nt = mat.node_tree
    bsdf = principled(mat)
    base, alpha = bsdf.inputs["Base Color"], bsdf.inputs["Alpha"]
    emit = nt.nodes.new("ShaderNodeEmission")
    clear = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    if normal_pass:
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        vt = nt.nodes.new("ShaderNodeVectorTransform")
        vt.vector_type, vt.convert_from, vt.convert_to = "NORMAL", "WORLD", "CAMERA"
        ma = nt.nodes.new("ShaderNodeVectorMath")
        ma.operation = "MULTIPLY_ADD"
        ma.inputs[1].default_value = (0.5, 0.5, 0.5)
        ma.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(geo.outputs["Normal"], vt.inputs["Vector"])
        nt.links.new(vt.outputs["Vector"], ma.inputs[0])
        nt.links.new(ma.outputs["Vector"], emit.inputs["Color"])
    elif base.links:
        nt.links.new(base.links[0].from_socket, emit.inputs["Color"])
    else:
        emit.inputs["Color"].default_value = base.default_value
    if alpha.links:
        nt.links.new(alpha.links[0].from_socket, mix.inputs[0])
    else:
        mix.inputs[0].default_value = alpha.default_value
    nt.links.new(clear.outputs[0], mix.inputs[1])
    nt.links.new(emit.outputs[0], mix.inputs[2])
    out_node = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    nt.links.new(mix.outputs[0], out_node.inputs["Surface"])


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


if mode == "preview":
    pts = world_points(levels[0])
    height = float(pts[:, 1].max()) * 1.05
    radius = float(np.hypot(pts[:, 0], pts[:, 2]).max()) * 1.05
    tile_h = int(extra.get("px", 900))
    ppm = tile_h / height
    px_w = int(math.ceil(2 * radius * ppm))
    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 4.0
    sun = bpy.data.objects.new("sun", sun_data)
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    bpy.context.scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.65, 0.8, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    bpy.context.scene.world = world
    setup_render(px_w, tile_h, 24, False)
    make_camera(extra.get("theta", 0.0), height / 2, 2 * radius, height)
    for k in sorted(levels):
        show(k)
        render(f"{out}_LOD{k}.png")
        print("preview", k)

if mode == "card":
    pts = world_points(levels[0])
    height = float(pts[:, 1].max())
    radius = float(np.hypot(pts[:, 0], pts[:, 2]).max())
    tile_w, tile_h = int(extra["tile_w"]), int(extra["tile_h"])
    ppm = min(tile_w / (2 * radius), tile_h / height)
    width_m, height_m = tile_w / ppm, tile_h / ppm
    for k in levels:
        for o in levels[k]:
            o.hide_render = k != 0
    show(0)
    mats = {m for o in levels[0] for m in o.data.materials}
    for normal_pass in (False, True):
        for mat in mats:
            unlit(mat, normal_pass)
        world = bpy.data.worlds.new("w")
        bpy.context.scene.world = world
        setup_render(tile_w, tile_h, 16, True)
        bpy.context.scene.view_settings.view_transform = "Raw" if normal_pass else "Standard"
        for i in range(extra["views"]):
            theta = math.pi * i / extra["views"]
            make_camera(theta, height_m / 2, width_m, height_m)
            render(f"{out}_{'normal' if normal_pass else 'albedo'}_{i}.png")
    json.dump({"tile_w": tile_w, "tile_h": tile_h, "width_m": width_m, "height_m": height_m,
               "height": height, "radius": radius}, open(f"{out}_card.json", "w"))
