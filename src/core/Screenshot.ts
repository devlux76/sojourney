import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { VideoRecorder } from "@babylonjs/core/Misc/videoRecorder";

const KEY = "KeyP";
const VIDEO_KEY = "KeyV";
// Frames a second the video is recorded at: as many as the game can draw, so that flicker between
// frames is in the recording.
const VIDEO_FPS = 60;
const HUD_IDS = ["hud", "play-reticle", "play-hint", "play-card", "play-pack", "play-announce"];

export function startScreenshotKey(engine: AbstractEngine) {
  window.addEventListener("keydown", (e) => {
    if (e.code !== KEY || e.repeat) return;
    takePhoto(engine, !e.shiftKey);
  });
}

// V starts recording the game's picture (without the HUD, which is not part of the canvas) with
// Babylon's VideoRecorder, and V again stops it and saves the video as a WebM file.
let recorder: VideoRecorder | null = null;

export function isRecordingVideo(): boolean {
  return recorder?.isRecording === true;
}

export function startVideoKey(engine: AbstractEngine) {
  window.addEventListener("keydown", (e) => {
    if (e.code !== VIDEO_KEY || e.repeat) return;
    if (!VideoRecorder.IsSupported(engine)) return console.warn("This browser cannot record the canvas");
    recorder ??= new VideoRecorder(engine, { fps: VIDEO_FPS });
    if (recorder.isRecording) return recorder.stopRecording();
    // No time limit: the recording runs until V is pressed again.
    void recorder.startRecording(`sojourney_${stamp()}.webm`, 0);
  });
}

export function takePhoto(engine: AbstractEngine, withHud: boolean) {
  engine.onEndFrameObservable.addOnce(() => {
    const source = engine.getRenderingCanvas()!;
    const shot = document.createElement("canvas");
    shot.width = source.width;
    shot.height = source.height;
    const ctx = shot.getContext("2d")!;
    ctx.drawImage(source, 0, 0);
    if (withHud) drawHud(ctx, source);
    shot.toBlob(blob => blob && download(blob), "image/png");
  });
}

function drawHud(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement) {
  const view = source.getBoundingClientRect();
  const scale = source.width / view.width;
  ctx.scale(scale, scale);
  ctx.textBaseline = "top";
  for (const id of HUD_IDS) {
    const el = document.getElementById(id);
    if (!el || el.hidden) continue;
    const style = getComputedStyle(el);
    const opacity = parseFloat(style.opacity);
    if (style.display === "none" || opacity === 0) continue;
    const r = el.getBoundingClientRect();
    const x = r.left - view.left, y = r.top - view.top;
    ctx.globalAlpha = opacity;
    ctx.fillStyle = style.backgroundColor;
    ctx.beginPath();
    ctx.roundRect(x, y, r.width, r.height, parseFloat(style.borderTopLeftRadius) || 0);
    ctx.fill();

    const text = el.textContent ?? "";
    if (!text) continue;
    ctx.font = style.font;
    ctx.fillStyle = style.color;
    const centred = style.textAlign === "center";
    ctx.textAlign = centred ? "center" : "left";
    const tx = centred ? x + r.width / 2 : x + parseFloat(style.paddingLeft);
    const lineHeight = parseFloat(style.lineHeight);
    const lead = (lineHeight - parseFloat(style.fontSize)) / 2;
    text.split("\n").forEach((line, i) => {
      ctx.fillText(line, tx, y + parseFloat(style.paddingTop) + i * lineHeight + lead);
    });
  }
  ctx.globalAlpha = 1;
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-");
}

function download(blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `sojourney_${stamp()}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
