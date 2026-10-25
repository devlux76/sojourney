import sys
import bpy

args = sys.argv[sys.argv.index("--") + 1:]
out_dir, prefix, lods, variants = args[:4]
lods, variants = lods.split(","), variants.split(",")
decimate = dict((k, float(v)) for k, v in (p.split(":") for p in args[4].split(","))) if len(args) > 4 else {}


def fix_twig_alpha(mat):
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    alpha_img = next((n for n in nt.nodes if n.type == "TEX_IMAGE" and n.image and "alpha" in n.image.name), None)
    diff_img = next((n for n in nt.nodes if n.type == "TEX_IMAGE" and n.image and "diff" in n.image.name), None)
    if not (bsdf and alpha_img):
        return
    for link in list(bsdf.inputs["Alpha"].links):
        nt.links.remove(link)
    rnd = nt.nodes.new("ShaderNodeMath")
    rnd.operation = "ROUND"
    nt.links.new(alpha_img.outputs["Color"], rnd.inputs[0])
    nt.links.new(rnd.outputs[0], bsdf.inputs["Alpha"])
    if diff_img:
        for link in list(bsdf.inputs["Base Color"].links):
            nt.links.remove(link)
        nt.links.new(diff_img.outputs["Color"], bsdf.inputs["Base Color"])
    print("fixed alpha on", mat.name)


def make_real_uv_layer(obj):
    me = obj.data
    attr = me.attributes.get("UVMap")
    if attr is None or attr.data_type != "FLOAT_VECTOR":
        return
    vals = [0.0] * (len(attr.data) * 3)
    attr.data.foreach_get("vector", vals)
    me.attributes.remove(attr)
    uv = me.uv_layers.new(name="UVMap")
    uv.data.foreach_set("uv", [v for i, v in enumerate(vals) if i % 3 != 2])
    for ca in list(me.color_attributes):
        me.color_attributes.remove(ca)


def use_uv_map_nodes(mat):
    nt = mat.node_tree
    for n in list(nt.nodes):
        if n.type == "ATTRIBUTE" and n.attribute_name == "UVMap":
            uvn = nt.nodes.new("ShaderNodeUVMap")
            uvn.uv_map = "UVMap"
            for link in list(n.outputs["Vector"].links):
                nt.links.new(uvn.outputs["UV"], link.to_socket)
            nt.nodes.remove(n)


def drop_vertex_color_mix(mat):
    nt = mat.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    mix = next((l.from_node for l in out.inputs["Surface"].links if l.from_node.type == "MIX_SHADER"), None)
    if not mix:
        return
    trunk_bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED" and n.name == "Principled BSDF")
    nt.links.new(trunk_bsdf.outputs["BSDF"], out.inputs["Surface"])
    print("dropped vertex-colour mix on", mat.name)


for o in bpy.data.objects:
    if o.type == "MESH":
        make_real_uv_layer(o)
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    use_uv_map_nodes(mat)
    if "trunk" in mat.name:
        drop_vertex_color_mix(mat)
    if "twig" in mat.name:
        fix_twig_alpha(mat)

for v in variants:
    names = [f"{prefix}_{v}_{lod}" for lod in lods]
    bpy.ops.object.select_all(action="DESELECT")
    for n in names:
        o = bpy.data.objects[n]
        o.location = (0, 0, 0)
        o.hide_set(False)
        o.hide_viewport = False
        o.select_set(True)
        ratio = decimate.get(n.rsplit("_", 1)[-1])
        if ratio:
            mod = o.modifiers.new("decimate", "DECIMATE")
            mod.ratio = ratio
            mod.use_collapse_triangulate = True
    path = f"{out_dir}/{prefix}_{v}.glb"
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True,
        export_image_format="WEBP", export_apply=True, export_yup=True,
    )
    print("exported", path, names)
