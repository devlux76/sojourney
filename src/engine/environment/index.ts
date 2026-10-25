import type { Scene } from "@babylonjs/core/scene";
import type { Immutable, Nullable } from "@babylonjs/core/types";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Observable } from "@babylonjs/core/Misc/observable";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Material } from "@babylonjs/core/Materials/material";
import { PBRBaseMaterial } from "@babylonjs/core/Materials/PBR/pbrBaseMaterial";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { configureAgXComparison } from "./agxToneMapping";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import "@babylonjs/core/Rendering/geometryBufferRendererSceneComponent";
import "@babylonjs/core/Rendering/prePassRendererSceneComponent";
import "@babylonjs/core/Culling/ray";
import { Atmosphere } from "@babylonjs/addons/atmosphere/atmosphere";
import { SkyMaterial } from "@babylonjs/materials/sky";
import {
  sunPositionToRef, horizontalToVectorToRef, celestialBasisToRef, type Horizontal,
} from "../../sky/Astronomy";
import { GameClock, nextStayDay, saveStayDay } from "../../sky/GameClock";
import { WEATHER_KINDS, WeatherSampler, type WeatherParams } from "../../sky/Weather";
import type { Biome } from "../../biomes/Biome";
import { settings, SHADOW_MODES, type ShadowMode } from "../../core/Settings";
import type { ChoiceControl, SettingControl, ValueControl } from "../../core/SettingsPanel";
import { SKY_LAYER_GROUP, FAR_PLANE, SKY_RADIUS, smoothstep, distantSkyLayers, type SkyState } from "./sky";
import { NightSky } from "./NightSky";
import { Moon } from "./Moon";
import { Clouds } from "./Clouds";
import { SunDisc } from "./Sun";
import { Rain } from "./Rain";
import { Fog } from "./Fog";
import { Lightning, type Strike } from "./Lightning";

export type { SkyState } from "./sky";

export type EnvironmentBiome = Pick<Biome, "location" | "calendar" | "climate">;

export interface EnvironmentOptions {
  siteHeightMetres?: number;
  shadowDistance?: number;
  shadowMapSize?: number;
}

export interface Environment {
  readonly sun: DirectionalLight;
  readonly moon: DirectionalLight;
  readonly shadows: CascadedShadowGenerator;
  readonly atmosphere: Atmosphere | null;
  readonly pipeline: DefaultRenderingPipeline;
  readonly sunDisc: SunDisc;
  readonly clock: GameClock;
  readonly onSky: Observable<SkyState>;
  // Fires at each lightning strike of a storm; thunder is to follow after the strike's delay.
  readonly onLightning: Observable<Strike>;
  readonly ready: Promise<void>;
  isPaused: () => boolean;
  // The world supplies the same aboard-and-dwelling boat state that holds graphical beauty.
  isBeautyStop: () => boolean;
  // The hour the sun, sky and weather are shown at when it is not the clock's own: the world supplies
  // the tour ship's time while the player is aboard, and null ashore. The clock itself runs on untouched.
  shownHours: () => number | null;
  // The opaque underwater volume hides distant sky, while sky irradiance still lights objects.
  setSkyVisible(visible: boolean): void;
  settingControls(): (SettingControl | ValueControl | ChoiceControl)[];
  dispose(): void;
}

