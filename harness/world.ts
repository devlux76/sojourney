// Import the same whole Babylon packages as gameplay before creating its real world.
import "../src/core/startGame";
import { Scene, Engine } from "@babylonjs/core";
import { createEngine, describeBackend } from "../src/core/Engine";
import { startPerf } from "../src/core/Perf";
import { settings } from "../src/core/Settings";
import { loadBiomeModule } from "../src/biomes/registry";
import { buildWorld } from "../src/engine/world";
import { Boat } from "../src/engine/boat";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const status = document.getElementById("verification-status")!;
// This standalone harness bypasses the destination downloader to inspect actual
// streaming/gameplay. Backend selection is confined to the harness, never shipped UI.
const engine = new URLSearchParams(location.search).get("backend") === "webgl"
  ? new Engine(canvas, false, { stencil: false, antialias: true, powerPreference: "high-performance" })
  : await createEngine(canvas);
const scene = new Scene(engine);
scene.skipPointerMovePicking = true;
let boat: Boat | null = null;
const originalLoad = Boat.load;
Boat.load = async (...args) => boat = await originalLoad(...args);
let world;
try {
  world = await buildWorld(scene, canvas, await loadBiomeModule("crater-lake"));
} finally {
  Boat.load = originalLoad;
}
world.play.poseControl = world.player;
world.player.onPoseChange.add(pose => world.play.setResting(pose !== "standing"));
await world.player.spawn();
await world.environment.ready;
await startPerf(scene, engine);
let sky: unknown = null;
world.environment.onSky.add(state => sky = {
  hour: world.environment.clock.hours, weather: { ...state.weather }, exposure: state.exposure,
});
Object.assign(window, { worldHarness: { world, scene, engine, boat, settings, sky: () => sky } });
status.textContent = `${describeBackend(engine).backend} — ready`;
engine.runRenderLoop(() => { scene.render(); world.player.update(); });
