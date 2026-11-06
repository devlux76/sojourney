# Idol: one image to a 3D Gaussian splat (lead's note, 2026-11-05)

The project lead flagged <https://huggingface.co/speridlabs/idol>: "this solves a lot of problems for
sojourney if we can make it work." Not evaluated yet; this note records what it is and what to check.

## What it is

- One image (a photo, a render or a generated image) in; a standard 3DGS `.ply` out, plus the
  processed input and the predicted input camera (`_camera.json`). It fills in the unseen sides.
- Background removal and cropping are built in (BiRefNet); `--mode real|synthetic` sets the crop margin.
- Up to 1,048,576 Gaussians per object, in multiples of 32 from 32,768; fewer sampling steps are
  faster but lose detail.
- About 1.8B parameters in all: a DiT denoiser, octree and Gaussian decoders, a DINOv3 ViT-H+/16
  encoder and the FLUX.2 VAE. The weights are about 3 GB; inference peaks at 7.2 GB of VRAM.
- Code: <https://github.com/speridlabs/idol-sdk> (`python -m idol.sample --image photo.jpg --mode real`,
  or `IdolPipeline.from_pretrained("speridlabs/idol")`).
- Speed (their benchmark, 262k Gaussians): 3.4 s on a B300, 46 s on an RTX 3080, 55 s on an L4.

## Why it may matter here

- Props, rocks, snags and fauna stand-ins could come straight from reference photos (the reference
  imagery in this folder and the source registry) instead of being modelled or sourced one by one.
- Babylon.js renders Gaussian splats natively (`GaussianSplattingMesh` loads `.ply`/`.splat`), so the
  output may drop in without a conversion step. Whether splats meet our frame budget, our lighting
  and shadows, and LOD at scene scale is the open question; a mesh conversion is the fallback.

## Blockers to check before relying on it

- **Hardware:** it needs an NVIDIA CUDA GPU (PyTorch 2.5+). This MacBook has an AMD RX460 (4 GB) and an
  iGPU, so it can't run locally as shipped. Options: a rented or cloud GPU for batch generation, or
  check whether a ROCm or CPU path works at all (likely far too slow).
- **Licensing:** the Idol weights and code are Apache-2.0, but it downloads the gated DINOv3 and
  FLUX.2-dev (VAE only) repos, which have their own terms. Before any generated asset ships, confirm
  that those terms allow it, and record the asset's source photo and its licence in `CREDITS.md`
  (see `LICENSING-TODO.md`).
- **Quality claims are self-reported** (their table: best SSIM/LPIPS/IoU/CLIP among the models they
  list). Try it on two or three of our own reference photos before planning around it.