const SITE_HEIGHT_METRES = 1882;
const WEATHER_EASE_SECONDS = 20;
const SUN_INTENSITY = 4;
const STOCK_SUN_INTENSITY = 3;
// The share of the sun's light the clouds take, by the square of the cover: a part-cloudy day stays sunny,
// a full overcast leaves a tenth of the sun, which keeps faint shadows.
const SUN_DIM_BY_CLOUD = 0.9;
const SUN_DIM_BY_RAIN = 0.05;
// Light from the cloud deck itself. The atmosphere's sky light follows the sun's intensity, so dimming the
// sun under cloud would leave the ground almost unlit; the clouds give this much grey light back at full
// cover with the sun overhead, through the atmosphere's additional sky irradiance. Rain clouds give less.
const OVERCAST_SKYLIGHT = 0.75;
const OVERCAST_COLOUR = new Color3(0.85, 0.87, 0.9);
const RAIN_DIMS_SKYLIGHT = 0.45;
// The atmosphere's additional sky irradiance on a clear night, so the ground is never fully black.
const NIGHT_SKYLIGHT = 0.002;
// The sky light a full lightning flash adds by day. Exposure rises at night, so the flash is scaled
// down by it, and by this power more: on screen a midnight flash is about half as bright as one at noon,
// which in the dark is still a jolt.
const LIGHTNING_SKYLIGHT = 1;
const LIGHTNING_NIGHT_POWER = 1.25;
const LIGHTNING_COLOUR = new Color3(0.8, 0.85, 1);
const NIGHT_SKYLIGHT_COLOUR = new Color3(0.64, 0.78, 1);
const MOON_INTENSITY = 0.005;
const MOON_COLOUR = new Color3(0.6, 0.7, 1.0);
const MOON_FADE = [0, 10];
const DAYLIGHT_FADE = [-6, 4];
const STARS_OUT = [-4, -14];
const SHADOWS_ON_ABOVE = -0.5;
// Anti-aliasing samples of the rendering pipeline; the optimizer drops them to 1 and restores this.
export const PIPELINE_SAMPLES = 4;
const EXPOSURE_DAY = 1.5;
const EXPOSURE_NIGHT = 30;
const EXPOSURE_FADE = [-14, 6];

function onScreen(wanted: (mesh: AbstractMesh) => boolean) {
  const kept: AbstractMesh[] = [];
  return (_pass: number, list: Nullable<Immutable<AbstractMesh[]>>, length: number) => {
    kept.length = 0;
    for (let i = 0; i < length; i++) if (wanted(list![i])) kept.push(list![i]);
    return kept;
  };
}

