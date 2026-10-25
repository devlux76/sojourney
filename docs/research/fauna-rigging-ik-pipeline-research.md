# Fauna Model + Auto-Rig + IK Pipeline Research (Sept 2026)

## Bottom line up front
The mesh-generation half of this is already solved by the tools in `3d-asset-generation-research.md` — TRELLIS.2, Hunyuan3D-2.1, Rodin, Tripo, Meshy all do single-object image/text-to-3D reconstruction, and a squirrel or a snake is just another "discrete object" to them, same as a boulder. The new problem fauna adds is **rigging and IK across wildly different body plans** — a biped, a quadruped, and a limbless serpentine creature all need different skeletons and different locomotion logic, and that's where a dedicated tool matters.

The good news: this got a lot better recently. **UniRig** (SIGGRAPH 2025, MIT-licensed, open weights on Hugging Face) is a genuinely general auto-rigging model trained across humans, animals, and objects, and it's free to self-host or run at ~$0.46/model via a hosted API. **Tripo3D's Rig API** goes further and explicitly supports seven skeleton categories — biped, quadruped, hexapod, octopod, avian, serpentine, aquatic — with matching preset animations (walk/run/idle) for each, as a single hosted pipeline. For IK/locomotion realism specifically, **Cascadeur** (local desktop app) added alpha quadruped support for its AI-assisted physics autoposing in late 2025, and for limbless creatures the honest answer is you don't want AI at all — Blender's built-in **Spline IK** constraint is the established, reliable way to animate snake-like undulation and will outperform any generative approach for that specific case.

Full generative text-to-animation for arbitrary creatures (skip keyframing entirely) exists only as research code right now (AniMo, OmniMotionGPT, X-MoGen) — promising, not production-ready. Treat the "cherry on top" as a 2027 revisit, not a 2026 pipeline component.

