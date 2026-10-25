import { Scene } from "@babylonjs/core/scene";
import { Observable } from "@babylonjs/core/Misc/observable";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { MirrorTexture } from "@babylonjs/core/Materials/Textures/mirrorTexture";
import type { Atmosphere } from "@babylonjs/addons/atmosphere/atmosphere";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeBox } from "@babylonjs/core/Physics/v2/physicsShape";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import type { Biome } from "../biomes/Biome";
import { isTourBeautyStop } from "../sky/Weather";
import { createSettingsPanel, type SettingsPanel } from "../core/SettingsPanel";
import { settings, BELL_MODES, type BellMode, OPTIMIZATION_MODES, type OptimizationMode } from "../core/Settings";
import { TOUCH_MODES, type TouchMode } from "../core/touchControl";
import { setTouchLayout } from "../core/isMobile";
import { Play } from "../play/Play";
import { Chopping } from "../play/Chopping";
import { Sitting } from "../play/Sitting";
import { Campfire } from "../play/Campfire";
import { Fishing } from "../play/Fishing";
import type { TouchSheet } from "../ui/TouchSheet";
import { enablePhysics } from "./physics";
import { PlayerController } from "./player/PlayerController";
import { OBSTACLE_MASK } from "./player/ground";
import { createEnvironment, type Environment, type SkyState } from "./environment";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { fogDensity, rainHides, rainReach, shownHazeDensity } from "./environment/Fog";
import { SKY_LAYER_GROUP } from "./environment/sky";
import { loadGround } from "./ground";
import { fetchProps, loadProps } from "./props";
import { Boat } from "./boat";
import { Flora } from "./flora";
import { Underwater } from "./underwater";
import { Narrator } from "../narrator/Narrator";
import { startOptimizer } from "./Optimizer";
import { isZoomedBeauty } from "./optimizerHaze";
import { inLake } from "./lake";
import { WATER_Y } from "./pack";
import { lightSubmergedObjects } from "./WaterDepthMaterial";
import { startAmbientAudio } from "./AmbientAudio";
import { WeatherAudio } from "./WeatherAudio";

export interface WorldSky extends SkyState {
  underwater: boolean;
  // Whether the player is in the water, at the surface or under it.
  swimming: boolean;
}

export interface World {
  player: PlayerController;
  play: Play;
  panel: SettingsPanel;
  environment: Environment;
  attachSheet(sheet: TouchSheet): void;
}

const EDGE_MARGIN_METRES = 20;
const WALL_HEIGHT_METRES = 6000;
const REFLECTED_TREE_LEVEL = 2;
const RIPPLE_DRIFT = 0.02;
const UNMIRRORED_SKY_INTENSITY = 0.35;
// How long the ship's word of a stop stays on screen.
const ANNOUNCE_SECONDS = 8;
// The lake's edge is heard from this far off, at full strength up to the first height above the water
// and not at all above the second; the sound takes this long to come and go.
const SHORE_EARSHOT = 40;
const SHORE_HEIGHT = [10, 40];
const SHORE_EASE_SECONDS = 2;

