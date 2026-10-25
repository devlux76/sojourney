import { Camera, MultiMaterial, PBRBaseMaterial, StandardMaterial,
  DitheredTileFadeMaterialPlugin, type InstancedMesh, type Scene } from "@babylonjs/core";

const FADE_MS = 500;
const FADE_GAP = 0.05;

// The stock plugin supplies complementary opaque coverage, including hardware
// instances and integrated prepass. Standalone shadow/depth passes still need
// their own coverage; registering both levels does not make those passes fade.
export class PropTransitions {
  private shown = -1;
  private target = -1;
  private start = -1;
  private hidden = true;
  private readonly plugins: DitheredTileFadeMaterialPlugin[][];

  constructor(readonly instances: InstancedMesh[], private distances: number[]) {
    this.plugins = instances.map(instance => {
      const material = instance.material;
      const materials = material instanceof MultiMaterial ? material.subMaterials : [material];
      return materials.map(material => {
        if (!(material instanceof PBRBaseMaterial) && !(material instanceof StandardMaterial))
          throw new Error(`Unsupported prop fade material: ${material?.name}`);
        return DitheredTileFadeMaterialPlugin.GetOrCreate(material);
      });
    });
    for (const instance of instances) instance.isVisible = false;
  }

  update(scene: Scene, fades: boolean, now = performance.now()) {
    const camera = scene.activeCamera;
    if (!camera) return;
    const first = this.instances[0];
    if (!first.isEnabled()) {
      // A fully hidden prop starts at today's level when it becomes visible.
      this.hidden = true;
      this.start = -1;
      return;
    }
    first.computeWorldMatrix(true);
    const sphere = first.getBoundingInfo().boundingSphere;
    const distance = camera.mode === Camera.ORTHOGRAPHIC_CAMERA ? camera.minZ
      : sphere.centerWorld.subtract(camera.globalPosition).length();
    // Each prepared level takes over once the eye is past its authored distance, the same
    // mapping Babylon's own LOD dispatch uses. This stays a plain distance comparison on
    // purpose: registering the levels on a separate selector mesh with addLODLevel would
    // make Babylon lend the selector's bounds and transform to every level, so instances
    // created from those levels would inherit the selector's empty bounds and frustum-cull
    // as a point — vanishing unless their centre is on screen while their mirror image
    // and shadows still draw. Each drawn instance must also retain its own prepared level
    // throughout a timed fade, which the native dispatch would override.
    let wanted = 0;
    while (wanted < this.distances.length && this.distances[wanted] < distance) wanted++;
    if (fades && !this.hidden && this.shown >= 0) {
      if (this.start >= 0) wanted = this.target;
      else if (wanted < this.shown) {
        // Inward hysteresis keeps a resting prop from restarting at its boundary.
        wanted = this.shown;
        while (wanted > 0 && distance < this.distances[wanted - 1] * (1 - FADE_GAP)) wanted--;
      }
    }
    if (this.hidden || this.shown < 0 || !fades) {
      this.shown = wanted;
      this.start = -1;
    } else if (wanted !== this.shown && this.start < 0) this.start = now;
    this.hidden = false;
    this.target = wanted;
    const progress = this.start < 0 ? 1 : Math.min(1, (now - this.start) / FADE_MS);
    if (progress === 1) { this.shown = wanted; this.start = -1; }
    this.instances.forEach((instance, i) => {
      const lower = i === this.shown ? 0 : 1 - progress;
      const upper = i === this.shown ? (this.start < 0 ? 1 : 1 - progress) : i === wanted ? 1 : lower;
      instance.isVisible = lower < upper;
      for (const plugin of this.plugins[i]) plugin.setFadeBounds(instance, lower, upper);
    });
  }
}
