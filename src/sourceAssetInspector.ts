// Developer-only authoring pilot for the ORIGINAL Poly Haven fir variants A/B
// with an original-vs-procedural bark comparison. It loads one variant at a
// time at full source detail from the untouched source glTF and never touches
// our exported packs/, cards or pipeline output. Kept separate from gameplay
// and the default production build: this module is loaded only by
// harness/sourceAsset.html, never by src/main.ts. The variant/bark selects
// are authoring controls for this pilot, not game feature settings.

// Whole Babylon packages first (repo rule: Babylon first, import whole
// packages), then the specific symbols this screen uses. The whole-package
// imports must stay: they run the side-effect registrations (TypeStore
// "BABYLON.*" block classes, NodeMaterial.Parse) that the procedural bark
// graph JSON depends on at parse time.
import "@babylonjs/core";
import "@babylonjs/loaders";
// Local KTX2 decoder config (no CDN fetches): the procedural bark graph
// samples a .ktx2 normal map, so this must run before the material parses.
import "./core/ktx2";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import type { FreeCameraKeyboardMoveInput } from "@babylonjs/core/Cameras/Inputs/freeCameraKeyboardMoveInput";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import { Color4, RegisterMathColor } from "@babylonjs/core/Maths/math.color";
import { RegisterMathVector, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import { NodeMaterial } from "@babylonjs/core/Materials/Node/nodeMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { NodeGeometry } from "@babylonjs/core/Meshes/Node/nodeGeometry";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Material } from "@babylonjs/core/Materials/material";
import type { MeshBlock } from "@babylonjs/core/Meshes/Node/Blocks/Sources/meshBlock";
import type { GeometryInputBlock } from "@babylonjs/core/Meshes/Node/Blocks/geometryInputBlock";

// Untouched source asset: the 4k glTF Codex downloaded. The scene inside holds
// fir_tree_01_a_LOD0 and fir_tree_01_b_LOD0 (variant C is out of scope for this
// pilot); the meshNames filter imports only the selected variant, nothing else.
const SOURCE_URL = "/tools/.cache/flora/src/fir_tree_01/gltf/fir_tree_01_4k.gltf";
type Variant = "a" | "b";
const MESH_NAMES: Record<Variant, string> = {
  a: "fir_tree_01_a_LOD0",
  b: "fir_tree_01_b_LOD0",
};

// Native NME bark graph authored by Codex: procedural grey-bark base plus
// Phantom Ship scaly normal relief sampled from bark_scales_normal.ktx2
// through UV2 with native PerturbNormal. Fetched fresh on every load so
// graph edits show up without a cache clear. Defaults live in the graph;
// this screen never overrides its uniforms. UV2 itself is authored below by
// the native NGE scaleUV graph, so the source's bark atlas never matters.
const GRAPH_URL = "/tools/materials/bark/pilot.json";

// Native NGE mapping (MeshBlock -> cylindrical MappingBlock -> SetUVs on
// channel 1) that authors the UV2 channel the bark graph samples. Fetched
// once per page load (no-store) and reused for every woody mesh; never
// edited here.
const SCALE_UV_GRAPH_URL = "/tools/materials/bark/scaleUV.json";

// Only bark/trunk/dead-branch materials are swapped in procedural mode and
// receive authored UV2. Foliage (fir_tree_01_twig) keeps its original source
// material in both modes and never gets UV2.
const BARK_MATERIAL_NAMES = new Set([
  "fir_tree_01_bark",
  "fir_tree_01_trunk_a",
  "fir_tree_01_trunk_b",
  "fir_tree_01_dead_branches",
]);

type Bark = "original" | "procedural";

async function main(): Promise<void> {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  const status = document.getElementById("status") as HTMLElement;
  const resetButton = document.getElementById("resetView") as HTMLButtonElement;
  const closeButton = document.getElementById("closeBark") as HTMLButtonElement;
  const variantSelect = document.getElementById("variantSelect") as HTMLSelectElement;
  const barkSelect = document.getElementById("barkSelect") as HTMLSelectElement;

  // Standard Babylon engine/scene: no optimizer, game plugins, terrain,
  // ground, grid, skybox or added geometry on this screen.
  const engine = new Engine(canvas, true);
  const scene = new Scene(engine);
  // Neutral studio backdrop; the asset's own materials/textures are untouched.
  scene.clearColor = new Color4(0.11, 0.12, 0.13, 1);

  // Free-fly inspector camera with the same look as the game: WASD moves,
  // arrows or mouse-drag looks, Shift runs faster, Space/C rises and sinks.
  // All movement and rotation is native Babylon input (the stock keyboard
  // and mouse inputs below); this screen adds no physics, meshes, actions,
  // settings or custom movement code, and no separate touch/gesture layer.
  const camera = new UniversalCamera("inspectorCamera", new Vector3(0, 2, -10), scene);
  camera.setTarget(Vector3.Zero());
  // Game key map (see FreeCameraKeyboardMoveInput.d.ts in the installed
  // source): WASD move, arrows rotate the head, Space/C rise/sink. The
  // camera proxies below write straight through to the native keyboard
  // input, so nothing here is hand-rolled movement.
  camera.keysUp = [87];
  camera.keysDown = [83];
  camera.keysLeft = [65];
  camera.keysRight = [68];
  camera.keysUpward = [32];
  camera.keysDownward = [67];
  camera.keysRotateLeft = [37];
  camera.keysRotateRight = [39];
  camera.keysRotateUp = [38];
  camera.keysRotateDown = [40];
  // Game head-turn rate (PlayerController ROTATION_SPEED): applied to the
  // native keyboard-rotation input, not to custom code.
  const nativeKeyboard = (camera.inputs.attached as unknown as Record<string, FreeCameraKeyboardMoveInput | undefined>)[
    "keyboard"
  ];
  if (nativeKeyboard) {
    nativeKeyboard.rotationSpeed = 0.03;
  }
  // Slow drift near the trunk so bark relief can be inspected; Shift steps
  // up to a faster native speed and back on release (a minimal speed
  // assignment, not custom movement).
  const BASE_SPEED = 2;
  const FAST_SPEED = 6;
  camera.speed = BASE_SPEED;
  window.addEventListener("keydown", (event) => {
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      camera.speed = FAST_SPEED;
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      camera.speed = BASE_SPEED;
    }
  });
  // Native mouse look, bound to the scene canvas with browser defaults
  // prevented while attached. Click focuses the canvas for keys; tabindex
  // makes it focusable in the first place.
  canvas.tabIndex = 0;
  camera.attachControl(false);
  canvas.addEventListener("click", () => canvas.focus());
  canvas.focus();

  // Plain inspection lighting: soft hemispheric fill plus a key directional
  // light, alongside stock PBR image-based lighting from the .env texture.
  // The native NME PBR bark graph lights through these same active lights and
  // the environment texture, so no custom shader code or plugins are needed.
  // None of this alters the imported asset; it only lights the viewport.
  const hemi = new HemisphericLight("inspectorHemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.9;
  const key = new DirectionalLight("inspectorKey", new Vector3(-0.5, -1, 0.4), scene);
  key.intensity = 1.2;
  scene.environmentTexture = CubeTexture.CreateFromPrefilteredData("/textures/environment.env", scene);

  // Framing chosen after import from the real world bounds of the variant.
  // Only meshes with actual vertices count: the glTF __root__ node imports
  // with zero vertices and its bounds sit at the origin, which would drag the
  // framing away from the tree if included.
  const home = { position: new Vector3(0, 2, -10), target: Vector3.Zero() };
  const resetInertia = (): void => {
    // Clear any in-flight native glide first, otherwise a recent drag keeps
    // carrying the camera away from home after the reset.
    camera.cameraDirection.setAll(0);
    camera.cameraRotation.setAll(0);
  };
  const frameCameraOnMeshes = (realMeshes: AbstractMesh[]): void => {
    let min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    let max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
    for (const mesh of realMeshes) {
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      min = Vector3.Minimize(min, bounds.minimumWorld);
      max = Vector3.Maximize(max, bounds.maximumWorld);
    }
    const center = min.add(max).scale(0.5);
    const size = Math.max(max.subtract(min).length(), 0.001);
    // Fit the variant from a three-quarter view above horizontal: the
    // distance comes from the bounding-sphere radius and the camera fov,
    // with a small margin so foliage never touches the frame edge.
    const direction = new Vector3(1, 0.55, 1).normalize();
    const fitDistance = ((size / 2) / Math.tan(camera.fov / 2)) * 1.25;
    camera.position.copyFrom(center.add(direction.scale(fitDistance)));
    camera.setTarget(center);
    home.position = camera.position.clone();
    home.target = camera.getTarget().clone();
    // Close detail down to 1% of the asset size (minZ scaled to match so
    // near geometry never clips).
    camera.minZ = size * 0.0001;
    camera.maxZ = size * 200;
  };
  const resetView = (): void => {
    resetInertia();
    camera.position.copyFrom(home.position);
    camera.setTarget(home.target.clone());
  };
  // Single reset listener for the life of the page: home is refreshed on every
  // variant change, so reset always matches the current variant. T resets too.
  resetButton.addEventListener("click", () => {
    resetView();
    canvas.focus();
  });
  window.addEventListener("keydown", (event) => {
    if (event.code === "KeyT" && !event.repeat) {
      const target = event.target as HTMLElement | null;
      if (target !== null && (target.tagName === "SELECT" || target.tagName === "INPUT")) {
        return;
      }
      resetView();
    }
  });

  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());
  // Dispose the engine (which disposes the scene) when leaving the page.
  window.addEventListener("unload", () => engine.dispose());

  // Pilot state. Exactly one variant's meshes are in the scene at a time;
  // originalMaterials remembers each current mesh's source material so bark
  // mode can be swapped without reimporting.
  let variant: Variant = "a";
  let bark: Bark = "procedural";
  let currentRoots: AbstractMesh[] = [];
  let currentMeshes: AbstractMesh[] = [];
  let originalMaterials = new Map<AbstractMesh, Material | null>();
  let proceduralMaterial: NodeMaterial | null = null;
  let proceduralGraphError: string | null = null;
  // Native NGE scaleUV graph source, fetched once per page (no-store) and
  // reused for every woody mesh of both variants.
  let scaleUVGraphSource: unknown | null = null;
  // Variant switches run one at a time through this chain, so large glTF
  // binaries never import concurrently; every queued request still runs to
  // completion in order. Bumped on each committed switch so bark readiness can
  // tell whether the tree it verified is still the current one.
  let variantChain: Promise<void> = Promise.resolve();
  let queuedSwitches = 0;
  let treeGeneration = 0;

  // Bound for any shader/scene readiness wait. scene.whenReadyAsync is
  // deliberately not used anywhere on this screen: it can wait on scene-wide
  // state that never settles and hang the awaiting caller (and any browser
  // tooling driving __assetInspector) indefinitely.
  const READY_TIMEOUT_MS = 15000;

  const triangleCount = (meshes: AbstractMesh[]): number => {
    let triangles = 0;
    for (const mesh of meshes) {
      triangles += mesh.getTotalIndices() / 3;
    }
    return Math.round(triangles);
  };

  const setStatusReady = (): void => {
    status.dataset.status = "ready";
    status.textContent =
      `Ready — Tree ${variant.toUpperCase()}, ${bark} bark, ` +
      `${currentMeshes.length} mesh(es), ~${triangleCount(currentMeshes).toLocaleString()} triangles.`;
  };

  // Compiles every affected mesh/material through the native engine path and
  // rejects with the real shader error; the timeout turns a never-settling
  // wait into a readable error instead of hanging the caller. Ready must
  // never mean a fallback texture: the engine substitutes its default red
  // checker and still reports ready, so every active texture is inspected
  // for a load error afterwards and any fallback rejects like a compile
  // failure (callers roll back to the previous bark/tree on error).
  const awaitMaterialsReady = async (meshes: AbstractMesh[], label: string): Promise<void> => {
    const compile = Promise.all(
      meshes
        .filter((mesh) => mesh.material !== null && mesh.material !== undefined)
        .map((mesh) => (mesh.material as Material).forceCompilationAsync(mesh)),
    );
    // The race below reports failures; swallow a late rejection here so a
    // timeout win does not surface as an unhandled rejection later.
    compile.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        compile,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`${label} did not finish within ${READY_TIMEOUT_MS / 1000}s`));
          }, READY_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
    const fallbacks: string[] = [];
    for (const mesh of meshes) {
      const material = mesh.material;
      if (material === null || material === undefined) {
        continue;
      }
      for (const texture of material.getActiveTextures()) {
        if (texture.loadingError) {
          const detail = texture.errorObject?.message ?? "unknown load error";
          fallbacks.push(`${texture.name} (${detail})`);
        }
      }
    }
    if (fallbacks.length > 0) {
      throw new Error(`${label} used fallback textures: ${[...new Set(fallbacks)].join("; ")}`);
    }
  };

  // Top-level nodes of an import; disposing them disposes their children too.
  // Plain dispose leaves materials and textures alone
  // (disposeMaterialAndTextures defaults to false), so nothing shared with
  // another variant is pulled out from under it.
  const topRoots = (meshes: AbstractMesh[]): AbstractMesh[] =>
    meshes.filter((mesh) => mesh.parent === null || !meshes.includes(mesh.parent as AbstractMesh));

  // Parses the bark graph once and reuses the single material for every bark
  // mesh. backFaceCulling stays off to preserve the source's double-sided
  // trunk materials; everything else is the graph default. The shader language
  // follows the engine (GLSL on this screen's WebGL engine).
  const ensureProceduralMaterial = async (): Promise<NodeMaterial> => {
    if (proceduralMaterial) {
      return proceduralMaterial;
    }
    const response = await fetch(GRAPH_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Graph ${GRAPH_URL} returned HTTP ${response.status}`);
    }
    const json = await response.json();
    // Explicit math/color registration before parse: the graph JSON carries
    // BABYLON.Vector3/Color3 value types plus dimension/rank metadata that the
    // NME input blocks resolve at parse time. Idempotent when the whole-package
    // side effects above already ran.
    RegisterMathVector();
    RegisterMathColor();
    const parsed = NodeMaterial.Parse(
      json,
      scene,
      "",
      engine.isWebGPU ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
    );
    parsed.name = "proceduralBarkPilot";
    parsed.backFaceCulling = false;
    // Opaque wood: the graph's alpha output makes the parsed material
    // auto-transparent, but bark is solid wood, so force opacity. Material
    // correctness, not a quality switch: foliage keeps its original alpha.
    parsed.ignoreAlpha = true;
    parsed.transparencyMode = Material.MATERIAL_OPAQUE;
    if (parsed.buildIsInProgress) {
      await new Promise<void>((resolve, reject) => {
        const buildObserver = parsed.onBuildObservable.addOnce(() => {
          parsed.onBuildErrorObservable.remove(errorObserver);
          resolve();
        });
        const errorObserver = parsed.onBuildErrorObservable.addOnce((reason) => {
          parsed.onBuildObservable.remove(buildObserver);
          reject(new Error(String(reason)));
        });
      });
    }
    proceduralMaterial = parsed;
    return parsed;
  };

  // Fetches the native NGE scaleUV graph once per page (no-store, so graph
  // edits show without a cache clear) and reuses the cached source for every
  // woody mesh afterwards.
  const ensureScaleUVGraphSource = async (): Promise<unknown> => {
    if (scaleUVGraphSource !== null) {
      return scaleUVGraphSource;
    }
    const response = await fetch(SCALE_UV_GRAPH_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Graph ${SCALE_UV_GRAPH_URL} returned HTTP ${response.status}`);
    }
    scaleUVGraphSource = await response.json();
    return scaleUVGraphSource;
  };

  // Derives the shared cylindrical axis for one imported variant from the
  // main trunk mesh's original positions: mean X/Z of vertices in the
  // near-base band (minY + 0.75m .. minY + 1.25m), Y pinned to 0. Falls back
  // to the raw-position bounds centre X/Z when the band is empty (or the
  // trunk mesh/positions are missing, using the woody meshes instead). The
  // same centre feeds the bark and dead-branch mappings so their fingernail
  // scales agree. Authoring-only: nothing here runs in gameplay.
  const trunkCentreForVariant = (
    next: Variant,
    woody: AbstractMesh[],
    originals: Map<AbstractMesh, Material | null>,
  ): Vector3 => {
    const trunkName = `fir_tree_01_trunk_${next}`;
    const trunk = woody.find((mesh) => originals.get(mesh)?.name === trunkName) ?? null;
    const sources = trunk !== null ? [trunk] : woody;
    // Raw positions from the same vertex data the NGE MeshBlock consumes
    // below, so the centre agrees with the mapping it feeds.
    const clouds: ArrayLike<number>[] = [];
    for (const mesh of sources) {
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
      if (positions !== null && positions.length >= 3) {
        clouds.push(positions);
      }
    }
    let minY = Number.POSITIVE_INFINITY;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const positions of clouds) {
      for (let i = 0; i + 2 < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];
        if (y < minY) {
          minY = y;
        }
        if (x < minX) {
          minX = x;
        }
        if (x > maxX) {
          maxX = x;
        }
        if (z < minZ) {
          minZ = z;
        }
        if (z > maxZ) {
          maxZ = z;
        }
      }
    }
    if (!Number.isFinite(minY)) {
      return Vector3.Zero();
    }
    let sumX = 0;
    let sumZ = 0;
    let bandCount = 0;
    const bandLow = minY + 0.75;
    const bandHigh = minY + 1.25;
    for (const positions of clouds) {
      for (let i = 0; i + 2 < positions.length; i += 3) {
        const y = positions[i + 1];
        if (y >= bandLow && y <= bandHigh) {
          sumX += positions[i];
          sumZ += positions[i + 2];
          bandCount += 1;
        }
      }
    }
    // Y stays 0: the authored graph's cylindrical axis is vertical through
    // the trunk base, so only the X/Z centre matters.
    if (bandCount > 0) {
      return new Vector3(sumX / bandCount, 0, sumZ / bandCount);
    }
    return new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  };

  // Runs the native NGE scaleUV graph per woody mesh to author UV2 in place:
  // the MeshBlock reads the imported mesh, the cylindrical MappingBlock
  // projects UVs around the shared trunk centre, and SetUVs writes channel
  // 1 (UV2) only. No hand-written UV math anywhere on this screen. Original
  // positions, normals, indices and UV1 are never touched: only the fresh
  // UV2 array is uploaded, and count asserts guard against any graph edit
  // that would alter topology. vertexData.applyToMesh is deliberately never
  // used.
  const authorBarkUV2 = async (
    next: Variant,
    realMeshes: AbstractMesh[],
    originals: Map<AbstractMesh, Material | null>,
  ): Promise<void> => {
    const woody = realMeshes.filter((mesh) => {
      const name = originals.get(mesh)?.name;
      return name !== undefined && BARK_MATERIAL_NAMES.has(name);
    });
    if (woody.length === 0) {
      return;
    }
    const graphSource = await ensureScaleUVGraphSource();
    const centre = trunkCentreForVariant(next, woody, originals);
    for (const mesh of woody) {
      const originalPositions = mesh.getVerticesData(VertexBuffer.PositionKind);
      const originalNormals = mesh.getVerticesData(VertexBuffer.NormalKind);
      const originalIndices = mesh.getIndices();
      if (originalPositions === null || originalIndices === null) {
        throw new Error(`Mesh ${mesh.name} has no readable positions/indices for UV2 authoring`);
      }
      const vertexCount = originalPositions.length / 3;
      const graph = new NodeGeometry(`barkScaleUV_${mesh.name}`);
      try {
        // parseSerializedObject (not Parse): Parse would auto-build before
        // the MeshBlock below is bound to the imported mesh.
        graph.parseSerializedObject(graphSource);
        const sourceMesh = graph.getBlockByName("sourceMesh") as unknown as MeshBlock | null;
        const trunkCentre = graph.getBlockByName("trunkCentre") as unknown as GeometryInputBlock | null;
        if (sourceMesh === null || trunkCentre === null) {
          throw new Error(`Graph ${SCALE_UV_GRAPH_URL} is missing its sourceMesh/trunkCentre blocks`);
        }
        sourceMesh.mesh = mesh as Mesh;
        trunkCentre.value = centre.clone();
        graph.build();
        const built = graph.vertexData;
        if (built?.positions === null || built?.positions === undefined) {
          throw new Error(`Graph ${SCALE_UV_GRAPH_URL} built no geometry for ${mesh.name}`);
        }
        if (
          built.positions.length !== originalPositions.length ||
          (built.normals?.length ?? 0) !== (originalNormals?.length ?? 0) ||
          (built.indices?.length ?? 0) !== originalIndices.length
        ) {
          throw new Error(
            `Graph ${SCALE_UV_GRAPH_URL} changed ${mesh.name} topology ` +
              `(positions ${originalPositions.length}->${built.positions.length}, ` +
              `normals ${originalNormals?.length ?? 0}->${built.normals?.length ?? 0}, ` +
              `indices ${originalIndices.length}->${built.indices?.length ?? 0}); UV2 not applied`,
          );
        }
        const uvs2 = built.uvs2;
        if (uvs2 === null || uvs2 === undefined || uvs2.length !== vertexCount * 2) {
          throw new Error(`Graph ${SCALE_UV_GRAPH_URL} produced no UV2 for ${mesh.name}`);
        }
        (mesh as Mesh).setVerticesData(VertexBuffer.UV2Kind, uvs2, false);
      } finally {
        graph.dispose();
      }
    }
  };

  // Swaps bark materials on the current meshes only; the camera is untouched
  // so original/procedural can be compared from the exact same viewpoint.
  const applyBark = (mode: Bark): void => {
    for (const [mesh, original] of originalMaterials) {
      const originalName = original?.name ?? mesh.material?.name;
      if (originalName === undefined || !BARK_MATERIAL_NAMES.has(originalName)) {
        continue;
      }
      mesh.material = mode === "procedural" && proceduralMaterial ? proceduralMaterial : original;
    }
  };

  const setBarkMode = async (mode: Bark): Promise<void> => {
    if (mode === bark && (mode === "original" || proceduralMaterial !== null)) {
      barkSelect.value = mode;
      return;
    }
    if (mode === "procedural" && proceduralMaterial === null) {
      status.dataset.status = "loading";
      status.textContent = "Loading procedural bark graph…";
      try {
        await ensureProceduralMaterial();
        proceduralGraphError = null;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        proceduralGraphError = detail;
        // Fall back to the untouched source bark; the tree stays visible.
        bark = "original";
        barkSelect.value = "original";
        applyBark("original");
        status.dataset.status = "error";
        status.textContent = `Procedural bark unavailable (${detail}); showing original bark.`;
        return;
      }
    }
    bark = mode;
    barkSelect.value = mode;
    const targets = currentMeshes.slice();
    const previous = new Map<AbstractMesh, Material | null>();
    for (const mesh of targets) {
      previous.set(mesh, mesh.material);
    }
    applyBark(mode);
    if (targets.length === 0) {
      return;
    }
    // Readiness gates the success status: report the new bark only once its
    // shaders actually compiled and its textures loaded for real (a fallback
    // texture rejects like a compile failure). Bounded, so a stuck compile
    // surfaces as an error instead of hanging this promise (and the caller)
    // forever.
    const generation = treeGeneration;
    status.dataset.status = "loading";
    status.textContent = `Compiling ${mode} bark shaders…`;
    try {
      await awaitMaterialsReady(targets, `${mode} bark shader compilation`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // Restore the exact pre-switch materials on the same meshes; the tree
      // is never left wearing a failed material.
      for (const [mesh, material] of previous) {
        mesh.material = material;
      }
      if (bark === mode) {
        bark = "original";
        barkSelect.value = "original";
      }
      status.dataset.status = "error";
      status.textContent =
        `${mode === "procedural" ? "Procedural" : "Original"} bark failed (${detail}); restored original bark.`;
      return;
    }
    // A variant switch may have replaced the tree mid-compile; only claim
    // success for the tree actually verified.
    if (generation === treeGeneration) {
      setStatusReady();
    }
  };

  // Variant failure helper: drops whatever the failed attempt imported and
  // leaves the prior variant, roots, material map and selects untouched, so
  // the old tree survives.
  const failVariant = (meshName: string, imported: AbstractMesh[] | null, error: unknown): void => {
    if (imported !== null) {
      for (const root of topRoots(imported)) {
        root.dispose();
      }
    }
    variantSelect.value = variant;
    barkSelect.value = bark;
    const detail = error instanceof Error ? error.message : String(error);
    const kept = currentMeshes.length > 0 ? ` Tree ${variant.toUpperCase()} kept.` : "";
    status.dataset.status = "error";
    status.textContent = `Failed to load ${meshName}: ${detail}.${kept}`;
  };

  const runVariantSwitch = async (next: Variant): Promise<void> => {
    if (next === variant && currentMeshes.length > 0) {
      variantSelect.value = next;
      return;
    }
    const meshName = MESH_NAMES[next];
    status.dataset.status = "loading";
    status.textContent = `Loading ${meshName}…`;
    // Module-level ImportMeshAsync per the installed sceneLoader.d.ts: the
    // meshNames option filters to one variant only. Geometry, scale,
    // transforms, material textures and alpha stay exactly as authored.
    let imported: AbstractMesh[] | null = null;
    try {
      const result = await ImportMeshAsync(SOURCE_URL, scene, {
        meshNames: meshName,
        onProgress: (event) => {
          if (event.lengthComputable && event.total > 0) {
            const percent = Math.round((event.loaded / event.total) * 100);
            status.textContent = `Loading ${meshName}… ${percent}%`;
          } else {
            status.textContent = `Loading ${meshName}…`;
          }
        },
      });
      imported = result.meshes;
    } catch (error) {
      failVariant(meshName, null, error);
      return;
    }
    if (imported.length === 0) {
      failVariant(meshName, imported, new Error(`Mesh ${meshName} not found in ${SOURCE_URL}`));
      return;
    }
    // Drop zero-vertex nodes (the glTF __root__) before framing so the
    // bounds — and zoomOn — see only the real tree geometry.
    const realMeshes = imported.filter((mesh) => mesh.getTotalVertices() > 0);
    if (realMeshes.length === 0) {
      failVariant(
        meshName,
        imported,
        new Error(`Mesh ${meshName} imported with no renderable geometry from ${SOURCE_URL}`),
      );
      return;
    }
    // Stage the new tree fully before committing: nothing global changes until
    // the import below is verified ready, so a failure cannot strand a half
    // swapped state.
    const nextOriginals = new Map<AbstractMesh, Material | null>();
    for (const mesh of realMeshes) {
      nextOriginals.set(mesh, mesh.material);
    }
    // Author UV2 on the woody meshes now: after the original import, before
    // any procedural material assignment or shader compilation. A failure
    // drops the staged import and keeps the previous tree, like any other
    // load failure.
    try {
      await authorBarkUV2(next, realMeshes, nextOriginals);
    } catch (error) {
      failVariant(meshName, imported, error);
      return;
    }
    const effectiveBark: Bark = bark === "procedural" && proceduralMaterial !== null ? "procedural" : "original";
    for (const [mesh, original] of nextOriginals) {
      const originalName = original?.name;
      if (originalName !== undefined && BARK_MATERIAL_NAMES.has(originalName)) {
        mesh.material = effectiveBark === "procedural" ? proceduralMaterial : original;
      }
    }
    status.textContent = `Compiling ${meshName}…`;
    try {
      await awaitMaterialsReady(realMeshes, `${meshName} shader compilation`);
    } catch (error) {
      failVariant(meshName, imported, error);
      return;
    }
    // Commit: the new tree is ready, so retire the old one. The camera
    // reframes here (and refreshes the reset home) while bark switches keep
    // the viewpoint.
    const fellBack = effectiveBark !== bark;
    const previousRoots = currentRoots;
    originalMaterials = nextOriginals;
    currentRoots = topRoots(imported);
    currentMeshes = realMeshes;
    treeGeneration += 1;
    bark = effectiveBark;
    barkSelect.value = effectiveBark;
    variant = next;
    variantSelect.value = next;
    frameCameraOnMeshes(realMeshes);
    for (const root of previousRoots) {
      root.dispose();
    }
    if (fellBack && proceduralGraphError !== null) {
      // The graph is still loading or failed: show the original bark rather
      // than a half-applied swap, and say so in the status line.
      status.dataset.status = "error";
      status.textContent =
        `Ready — Tree ${variant.toUpperCase()}, original bark ` +
        `(procedural graph failed: ${proceduralGraphError}), ` +
        `${currentMeshes.length} mesh(es), ~${triangleCount(currentMeshes).toLocaleString()} triangles.`;
    } else {
      setStatusReady();
    }
  };

  // Queues the switch behind any in-flight one instead of racing it, and
  // keeps both selects disabled until the queue drains. Each caller still gets
  // its own promise, which always settles (runVariantSwitch reports failures
  // via status, never by throwing).
  const setVariantMode = (next: Variant): Promise<void> => {
    if (next === variant && currentMeshes.length > 0 && queuedSwitches === 0) {
      variantSelect.value = next;
      return Promise.resolve();
    }
    queuedSwitches += 1;
    variantSelect.disabled = true;
    barkSelect.disabled = true;
    const task = variantChain.then(() => runVariantSwitch(next));
    const settle = task.then(
      () => undefined,
      () => undefined,
    );
    variantChain = settle;
    void settle.finally(() => {
      queuedSwitches -= 1;
      if (queuedSwitches === 0) {
        variantSelect.disabled = false;
        barkSelect.disabled = false;
      }
    });
    return task;
  };

  // Selects are authoring controls for this pilot only, not game settings.
  variantSelect.addEventListener("change", () => {
    void setVariantMode(variantSelect.value as Variant);
  });
  barkSelect.addEventListener("change", () => {
    void setBarkMode(barkSelect.value as Bark);
  });

  // Close bark detail: step to about 1m outside the trunk at ~2m height and
  // aim at the stem so the relief fills the viewport. The centre comes from
  // the same authoring trunk-centre helper as the UV2 mapping; the fixed 1m
  // offset stays clear of the trunk surface (inside geometry would hide the
  // bark). Bark switches keep the viewpoint, so this pairs with A/B compare.
  closeButton.addEventListener("click", () => {
    const woody = currentMeshes.filter((mesh) => {
      const name = originalMaterials.get(mesh)?.name ?? mesh.material?.name;
      return name !== undefined && BARK_MATERIAL_NAMES.has(name);
    });
    const sources = woody.length > 0 ? woody : currentMeshes.slice();
    if (sources.length === 0) {
      return;
    }
    const centre = trunkCentreForVariant(variant, sources, originalMaterials);
    let baseY = Number.POSITIVE_INFINITY;
    for (const mesh of currentMeshes) {
      mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      if (bounds.minimumWorld.y < baseY) {
        baseY = bounds.minimumWorld.y;
      }
    }
    if (!Number.isFinite(baseY)) {
      baseY = 0;
    }
    const height = baseY + 2;
    const outward = new Vector3(1, 0, 1).normalize();
    resetInertia();
    camera.position.set(centre.x + outward.x, height, centre.z + outward.z);
    camera.setTarget(new Vector3(centre.x, height, centre.z));
    canvas.focus();
  });

  // Expose the live scene and the pilot controls for Codex inspection
  // (explicit casts, as required).
  (window as unknown as { __assetInspectorScene: Scene }).__assetInspectorScene = scene;
  (window as unknown as { __assetInspector: unknown }).__assetInspector = {
    scene,
    setVariant: (next: Variant) => setVariantMode(next),
    setBark: (mode: Bark) => setBarkMode(mode),
    get variant(): Variant {
      return variant;
    },
    get bark(): Bark {
      return bark;
    },
  };

  // Boot with Tree A in original bark, then upgrade to procedural bark once
  // the graph parses. If the graph is missing, the viewer still works with
  // the original bark and the bark select falls back to match.
  await setVariantMode("a");
  try {
    await ensureProceduralMaterial();
    proceduralGraphError = null;
    if (barkSelect.value === "original") {
      await setBarkMode("procedural");
    }
  } catch (error) {
    proceduralGraphError = error instanceof Error ? error.message : String(error);
    bark = "original";
    barkSelect.value = "original";
    if (currentMeshes.length > 0) {
      status.dataset.status = "error";
      status.textContent =
        `Ready — Tree ${variant.toUpperCase()}, original bark ` +
        `(procedural graph failed: ${proceduralGraphError}), ` +
        `${currentMeshes.length} mesh(es), ~${triangleCount(currentMeshes).toLocaleString()} triangles.`;
    } else {
      status.dataset.status = "error";
      status.textContent = `Failed to start viewer: ${proceduralGraphError}`;
    }
  }
}

void main();
