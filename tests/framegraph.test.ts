import { expect, test } from "bun:test";
import graph from "../src/engine/framegraph/sojourney.json";

const blocks = graph.blocks as Array<{
  customType: string;
  id: number;
  inputs: Array<{ name: string; targetBlockId?: number }>;
}>;

test("stripped-scene framegraph contains one fully connected render path", () => {
  expect(blocks).toHaveLength(13);
  expect(blocks.filter(block => block.customType.endsWith("NodeRenderGraphOutputBlock"))).toHaveLength(1);
  expect(blocks.filter(block => block.customType.endsWith("NodeRenderGraphObjectRendererBlock"))).toHaveLength(1);
  expect(blocks.filter(block => block.customType.endsWith("NodeRenderGraphCascadedShadowGeneratorBlock"))).toHaveLength(1);
  const shadows = blocks.find(block => block.customType.endsWith("NodeRenderGraphCascadedShadowGeneratorBlock")) as typeof blocks[number] & { filter?: number };
  expect(shadows.filter).toBe(7);

  const clear = blocks.find(block => block.customType.endsWith("NodeRenderGraphClearBlock")) as typeof blocks[number] & { color?: number[] };
  expect(clear.color).toBeDefined();
  const imageProcessing = blocks.find(block => block.customType.endsWith("NodeRenderGraphImageProcessingPostProcessBlock")) as typeof blocks[number] & { vignetteColor?: number[] };
  expect(imageProcessing.vignetteColor).toEqual([0, 0, 0, 1]);

  for (const block of blocks) {
    for (const input of block.inputs) {
      if (["dependencies", "target", "geomDepth"].includes(input.name)) continue;
      expect(input.targetBlockId).toBeDefined();
    }
  }
});