export async function buildWorld(scene: Scene, canvas: HTMLCanvasElement, biome: Biome): Promise<World> {
  await enablePhysics(scene);
  const player = new PlayerController(scene, canvas, biome);
  const camera = player.camera;
  // The sun's shadows reach 100 m: near foliage and props shade crisply, while nothing far
  // off is in the shadow pass, where coarse distant texels shimmered like breathing ground.
  const environment = createEnvironment(scene, camera, biome, { shadowDistance: 100 });

  const ground = await loadGround(scene, biome);
  // Install before props/flora load so imported materials and later play clones
  // share the bed's per-fragment sunlight falloff while lamps remain undimmed.
  lightSubmergedObjects(scene, ground.lakeMask, ground.manifest.sizeMetres, ground.waterMaterial);
  const propsManifest = await fetchProps(biome.id);
  const props = await loadProps(scene, biome, propsManifest, environment.shadows);
  const boat = await Boat.load(scene, biome, propsManifest, environment.shadows);
  // A dwell with the player aboard eases to clear automatic weather.
  // Reuse this predicate for the optimizer so departure releases both holds together.
  const beautyStop = () => isTourBeautyStop(player.aboard, boat?.dwellLeft ?? 0);
  environment.isBeautyStop = beautyStop;
  const flora = await Flora.load(scene, biome, environment.shadows, ground.manifest.leaves);
  if (flora.band) ground.surface.forestBand = flora.band;
  // Before a teleport lands, the ground under the target and the forest around it are loaded.
  player.ground.prepare = async (x, z) => { await Promise.all([ground.stream.prepare(x, z), flora.prepare(x, z)]); };
  wallTheEdge(scene, ground.manifest.sizeMetres);

  const underwater = new Underwater(scene, camera, ground.water);
  // Run after Underwater's update and before Babylon evaluates active meshes:
  // entering and resurfacing change sky submission in the same frame.
  scene.onBeforeRenderObservable.add(() => environment.setSkyVisible(!underwater.active));
  // Each prop's drawn meshes (its instance, and the ship's steps) with the radius of the sphere
  // round them, kept from when they were placed: a hidden mesh's own bounds go stale as the ship sails.
  const propDraws = [...props, ...(boat ? [boat] : [])].map(prop => ({
    root: prop.root, meshes: prop.root.getChildMeshes(), radius: prop.instance.getBoundingInfo().boundingSphere.radiusWorld,
  }));
  const sky = new Observable<WorldSky>();
  ground.surface.causticsStrength = settings.underwaterCaustics;
  environment.onSky.add(s => {
    underwater.daylight = s.daylight;
    ground.surface.wetness = s.weather.wetness;
    // The binoculars' zoom reaches the streaming levels before they update (this observer was
    // added before theirs): wall, trees and painted forest all draw as though walked up to.
    const zoom = player.zoomFactor;
    ground.stream.zoom = zoom;
    flora.zoom = zoom;
    if (flora.band) ground.surface.forestBand = [flora.band[0] * zoom, flora.band[1] * zoom];
    // How far the rain lets the player see, or the water when the eye is under it: the ground and
    // the forest skip what either fully hides. The optimizer haze counts as rain here, so its
    // tighter reach culls only what its own fog already covers.
    const reach = Math.min(rainReach(fogDensity(s.weather.rain, s.sun.alt).rain + shownHazeDensity()), underwater.reach);
    ground.stream.rainReach = reach;
    flora.rainReach = reach;
    // This getter uses the current eye, including the first entry/exit frame,
    // before Flora builds its lists and Underwater draws the opaque volume.
    flora.waterRadius = underwater.volumeRadius;
    // Under water levels switch at once, with no dithered cross-fade.
    ground.stream.fades = flora.fades = !Number.isFinite(flora.waterRadius);
    // Where no daylight is left the sun's shadows fall on nothing lit, so the shadow maps are not
    // drawn again until the diver comes back up. Set on change only: setting it restarts the count.
    const shadowRate = underwater.sunless ? RenderTargetTexture.REFRESHRATE_RENDER_ONCE : RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME;
    const shadowMap = environment.shadows.getShadowMap();
    if (shadowMap && shadowMap.refreshRate !== shadowRate) shadowMap.refreshRate = shadowRate;
    // A prop it fully hides is not drawn and casts no shadow; its collision stays.
    const eye = camera.globalPosition;
    for (const { root, meshes, radius } of propDraws) {
      const at = root.absolutePosition;
      const hidden = rainHides(reach, Vector3.Distance(at, eye) - radius, at.y + radius - eye.y);
      for (const mesh of meshes) mesh.setEnabled(!hidden);
    }
    ground.surface.causticsTime = performance.now() / 1000;
    // Wind-driven water motion uses only the share above this biome's calm baseline.
    const calmWind = biome.climate.calmWind;
    const wind = Math.max(0, (s.weather.wind - calmWind) / (1 - calmWind));
    ground.waterMaterial.reflectionTexture = scene.renderTargetsEnabled ? ground.mirror : null;
    ground.waterMaterial.environmentIntensity = scene.renderTargetsEnabled ? 1 : UNMIRRORED_SKY_INTENSITY;
    ground.ripples.uOffset += RIPPLE_DRIFT * (1 + wind) * s.dt;
    ground.ripples.vOffset += RIPPLE_DRIFT * 0.6 * (1 + wind) * s.dt;
    sky.notifyObservers({ ...s, underwater: underwater.active, swimming: player.isSwimming() });
  });

  let touchSheet: TouchSheet | null = null;
  // The optimizer holds full beauty while the player rides the boat lying at a stop (the
  // guide's talk) and resumes with a fresh window once she casts off; under way, ashore, or
  // unattended it optimizes as usual. It also shuts off for a still or zoomed camera: standing
  // still means immersion, so frame rate stops mattering until the player moves again.
  const retune = startOptimizer(scene, environment.pipeline, beautyStop, () => isZoomedBeauty(player.zoomFactor));
  const panel = createSettingsPanel([
    { label: "Touch controls", choices: TOUCH_MODES,
      get: () => settings.touchUI,
      set: (v: string) => { settings.touchUI = v as TouchMode; },
      apply: () => setTouchLayout(settings.touchUI) },
    ...(biome.shipBellAudio ? [{ label: "Ship's bell", choices: BELL_MODES,
      get: () => settings.shipBell,
      set: (v: string) => { settings.shipBell = v as BellMode; } }] : []),
    ...(biome.tourGuideAudio ? [{ label: "Tour guide's voice", choices: BELL_MODES,
      get: () => settings.tourGuide,
      set: (v: string) => { settings.tourGuide = v as BellMode; } },
      // Leaves the game for the sound check, where the guide's voice is tried and chosen.
      { label: "Sound check", choices: ["Run"], get: () => "", set: () => { location.search = "?soundcheck"; } }] : []),
    { key: "targetFps", label: "Target frame rate (lower keeps more detail)", min: 20, max: 60, step: 5, apply: retune },
    { label: "Scene optimization", choices: OPTIMIZATION_MODES,
      get: () => settings.sceneOptimization,
      set: (v: string) => { settings.sceneOptimization = v as OptimizationMode; },
      apply: retune },
    ...environment.settingControls(), ...underwater.settingControls(),
    { key: "underwaterCaustics", label: "Caustics strength", min: 0, max: 3, step: 0.05, apply: v => { ground.surface.causticsStrength = v; } },
    { key: "headBob", label: "Head bob", min: 0, max: 1.5, step: 0.05 },
  ], canvas);
  const anyPanelOpen = () => panel.open || touchSheet?.open === true;
  environment.isPaused = anyPanelOpen;

  const audio = startAmbientAudio(biome);
  new WeatherAudio({ onSky: sky }, audio.setLevel);
  // The lake's edge is within earshot when the lake lies within SHORE_EARSHOT metres to any side and the
  // eye is not far above it; the share eases, so walking up to the water fades its sound in.
  let shore = 0;
  const nearLake = (x: number, z: number) => {
    if (inLake(x, z)) return true;
    for (let i = 0; i < 8; i++) if (inLake(x + SHORE_EARSHOT * Math.sin(i * Math.PI / 4), z + SHORE_EARSHOT * Math.cos(i * Math.PI / 4))) return true;
    return false;
  };
  // Footsteps sound while walking: wooden ones on the ship and the piers, the ground's elsewhere.
  sky.add(s => {
    const v = player.velocity(), at = player.position();
    const height = Math.min(1, Math.max(0, (SHORE_HEIGHT[1] - (camera.globalPosition.y - WATER_Y)) / (SHORE_HEIGHT[1] - SHORE_HEIGHT[0])));
    shore += ((nearLake(at.x, at.z) ? height : 0) - shore) * Math.min(1, s.dt / SHORE_EASE_SECONDS);
    audio.setConditions({ daylight: s.daylight, rain: s.weather.rain, storm: s.weather.storm, underwater: s.underwater, aboard: player.aboard, shore });
    const onWood = player.aboard || player.ground.propAt(at.x, at.z) !== null;
    audio.setMovement(player.isGrounded() ? Math.hypot(v.x, v.z) : 0, onWood ? "wood" : "ground", s.dt);
  });
  // Thunder follows each lightning strike after the time its sound takes to arrive.
  environment.onLightning.add(strike => { setTimeout(() => audio.thunder(strike.distanceMetres), strike.thunderDelaySeconds * 1000); });

  const play = new Play(scene, camera, player.ground, { onSky: sky }, anyPanelOpen);
  // A travel lands with the place's name on the ship's own banner, so the player knows where T took them.
  player.onTravel.add(name => play.overlay.announce(name, ANNOUNCE_SECONDS));
  play.add(new Chopping(scene, play, flora));
  play.add(new Sitting(play, flora));
  // Runtime-laid fires append their prepared levels to this same lake mirror.
  play.add(await Campfire.load(scene, play, biome, environment.shadows, propsManifest, ground.mirror));
  play.add(new Fishing(scene, play, biome));

  let narrator: Narrator | null = null;
  if (boat) {
    player.vessel = boat;
    play.vesselStep = () => player.aboard ? boat.step : null;
    const standAt = new Vector3(...biome.boat!.standAt);
    // The ship's bell is heard from where the player is and from the side the ship lies on, each time
    // the ship rings it.
    boat.onBell.add(() => {
      if (settings.shipBell === "off") return;
      const to = boat.toWorld(standAt).subtract(camera.globalPosition);
      audio.bell(to.length(), Math.sin(Math.atan2(to.x, to.z) - camera.rotation.y));
    });
    // Aboard, the player is told where the ship has stopped and, as she casts off, where she goes next:
    // in writing, and by the guide, who speaks of the stop she has come to or is leaving.
    // Each line is asked for ahead of when it is said: a live voice may need the whole leg to make it.
    // While her line sounds the cutscene look locks input and eases the head to the talked-about
    // feature: the arrive line aims at this stop, the depart line at the next one. A newer line takes
    // the lock over; stepping ashore or opening a panel ends it at once; a stuck line releases on a
    // safety timeout instead of holding the camera for ever.
    const GUIDE_HOLD_SECONDS = 0.75;
    const GUIDE_ARRIVE_SAFETY_SECONDS = 60;
    const GUIDE_DEPART_SAFETY_SECONDS = 25;
    let guideTurn = 0;
    const guideCutscene = (speech: { started: Promise<void>; done: Promise<void> }, target: Vector3, safetySeconds: number) => {
      const turn = ++guideTurn;
      void speech.started.then(() => {
        if (turn !== guideTurn || !player.aboard || anyPanelOpen()) return;
        player.guideLookTo(target, () => !player.aboard || anyPanelOpen());
        const hold = speech.done.then(() => new Promise(resolve => setTimeout(resolve, GUIDE_HOLD_SECONDS * 1000)));
        const safety = new Promise(resolve => setTimeout(resolve, safetySeconds * 1000));
        void Promise.race([hold, safety]).then(() => { if (turn === guideTurn) player.releaseGuide(); });
      });
    };
    narrator = biome.tourGuideAudio ? new Narrator(biome.tourGuideAudio, audio) : null;
    narrator?.prepare(boat.stopName, "depart");
    boat.onArrive.add(name => {
      narrator?.prepare(name, "depart");
      if (!player.aboard) return;
      play.overlay.announce(`This stop: ${name}`, ANNOUNCE_SECONDS);
      if (settings.tourGuide === "on" && narrator) {
        const target = boat.lookAt(name);
        const speech = narrator.say(name, "arrive");
        if (target) guideCutscene(speech, target, GUIDE_ARRIVE_SAFETY_SECONDS);
      }
    });
    boat.onDepart.add(({ from, to }) => {
      narrator?.prepare(to, "arrive");
      if (!player.aboard) return;
      play.overlay.announce(`Next stop: ${to}`, ANNOUNCE_SECONDS);
      if (settings.tourGuide === "on" && narrator) {
        const target = boat.lookAt(to);
        const speech = narrator.say(from, "depart");
        if (target) guideCutscene(speech, target, GUIDE_DEPART_SAFETY_SECONDS);
      }
    });
    // The boat moves before the player steps (this observer is put first), so the player can be carried
    // by the move it has just made; its collision catches up in the physics step that follows. The
    // boat waits while a panel is open, as the clock does.
    scene.onBeforePhysicsObservable.add(() => {
      boat.update(anyPanelOpen() ? 0 : scene.getEngine().getDeltaTime() / 1000);
      player.setPlace(0, boat.toWorld(standAt), boat.heading);
    }, undefined, true);
  }

  await environment.ready;
  ground.mirror.renderList = [
    ground.reflectionProxy, ...flora.meshes("tree", REFLECTED_TREE_LEVEL),
    // Every prepared prop instance uses the same coverage in the mirror. Listing
    // only LOD0 would erase far props and the incoming half of a transition.
    ...props.flatMap(prop => prop.transitions.instances), ...(boat ? boat.root.getChildMeshes() : []),
    ...scene.meshes.filter(mesh => mesh.renderingGroupId === SKY_LAYER_GROUP && !mesh.parent && !mesh.name.startsWith("rain")),
  ];
  ground.mirror.setRenderingAutoClearDepthStencil(SKY_LAYER_GROUP, false);
  if (environment.atmosphere) mirrorTheSky(scene, environment.atmosphere, ground.mirror);
  environment.sunDisc.dimIn(ground.mirror);
  if (import.meta.env.DEV) Object.assign(window, { __scene: scene, __settings: settings, __environment: environment, __player: player, __play: play, __flora: flora, __ground: ground, __boat: boat, __narrator: narrator });
  return { player, play, panel, environment, attachSheet: sheet => { touchSheet = sheet; } };
}

