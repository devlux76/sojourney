import "@babylonjs/core";
import "@babylonjs/loaders";
import "@babylonjs/materials";
import "@babylonjs/post-processes";
import "@babylonjs/procedural-textures";
import "@babylonjs/addons";
import "@babylonjs/gui";
import "@babylonjs/serializers";
import { Scene } from "@babylonjs/core/scene";
import { SetMissingSideEffectWarningsEnabled } from "@babylonjs/core/Misc/devTools";
import { createEngine } from "./Engine";
import { settings } from "./Settings";
import { startHud } from "./Hud";
import { startScreenshotKey, startVideoKey } from "./Screenshot";
import { startPerf } from "./Perf";
import { setTouchLayout, touchLayoutActive, suppressContextMenu } from "./isMobile";
import { buildWorld } from "../engine/world";
import { SceneFrameGraph } from "../engine/framegraph";
import { TouchStick } from "../ui/TouchStick";
import { ActionCluster } from "../ui/ActionCluster";
import { TouchSheet } from "../ui/TouchSheet";
import type { Biome } from "../biomes/Biome";

export async function startGame(canvas: HTMLCanvasElement, biome: Biome): Promise<void> {
  if (import.meta.env.DEV) SetMissingSideEffectWarningsEnabled(true);
  const engine = await createEngine(canvas);
  const scene = new Scene(engine);
  scene.skipPointerMovePicking = scene.skipPointerDownPicking = scene.skipPointerUpPicking = true;
  startHud(engine);
  startScreenshotKey(engine);
  startVideoKey(engine);
  suppressContextMenu();
  setTouchLayout(settings.touchUI);

  const { player, play, panel, environment, attachSheet } = await buildWorld(scene, canvas, biome);
  const frameGraph = await SceneFrameGraph.create(scene, player.camera, settings.msaaSamples);
  play.poseControl = player;
  player.onPoseChange.add(pose => play.setResting(pose !== "standing"));
  // The stripped Crater Lake test has no boat or piers, so begin on land rather than at the old berth.
  const shoreSpawn = biome.places.findIndex(place => place.name === "Llao Rock");
  await player.spawn(shoreSpawn >= 0 ? shoreSpawn : 0);

  if (touchLayoutActive()) {
    new TouchStick(
      vector => player.setTouchStick(vector),
      rate => player.setPitchTrim(rate),
    );
    const cluster = new ActionCluster(play, player);
    const sheet = new TouchSheet({ play, engine, panel });
    attachSheet(sheet);
    let marked: string | null | undefined;
    play.onFrame = () => {
      cluster.render(play.ringActions(), play.isResting());
      if (play.rucksack.held !== marked) sheet.refresh(marked = play.rucksack.held);
    };
  }

  engine.runRenderLoop(() => {
    // scene.render() runs Babylon's framegraph and its scene callbacks; player input is stepped once afterward.
    scene.render();
    player.update();
  });

  scene.onDisposeObservable.addOnce(() => frameGraph.dispose());

  const params = new URLSearchParams(location.search);
  if (import.meta.env.DEV) {
    if (params.has("perf")) await startPerf(scene, engine);
    if (params.has("inspector")) {
      await import("@babylonjs/inspector");
      await scene.debugLayer.show();
    }
    const hour = params.get("hour");
    if (hour !== null) environment.clock.hours = Math.min(23.95, Math.max(0, Number(hour) || 0));
  }
}
