import type { Biome } from "../biomes/Biome";
import { GUIDE_DELAY_SECONDS, type AmbientAudio } from "../engine/AmbientAudio";
import { Kokoro, browserSpeak, fault, loadChoice, toAudioBuffer, DEFAULT_VOLUME } from "./voices";
import { Liquid, arrivalAsk, browserWriter, unusable, type Writer } from "./writers";

type Moment = "arrive" | "depart";

// The tour guide in the game: says each stop's line in the voice, and by the narrator, the player
// chose at the sound check. A live voice or a model may be slower than talking, so a line is made
// ahead, while the ship is on her way to where it will be said. A line that is not ready in time, or
// comes out wrong, is replaced by our written line, and failing that by its recording.
export class Narrator {
  private choice = loadChoice();
  private kokoro: Kokoro | null = null;
  private writer: Promise<Writer | null> = Promise.resolve(null);
  private lines: Promise<Record<string, Record<Moment, string>>> | null = null;
  private asked = new Set<string>();
  private texts = new Map<string, string>();
  private made = new Map<string, AudioBuffer>();
  private speaking = 0;

  constructor(private guide: NonNullable<Biome["tourGuideAudio"]>, private audio: AmbientAudio) {
    const { voice, kokoroDevice, writer, liquidPower } = this.choice;
    // The recordings say our written lines and nothing else, so a narrator needs a voice that can
    // speak new words.
    if (voice === "recorded") return;
    this.lines = fetch(guide.urlPrefix + "lines.json").then(r => r.json()).then(file => file.stops);
    if (voice === "kokoro" && kokoroDevice) {
      this.kokoro = new Kokoro(kokoroDevice);
      this.kokoro.ready.catch(e => console.warn("Live voice failed to start:", e));
    }
    if (writer === "browser") this.writer = browserWriter().catch(e => (console.warn("Browser narrator:", e), null));
    else if (writer === "liquid" && liquidPower) {
      const liquid = new Liquid(liquidPower);
      this.writer = liquid.ready.then(() => liquid, e => (console.warn("Narrator model failed to start:", e), null));
    }
  }

  private get volume(): number {
    return (this.guide.volume * this.choice.volume) / DEFAULT_VOLUME;
  }

  // Have the line for this stop and moment made, ready for when it is wanted.
  prepare(stop: string, moment: Moment) {
    const key = `${stop}|${moment}`;
    if (!this.lines || this.asked.has(key)) return;
    this.asked.add(key);
    void (async () => {
      let text = (await this.lines!)[stop][moment];
      // Only the telling of a stop is a narrator's to reword: the line on leaving names the next
      // stop and stays as written.
      const writer = moment === "arrive" ? await this.writer : null;
      if (writer) {
        const written = await writer.write(arrivalAsk(stop, text)).catch(e => (console.warn("Narrator:", e), ""));
        if (unusable(written)) console.warn(`Narrator: ${unusable(written)}; the written line is used`);
        else text = written;
      }
      this.texts.set(key, text);
      if (!this.kokoro) return;
      const spoken = await this.kokoro.speak(text);
      if (fault(spoken.samples)) console.warn(`Live voice: ${fault(spoken.samples)}; the recording is used`);
      else this.made.set(key, toAudioBuffer(spoken));
    })().catch(e => console.warn("Tour guide:", e));
  }

  // Says this stop's line in the chosen voice. Answers when the line starts sounding and when
  // it ends, so the game can turn the player to what is talked about for exactly that long.
  say(stop: string, moment: Moment): { started: Promise<void>; done: Promise<void> } {
    const key = `${stop}|${moment}`, made = this.made.get(key), text = this.texts.get(key);
    // The next time round the line is made afresh.
    this.made.delete(key);
    this.texts.delete(key);
    this.asked.delete(key);
    const turn = ++this.speaking;
    if (this.choice.voice === "browser") {
      // The browser speaks outside the game's audio engine, so the wait for the bell is kept here.
      let start!: () => void;
      const started = new Promise<void>(resolve => { start = resolve; });
      const done: Promise<void> = Promise.resolve()
        .then(() => this.lines ?? Promise.reject(new Error("no lines")))
        .then(lines => new Promise<void>(resolve => {
          setTimeout(() => {
            // A newer line has taken over: wait for nothing and sound nothing.
            if (turn !== this.speaking) { start(); resolve(); return; }
            start();
            browserSpeak(text ?? lines[stop][moment], this.volume).then(resolve, () => resolve());
          }, GUIDE_DELAY_SECONDS * 1000);
        }))
        .catch(() => { start(); });
      return { started, done };
    }
    const recording = `${this.guide.urlPrefix}${stop.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${moment}.ogg`;
    return this.audio.guide(made ?? recording, this.volume);
  }
}
