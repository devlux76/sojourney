import { NodeRenderGraph } from "@babylonjs/core/FrameGraph/Node/nodeRenderGraph";
import "@babylonjs/core/FrameGraph/Node/Blocks/allBlocks";
import "@babylonjs/core/FrameGraph/Node/Blocks/Textures/clearBlock";
import "@babylonjs/core/FrameGraph/Node/Blocks/cullObjectsBlock";
import "@babylonjs/core/FrameGraph/Node/Blocks/Rendering/objectRendererBlock";
import "@babylonjs/core/FrameGraph/Node/Blocks/Rendering/csmShadowGeneratorBlock";
import "@babylonjs/core/FrameGraph/Node/Blocks/PostProcesses/imageProcessingPostProcessBlock";
import "@babylonjs/core/FrameGraph/Node/Blocks/PostProcesses/bloomPostProcessBlock";
import "@babylonjs/core/FrameGraph/Node/Blocks/PostProcesses/sharpenPostProcessBlock";
import "@babylonjs/core/FrameGraph/Node/Blocks/outputBlock";
import type { NodeRenderGraphInputBlock } from "@babylonjs/core/FrameGraph/Node/Blocks/inputBlock";
import type { NodeRenderGraphBlock } from "@babylonjs/core/FrameGraph/Node/nodeRenderGraphBlock";
import type { NodeRenderGraphBloomPostProcessBlock } from "@babylonjs/core/FrameGraph/Node/Blocks/PostProcesses/bloomPostProcessBlock";
import type { NodeRenderGraphImageProcessingPostProcessBlock } from "@babylonjs/core/FrameGraph/Node/Blocks/PostProcesses/imageProcessingPostProcessBlock";
import type { NodeRenderGraphSharpenPostProcessBlock } from "@babylonjs/core/FrameGraph/Node/Blocks/PostProcesses/sharpenPostProcessBlock";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Scene } from "@babylonjs/core/scene";

type SerializedGraph = {
  blocks: Array<{
    customType: string;
    additionalConstructionParameters?: number[];
    creationOptions?: { options?: { samples?: number } };
  }>;
};

const owners = new WeakMap<Scene, SceneFrameGraph>();

export function setFrameGraphExposure(scene: Scene, exposure: number): void {
  owners.get(scene)?.setExposure(exposure);
}

export function setFrameGraphEffectsEnabled(scene: Scene, enabled: boolean): void {
  owners.get(scene)?.setEffectsEnabled(enabled);
}

export function setFrameGraphSamples(scene: Scene, samples: number): void {
  owners.get(scene)?.setSamples(samples);
}

export function setGraphSampleCount(source: SerializedGraph, samples: number): SerializedGraph {
  const copy = structuredClone(source);
  const color = copy.blocks.find(block =>
    block.customType.endsWith("NodeRenderGraphInputBlock") && block.additionalConstructionParameters?.[0] === 1,
  );
  if (!color?.creationOptions?.options) throw new Error("Framegraph color texture input is missing creation options");
  color.creationOptions.options.samples = samples;
  return copy;
}

// Owns the main render graph so its render targets and effects can be rebuilt without putting graph logic in gameplay.
export class SceneFrameGraph {
  private graph: NodeRenderGraph;
  private source: SerializedGraph;
  private requestedSamples: number;
  private rebuildInProgress = false;
  private effectsEnabled = true;
  private imageProcessing!: NodeRenderGraphImageProcessingPostProcessBlock;
  private bloom!: NodeRenderGraphBloomPostProcessBlock;
  private sharpen!: NodeRenderGraphSharpenPostProcessBlock;

  private constructor(private readonly scene: Scene, private readonly camera: Camera, graph: NodeRenderGraph, source: SerializedGraph, samples: number) {
    this.graph = graph;
    this.source = source;
    this.requestedSamples = samples;
    this.imageProcessing = this.requireBlock("NodeRenderGraphImageProcessingPostProcessBlock");
    this.bloom = this.requireBlock("NodeRenderGraphBloomPostProcessBlock");
    this.sharpen = this.requireBlock("NodeRenderGraphSharpenPostProcessBlock");
  }

  static async create(scene: Scene, camera: Camera, samples: number): Promise<SceneFrameGraph> {
    const response = await fetch(new URL("./sojourney.json", import.meta.url));
    if (!response.ok) throw new Error(`Unable to load framegraph JSON: ${response.status} ${response.statusText}`);
    const source = await response.json() as SerializedGraph;
    const graph = this.parse(scene, camera, setGraphSampleCount(source, samples));
    await graph.buildAsync();
    // Scene.render() now enters Babylon's framegraph render implementation, which still runs scene callbacks and render targets.
    const owner = new SceneFrameGraph(scene, camera, graph, source, samples);
    owners.set(scene, owner);
    return owner;
  }

  setExposure(exposure: number): void {
    this.imageProcessing.exposure = exposure;
  }

  setEffectsEnabled(enabled: boolean): void {
    this.effectsEnabled = enabled;
    this.bloom.task.disabled = !enabled;
    this.sharpen.task.disabled = !enabled;
  }

  setSamples(samples: number): void {
    this.requestedSamples = samples;
    if (!this.rebuildInProgress) void this.rebuildForLatestSampleCount();
  }

  dispose(): void {
    owners.delete(this.scene);
    this.graph.dispose();
  }

  private static parse(scene: Scene, camera: Camera, source: SerializedGraph): NodeRenderGraph {
    const graph = NodeRenderGraph.Parse(source, scene, { autoFillExternalInputs: true, rebuildGraphOnEngineResize: true }, true);
    const cameraInput = graph.getInputBlocks().find(block => block.type === 16777216) as NodeRenderGraphInputBlock | undefined;
    if (!cameraInput) throw new Error("Framegraph camera input is missing");
    cameraInput.value = camera;
    scene.cameraToUseForPointers = camera;
    return graph;
  }

  private requireBlock<T extends NodeRenderGraphBlock>(type: string): T {
    const block = this.graph.getBlocksByPredicate(candidate => candidate.getClassName() === type)[0];
    if (!block) throw new Error(`Framegraph block ${type} is missing`);
    return block as T;
  }

  private async rebuildForLatestSampleCount(): Promise<void> {
    this.rebuildInProgress = true;
    try {
      while (this.graph && this.requestedSamples !== this.currentSamples()) {
        const replacement = SceneFrameGraph.parse(this.scene, this.camera, setGraphSampleCount(this.source, this.requestedSamples));
        await replacement.buildAsync(false, true, false);
        const previous = this.graph;
        this.graph = replacement;
        this.imageProcessing = this.requireBlock("NodeRenderGraphImageProcessingPostProcessBlock");
        this.bloom = this.requireBlock("NodeRenderGraphBloomPostProcessBlock");
        this.sharpen = this.requireBlock("NodeRenderGraphSharpenPostProcessBlock");
        this.setEffectsEnabled(this.effectsEnabled);
        this.scene.frameGraph = replacement.frameGraph;
        previous.dispose();
      }
    } catch (error) {
      console.error("Could not rebuild the framegraph for the requested MSAA sample count", error);
    } finally {
      this.rebuildInProgress = false;
      if (this.requestedSamples !== this.currentSamples()) void this.rebuildForLatestSampleCount();
    }
  }

  private currentSamples(): number {
    const input = this.graph.getInputBlocks().find(block => block.type === 1);
    return (input?.creationOptions as { options?: { samples?: number } } | undefined)?.options?.samples ?? 1;
  }
}
