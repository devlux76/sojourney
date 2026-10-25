import { Scene } from "@babylonjs/core/scene";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { settings } from "../core/Settings";
import type { SettingControl } from "../core/SettingsPanel";
import { WATER_Y } from "./pack";
import { DAYLIGHT_DEPTH_METRES, inLake } from "./lake";
import { rainReach } from "./environment/Fog";

const DENSITY_AT_VISIBILITY = Math.sqrt(-Math.log(0.05));
const WATER_SATURATION = 0.85;
const SURFACE_BRIGHTNESS = 2.5;
const RIPPLE_DRIFT = 0.0004;
const VOLUME_VISIBILITIES = 3;

export class Underwater {
  active = false;
  daylight = 1;
  // How far the water lets the diver see, in metres: beyond it less than a thousandth of a thing's
  // own colour is left, so the ground and the forest skip what lies there. Infinite above the surface.
  get reach(): number {
    // Streaming and prop culling read this before update(). Do not let the
    // previous surface state leak a frame of distant work into a new dive.
    return Number.isFinite(this.volumeRadius)
      ? rainReach(DENSITY_AT_VISIBILITY / settings.underwaterVisibility) : Infinity;
  }
  // The opaque volume encloses the eye. Geometry wholly beyond its outer
  // radius cannot contribute even when the rain veil's elevation test stays clear.
  get volumeRadius(): number {
    // Sky/stream observers run before update(), so answer from the current eye
    // rather than the previous frame's active state on entry and resurfacing.
    const eye = this.camera.globalPosition;
    return eye.y < WATER_Y && inLake(eye.x, eye.z)
      ? settings.underwaterVisibility * VOLUME_VISIBILITIES : Infinity;
  }
  // Whether the diver is so deep that less than a thousandth of the daylight is left on even the
  // highest thing the water lets them see: the sun and the moon light nothing in view there.
  sunless = false;
  private surface: Mesh;
  private surfaceMaterial: StandardMaterial;
  private ripples: Texture;
  private volume: Mesh;
  private volumeMaterial: StandardMaterial;

  constructor(private scene: Scene, private camera: Camera, private water: Mesh) {
    this.surface = water.clone("waterUnderside");
    this.surface.position.y -= 0.01;
    this.surface.isPickable = false;
    this.surfaceMaterial = new StandardMaterial("waterUnderside", scene);
    this.surfaceMaterial.disableLighting = true;
    this.surfaceMaterial.backFaceCulling = false;
    this.surfaceMaterial.fogEnabled = false;
    const ripples = this.ripples = new Texture("textures/waterbump.png", scene);
    ripples.uScale = ripples.vScale = 1440;
    this.surfaceMaterial.emissiveTexture = ripples;
    this.surface.material = this.surfaceMaterial;
    this.surface.setEnabled(false);

    this.volume = MeshBuilder.CreateSphere("waterVolume", { diameter: 2, segments: 12, sideOrientation: Mesh.BACKSIDE }, scene);
    this.volume.isPickable = false;
    this.volumeMaterial = new StandardMaterial("waterVolume", scene);
    this.volumeMaterial.disableLighting = true;
    this.volumeMaterial.fogEnabled = false;
    this.volume.material = this.volumeMaterial;
    this.volume.setEnabled(false);

    scene.onBeforeRenderObservable.add(() => {
      if (this.active) {
        ripples.uOffset += RIPPLE_DRIFT;
        ripples.vOffset += RIPPLE_DRIFT * 0.6;
      }
      this.update();
    });
  }

  settingControls(): SettingControl[] {
    return [
      { key: "underwaterVisibility", label: "Underwater visibility (m)", min: 5, max: 150, step: 1 },
      { key: "underwaterHue", label: "Underwater hue", min: 150, max: 250, step: 1 },
      { key: "underwaterBrightness", label: "Underwater brightness", min: 0.05, max: 1, step: 0.01 },
    ];
  }

  private update() {
    // Below lake level and inside the lake mask: land outside the caldera that lies lower is dry.
    const cam = this.camera.globalPosition;
    const under = cam.y < WATER_Y && inLake(cam.x, cam.z);
    if (under !== this.active) {
      this.active = under;
      this.volume.setEnabled(under);
      // From below, the lake's top face is never seen (the underside stands in for it), so it is not
      // drawn, and neither is the mirror it reflects the world in.
      this.water.setEnabled(!under);
      if (!under) {
        this.surface.setEnabled(false);
        this.sunless = false;
      }
    }
    if (!under) return;
    // Above the surface the weather sets the scene fog (environment/Fog.ts); under it the water takes over.
    // This runs after the weather's update each frame, so the water's values are the ones drawn.
    // The water glows with the daylight scattered in it, which is gone at depth: around a diver on
    // the floor it is black, and only what a lamp reaches shows.
    const daylightLeft = Math.exp(-(WATER_Y - cam.y) / DAYLIGHT_DEPTH_METRES);
    const water = Color3.FromHSV(settings.underwaterHue, WATER_SATURATION, settings.underwaterBrightness * this.daylight * daylightLeft);
    this.scene.fogColor = water;
    this.scene.fogDensity = DENSITY_AT_VISIBILITY / settings.underwaterVisibility;
    // The water fogs as the rain does, so the same reach holds; a diver deeper than that cannot
    // see the underside of the surface either.
    this.surface.setEnabled(WATER_Y - cam.y < this.reach);
    this.sunless = Math.exp(-(WATER_Y - cam.y - this.reach) / DAYLIGHT_DEPTH_METRES) < 0.001;
    this.surfaceMaterial.emissiveColor = water.scale(SURFACE_BRIGHTNESS);
    // An emissive texture is added to the colour, not multiplied by it, so the ripples must be
    // dimmed with the light themselves: at full strength at night, under an exposure thirty times
    // the day's, the whole underside of the surface was a white sheet.
    this.ripples.level = this.daylight * daylightLeft;
    this.volumeMaterial.emissiveColor = water;
    this.volume.position.copyFrom(this.camera.globalPosition);
    this.volume.scaling.setAll(this.volumeRadius);
  }
}
