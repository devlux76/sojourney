import type { Biome } from "./Biome";

export interface BiomeSummary { id: string; name: string; blurb: string; thumbnailUrl: string }

export const BIOME_SUMMARIES: BiomeSummary[] = [
  { id: "crater-lake", name: "Crater Lake", blurb: "Wood smoke, cold water, huckleberries.",
    thumbnailUrl: "packs/crater-lake/thumbnail.jpg" },
];

const LOADERS: Record<string, () => Promise<{ default: Biome }>> = {
  "crater-lake": () => import("./crater-lake/index"),
};

export function loadBiomeModule(id: string): Promise<Biome> {
  const load = LOADERS[id];
  if (!load) throw new Error(`Unknown biome: ${id}`);
  return load().then(m => m.default);
}
