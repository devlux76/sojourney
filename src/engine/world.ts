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
import { createSettingsPanel, type SettingsPanel } from "../core/SettingsPanel";
import { settings, BELL_MODES, type BellMode } from "../core/Settings";
import { TOUCH_MODES, type TouchMode } from "../core/touchControl";
import { setTouchLayout } from "../core/isMobile";
import { Play } from "../play/Play";
import type { TouchSheet } from "../ui/TouchSheet";
import { CALM_WIND } from "../sky/Weather";
import { enablePhysics } from "./physics";
import { PlayerController } from "./player/PlayerController";
import { OBSTACLE_MASK } from "./player/ground";
import { createEnvironment, type Environment, type SkyState } from "./environment";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { fogDensity, rainReach } from "./environment/Fog";
import { SKY_LAYER_GROUP } from "./environment/sky";
import { loadGround } from "./ground";
import { Underwater } from "./underwater";
import { startOptimizer } from "./Optimizer";
import { inLake } from "./lake";
import { WATER_Y } from "./pack";
import { setFrameGraphEffectsEnabled } from "./framegraph";
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
const RIPPLE_DRIFT = 0.02;
const UNMIRRORED_SKY_INTENSITY = 0.35;
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
  // Prepare only terrain geometry and collision when the player moves in the bare-scene test.
  player.ground.prepare = (x, z) => ground.stream.prepare(x, z);
  wallTheEdge(scene, ground.manifest.sizeMetres);

  const underwater = new Underwater(scene, camera, ground.water);
  const sky = new Observable<WorldSky>();
  environment.onSky.add(s => {
    underwater.daylight = s.daylight;
    ground.stream.zoom = player.zoomFactor;
    // Rain and underwater fog still limit terrain visibility, with no scenery stream active.
    const reach = Math.min(rainReach(fogDensity(s.weather.rain, s.sun.alt).rain), underwater.reach);
    ground.stream.rainReach = reach;
    ground.stream.fades = !underwater.active;
    // Where no daylight is left the sun's shadows fall on nothing lit, so the shadow maps are not
    // drawn again until the diver comes back up. Set on change only: setting it restarts the count.
    const shadowRate = underwater.sunless ? RenderTargetTexture.REFRESHRATE_RENDER_ONCE : RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME;
    const shadowMap = environment.shadows.getShadowMap();
    if (shadowMap && shadowMap.refreshRate !== shadowRate) shadowMap.refreshRate = shadowRate;
    const wind = Math.max(0, (s.weather.wind - CALM_WIND) / (1 - CALM_WIND));
    ground.waterMaterial.reflectionTexture = scene.renderTargetsEnabled ? ground.mirror : null;
    ground.waterMaterial.environmentIntensity = scene.renderTargetsEnabled ? 1 : UNMIRRORED_SKY_INTENSITY;
    ground.ripples.uOffset += RIPPLE_DRIFT * (1 + wind) * s.dt;
    ground.ripples.vOffset += RIPPLE_DRIFT * 0.6 * (1 + wind) * s.dt;
    sky.notifyObservers({ ...s, underwater: underwater.active, swimming: player.isSwimming() });
  });

  let touchSheet: TouchSheet | null = null;
  const retune = startOptimizer(scene, enabled => setFrameGraphEffectsEnabled(scene, enabled));
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
      // Keep the existing sound-check entry available in the otherwise stripped scene.
      { label: "Sound check", choices: ["Run"], get: () => "", set: () => { location.search = "?soundcheck"; } }] : []),
    { key: "targetFps", label: "Target frame rate (lower keeps more detail)", min: 20, max: 60, step: 5, apply: retune },
    ...environment.settingControls(), ...underwater.settingControls(),
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
  sky.add(s => {
    const v = player.velocity(), at = player.position();
    const height = Math.min(1, Math.max(0, (SHORE_HEIGHT[1] - (camera.globalPosition.y - WATER_Y)) / (SHORE_HEIGHT[1] - SHORE_HEIGHT[0])));
    shore += ((nearLake(at.x, at.z) ? height : 0) - shore) * Math.min(1, s.dt / SHORE_EASE_SECONDS);
    audio.setConditions({ daylight: s.daylight, rain: s.weather.rain, storm: s.weather.storm, underwater: s.underwater, aboard: false, shore });
    audio.setMovement(player.isGrounded() ? Math.hypot(v.x, v.z) : 0, "ground", s.dt);
  });
  // Thunder follows each lightning strike after the time its sound takes to arrive.
  environment.onLightning.add(strike => { setTimeout(() => audio.thunder(strike.distanceMetres), strike.thunderDelaySeconds * 1000); });

  const play = new Play(scene, camera, player.ground, { onSky: sky }, anyPanelOpen, { bareScene: true });

  await environment.ready;
  ground.mirror.renderList = [ground.reflectionProxy,
    ...scene.meshes.filter(mesh => mesh.renderingGroupId === SKY_LAYER_GROUP && !mesh.parent && !mesh.name.startsWith("rain"))];
  ground.mirror.setRenderingAutoClearDepthStencil(SKY_LAYER_GROUP, false);
  if (environment.atmosphere) mirrorTheSky(scene, environment.atmosphere, ground.mirror);
  environment.sunDisc.dimIn(ground.mirror);
  if (import.meta.env.DEV) Object.assign(window, { __scene: scene, __settings: settings, __environment: environment, __player: player, __play: play, __ground: ground });
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