function wallTheEdge(scene: Scene, sizeMetres: number) {
  const half = sizeMetres / 2 - EDGE_MARGIN_METRES;
  for (const [x, z, wide, deep] of [[half, 0, 1, sizeMetres], [-half, 0, 1, sizeMetres], [0, half, sizeMetres, 1], [0, -half, sizeMetres, 1]]) {
    const body = new PhysicsBody(new TransformNode("worldEdge", scene), PhysicsMotionType.STATIC, false, scene);
    body.shape = new PhysicsShapeBox(new Vector3(x, 0, z), Quaternion.Identity(), new Vector3(wide, WALL_HEIGHT_METRES, deep), scene);
    body.shape.filterMembershipMask = OBSTACLE_MASK;
  }
}

function mirrorTheSky(scene: Scene, atmosphere: Atmosphere, mirror: MirrorTexture) {
  const flip = Matrix.Scaling(1, -1, 1), upright = new Matrix();
  let mirroring = false;
  mirror.onBeforeRenderObservable.add(() => { mirroring = true; });
  mirror.onAfterRenderObservable.add(() => { mirroring = false; });
  scene.onAfterRenderingGroupObservable.add(group => {
    if (!mirroring || group.renderingGroupId !== atmosphere.skyRenderingGroup) return;
    const rays = atmosphere.cameraAtmosphereVariables.inverseViewProjectionMatrixWithoutTranslation as Matrix;
    upright.copyFrom(rays);
    rays.multiplyToRef(flip, rays);
    atmosphere.updateUniformBuffer();
    atmosphere.drawSkyCompositor();
    rays.copyFrom(upright);
    atmosphere.updateUniformBuffer();
  });
}
