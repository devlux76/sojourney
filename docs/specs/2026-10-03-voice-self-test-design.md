# Voice self-test and calibration — design (draft, 2026-10-03)

**Status:** Built on 2026-10-03 as the "sound check" (`src/ui/SoundCheckScreen.ts`, `src/narrator/`),
awaiting the project lead's acceptance testing in Chromium, Chrome and Firefox. Differences from the
design below: the browser's voices and Kokoro on WebNN are written but untested, since the test
Chromium has neither; the trial answers are compared as text, not spoken; a narrator rewords only
the line said on arriving at a stop.

## Goal

The tour guide should speak live where the player's machine can do it well, and fall back to the
recordings where it cannot, without the player having to know why. A self-test finds out which voice
engines work on this machine, the player picks among the ones that do, and the game remembers.

## Why a test and not a rule

Measured on the development machine on 2026-10-03, Kokoro-82M (full precision), one 7.5 s sentence:

| Engine | Intel UHD 630 | Radeon Pro 560X (Mesa RADV) |
|---|---|---|
| WebGPU, Transformers.js 4.3.0 | clean; about 7.6 s to generate | corrupt (peaks in the millions), identical every run; about 22 s |
| WebGPU, kokoro-js 1.2.1 (older runtime) | crashes | corrupt |
| CPU (WASM) | clean, but 40 to 85 s to generate while the machine was busy | same |

The Radeon fault is silent: no GPU error is raised, and it is the same in Chromium 153 and Google
Chrome 154. A rule keyed on the card's name would switch off good cards and miss other bad ones, so
each engine is judged by what it produces.

## When it runs

- Before the destination screen, the first time the game is opened.
- Again when the browser version or the graphics cards WebGPU reports have changed since the last run.
- Whenever the player asks, from the settings panel.

The cheap part (detection) is automatic and takes a moment. Anything that needs a download waits for
the player to ask for it, so nobody sits through a 310 MB download before seeing a destination.

## Candidates, in the order they are preferred

1. Kokoro on WebNN, where the browser has `navigator.ml`.
2. Kokoro on WebGPU, on the low-power card first, so that on a two-card machine the voice stays off
   the card the game renders on.
3. Kokoro on the CPU.
4. The browser's own voices: the Web Speech API (`speechSynthesis`, `SpeechSynthesisUtterance`).
5. The recordings in the pack. Always available; the fallback for everything above.

## How a candidate is tested

Each Kokoro candidate speaks one short fixed phrase and is judged on the samples it returns:

- Valid: every sample finite, peak no more than about 1.5, loudness within the range of speech (the
  good runs measured 0.07 to 0.08 RMS; the faulty ones 0.4 to 10,000).
- Fast enough: generated in less time than it lasts, once warmed up. A slower engine can still be
  offered if lines are generated ahead of the stop they belong to; that is an open question below.

The browser's voices return no samples to inspect. They count as working when at least one voice is
listed and a spoken phrase reports that it started and ended; the player's ear is the judge.

## Calibration

The self-test screen plays the phrase in each working voice and the player chooses one and sets its
loudness against the bell. The click this takes also unlocks the browser's audio, which the game must
wait for in any case.

## What is remembered

The chosen engine and voice, the loudness, and a signature of the browser version and graphics cards,
in the existing settings store. A changed signature runs the test again.

## Boundaries

- Voice and audio only. Graphics detail stays with the target frame rate (`AGENTS.md`, rule 3).
- The recordings stay in the pack and stay the default until a live engine has passed the test.
- The lines the live voices speak are the same text the recordings were made from
  (`tools/narration/crater-lake.json`), shipped in the pack as text.

## Limits known today

- The browser's voices play straight to the speakers, outside the game's audio engine: their level
  cannot be mixed with the bell and ambience by the game, and they are probably not in V recordings.
- The browser's voices differ by browser. The project lead's experience: robotic in Chromium, quite
  nice in Chrome and Firefox, Siri's voice in Safari. So the same setting sounds different on each,
  which is one more reason the player chooses by ear on the calibration screen.
- The test Chromium on the development machine lists no voices and has no `navigator.ml`, so
  candidates 1 and 4 are untested.
- Kokoro live means each player downloads the model: 310 MB at full precision. The 88 MB 8-bit model
  is not supported on WebGPU and was slower on the CPU.

## Licences of what live mode would ship to players

Recorded here for the project lead to rule on.

- Kokoro-82M weights and ONNX export: Apache-2.0.
- Transformers.js: Apache-2.0. ONNX Runtime Web, which it bundles: MIT.
- `phonemizer` (text to sounds, needed in the browser by any live Kokoro): labelled Apache-2.0, and
  it bundles eSpeak NG compiled to WebAssembly, which is GPL-3.0. Today eSpeak NG is used only at
  build time; live mode would ship it.
- Web Speech API voices: provided by the browser or operating system; nothing of ours ships.

## Found after building (2026-10-03, late)

- ONNX Runtime Web 1.31 ignores its own `powerPreference` and `adapter` settings and always takes the
  high-performance card. Each model's worker now answers the adapter request itself.
- The Intel UHD 630 on Linux gives clean speech but hung three times in one evening during live-voice
  work (kernel: `i915 ... Resetting rcs0 for preemption time out`, `GPU HANG`). A hang resets the
  browser's whole graphics process, so the game's picture on the other card goes blank white while its
  sound carries on. No test at the sound check can predict this.
- So a mark is left while the live voice is at work (`markLiveVoiceBusy`). If the page dies under it
  even once, the next start marks the graphics card unstable for the voice for good (`gpuUnstable`)
  and moves the voice to the processor, slower as that is, and says so at the sound check (project
  lead's decision). If it dies on the processor too, the recorded guide is put back.
- Still open: the game does not recover its own picture after the graphics process is reset; the
  player has to reload.

## Decisions (project lead, 2026-10-03)

1. Live mode is built now, with the fixed script as what it speaks first.
2. An engine slower than real time may be used: each stop's line is made during the leg before it.
3. The self-test screen tells the player a higher-quality voice is available, how big the download
   is, and that it may not work on their system; they try it and decide.
4. Where the browser has a built-in language model it is used. Our own narrator model (Liquid LFM2.5)
   is offered the same way as the voice: its size, that it may not work here, try it and decide.
5. The trial for narrators: each one is asked "How did Crater Lake form?" and the player chooses the
   answer they prefer.

Build order: (1) the voices, the self-test screen and generate-ahead on the boat; (2) the narrators
(script, browser's model, Liquid) and the trial question.
