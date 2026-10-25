import { startFullscreenToggle } from "./core/Fullscreen";
import { showDestinationScreen } from "./ui/DestinationScreen";
import { loadBiomeModule } from "./biomes/registry";
import { detect, liveVoiceDiedLastTime, loadChoice } from "./narrator/voices";
import { showSoundCheck } from "./ui/SoundCheckScreen";

startFullscreenToggle();

async function registerServiceWorker(): Promise<void> {
  if (!(import.meta.env.PROD && "serviceWorker" in navigator)) return;
  await navigator.serviceWorker.register("/sw.js");
  if (navigator.serviceWorker.controller) return;
  await new Promise<void>(resolve => {
    navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
    setTimeout(resolve, SW_WAIT_MS);
  });
}
const SW_WAIT_MS = 3000;
const swControlled = registerServiceWorker().catch(e => console.warn("Service worker:", e));

const enginePromise = import("./core/startGame");
const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;

// The sound check comes before the destinations the first time, again when the browser or the graphics
// cards have changed since it last ran, and when it is asked for (?soundcheck, from the settings panel).
async function soundCheck(): Promise<void> {
  const detected = await detect(), choice = loadChoice();
  const asked = new URLSearchParams(location.search).has("soundcheck");
  // A live voice that took the page down with it last time has been moved to the processor for good,
  // and the player is told so at the sound check.
  const died = liveVoiceDiedLastTime(choice);
  if (!asked && !died && choice.signature === detected.signature) return;
  await showSoundCheck(detected, choice, died
    ? "The live voice stopped this machine's graphics last time. If you try it again it will run on the processor only, which is slower, so its lines are made ready ahead of time." : null);
  if (asked) history.replaceState(null, "", location.pathname);
}

void soundCheck().then(() => showDestinationScreen(async id => {
  const [biome] = await Promise.all([loadBiomeModule(id), swControlled]);
  const { startGame } = await enginePromise;
  await startGame(canvas, biome);
}));
