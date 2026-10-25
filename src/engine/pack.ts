export const WATER_Y = 0;

// One quadtree leaf of the ground: a square of size x size metres whose south-west corner is (x, z),
// meshed as a 128 x 128 quad grid. lodDistances[k] is the camera distance beyond which LOD level k + 1 is drawn.
// heightMin/heightScale decode the leaf's uint16 collision samples; centre is the bounding-sphere centre in world metres.
export interface GroundLeaf {
  x: number;
  z: number;
  size: number;
  lodDistances: number[];
  heightMin: number;
  heightScale: number;
  // Close-detail authoring can give one leaf denser collision than the pack default.
  collisionSamples?: number;
  centre: [number, number, number];
}

// One regional normal/AO tile: the url of its linear KTX2 texture and the world rectangle that
// texture covers as west, south, width and height in metres, padded texture rectangle included
// (the texture reaches past the leaf it belongs to by the tile set's padding, so neighbours
// overlap and no seam shows where two tiles meet).
export interface GroundNormalTile {
  url: string;
  bounds: [number, number, number, number];
}

// Registered normal/AO crops at the original bake density (texelMetres). Several
// leaves can reference one region URL; Babylon shares its native texture by URL.
// tiles[leaf id] identifies the region covering that leaf, including its padded bounds. normalAoUrl stays the small whole-map distant
// fallback, drawn until a leaf's tile loads, when it fails, and on block meshes. Packs without
// this field behave exactly as before.
export interface GroundNormalTileSet {
  sourceSize: number;
  texelMetres: number;
  padding: number;
  tiles: GroundNormalTile[];
}
export interface GroundLayer {
  name: string;
  albedoUrl: string;
  normalUrl: string;
  aoUrl: string;
  tileMetres: number;
  tint: number;
}

export interface GroundManifest {
  format: 4;
  sizeMetres: number;
  far: string[];
  // The leaves of each 1 km square joined into one mesh at each of blockLevels (named block_<n>_LOD<level>),
  // drawn in place of those leaves once all of them have reached that level.
  blocksUrl: string;
  blockLevels: number[];
  blocks: { leaves: number[] }[];
  nearUrl: string;
  collisionUrl: string;
  collisionSamples: number;
  leaves: GroundLeaf[];
  lakeMask: { url: string; cells: number };
  // Optional water depth over rect [x0, z0, x1, z1] (one byte per cell, row 0 = south, unitMetres
  // steps); with it the lake shows its bed through the shallows (LakeSurfaceMaterial).
  lakeDepth?: { url: string; rect: [number, number, number, number]; cols: number; rows: number; unitMetres: number };
  // Optional horizon over the same rect: per cell and compass bearing, the rim's elevation angle seen
  // from the water ([azimuth][row][col] bytes in unitDegrees steps); with it the sun and moon leave
  // no glint on water they cannot reach (LakeLight).
  lakeHorizon?: { url: string; rect: [number, number, number, number]; cols: number; rows: number; azimuths: number; unitDegrees: number };
  water: { url: string };
  reflectionProxy: { url: string };
  material: {
    splatmapUrl: string;
    normalAoUrl: string;
    // Optional regional tiles at full lidar resolution (tiles[leaf id]); without this field the
    // whole map is normalAoUrl alone and the runtime never asks for tiles.
    normalAoTiles?: GroundNormalTileSet;
    // Optional authored metre-scale rock relief; packs without this asset still
    // use their existing rock normal. The runtime never derives it from heights.
    relief?: { normalUrl: string; packedNormalUrl: string; tileMetres: number };
    layers: GroundLayer[];
    rock: { albedoUrl: string; normalUrl: string; tileMetres: number };
    // The lake bed's depth bands as two texture arrays (albedo + normals): one layer per entry
    // of layers, in order, each sampled at its own tileMetres. Two textures instead of ten, so
    // count the complete material against the device limits requested by Engine.ts.
    // Sixteen is WebGPU's default allowance, not every adapter's supported ceiling.
    lakeBed: {
      albedoArrayUrl: string; normalArrayUrl: string; layers: { name: string; tileMetres: number }[];
      // An additional shared-array layer for mapped loose cinders above water.
      cinder?: { arrayLayer: number; tileMetres: number };
    };
  };
}

