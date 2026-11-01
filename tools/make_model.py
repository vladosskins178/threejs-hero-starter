"""Build the demo model (assets/crystal.glb): a low-poly crystal cluster on a rock.

Run with Blender 4.0 or newer:
    blender --background --python tools/make_model.py

The script only uses Blender's built-in primitives, so the output is original
work covered by this repository's MIT license.
"""
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

random.seed(7)
OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "crystal.glb"))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, color, roughness, metallic=0.0, emission=None, strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


CRYSTAL_MATS = [
    material("CrystalViolet", (0.22, 0.06, 0.85), 0.32, 0.0, (0.20, 0.05, 0.75), 0.35),
    material("CrystalBlue", (0.02, 0.28, 0.95), 0.30, 0.0, (0.02, 0.20, 0.80), 0.3),
    material("CrystalPink", (0.85, 0.06, 0.50), 0.32, 0.0, (0.65, 0.03, 0.35), 0.3),
]
ROCK_MAT = material("Rock", (0.025, 0.022, 0.035), 0.9)


def add_object(name, bm, mat):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = False
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(mat)
    scene.collection.objects.link(obj)
    return obj


def crystal(radius, height, tip, sides=6):
    """Hexagonal prism with a pointed top and a slightly narrower base."""
    bm = bmesh.new()
    ring = lambda r, z: [
        bm.verts.new((r * math.cos(2 * math.pi * i / sides), r * math.sin(2 * math.pi * i / sides), z))
        for i in range(sides)
    ]
    bottom = ring(radius * 0.8, -0.2)
    top = ring(radius, height)
    apex = bm.verts.new((0, 0, height + tip))
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
        bm.faces.new((top[i], top[j], apex))
    bm.faces.new(list(reversed(bottom)))
    return bm


# Crystals: one tall centre piece, the rest leaning outwards.
specs = [(0.34, 1.9, 0.55, 0.0, 0.0, 0)]
for k in range(8):
    angle = k / 8 * 2 * math.pi + random.uniform(-0.25, 0.25)
    specs.append((
        random.uniform(0.14, 0.24),
        random.uniform(0.55, 1.25),
        random.uniform(0.22, 0.38),
        angle,
        random.uniform(0.35, 0.75),
        k % 3,
    ))

for idx, (r, h, tip, angle, lean, mat_idx) in enumerate(specs):
    bm = crystal(r, h, tip)
    obj = add_object(f"Crystal{idx}", bm, CRYSTAL_MATS[mat_idx])
    offset = 0.0 if idx == 0 else random.uniform(0.25, 0.45)
    obj.location = (offset * math.cos(angle), offset * math.sin(angle), 0.15)
    tilt = Matrix.Rotation(lean, 4, Vector((-math.sin(angle), math.cos(angle), 0)))
    spin = Matrix.Rotation(random.uniform(0, math.pi), 4, "Z")
    obj.matrix_world = Matrix.Translation(obj.location) @ tilt @ spin

# Rock base: a squashed, jittered icosphere.
bm = bmesh.new()
bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
for v in bm.verts:
    v.co *= random.uniform(0.88, 1.08)
    v.co.z *= 0.42
    if v.co.z > 0.12:
        v.co.z = 0.12 + (v.co.z - 0.12) * 0.3
rock = add_object("Rock", bm, ROCK_MAT)
rock.scale = (1.15, 1.15, 1.0)
rock.location = (0, 0, -0.05)

# Join everything into one mesh so the hero loads a single draw-friendly object.
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = rock
bpy.ops.object.join()
rock.name = "CrystalCluster"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_apply=True)
tris = sum(len(p.vertices) - 2 for p in rock.data.polygons)
print(f"wrote {OUT} ({tris} triangles)")
