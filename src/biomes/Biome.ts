export interface Biome {
  id: string;
  name: string;
  blurb: string;
  thumbnailUrl: string;

  location: { lat: number; lon: number; utcOffsetHours: number };
  calendar: { startMonth: number; startDay: number; stayLengthDays: number; startHour: number };

  // The ground itself (heights, textures, the lake's outline and level) comes from the pack's own
  // manifests; the biome only says how wide the world is and what colour its water is.
  terrain: { worldSizeMetres: number };

  water: { colour: [number, number, number] } | null;

  flora: FloraEntry[];
  groundCover: (FloraEntry & {
    forage?: { ingredient: string; perBush: number; ripeMonths: [number, number]; regrowDays: number };
  })[];

  fauna: {
    id: string;
    kind: "heard" | "bird" | "ground";
    modelUrl?: string;
    soundUrl?: string;
    schedule?: { startHour: number; endHour: number; intervalSecondsRange: [number, number] };
    spawnCount?: number;
    wanderRadius?: number;
  }[];

  fish: { species: string; share: number; mean: number; spread: number; min: number; max: number }[];

  ingredients: { id: string; name: string }[];
  recipes: {
    id: string; name: string; ingredients: string[]; staples: string[];
    cookSeconds: number; effect: string;
  }[];

  climate: {
    rainWindow: [number, number]; rainHours: [number, number];
    showerWindow: [number, number]; showerHours: [number, number];
    showerChance: number; showerGap: number;
    calmWind: number; weatherSeed: number; maxRainMinutes: number;
  };

  lighting: {
    colourStops: Record<"night" | "twilight" | "golden" | "midday", {
      sun: [number, number, number]; fill: [number, number, number]; fog: [number, number, number];
      daylight: number;
    }>;
  };

  // Where the player can be put: the game starts at the first place and T cycles through them in order.
  places: { name: string; position: [number, number, number]; headingDegrees: number }[];
  // Props standing in the world: position is the prop's origin in world metres, heading turns it about +y.
  // pitchDegrees lifts the prop's +z end (a pier climbing from the shore to the ship's rail).
  props: { prop: string; position: [number, number, number]; headingDegrees: number; pitchDegrees?: number }[];
  // The tour boat: the prop it is drawn as, the route it follows and the real seconds it waits at each
  // stop, dock or sight. standAt is the place aboard that the first of `places` follows, in the ship's own frame.
  boat: { prop: string; routeUrl: string; dwellSeconds: number; standAt: [number, number, number] } | null;
  // Loops that play all the time, or only in the conditions each names (all of them at once): a track
  // for ["day", "dry", "surface"] is heard on a dry day with the eye above water. "aboard" is on the tour
  // boat, "ashore" anywhere else, "shore" within earshot of the lake's edge or out on the lake.
  // A long recording sets `stream`, so it is played as it downloads and not decoded whole into memory.
  ambientAudio: { url: string; volume: number; delaySeconds: number; when?: AmbientCondition[]; stream?: boolean }[];
  // Footsteps: a loop while walking on the ground, and single steps on wood (the piers and the ship).
  footstepAudio: { ground: { url: string; volume: number } | null; wood: { urls: string[]; volume: number } | null } | null;
  // Fishing: the bait landing, and the reel and the splashing fish, looped together while reeling in.
  fishingAudio: { plop: { url: string; volume: number }; reel: { url: string; volume: number }; fish: { url: string; volume: number } } | null;
  // A fire burning in the rain, looped near a campfire while it rains.
  campfireRainAudio: { url: string; volume: number } | null;
  // One thunderclap, played after each lightning strike.
  thunderAudio: { url: string; volume: number } | null;
  // The ship's bell, rung as the tour boat casts off and as it comes alongside a dock.
  shipBellAudio: { url: string; volume: number } | null;
  // The tour guide's voice: one recording for each stop of the boat tour as the ship arrives and one as
  // she departs, named <stop>_arrive.ogg and <stop>_depart.ogg under urlPrefix, with the stop's name in
  // lower case and underscores (tools/build_narration.py speaks them).
  tourGuideAudio: { urlPrefix: string; volume: number } | null;
}

export type AmbientCondition = "day" | "night" | "dry" | "rain" | "storm" | "underwater" | "surface" | "aboard" | "ashore" | "shore";

export interface FloraEntry {
  id: string;
  variants: string[];
  impostor: boolean;
  zones: { minElevation: number; maxElevation: number; maxSlope: number; density: number }[];
  scale?: [number, number];
  sink?: number;
  tint?: [number, number, number];
  alignToGround?: boolean;
  clusters?: { minDepth: number; maxDepth: number; beds: number; plantsPerBed: [number, number]; bedRadius: number };
}
