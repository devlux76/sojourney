import {
  DEFAULT_VOLUME, KOKORO_DOWNLOAD_MB, browserSpeak, fault, saveChoice, testKokoro, toAudioBuffer,
  type Detected, type Kokoro, type NarratorChoice, type Spoken,
} from "../narrator/voices";
import { LIQUID_DOWNLOAD_MB, TRIAL_ASK, TRIAL_QUESTION, browserWriter, browserWriterState, testLiquid, unusable } from "../narrator/writers";

// What the recorded guide says here (tools/build_narration.py records it), and what a live voice is
// first tried on.
const PHRASE = "Welcome aboard. This is how your guide will sound.";
const RECORDED_SAMPLE = "audio/guide_sample.ogg";

// The sound check: shown before the destinations the first time, when the browser or graphics cards
// have changed, and whenever the player asks. The first choice is who tells the tour: the recorded
// guide, which needs nothing more, or a narrator that writes on this machine. Only for a narrator is
// there a second choice, the voice, and each voice is heard speaking what that narrator wrote.
export async function showSoundCheck(detected: Detected, choice: NarratorChoice, notice: string | null = null): Promise<void> {
  const root = element("div", { id: "soundcheck" });
  const panel = root.appendChild(element("div", { id: "soundcheck-panel" }));
  panel.append(
    element("h1", { textContent: "Sound check" }),
    element("p", { textContent: "Your guide on the boat can be the one we recorded, or a narrator on your own machine that tells the tour in its own words." }));
  if (notice) panel.append(element("p", { className: "soundcheck-notice", textContent: notice }));

  // Sound made here is played on this screen's own audio, before the game's audio engine exists.
  let context: AudioContext | null = null, playing: AudioBufferSourceNode | null = null;
  const recorded = new Audio(RECORDED_SAMPLE);
  const loudness = () => choice.volume / DEFAULT_VOLUME;
  const quiet = () => {
    recorded.pause();
    playing?.stop();
    window.speechSynthesis?.cancel();
  };
  const playSamples = (spoken: Spoken) => {
    context ??= new AudioContext();
    const gain = context.createGain();
    gain.gain.value = loudness();
    playing = context.createBufferSource();
    playing.buffer = toAudioBuffer(spoken);
    playing.connect(gain).connect(context.destination);
    playing.start();
  };

  // A set of cards of which one is chosen; a card that cannot be used here cannot be chosen.
  const group = <K extends string>(parent: HTMLElement, chosen: (kind: K) => void) => {
    const cards: { kind: K; card: HTMLElement; usable: () => boolean }[] = [];
    const select = (kind: K) => {
      chosen(kind);
      for (const c of cards) c.card.classList.toggle("selected", c.kind === kind);
    };
    const add = (kind: K, title: string, detail: string, action: string, usable: () => boolean) => {
      const card = parent.appendChild(element("div", { className: "soundcheck-option" }));
      const text = card.appendChild(element("div"));
      text.append(element("h2", { textContent: title }));
      const note = text.appendChild(element("p", { textContent: detail }));
      const button = card.appendChild(element("button", { textContent: action }));
      card.addEventListener("click", () => { if (usable()) select(kind); });
      card.classList.toggle("unavailable", !usable());
      cards.push({ kind, card, usable });
      return { card, note, button };
    };
    return { add, select };
  };

  // What each narrator answered to the trial question; the voices below speak the chosen one's answer.
  const answers = new Map<NarratorChoice["writer"], string>();
  const voiceSection = element("div", { id: "soundcheck-voices", hidden: true });
  const writers = group<NarratorChoice["writer"]>(panel, kind => {
    choice.writer = kind;
    voiceSection.hidden = kind === "script";
  });

  const record = writers.add("script", "Recorded guide", "Our own script, read for you. Ready now, and the same on every machine.", "Listen", () => true);
  record.button.addEventListener("click", () => {
    quiet();
    recorded.volume = Math.min(1, loudness());
    recorded.currentTime = 0;
    void recorded.play();
  });

  panel.append(element("p", { textContent: `Or let a narrator tell it. Each is asked "${TRIAL_QUESTION}" so you can read its answer, and then hear it.` }));
  const answered = (kind: NarratorChoice["writer"], card: HTMLElement, note: HTMLElement, answer: string) => {
    answers.set(kind, answer);
    note.textContent = answer;
    card.classList.remove("unavailable");
    writers.select(kind);
  };

  const builtIn = await browserWriterState();
  const model = writers.add("browser", "Your browser's narrator",
    builtIn === "none" ? "This browser has no built-in narrator."
      : builtIn === "available" ? "Your browser has a built-in narrator. Ask it and see."
      : "Your browser has a built-in narrator, which it will download the first time. Ask it and see.",
    "Ask it", () => answers.has("browser"));
  model.button.disabled = builtIn === "none";
  model.button.addEventListener("click", async () => {
    model.button.disabled = true;
    try {
      const writer = await browserWriter(share => { model.note.textContent = `Downloading the browser's narrator: ${Math.round(share * 100)}%`; });
      model.note.textContent = "Asking the narrator…";
      const answer = await writer.write(TRIAL_ASK);
      writer.dispose();
      if (unusable(answer)) throw new Error(unusable(answer)!);
      answered("browser", model.card, model.note, answer);
    } catch (error) {
      model.note.textContent = `It did not work on this system: ${String(error).slice(0, 120)}.`;
    }
    model.button.disabled = false;
  });

  const liquid = writers.add("liquid", "Our narrator model",
    `We also provide a narrator model. It is a download of about ${(LIQUID_DOWNLOAD_MB / 1000).toFixed(1)} GB and may not work on your system. Try it and decide.`,
    "Try it", () => answers.has("liquid"));
  liquid.button.addEventListener("click", async () => {
    liquid.button.disabled = true;
    const results = await testLiquid(detected, text => { liquid.note.textContent = text; });
    const passed = results.find(result => !result.fault);
    liquid.button.disabled = false;
    if (!passed) {
      liquid.note.textContent = `It did not work on this system: ${results.map(r => r.fault).join("; ")}.`;
      return;
    }
    choice.liquidPower = passed.power;
    answered("liquid", liquid.card, liquid.note, passed.text);
  });

  // The voices, for a narrator only: each speaks the answer the chosen narrator gave.
  panel.append(voiceSection);
  voiceSection.append(
    element("h1", { textContent: "How it sounds" }),
    element("p", { textContent: "Hear the narrator's answer in each voice, and choose one." }));
  const said = () => answers.get(choice.writer) ?? PHRASE;
  let voiceChosen = false;
  const voices = group<NarratorChoice["voice"]>(voiceSection, kind => { choice.voice = kind; voiceChosen = true; });

  // A browser may list its voices late, after this screen is up, so the card follows the list as it
  // changes and does not rely on what was found at the start.
  const hasBrowserVoice = () => (window.speechSynthesis?.getVoices().length ?? 0) > 0;
  const browser = voices.add("browser", "Your browser's voice", "", "Listen", hasBrowserVoice);
  const showBrowserVoice = () => {
    browser.note.textContent = hasBrowserVoice() ? "Built into this browser; nothing to download. How it sounds depends on the browser."
      : "This browser has no voice of its own.";
    browser.button.disabled = !hasBrowserVoice();
    browser.card.classList.toggle("unavailable", !hasBrowserVoice());
  };
  showBrowserVoice();
  window.speechSynthesis?.addEventListener("voiceschanged", showBrowserVoice);
  browser.button.addEventListener("click", () => {
    quiet();
    browserSpeak(said(), loudness()).catch(() => { browser.note.textContent = "The browser's voice would not speak here."; });
  });

  // The live voice is a download that may not work on this system, so it is tried only when asked for.
  let live: Kokoro | null = null;
  const kokoro = voices.add("kokoro", "Live voice",
    `A higher-quality voice that speaks on your own machine. It is a download of about ${KOKORO_DOWNLOAD_MB["webgpu-low"]} MB `
    + `(${KOKORO_DOWNLOAD_MB.wasm} MB if it has to run on the processor) and may not work on your system. Try it and decide.`
    + (choice.gpuUnstable ? " On this machine it runs on the processor only." : ""),
    "Try it", () => live !== null);
  kokoro.button.addEventListener("click", async () => {
    quiet();
    kokoro.button.disabled = true;
    if (!live) {
      const tried = await testKokoro(detected, choice.gpuUnstable, PHRASE, text => { kokoro.note.textContent = text; });
      const passed = tried.results.find(result => !result.fault);
      if (!tried.kokoro || !passed) {
        kokoro.note.textContent = `It did not work on this system: ${tried.results.map(r => r.fault).join("; ")}.`;
        kokoro.button.disabled = false;
        return;
      }
      live = tried.kokoro;
      choice.kokoroDevice = passed.device;
      kokoro.card.classList.remove("unavailable");
      kokoro.button.textContent = "Listen";
      kokoro.note.textContent = passed.pace <= 1 ? "It works here."
        : "It works here, though slower than talking, so each line will be made ready before it is needed.";
      voices.select("kokoro");
    }
    const wait = kokoro.note.textContent;
    kokoro.note.textContent = "Making the narrator's answer ready…";
    const spoken = await live.speak(said()).catch(() => null);
    kokoro.note.textContent = wait;
    kokoro.button.disabled = false;
    if (spoken && !fault(spoken.samples)) playSamples(spoken);
    else kokoro.note.textContent = "It could not speak that answer on this system.";
  });

  const volume = panel.appendChild(element("label", { className: "soundcheck-volume", textContent: "Guide's loudness" }));
  const slider = volume.appendChild(element("input", { type: "range", min: "0.2", max: "1", step: "0.05", value: String(choice.volume) }));
  slider.addEventListener("input", () => { choice.volume = Number(slider.value); });

  // The check starts from the recorded guide each time: a narrator and its voice are tried afresh.
  writers.select("script");
  voiceChosen = false;
  const go = panel.appendChild(element("button", { id: "soundcheck-continue", textContent: "Continue" }));
  document.body.appendChild(root);
  return new Promise(resolve => go.addEventListener("click", () => {
    quiet();
    void context?.close();
    live?.dispose();
    // A narrator with no voice to speak for it cannot be heard, so the recorded guide stands in.
    if (choice.writer === "script" || !voiceChosen) Object.assign(choice, { writer: "script", voice: "recorded" });
    choice.signature = detected.signature;
    saveChoice(choice);
    root.remove();
    resolve();
  }));
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, properties: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), properties);
}