## Anything World ("Animate Anything")
**Anything World** and its **"Animate Anything"** product ([anything-world.gitbook.io](https://anything-world.gitbook.io/anything-world/animate-anything-3d-software-plugins/animate-anything-blender-add-on-manual), [CG Channel coverage](https://www.cgchannel.com/2023/10/animate-anything-uses-ai-to-rig-your-3d-characters/)). It's a cloud-based AI service with a Blender add-on (also Maya/3ds Max) that auto-generates a bone structure *and* motion sequences for an imported static mesh. It explicitly classifies non-humanoid input by anatomical similarity — e.g. it'll rig a unicorn using its "horse" template, or fall back to a generic "quadruped" template for something unfamiliar — and it covers cats, dogs, ants, and other animals, not just humanoid NPCs. It's a legitimate starting point, but it's a closed cloud pipeline (account + API key, no self-hosting, pricing not published), and its rig-template approach means genuinely unusual body plans (your garter snake) may get force-fit into the nearest template rather than getting a correct skeleton. Worth prototyping with, but I wouldn't anchor the pipeline on it — UniRig and Tripo's Rig API are more transparent about what they actually generate and give you either open weights or a documented API contract.

## Auto-rigging tools, compared

**UniRig** (VAST-AI-Research — the same lab behind TripoSR, already in your mesh-gen doc) — [GitHub](https://github.com/VAST-AI-Research/UniRig), [Hugging Face](https://huggingface.co/VAST-AI/UniRig), [SIGGRAPH 2025 paper](https://dl.acm.org/doi/10.1145/3730930)
A unified autoregressive model that generates a topologically valid skeleton *and* predicts per-vertex skinning weights in one pass, for "diverse model categories (humans, animals, objects)" — published examples include giraffes and rabbits alongside humanoids. MIT license, no usage restrictions. Self-host needs an 8GB+ CUDA GPU, Python 3.11, PyTorch ≥2.3.1, and some fiddly deps (`spconv`, `torch_scatter`, `flash_attn`) — a real install, not pip-and-go. If you don't want to stand up a GPU, it's also hosted on Replicate (~$0.46/run, ~6 min, A100) with no self-hosting required. Known limitation worth flagging for your snake case: the authors note results "degrade significantly if the skeleton is inaccurate — for example, if tail bones or wing bones are missing," so verify output on genuinely unusual anatomy rather than trusting it blind.

**Tripo3D Rig API** — [developers.tripo3d.ai/en/models/rig](https://developers.tripo3d.ai/en/models/rig)
Hosted, credit-based (25 credits/rig, free compatibility pre-check via "Rig Check"). This is the standout find: it explicitly supports **biped, quadruped, hexapod, octopod, avian, serpentine, and aquatic** skeletons — i.e., it has a named category for your snake, and one for insects/arachnids if Sojourney's biomes need those too. Outputs GLB or FBX, with a choice of Tripo's own bone naming or Mixamo-compatible naming (useful if you want to blend in Mixamo human animations for biped NPCs). Since Tripo is already your recommended pick for cheap hosted mesh generation, this makes Tripo a genuine single-vendor mesh→rig pipeline for most fauna.

**Tripo3D Animation Retargeting API** — [developers.tripo3d.ai/en/docs/animations-retarget](https://developers.tripo3d.ai/en/docs/animations-retarget)
Pairs with the Rig API. Current (v2.5) biped presets: idle, walk, run, dive, climb, jump, slash, shoot, hurt, fall, turn. Quadruped and hexapod/octopod get walk presets; serpentine and aquatic get a "march" preset. This is a real "cherry on top", already shipping — not full generative motion, but a real preset library scoped per skeleton type, which is more than any other tool here offers out of the box.

**Meshy Auto-Rigging** — [meshy.ai/features/ai-auto-rigging](https://www.meshy.ai/features/ai-auto-rigging)
Explicitly supports "humanoid and quadruped characters" only — no stated support for serpentine, avian, or hexapod topologies. Docs recommend manual rigging in Blender/Maya for "complex custom skeletons," which a garter snake would count as. Fine for mammalian fauna, not a complete solution for Sojourney's full cast.

**RigNet** (SIGGRAPH 2020) — [GitHub](https://github.com/zhan-xu/RigNet)
The academic predecessor to UniRig, still around via community Blender add-ons ([brignet](https://github.com/pKrime/brignet), [blender-rignet](https://github.com/jasongzy/blender-rignet)). Superseded by UniRig in both quality and scope — worth knowing it exists, not worth building on new.

## Realistic IK: the part that's actually the hard problem

**Cascadeur** — [cascadeur.com](https://cascadeur.com/), [2025.3 release notes](https://cascadeur.com/blog/view/cascadeur-2025-3-new-inbetweening-quadrupeds)
A local desktop app (not cloud), built around AI-assisted physics autoposing — you set a few keyframes and its physics/ML models solve plausible in-between poses and weight distribution, which is effectively "realistic IK" as a product feature rather than a manual rigger's constraint setup. As of the 2025.3 release it added **quadruped support to AutoPosing and Quick Rigging**, explicitly marked **Alpha** — so it's new and should be evaluated hands-on before you depend on it, but it's the only tool in this research that markets physics-grounded IK quality (ground contact, weight shift, balance) as its core value proposition rather than as a side effect of rigging. The 2026.1 release also added "AI root motion." No animal-specific case studies were found in what I could pull from their docs, so this is a prototype-and-verify recommendation, not a confirmed one.

**Limbless creatures (your garter snake) — don't reach for AI at all.** Blender's built-in [Spline IK constraint](https://docs.blender.org/manual/en/latest/animation/constraints/tracking/spline_ik.html) drives a bone chain along a curve and is the standard, well-documented technique for snake/tentacle/tail undulation — procedural, deterministic, and free. Once UniRig or Tripo's Rig API gives you a spine-chain skeleton for the snake mesh, Spline IK (driven by a curve you animate or by a simple noise/sine-wave modifier for idle slither) will look more "correct" and be far easier to art-direct than any current generative-motion model. This is a case where the AI's job stops at "give me a correct skeleton" and classical rigging takes over — worth designing the pipeline around rather than fighting.

**Quadruped/biped locomotion generally**: once you have a rig (from UniRig or Tripo), Tripo's retargeted walk/run presets or Mixamo-compatible biped animations (via Tripo's Mixamo bone-naming option) cover baseline locomotion. Cascadeur is the place to hand-polish or generate secondary motion (weight, footfall timing on uneven terrain) beyond a flat preset loop.

## Animation generation — the actual cherry on top (research-stage, not yet a pipeline component)
Current academic work on text-driven or video-driven motion generation for non-humanoid creatures, roughly newest-first:
- **Kirin** (Sept 2026, [arXiv](https://arxiv.org/html/2609.01823v1)) — generates animal motion from in-the-wild video references rather than text. Newest and most relevant to "give me a squirrel's actual gait" if you can source reference footage, but this is days-old research, not a packaged tool.
- **UniMo** ([arXiv](https://arxiv.org/html/2609.12342)) — unifies human and animal motion generation in one model.
- **AniMo** (CVPR 2025, [GitHub](https://github.com/WandererXX/AniMo)) — species-aware text-to-animal-motion. Runnable locally via conda, but needs its own AniMo4D training/reference dataset and the repo doesn't clearly document a pretrained-checkpoint quick-start, license, or supported-species list — expect real setup effort, not a Hugging Face demo you can just call.
- **X-MoGen** ([arXiv](https://arxiv.org/html/2508.05162v1)) — unified motion generation across humans and animals, Aug 2025.
- **OmniMotionGPT** ([arXiv, 2023](https://arxiv.org/html/2311.18303)) — animal motion generation with limited data; the oldest and most-cited of this group, a reasonable baseline to read even if you don't run it.

None of these have a hosted API, a Hugging Face inference endpoint, or documented production use as of this research. They're the right thing to prototype with in a research spike, not something to architect Sojourney's pipeline around yet. Tripo's preset retargeting library is the realistic "some generated motion, no keyframing" option available today.

## Recommended pipeline for Sojourney

1. **Mesh**: generate the rest-pose creature mesh with the tools already chosen in `3d-asset-generation-research.md` — Stable Fast 3D for fast iteration, TRELLIS.2 or Tripo for higher-quality/hero fauna. No changes needed here; animals reconstruct the same way rocks do.
2. **Rig**: run the mesh through **Tripo's Rig API**, selecting the matching skeleton category (quadruped for the squirrel, serpentine for the garter snake). If you're already using Tripo for mesh generation this is a same-vendor next step and the 25-credit cost is trivial at prototype volume. Use **UniRig** (self-hosted, free, MIT) as the fallback/cross-check for anything Tripo's categories don't cleanly cover, or if you want to stay fully open-source-first per the existing doc's stance — it's the more "download and own it" option of the two.
3. **IK / locomotion**:
   - Legged creatures (squirrel, chipmunk, toad): start from Tripo's retargeted walk/run/idle presets for a working baseline, then bring the rig into **Cascadeur** (alpha quadruped support) to hand-polish weight and ground contact if the preset reads as floaty.
   - Limbless creatures (garter snake): skip generative motion entirely — rig the spine chain, apply Blender's **Spline IK** constraint, and drive it with a curve or a simple sine/noise driver. This will look better and cost nothing.
4. **Animation (cherry on top)**: treat as a research spike, not a dependency. If you want to push it, **Kirin** (video-reference-driven, brand new) is the most promising near-term option for getting real animal gaits without hand-keying, but budget it as an experiment with no guaranteed payoff this cycle.

## Sources
- [Anything World: Animate Anything Blender add-on manual](https://anything-world.gitbook.io/anything-world/animate-anything-3d-software-plugins/animate-anything-blender-add-on-manual)
- [CG Channel: Animate Anything uses AI to rig your 3D characters](https://www.cgchannel.com/2023/10/animate-anything-uses-ai-to-rig-your-3d-characters/)
- [UniRig GitHub (VAST-AI-Research)](https://github.com/VAST-AI-Research/UniRig)
- [UniRig on Hugging Face](https://huggingface.co/VAST-AI/UniRig)
- [UniRig SIGGRAPH 2025 paper (ACM TOG)](https://dl.acm.org/doi/10.1145/3730930)
- [UniRig hosted on Replicate](https://replicate.com/aaronjmars/unirig-ai)
- [Tripo Rigging API docs](https://developers.tripo3d.ai/en/models/rig)
- [Tripo Animation Retargeting API docs](https://developers.tripo3d.ai/en/docs/animations-retarget)
- [Tripo blog: quadruped rigging tools compared (AccuRig, DeepMotion, Tripo)](https://www.tripo3d.ai/blog/quadruped-rigging-tools-compared)
- [Meshy AI Auto Rigging](https://www.meshy.ai/features/ai-auto-rigging)
- [Meshy rigging docs](https://docs.meshy.ai/en/webapp/guides/3d-model/rigging)
- [RigNet GitHub (SIGGRAPH 2020)](https://github.com/zhan-xu/RigNet)
- [Cascadeur 2025.3 release notes (quadruped AutoPosing alpha)](https://cascadeur.com/blog/view/cascadeur-2025-3-new-inbetweening-quadrupeds)
- [Cascadeur 2026.1 (AI root motion)](https://digitalproduction.com/2026/04/09/cascadeur-2026-1-adds-unreal-live-link-filament-rendering-and-ai-root-motion/)
- [Blender Manual: Spline IK Constraint](https://docs.blender.org/manual/en/latest/animation/constraints/tracking/spline_ik.html)
- [Kirin: Animal Motion Generation from In-the-Wild Video (arXiv, Sept 2026)](https://arxiv.org/html/2609.01823v1)
- [UniMo: Unifying Human and Animal Motion Generation (arXiv)](https://arxiv.org/html/2609.12342)
- [AniMo: Species-Aware Model for Text-Driven Animal Motion Generation (CVPR 2025, GitHub)](https://github.com/WandererXX/AniMo)
- [X-MoGen: Unified Motion Generation across Humans and Animals (arXiv)](https://arxiv.org/html/2508.05162v1)
- [OmniMotionGPT (arXiv, 2023)](https://arxiv.org/html/2311.18303)
