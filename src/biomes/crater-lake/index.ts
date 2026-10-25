import type { Biome } from "../Biome";

const craterLake: Biome = {
  id: "crater-lake",
  name: "Crater Lake",
  blurb: "Wood smoke, cold water, huckleberries.",
  thumbnailUrl: "packs/crater-lake/thumbnail.jpg",

  location: { lat: 42.94, lon: -122.11, utcOffsetHours: -7 },
  calendar: { startMonth: 6, startDay: 15, stayLengthDays: 60, startHour: 9.5 },

  terrain: { worldSizeMetres: 18000 },

  water: { colour: [0.004, 0.035, 0.2] },

  flora: [
    // The waterline rubble (Cleetwood reference IMG_0749.webp) is scattered by place_shore_rubble
    // in tools/build_forest.py, reusing the lava-block/boulder species below: the ordinary rock
    // attempt rate is far too sparse for a rubble pile, so it has its own dense stream.
    {
      id: "tree", impostor: true,
      variants: [
        "packs/crater-lake/models/trees/fir_tree_01_a.glb", "packs/crater-lake/models/trees/fir_tree_01_b.glb",
        "packs/crater-lake/models/trees/fir_tree_01_c.glb", "packs/crater-lake/models/trees/pine_tree_01_a.glb",
        "packs/crater-lake/models/trees/pine_tree_01_b.glb", "packs/crater-lake/models/trees/pine_tree_01_c.glb",
      ],
      zones: [
        { minElevation: 22, maxElevation: 162, maxSlope: 0.4, density: 0.6 },
        { minElevation: 22, maxElevation: 120, maxSlope: 0.8, density: 0.3 },
        { minElevation: 120, maxElevation: 180, maxSlope: 0.8, density: 0.18 },
        { minElevation: 180, maxElevation: 235, maxSlope: 0.85, density: 0.1 },
      ],
    },
    {
      id: "lava_block", impostor: false, scale: [0.3, 2], sink: 0.15, tint: [0.36, 0.38, 0.42],
      variants: [
        "packs/crater-lake/models/rocks/rock_07.glb", "packs/crater-lake/models/rocks/namaqualand_boulder_03.glb", "packs/crater-lake/models/rocks/namaqualand_boulder_06.glb",
      ],
      zones: [
        { minElevation: -2, maxElevation: 60, maxSlope: 1.2, density: 0.1 },
        { minElevation: 60, maxElevation: 235, maxSlope: 1.2, density: 0.07 },
      ],
    },
    {
      id: "boulder", impostor: false, scale: [0.8, 5], sink: 0.2, tint: [0.36, 0.38, 0.42],
      variants: [
        "packs/crater-lake/models/rocks/namaqualand_boulder_02.glb", "packs/crater-lake/models/rocks/namaqualand_boulder_03.glb", "packs/crater-lake/models/rocks/namaqualand_boulder_06.glb",
      ],
      zones: [
        { minElevation: -2, maxElevation: 60, maxSlope: 1.0, density: 0.02 },
        { minElevation: 60, maxElevation: 235, maxSlope: 1.0, density: 0.012 },
      ],
    },
    {
      id: "scoria", impostor: false, scale: [0.6, 3], sink: 0.2, tint: [0.7, 0.55, 0.5],
      variants: ["packs/crater-lake/models/rocks/boulder_01.glb", "packs/crater-lake/models/rocks/namaqualand_boulder_04.glb"],
      zones: [{ minElevation: -2, maxElevation: 235, maxSlope: 1.0, density: 0.006 }],
    },
    {
      id: "rock_patch", impostor: false, scale: [0.7, 1.2], sink: 0.5, alignToGround: true, tint: [0.45, 0.43, 0.43],
      variants: ["packs/crater-lake/models/rocks/coast_land_rocks_04.glb"],
      zones: [{ minElevation: 22, maxElevation: 235, maxSlope: 0.45, density: 0.03 }],
    },
    {
      id: "pumice_patch", impostor: false, scale: [0.7, 1.2], sink: 0.35, alignToGround: true,
      variants: ["packs/crater-lake/models/rocks/sand_rocks_small_01.glb"],
      zones: [{ minElevation: 0, maxElevation: 22, maxSlope: 0.35, density: 0.015 }],
    },
    {
      id: "shrub", impostor: true, variants: ["packs/crater-lake/models/shrubs/shrub_dense.glb"],
      zones: [
        { minElevation: 4, maxElevation: 22, maxSlope: 0.4, density: 0.5 },
        { minElevation: 22, maxElevation: 162, maxSlope: 0.5, density: 0.5 },
      ],
    },
    {
      id: "rock_boulder", impostor: false, variants: ["packs/crater-lake/models/rocks/rock_boulder.glb"],
      zones: [{ minElevation: -30, maxElevation: -10, maxSlope: Infinity, density: 0.05 }],
    },
    {
      id: "rock_pebble", impostor: false, variants: ["packs/crater-lake/models/rocks/rock_pebble.glb"],
      zones: [{ minElevation: 0, maxElevation: 4, maxSlope: Infinity, density: 0.15 }],
    },
    {
      id: "seaweed", impostor: true, variants: ["packs/crater-lake/models/shrubs/shrub_dense.glb"],
      zones: [],
      clusters: { minDepth: 1.5, maxDepth: 30, beds: 5000, plantsPerBed: [6, 20], bedRadius: 8 },
    },
  ],
  groundCover: [],

  fauna: [],

  fish: [
    { species: "kokanee salmon", share: 0.6, mean: 26, spread: 4, min: 18, max: 38 },
    { species: "rainbow trout", share: 0.4, mean: 38, spread: 7, min: 25, max: 61 },
  ],

  ingredients: [],
  recipes: [],

  climate: {
    rainWindow: [7.5, 19], rainHours: [2.4, 6],
    showerWindow: [2, 20], showerHours: [1, 2], showerChance: 0.3, showerGap: 1,
    calmWind: 0.15, weatherSeed: 20260715, maxRainMinutes: 10,
  },
  lighting: {
    colourStops: {
      night: { sun: [0.6, 0.7, 1.0], fill: [0.15, 0.2, 0.35], fog: [0.02, 0.03, 0.06], daylight: 0.08 },
      twilight: { sun: [1.0, 0.55, 0.35], fill: [0.3, 0.3, 0.45], fog: [0.3, 0.28, 0.38], daylight: 0.35 },
      golden: { sun: [1.0, 0.95, 0.85], fill: [0.4, 0.5, 0.7], fog: [0.65, 0.78, 0.92], daylight: 1 },
      midday: { sun: [1.0, 0.98, 0.95], fill: [0.45, 0.55, 0.75], fog: [0.62, 0.76, 0.95], daylight: 1.1 },
    },
  },

  places: [
    // On the main deck of the tour boat, which starts docked at Cleetwood Cove; this place follows the boat.
    { name: "Aboard the ship", position: [4751.3, 0, 4220.9], headingDegrees: 204 },
    // The docks, then the tour's points of interest in the order the boat visits them. The sights
    // stand in deep water at the boat's own stops and face them; the eye is a few metres up and
    // a swimmer floats on landing.
    { name: "Cleetwood Cove pier", position: [4728.3, 0, 4228.5], headingDegrees: 114 },
    { name: "Wizard Island", position: [0, 0, 530], headingDegrees: 40 },
    { name: "Llao Rock", position: [1424.0, 3, 3274.2], headingDegrees: 320.2 },
    { name: "Devils Backbone", position: [-388.0, 3, 2001.3], headingDegrees: 308.9 },
    { name: "Phantom Ship", position: [4437.1, 3, -3048.0], headingDegrees: 72.0 },
    { name: "Pumice Castle", position: [6870.5, 3, -886.6], headingDegrees: 105.3 },
  ],
  props: [
    // Each pier's shore end sits where the ground is a metre above the lake. It climbs 6.76 degrees
    // on its way out so the ramp at its end comes down onto the ship's rail where that is lowest
    // (2.64 m above the water, in the waist); the ship lies across the end of the pier.
    { prop: "modular_wooden_pier", position: [4725.6, 1.0, 4229.7], headingDegrees: 114, pitchDegrees: 6.76 },
    { prop: "modular_wooden_pier", position: [-285.5, 1.0, -496.0], headingDegrees: 180, pitchDegrees: 6.76 },
  ],
  // Where the ship lies at each dock is in the route file (tools/build_route.py).
  boat: { prop: "dutch_ship_medium", routeUrl: "packs/crater-lake/route/boat_tour.json", dwellSeconds: 120, standAt: [-0.8, 0, -1.5] },
  // Crater Lake is a quiet place: no streams run in or out, and the caldera walls keep the wind off the
  // water. It is never silent, though: a quiet bed plays wherever it is dry, the lake's surf near the
  // water, and birds and water on the boat ride.
  ambientAudio: [
    { url: "packs/crater-lake/audio/birds_and_water.ogg", volume: 0.35, delaySeconds: 0, when: ["day", "dry", "surface", "aboard"] },
    { url: "packs/crater-lake/audio/outside.ogg", volume: 0.25, delaySeconds: 0, when: ["dry", "surface"] },
    { url: "packs/crater-lake/audio/night_rain.ogg", volume: 0.4, delaySeconds: 0, when: ["night", "rain", "surface"] },
    { url: "packs/crater-lake/audio/quiet_surf_on_the_lake.mp3", volume: 0.6, delaySeconds: 0, when: ["surface", "shore"], stream: true },
    { url: "packs/crater-lake/audio/underwater.mp3", volume: 0.8, delaySeconds: 0, when: ["underwater"] },
  ],
  footstepAudio: {
    ground: { url: "packs/crater-lake/audio/walking_on_sand_and_gravel.mp3", volume: 0.24 },
    wood: { urls: [1, 2, 3, 4].map(n => `packs/crater-lake/audio/footstep_wood_${n}.ogg`), volume: 0.7 },
  },
  fishingAudio: {
    plop: { url: "packs/crater-lake/audio/fishing_plop.ogg", volume: 1.5 },
    reel: { url: "packs/crater-lake/audio/fishing_reel.ogg", volume: 1.5 },
    fish: { url: "packs/crater-lake/audio/fishing_fish.ogg", volume: 1.2 },
  },
  campfireRainAudio: { url: "packs/crater-lake/audio/campfire_in_rain.ogg", volume: 1 },
  thunderAudio: { url: "packs/crater-lake/audio/thunder.ogg", volume: 1 },
  shipBellAudio: { url: "packs/crater-lake/audio/ships_bell.ogg", volume: 0.8 },
  tourGuideAudio: { urlPrefix: "packs/crater-lake/audio/tour/", volume: 1.6 },
};

export default craterLake;