export type FloraKind = "tree" | "shrub" | "rock" | "waterPlant";

// flora/forest.json (format 1), written by tools/build_forest.py: everything that stands on the
// ground, cut into the ground's quadtree leaves and streamed with them.
//
// A species is drawn at level k + 1 beyond lodDistances[k], and at its last level until it is further
// than pixelReach * size * scale metres away (about two pixels tall); it has no other cull distance.
// size is the longest side of the model's bounding box in metres at scale 1. A tree's collider is its
// trunk at scale 1.
export interface ForestSpecies {
  id: string;
  kind: FloraKind;
  modelUrl: string;
  lodDistances: number[];
  size: number;
  castsShadows: boolean;
  collider: { radius: number; height: number } | null;
}

// leaves[id] = [records in leavesUrl + id + ".bin", records in midUrl + id + ".bin"] for ground leaf
// id; a count of 0 means there is no file. The leaves file holds everything in the leaf and is wanted
// within nearMetres of it; the mid file holds only the tallest tree of each 14 m cell and is drawn
// instead, as cards, out to midMetres. Beyond that the forest is the ground's own colour.
//
// Both files are arrays of little-endian records of recordBytes (14) bytes:
//   0  float32 y        world height of the model's origin
//   4  uint16  x        east of the leaf's west edge, in 1/65536 of the leaf's size
//   6  uint16  z        north of the leaf's south edge, likewise
//   8  uint16  scale    uniform scale, in scaleUnit
//   10 uint8   yaw      turn about the up axis, in 1/256 of a turn
//   11 uint8   species  index into species
//   12 int8    tiltX    x and z of the unit vector the model's up axis points along, times 127
//   13 int8    tiltZ    (0, 0 for everything that stands upright); the tilt is applied after the yaw
// sorted by species, then by cell (cellMetres squares counted from the leaf's south-west corner, row
// by row northwards), then largest first. A record's index in its leaves file identifies it for good
// (a felled tree is remembered as leaf id and index).
export interface ForestManifest {
  format: 1;
  leavesUrl: string;
  midUrl: string;
  recordBytes: 14;
  scaleUnit: number;
  cellMetres: number;
  nearMetres: number;
  midMetres: number;
  pixelReach: number;
  species: ForestSpecies[];
  leaves: [number, number][];
}

// props.json (format 1): static props with authored LOD levels and collision boxes, all in the
// prop's own frame in metres. A flat walk box is either the pier deck (top at yTop) or a ship
// deck (top at y); a ramp slopes from one end to the other; a blocker is a solid volume.
export type PropWalk =
  | { kind: "deck"; x: [number, number]; z: [number, number]; yTop: number; thickness: number }
  | { kind?: undefined; x: [number, number]; z: [number, number]; y: number; thickness: number }
  | { kind: "ramp"; x: [number, number]; from: { z: number; y: number }; to: { z: number; y: number }; thickness: number };

export interface PropBlocker {
  x: [number, number];
  y: [number, number];
  z: [number, number];
  kind?: string;
}

export interface PropEntry {
  file: string;
  lodDistances: number[];
  triangles: number[];
  bounds: { min: [number, number, number]; max: [number, number, number] };
  walk?: PropWalk[];
  blockers?: PropBlocker[];
}

// route/boat_tour.json (format 2): the closed loop the tour boat follows, as world x/z points about
// 10 m apart starting at the first dock. A dock gives the ship's origin and heading when it lies there
// and how far along the loop that is. A sight is a stop with no dock: the ship waits on the loop there.
// Every stop carries the cutscene look target the guide's voice turns the player to, as world [x, y, z]
// with the lake at y = 0 (researched in tools/build_route.py: real feature positions, not the boat's
// approximate stop, so the talked-about rock stays centered whatever the drift).
export interface RouteManifest {
  format: 2;
  length: number;
  docks: { name: string; position: [number, number]; headingDegrees: number; distance: number; lookAt: [number, number, number] }[];
  sights: { name: string; distance: number; lookAt: [number, number, number] }[];
  points: [number, number][];
}

export interface PropsManifest {
  format: 1;
  props: Record<string, PropEntry>;
}
