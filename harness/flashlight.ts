import {
  Camera, Color3, Color4, FreeCamera, MeshBuilder, PBRMaterial,
  RenderTargetTexture, Scene, SpotLight, Vector3,
} from "@babylonjs/core";

// Isolate the production spotlight parameters on a matte panel ten metres away.
// Linear pixels measure beam width/brightness without exposure, fog or terrain
// variations; gameplay/deep-water appearance is checked separately in the world.
export async function verifyFlashlight(source: SpotLight, intensities: readonly number[]) {
  const scene = new Scene(source.getScene().getEngine());
  scene.clearColor = new Color4(0, 0, 0, 1);
  scene.imageProcessingConfiguration.isEnabled = false;
  const camera = new FreeCamera("flashlightProbe", Vector3.Zero(), scene);
  camera.setTarget(Vector3.Forward());
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.orthoLeft = camera.orthoBottom = -6;
  camera.orthoRight = camera.orthoTop = 6;
  const panel = MeshBuilder.CreatePlane("flashlightPanel", { size: 12 }, scene);
  panel.position.z = 10;
  const material = new PBRMaterial("flashlightMatte", scene);
  material.albedoColor = new Color3(0.05, 0.05, 0.05);
  material.metallic = 0;
  material.roughness = 1;
  material.allowShaderHotSwapping = false;
  panel.material = material;
  const light = new SpotLight("flashlightSample", Vector3.Zero(), Vector3.Forward(),
    source.angle, source.exponent, scene);
  light.diffuse = source.diffuse.clone();
  light.specular = source.specular.clone();
  light.range = source.range;
  light.intensityMode = source.intensityMode;
  light.falloffType = source.falloffType;
  const target = new RenderTargetTexture("flashlightPixels", 256, scene, false);
  target.activeCamera = camera;
  target.renderList = [panel];
  const sample = async (angle: number) => {
    light.angle = angle;
    await material.forceCompilationAsync(panel);
    // Let Babylon prepare active meshes, transforms and the render-target effect
    // before readback; compilation alone does not perform scene preparation.
    for (let i = 0; i < 3; i++) {
      scene.render();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    target.render(true);
    const pixels = await target.readPixels() as Uint8Array | null;
    if (!pixels) throw new Error("Flashlight pixel readback unavailable");
    const row = Array.from({ length: 256 }, (_, x) => pixels[(128 * 256 + x) * 4]);
    const peak = Math.max(...row);
    const width = row.filter(value => value >= peak / 2).length;
    return { peak, width };
  };
  try {
    const results = [];
    for (const intensity of intensities) {
      light.intensity = intensity;
      const old = await sample(0.4);
      const widened = await sample(source.angle);
      const ratio = widened.width / old.width;
      if (old.peak < 5 || old.peak >= 250 || Math.abs(widened.peak - old.peak) > 2
        || ratio < 2 || ratio > 3) {
        throw new Error(`Flashlight coverage/brightness failed: ${JSON.stringify({ intensity, old, widened, ratio })}`);
      }
      results.push({ intensity, old, widened, ratio });
    }
    return { angle: source.angle, geometricWidthRatio: Math.tan(source.angle / 2) / Math.tan(0.2), results };
  } finally {
    target.dispose();
    scene.dispose();
  }
}
