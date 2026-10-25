import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { describeBackend } from "./Engine";
import { isRecordingVideo } from "./Screenshot";

const KEYS = "` settings   H hide this   T travel   B binoculars   K sit   L lie down   Shift run   Tab rucksack   F fullscreen   P photo (Shift: no HUD)   V video";
const TOUCH = "stick to move   tap a satellite   ··· for everything else";

export function startHud(engine: AbstractEngine) {
  const hud = document.getElementById("hud") as HTMLDivElement;
  // H hides the HUD, the reticle and the play panels, to see the world with nothing over it, and
  // brings them back. They fade as they do for a player at rest; a photo leaves out what is hidden.
  window.addEventListener("keydown", e => {
    if (e.code === "KeyH" && !e.repeat) document.body.classList.toggle("hud-off");
  });
  const { gpu, backend } = describeBackend(engine);
  setInterval(() => {
    const keys = document.body.classList.contains("touch") ? TOUCH : KEYS;
    // While a video is being recorded the HUD says so; the HUD itself is not in the video.
    const help = isRecordingVideo() ? `${keys}\n● recording video, V to stop and save` : keys;
    hud.textContent = `${gpu}\n${backend} | ${engine.getRenderWidth()}x${engine.getRenderHeight()}\n${engine.getFps().toFixed(0)} fps\n${help}`;
  }, 500);
}
