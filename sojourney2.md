# Sojourney 2 — targets for the rewrite

Work that needs a substantial rewrite of the engine, and features and content that v1 will not have,
so it waits for the v2 game. Nothing here blocks Sojourney v1; the issues that do are in `ISSUES.md`.

## Engine work deferred to a rebuild

### Frame Graph

Rendering stays on Babylon's classic loop for now. Moving to the Frame Graph is the main reason for a
rebuild:

- **SSAO2 is off** (`src/engine/environment/index.ts`, commented out). It is built for the Frame
  Graph; on the classic loop it fought the SceneOptimizer (frames ghosted and the fog lit the far
  shore once the optimizer stepped).
- **The Atmosphere addon has no Frame Graph hookup in 9.29.** It draws through
  `scene.onBeforeCameraRenderObservable` and the scene's own `renderingManager` groups. The Frame
  Graph's object renderer has its own RenderingManager, and the per-camera hook only fires in the classic
  loop, so the sky would need custom glue. Check the then-current Babylon before starting.
- `mirrorTheSky` (`src/engine/world.ts`) hand-draws the atmosphere into the lake mirror because the addon
  never draws into render targets. A Frame Graph build should replace it with a stock path if one exists.

### Large world rendering (floating origin)

Babylon 9.29 ships `useLargeWorldRendering` (engine option: 64-bit matrices plus floating origin on
every scene) and `useFloatingOrigin` (per scene), with Havok multi-region physics to match
(https://doc.babylonjs.com/features/featuresDeepDive/scene/large_world/). **Not enabled, and not needed
at Crater Lake's size for positions:** the farthest point (a map corner) is about 12.7 km from the
origin, where a float32 still resolves about 1 mm. The docs' case is around 1,000,000 units, about 6 cm
per step. **It does matter for depth**, which was missed when this was first written: see "The
atmosphere and the depth buffer" below. A millimetre of rounding in a position becomes metres of depth
at a kilometre with the near plane at 0.1 m.
Turn it on if a destination is much larger (tens of km or more) or near-camera items visibly
wobble at the map edge. It is one engine option, but the custom shaders (star field in `NightSky.ts`,
`TerrainMaterialPlugin`, `mirrorTheSky`) must then be checked to use Babylon's standard uniform names.

### The atmosphere and the depth buffer

Found on 2026-10-03 while fixing ground that flickered along ridge tops (ISSUES.md U12, `123fb66`).

**How coarse depth is in v1.** The camera sees from 0.1 m to 20 km. The textbook figure for 24 bits of
depth is the distance squared times 6e-7: about 1 m at 1.3 km. What we measured is ten times worse. Two
surfaces 2.7 m apart, 1,270 m from the eye, changed order from frame to frame, and still did when one
was moved 4 m farther back; a twentieth of the distance (64 m there) settles it with room to spare. The
cause is where positions are worked out: in 32-bit floats, from world coordinates thousands of metres
from the origin. The rounding is only about a millimetre, but depth near the far end of the range is so
compressed that a millimetre there is worth about a hundredth of the distance.

**What v1 does about it.** Only the one visible case is treated: ground skirts are marked in the pack
and drawn farther back in depth by the ground material (`skirtBack` in
`src/engine/TerrainMaterial.ts`). Every other pair of surfaces that lie close together far away (tree
cards against the ground behind them, a ridge against the next one) still has the coarse depth.

**Why the stock cure is closed.** Babylon ships `engine.useReverseDepthBuffer`, which spreads depth
precision evenly and is the normal answer. With it on, the sky was black and the haze far too blue. The
Atmosphere addon (9.29) is written for the ordinary depth direction:

- Its sky compositor is drawn at a fixed depth of 1 with the depth test set to EQUAL
  (`drawSkyCompositor` in `node_modules/@babylonjs/addons/atmosphere/atmosphere.js`), so it fills only
  pixels whose depth is still the far value. With reverse depth the far value is 0 and nothing passes.
- Its aerial perspective, when given a depth texture, "expects an infinite far plane on the camera
  (camera.maxZ = 0) and the non-linear depth accessible in red channel" (the addon's own comment). We
  do not give it one: the haze is applied per material by `AtmospherePBRMaterialPlugin`, which is also
  why every material in the scene must be a `PBRMaterial`.
- No option in the addon mentions reverse depth; a search of its source finds none.

So in 9.29 the choice is the addon or reverse depth, not both. Check the then-current Babylon first: a
reverse-depth-aware compositor is a small change upstream and may exist by the time v2 starts.

**What would cure it in a rebuild**, in the order to try:

1. Reverse depth with a sky that respects it: the stock addon if it has learnt to, otherwise the Frame
   Graph route above, where the sky is our own pass and its depth test is ours to set.
2. Floating origin (`useFloatingOrigin`, previous section): positions are worked out relative to the
   camera, which takes out the rounding that costs the factor of ten. It does not need the addon to
   change, but every custom shader that reads world position must be checked (the ground's splat map
   and triplanar lookups use it).
3. A nearer far plane or a farther near plane. The near plane cannot go much past 0.2 m (the player's
   body is 0.3 m in radius), which buys a factor of two.

**A sky of our own, as a fallback.** If the volumetric atmosphere cannot be made to work with the depth
the game needs, the fallback the project lead has in mind is to build our own. What it would have to
replace, from what v1 uses of the addon: the sky itself (drawn behind everything, at whatever the far
depth is), the sun's and sky's light on every material (`additionalDiffuseSkyIrradiance`, the
transmittance on the sun), the haze with distance (aerial perspective, which v1 leans on for the far
rim and sets to 1.4), exposure through the day, and the sky in the lake's mirror (`mirrorTheSky`
already hand-draws that). A baked or analytic sky with distance fog in our own material plugin would
cover these and has none of the addon's constraints (PBR only, classic loop only, ordinary depth
only), at the cost of the look the addon gives for free at sunrise and sunset. This goes against
"Babylon first" and is only for the case where the addon blocks something v2 must have.

