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
  centre: [number, number, number];
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
  water: { url: string };
  reflectionProxy: { url: string };
  material: {
    splatmapUrl: string;
    normalAoUrl: string;
    layers: GroundLayer[];
    rock: { albedoUrl: string; normalUrl: string; tileMetres: number };
    // The lake bed's depth bands as two texture arrays (albedo + normals): one layer per entry
    // of layers, in order, each sampled at its own tileMetres. Two textures instead of ten, so
    // the ground material stays within WebGPU's guaranteed 16 textures per stage (ISSUES.md B4).
    lakeBed: { albedoArrayUrl: string; normalArrayUrl: string; layers: { name: string; tileMetres: number }[] };
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
export interface RouteManifest {
  format: 2;
  length: number;
  docks: { name: string; position: [number, number]; headingDegrees: number; distance: number }[];
  sights: { name: string; distance: number }[];
  points: [number, number][];
}

export interface PropsManifest {
  format: 1;
  props: Record<string, PropEntry>;
}