export function createEnvironment(scene: Scene, camera: Camera, biome: EnvironmentBiome,
  options: EnvironmentOptions = {}): Environment {
  const engine = scene.getEngine();
  const { lat, lon, utcOffsetHours } = biome.location;
  if (camera.maxZ < FAR_PLANE) camera.maxZ = FAR_PLANE;
  scene.renderingManager.setRenderingAutoClearDepthStencil(SKY_LAYER_GROUP, false);
  scene.clearColor = new Color4(0, 0, 0, 1);

  // At sunset the sun stops binding its shadow map. A hot-swapped old PBR effect
  // still expects that depth-array sampler, which can now contain a colour LUT
  // or an empty array in WebGL. Let Babylon wait for the matching effect instead.
  // Cover streamed glTF materials and clones as well as materials already loaded.
  const waitForPbrEffect = (material: Material) => {
    if (material instanceof PBRBaseMaterial) material.allowShaderHotSwapping = false;
  };
  scene.materials.forEach(waitForPbrEffect);
  const materialObserver = scene.onNewMaterialAddedObservable.add(waitForPbrEffect);

  const sun = new DirectionalLight("sun", new Vector3(0, -1, 0), scene);
  const moon = new DirectionalLight("moon", new Vector3(0, -1, 0), scene);
  moon.diffuse = MOON_COLOUR;
  moon.specular = MOON_COLOUR;
  moon.intensity = 0;

  const atmosphere = Atmosphere.IsSupported(engine)
    ? new Atmosphere("atmosphere", scene, [sun], {
      originHeight: (options.siteHeightMetres ?? SITE_HEIGHT_METRES) / 1000,
      isLinearSpaceLight: true,
      isLinearSpaceComposition: true,
      minimumMultiScatteringIntensity: 0,
      // A little more haze than the clear mountain air gives, so the caldera walls 2 km off read as distant.
      aerialPerspectiveIntensity: 1.4,
      additionalDiffuseSkyIrradianceIntensity: NIGHT_SKYLIGHT,
    })
    : null;
  const fallbackSky = atmosphere ? null : createStockSky(scene, sun);

  const skyProxy = MeshBuilder.CreateSphere("skyProxy", { diameter: 2 * SKY_RADIUS, segments: 8, sideOrientation: Mesh.BACKSIDE }, scene);
  const skyProxyMaterial = new StandardMaterial("skyProxyMaterial", scene);
  skyProxyMaterial.alpha = 0;
  skyProxyMaterial.backFaceCulling = false;
  skyProxy.material = skyProxyMaterial;
  skyProxy.infiniteDistance = true;
  skyProxy.isPickable = false;
  skyProxy.alwaysSelectAsActiveMesh = true;

  const shadows = new CascadedShadowGenerator(options.shadowMapSize ?? 2048, sun);
  shadows.numCascades = 3;
  shadows.lambda = 0.85;
  shadows.shadowMaxZ = Math.min(camera.maxZ, options.shadowDistance ?? 600);
  shadows.stabilizeCascades = true;
  shadows.depthClamp = true;
  shadows.bias = 0.002;
  shadows.normalBias = 0.02;
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = CascadedShadowGenerator.QUALITY_HIGH;
  shadows.cascadeBlendPercentage = 0.1;

  // Keep ACES until the E29 noon/low-sun/night comparison has visual acceptance.
  configureAgXComparison(false, engine.isWebGPU);
  const pipeline = new DefaultRenderingPipeline("environment", true, scene, [camera]);
  pipeline.samples = PIPELINE_SAMPLES;
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 1;
  pipeline.bloomWeight = 0.3;
  // Wide enough for the sun's disc to spread into a glare.
  pipeline.bloomKernel = 128;
  pipeline.sharpenEnabled = true;
  pipeline.sharpen.edgeAmount = 0.25;
  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.toneMappingEnabled = true;
  pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  // Dithers the tone-mapped gradient by the default 1/255, so the clear midday sky grades
  // smoothly instead of banding (E19). Like tone mapping it stays on through the optimizer's
  // bloom/sharpen/AA step, which never touches it.
  pipeline.imageProcessing.ditheringEnabled = true;

  // SSAO2 lives behind the settings toggle (default 1): on the classic render loop it has
  // fought the SceneOptimizer before (ghosted frames, fog lighting the far shore). The sky layers
  // are kept out of its geometry buffer, as with the lake mirror's sky handling.
  let ssao: SSAO2RenderingPipeline | null = null;
  const isSceneMesh = (mesh: AbstractMesh) => mesh.renderingGroupId !== SKY_LAYER_GROUP;
  const syncSsao = () => {
    // 0 is off, 1 or greater means enabled
    const currentMode = settings.ssao;
    const on = currentMode >= 1;
    
    if (on) {
      if (!ssao) {
        ssao = new SSAO2RenderingPipeline("ssao", scene, { ssaoRatio: 0.5, blurRatio: 1 }, [camera], true);
        ssao.radius = 1.5;
        ssao.totalStrength = 0.5;
        ssao.maxZ = 200;
        ssao.expensiveBlur = true;
        scene.geometryBufferRenderer!.getGBuffer().getCustomRenderList = onScreen(isSceneMesh);
      }
      
      // Map slider snapping points (1, 2, 3, 4) to actual MSAA sample configurations (1, 2, 4, 8)
      const msaaMapping: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 8 };
      ssao.samples = msaaMapping[currentMode] ?? 1;
    } else if (!on && ssao) {
      ssao.dispose();
      ssao = null;
    }
  };
  syncSsao();

  const clock = new GameClock(nextStayDay(), biome.calendar.startHour, undefined, biome.calendar, utcOffsetHours);
  saveStayDay(clock.day);
  // The biome supplies the deterministic pattern; the sampler applies the shared weather model.
  const weatherSampler = new WeatherSampler(biome.climate.weatherSeed, biome.climate);
  // Weather eases toward the sampler's reusable target, so keep its mutable current state separate.
  const weather: WeatherParams = { ...weatherSampler.update(clock.day, clock.hours, settings.dayLengthMinutes, settings.weatherOverride) };
  const onSky = new Observable<SkyState>();
  const sunDir = new Vector3(), moonDir = new Vector3(), skylightColour = new Color3();
  const sunPositionState: Horizontal = { alt: 0, az: 0 }, moonPositionState: Horizontal = { alt: 0, az: 180 };
  const celestial = new Float32Array(9);
  const lightning = new Lightning(scene, camera);
  const skyMasks = new Map<AbstractMesh, number>();
  const skyRenderingGroup = atmosphere?.skyRenderingGroup;
  let skyVisible = true;

  const environment: Environment = {
    sun, moon, shadows, atmosphere, pipeline, sunDisc: new SunDisc(scene, onSky, sun), clock, onSky, onLightning: lightning.onStrike, isPaused: () => false, isBeautyStop: () => false, shownHours: () => null,
    ready: Promise.resolve(),
    setSkyVisible: visible => {
      if (visible === skyVisible) return;
      skyVisible = visible;
      // Layer masks keep weather/astronomy enabled states intact. Babylon rejects
      // these meshes before submission, even when alwaysSelectAsActiveMesh is on.
      // All asynchronous sky assets are ready before the world's first render.
      if (!visible) {
        for (const mesh of scene.meshes) if (distantSkyLayers.has(mesh)) {
          skyMasks.set(mesh, mesh.layerMask);
          mesh.layerMask = 0;
        }
      } else {
        for (const [mesh, mask] of skyMasks) if (!mesh.isDisposed()) mesh.layerMask = mask;
        skyMasks.clear();
      }
      // A negative group skips only the sky compositor. Do not disable Atmosphere:
      // its LUTs and PBR irradiance are still needed by submerged objects.
      if (atmosphere) atmosphere.skyRenderingGroup = visible ? skyRenderingGroup! : -1;
    },
    settingControls: () => [
      {
        label: () => `Time of day ${formatHours(clock.hours)}`, min: 0, max: 23.95, step: 0.05,
        get: () => clock.hours, set: (v: number) => { clock.hours = v; },
      },
      { key: "dayLengthMinutes", label: "Day length (min)", min: 5, max: 120, step: 1 },
      { key: "weatherOverride", min: -1, max: WEATHER_KINDS.length - 1, step: 1,
        label: () => `Weather: ${settings.weatherOverride < 0 ? "auto" : WEATHER_KINDS[settings.weatherOverride]}` },
      {
        // Converted from ChoiceControl to ValueControl/SettingControl structure
        key: "ssao",
        label: () => `SSAO2 Quality: ${settings.ssao === 0 ? "Off" : `MSAA Level ${settings.ssao}`}`,
        min: 0,
        max: 4,
        step: 1,
        apply: () => syncSsao(),
      },
      {
        label: "Sun shadows", choices: SHADOW_MODES,
        get: () => settings.sunShadows, set: (v: string) => { settings.sunShadows = v as ShadowMode; },
      },
      ...moonSky.settingControls(),
    ],
    dispose: () => {
      observer.remove();
      materialObserver.remove();
      lightning.dispose();
      onSky.clear();
      shadows.dispose();
      skyProxy.dispose();
      ssao?.dispose();
      pipeline.dispose();
      atmosphere?.dispose();
      sun.dispose();
      moon.dispose();
    },
  };
  (environment as { ready: Promise<void> }).ready = NightSky.create(scene, onSky).then(() => undefined);
  new Clouds(scene, camera, onSky, sun, moon);
  new Rain(scene, camera, onSky);
  new Fog(scene, onSky, sun, moon);

  const observer = scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    const paused = environment.isPaused();
    if (!paused && clock.advance(dt, settings.dayLengthMinutes)) saveStayDay(clock.day);
    const hours = environment.shownHours() ?? clock.hours;
    const date = clock.date(hours);
    const sunPos = sunPositionToRef(date, lat, lon, sunPositionState);
    const moonPos = moonPositionState;
    moonPos.alt = -sunPos.alt;
    moonPos.az = (sunPos.az + 180) % 360;
    horizontalToVectorToRef(sunPos, sunDir);
    horizontalToVectorToRef(moonPos, moonDir);
    const moonFraction = 1;

    const target = weatherSampler.update(clock.day, hours, settings.dayLengthMinutes,
      settings.weatherOverride, environment.isBeautyStop());
    const k = paused ? 1 : 1 - Math.exp(-dt / WEATHER_EASE_SECONDS);
    for (const key of ["cloudCover", "rain", "wetness", "wind", "storm"] as const) weather[key] += (target[key] - weather[key]) * k;

    const daylight = smoothstep(DAYLIGHT_FADE[0], DAYLIGHT_FADE[1], sunPos.alt);
    const overcast = weather.cloudCover * weather.cloudCover;
    const weatherDim = 1 - SUN_DIM_BY_CLOUD * overcast - SUN_DIM_BY_RAIN * weather.rain;
    const exposure = Math.exp(Math.log(EXPOSURE_NIGHT) + (Math.log(EXPOSURE_DAY) - Math.log(EXPOSURE_NIGHT)) * smoothstep(EXPOSURE_FADE[0], EXPOSURE_FADE[1], sunPos.alt));
    // Lightning keeps its own time, in real seconds, and stops with the clock.
    const dim = EXPOSURE_DAY / exposure;
    const flash = lightning.update(paused ? 0 : dt, weather.storm, dim) * LIGHTNING_SKYLIGHT * Math.pow(dim, LIGHTNING_NIGHT_POWER);
    if (atmosphere) {
      // The cloud deck is lit from above by the sun, so its light follows the sun's height.
      const height = 0.25 + 0.75 * Math.max(0, Math.sin((sunPos.alt * Math.PI) / 180));
      const clouds = OVERCAST_SKYLIGHT * overcast * daylight * height * (1 - RAIN_DIMS_SKYLIGHT * weather.rain);
      // The additional sky light is the night's, the cloud deck's and the lightning's, each in its colour.
      const total = NIGHT_SKYLIGHT + clouds + flash;
      skylightColour.set(
        (NIGHT_SKYLIGHT * NIGHT_SKYLIGHT_COLOUR.r + clouds * OVERCAST_COLOUR.r + flash * LIGHTNING_COLOUR.r) / total,
        (NIGHT_SKYLIGHT * NIGHT_SKYLIGHT_COLOUR.g + clouds * OVERCAST_COLOUR.g + flash * LIGHTNING_COLOUR.g) / total,
        (NIGHT_SKYLIGHT * NIGHT_SKYLIGHT_COLOUR.b + clouds * OVERCAST_COLOUR.b + flash * LIGHTNING_COLOUR.b) / total);
      atmosphere.additionalDiffuseSkyIrradianceColor = skylightColour;
      atmosphere.additionalDiffuseSkyIrradianceIntensity = total;
    }
    const moonStrength = moonFraction * smoothstep(MOON_FADE[0], MOON_FADE[1], moonPos.alt) * (1 - daylight);

    sun.direction.copyFrom(sunDir).scaleInPlace(-1);
    sun.intensity = SUN_INTENSITY * weatherDim;
    moon.direction.copyFrom(moonDir).scaleInPlace(-1);
    moon.intensity = MOON_INTENSITY * SUN_INTENSITY * moonStrength * weatherDim;
    sun.shadowEnabled = sunPos.alt > SHADOWS_ON_ABOVE && scene.renderTargetsEnabled && settings.sunShadows === "on";
    if (fallbackSky) fallbackSky(sunDir, sunPos.alt, daylight);

    pipeline.imageProcessing.exposure = exposure;

    onSky.notifyObservers({
      date, sun: sunPos, moon: moonPos, sunDir, moonDir, moonFraction,
      celestial: celestialBasisToRef(date, lat, lon, celestial),
      weather, daylight, darkness: smoothstep(STARS_OUT[0], STARS_OUT[1], sunPos.alt), exposure, dt,
    });
  });

  const moonSky = new Moon(scene, onSky);
  return environment;
}

function formatHours(hours: number) {
  const h = Math.floor(hours), m = Math.floor((hours - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function createStockSky(scene: Scene, sun: DirectionalLight): (sunDir: Vector3, alt: number, daylight: number) => void {
  const sky = new SkyMaterial("stockSky", scene);
  sky.useSunPosition = true;
  sky.backFaceCulling = false;
  sky.disableDepthWrite = true;
  const dome = MeshBuilder.CreateSphere("stockSkyDome", { diameter: 2 * SKY_RADIUS, segments: 16 }, scene);
  dome.material = sky;
  dome.infiniteDistance = true;
  dome.isPickable = false;
  distantSkyLayers.add(dome);
  const fill = new HemisphericLight("stockFill", Vector3.Up(), scene);
  return (sunDir, alt, daylight) => {
    sky.sunPosition = sunDir.scale(100);
    sun.diffuse.set(1, 0.85 + 0.15 * smoothstep(0, 30, alt), 0.7 + 0.3 * smoothstep(0, 30, alt));
    sun.specular.copyFrom(sun.diffuse);
    fill.intensity = 0.3 * daylight;
  };
}