### From the Babylon v9 audit

- WebGPU runs in compatibility mode (WebGL semantics); native WebGPU features are unused.
- No snapshot rendering.
- The ground material binds 18 textures. The WebGPU floor is 16 per stage, so this may fail on weaker
  devices. Texture arrays (Babylon's KTX2 loader does not upload them today) or a Node Material are
  the durable fix. A Node Material cannot take the Atmosphere addon's material plugin, which attaches
  only to `PBRMaterial`.
- `needAlphaTesting()` in `src/engine/flora.ts` is deprecated.
- `src/vendor/dynamicTerrain/` and `harness/dynamicTerrain.*` are dead code (spike not adopted).

## Content deferred to v2

### Fauna and NPCs

Moved from `ISSUES.md` (was B2) on 2026-10-02 by the project lead. Crater Lake's `fauna` is empty
(`src/biomes/crater-lake/index.ts`) and stays empty for v1: animal and character models that look good
and allow commercial use are not available, apart from the rat on Poly Haven.

Fauna is also engine work the game does not have yet. Everything placed in the world today is a static
object or an impostor card; animals need animated, skinned meshes, moving collision and behaviour, none
of which exists in `src/`.

## Features deferred to v2

### Player avatar and third-person view

Project lead, 2026-10-02. Give the player a body and the option of an over-the-shoulder third-person
camera, as in The Legend of Zelda: Breath of the Wild. v1 is first person with no body. It needs the same
groundwork as fauna (a skinned mesh, animation blending, a moving collider), so the two go together.

The character mesh and its animations have to be sourced under a commercial licence (a licensed or
commissioned model, or a generated one cleaned up; motion-capture clips for walking, rowing, fishing,
sitting). Rigging, skinning, retargeting, LOD levels and the glTF export can be scripted in Blender in
`tools/`, like the rest of the pipeline.

### Camp with friends

Project lead, 2026-10-02. Friends join the same destination by invite and camp together. It needs
networking, invites and a **world sync mechanism**: everything that changes or moves must be the same
for everyone present, or one person sees a wolf running along a cliff line and the others do not. That
covers fauna, and by the same reasoning the time of day, the weather, the ship, and what players do to
the world (chopped trees, fires). It also needs the player avatar above, so friends can see each other.

### Investigate survey-faithful voxel-backed terrain

Project-lead direction, 2026-10-06: schedule deeper investigation/exploration for v2;
continue closing v1 issues on the current code base. This is an investigation, not
an approved terrain replacement or a promised performance gain.

Explore a volumetric backing field derived from the geographically registered lidar
surface/bathymetry, while preserving aerial vegetation classifications and canopy
measurements as independent surface data. Keep original surveys authoritative;
distinguish measured geometry from authored caves/overhangs that the source does
not observe. Assess original point-cloud detail lost during heightmap conversion.

Compare the implemented BCC/truncated-octahedron and subdivision work in
`~/projects/infinite_realms` with the heightmap/quadtree lineage in
`~/projects/wizards_island` and Sojourney. Evaluate reusable implementations rather
than assuming the old engine was carried forward. Cell topology, streaming-region
shape and visible surface meshes are separate decisions.

Pilot adaptive volumetric sampling and offline surface extraction into Babylon's
existing mesh/material/LOD loading paths. Measure geometric error against lidar,
cliff silhouettes, seams, vegetation placement, authoring cost, triangles/draws,
download/cache occupancy, GPU memory and frame time against matched current views.
Regional meshes and baked textures must stream together; switching to voxels alone
does not fix the current global normal/AO texture. Assess terrain editing and
unsupported surveyed overhangs separately. Retain v1's source fidelity, commercial
provenance and Babylon-first/offline-authoring principles when evaluating options.

### Embodied Mirai and continual development

Project-lead direction, 2026-10-06: record findings for a possible v2 research
direction. This is exploratory, not an approved implementation plan or a claim
that an architecture produces consciousness.

**Research question.** At what level could something like a mind emerge: within
model inference, a continuously active neural system, or an integrated system of
perception, memory, motivation, action and learning? Here, "raising" means that
experience continually changes future perception, prediction and action,
including learned parameters. Persistent conversation history alone does not
cover the proposed experiment. Subjective experience remains an open question;
behavioral improvement cannot by itself establish it.

**Existing experiments inspected.** `~/projects/mirai-agent` provides an
Elixir/OTP harness with an asynchronous model loop, durable memory, recall,
reflection, schedules and revisable skills. Its current model transport uses
HTTP/SSE chat completions; live visual/audio observation would need integration.
`~/projects/dros/FlyScaleWeb` supplies a different approach: a connectome-derived
network of approximately 165,538 neurons and 25.4 million recurrent connections,
persistent activity, sensory/motor feedback and metabolic modulation. The
inspected browser runner updates activity rather than learning synaptic weights
from experience. Its genetic algorithm tunes input gains across candidate
configurations, and its thought bubbles select authored sentences from probes
and events. These are useful mechanisms, but they do not establish lifetime
learning or internally formulated thoughts. Biological topology is accompanied
by assumptions about neuron dynamics and sensory/motor routing; fidelity needs
validation. Why work on Mirai stopped was not established by this inspection.

**Activity, learning and collapse are different.** Continuous neural activity
does not guarantee lasting learning; discrete inference does not prevent a
larger system from maintaining continuity or acquiring capabilities through
training. Neither property settles the emergence question. Distinguish:

| Difficulty | Meaning | Research implication |
|---|---|---|
| Catastrophic forgetting | New learning damages previous abilities. | Measure retention as well as acquisition; investigate replay and protection of important parameters. |
| Loss of plasticity | The system becomes less able to learn new things. | Test adaptation over extended runs, not only initial improvement. |
| Model collapse | Recursive training on generated data can lose diversity and distort the learned distribution. | Retain grounded observations and distinguish them from the agent's accounts of events. |

These difficulties are not confined to language models, and continuous learning
is not known to inevitably collapse a model. Forgetting mitigation has been
demonstrated in classification and reinforcement learning; plasticity research
also covers both. Results in those settings do not guarantee stable learning in
a multimodal agent. Model-collapse findings concern recursive generated-data
training, not a general prohibition on learning from environmental feedback.

**Liquid Foundation Models as candidate components.** LFM 2.x includes
vision-language, audio-language and reasoning variants, with open weights and
documented fine-tuning. LFM2 uses gated short convolutions and attention, drawing
on earlier Liquid dynamical-system work. "Liquid" does not mean deployed weights
automatically learn, nor does this architecture supply the fly simulation's
continuous recurrence. No evidence inspected establishes that these models
solve open-ended continual learning. Their size and deployment options make
them candidates for experimentation, not a settled model choice.

**Proposed architecture: a "mind of minds."** Coordinate specialized models
around one persistent body, working state, event history, memory and intentions.
Sight, hearing and body observations inform action; actions alter the world;
observed consequences become learning material. Models can initially communicate
through structured events and language. Shared latent representations would
require additional alignment/training, not merely connecting their outputs.
Multiple models do not inherently form a unified mind, and updating them
independently can destabilize their communication and coordination.

For an experiment in learning through experience, expose observations available
to the agent's body rather than the entire scene database. Preserve actual
events separately from inferred beliefs and narration. Sojourney can provide
grounding even though it is simulated: outcomes are computed independently of
what the agent says happened. Rendering, collision and movement continue while
models deliberate; local simulation with remote inference/training is possible.
Measure resource needs rather than assuming several small models can train and
render concurrently on the current machine. Training has different memory and
compute costs from inference.

**Learning design is the central work.** A missed boat could reflect a failure
to recognize its bell, predict its departure, remember its schedule or choose a
route. One outcome score cannot identify which component should change: this is
credit assignment. Investigate observation-based prediction objectives,
action-outcome feedback and corrective demonstrations/preferences. Random weight
perturbation with selection is one search method, not a solution to assigning
consequences to the responsible decisions or representations. Avoid training
only on the agent's own narration or agreement between models.

Experience can accumulate continuously while updates run at different rates:
immediate working-state changes, episodic memory, small policy/parameter updates
and slower consolidation. Adapters or selected trainable layers offer a first
experiment with genuine parameter learning; broader weight updates remain a
research option. Replay earlier grounded experiences alongside new ones, retain
recoverable checkpoints and measure both retention and continued adaptability.
These mechanisms mitigate risks rather than guarantee stability. Starting from
pretrained models studies development on top of substantial prior training,
not learning a mind from a blank initial state.

**Useful first study.** Give the embodied system repeated opportunities to learn
from a small part of Crater Lake, then change conditions and test transfer.
Compare otherwise matched systems with memory only, parameter learning only,
both, and neither. Measure acquisition, retention, recovery from mistaken
beliefs, adaptation to new conditions and continued learning across multiple
runs. Separate better action/prediction from a more convincing self-description.
The engineering hypothesis is that integration and grounded learning can produce
history-dependent competence; whether this constitutes a mind remains open.

Sources checked on 2026-10-06:

- [Liquid's LFM2 architecture and training](https://www.liquid.ai/blog/liquid-foundation-models-v2-our-second-series-of-generative-ai-models).
- [LFM2.5 vision/audio family](https://www.liquid.ai/blog/introducing-lfm2-5-the-next-generation-of-on-device-ai), [Thinking model card](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Thinking), and [fine-tuning guidance](https://docs.liquid.ai/lfm/help/troubleshooting).
- [Overcoming catastrophic forgetting in neural networks](https://arxiv.org/abs/1612.00796).
- [Loss of plasticity in deep continual learning](https://www.nature.com/articles/s41586-024-07711-7).
- [AI models collapse when trained on recursively generated data](https://www.nature.com/articles/s41586-024-07566-y).
- [Voyager](https://arxiv.org/abs/2305.16291): embodied skill acquisition through feedback and an external skill library without language-model weight updates.
- [V-JEPA 2 research](https://ai.meta.com/research/publications/v-jepa-2-self-supervised-video-models-enable-understanding-prediction-and-planning/): learned representations and action-conditioned prediction for planning; a possible complementary component, not a complete cognitive architecture.
