"""Speak the tour guide's lines into public/packs/crater-lake/audio/tour/.

Usage: uv run --quiet --with kokoro-onnx --with soundfile python tools/build_narration.py
Then rebuild the pack index: python3 tools/build_pack_index.py crater-lake

The lines are in tools/narration/crater-lake.json: for each stop of the boat tour (named as in
tools/build_route.py) what the guide says as the ship arrives and as she departs. Each becomes one
recording, <stop>_<arrive|depart>.ogg with the stop's name in lower case and underscores, which is
where src/narrator/Narrator.ts looks for it. "respell" gives words the voice gets wrong the spelling
it should read instead. The lines as spoken are also written beside the recordings as lines.json, for
the voices that speak live in the player's browser, and the phrase the sound check plays is recorded
to public/audio/guide_sample.ogg.

The voice is Kokoro-82M (https://huggingface.co/hexgrad/Kokoro-82M, Apache-2.0), run on the CPU here
through kokoro-onnx (MIT), which turns text into sounds with eSpeak NG (GPL-3.0). The model (310 MB)
and its voices are downloaded to tools/.cache/kokoro the first time. In the browser the same model
gave noise on the graphics card and took five times as long as the speech lasts on the CPU, so the
lines are spoken here and shipped as recordings.
"""
import json
import pathlib
import re
import urllib.request

import soundfile
from kokoro_onnx import Kokoro

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "tools/narration/crater-lake.json"
OUT = ROOT / "public/packs/crater-lake/audio/tour"
CACHE = ROOT / "tools/.cache/kokoro"
RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = ["kokoro-v1.0.onnx", "voices-v1.0.bin"]
# What every voice says at the sound check; the same words are in src/ui/SoundCheckScreen.ts.
SAMPLE = "Welcome aboard. This is how your guide will sound."
SAMPLE_OUT = ROOT / "public/audio/guide_sample.ogg"


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        if not (CACHE / name).exists():
            print(f"downloading {name}")
            urllib.request.urlretrieve(RELEASE + name, CACHE / name)
    script = json.loads(SOURCE.read_text())
    kokoro = Kokoro(str(CACHE / FILES[0]), str(CACHE / FILES[1]))
    OUT.mkdir(parents=True, exist_ok=True)
    for stale in OUT.glob("*.ogg"):
        stale.unlink()
    total = 0.0
    for lines in script["stops"].values():
        for moment, line in lines.items():
            for word, spoken in script["respell"].items():
                line = line.replace(word, spoken)
            lines[moment] = line
    (OUT / "lines.json").write_text(json.dumps({"stops": script["stops"]}, indent=1) + "\n")
    samples, rate = kokoro.create(SAMPLE, voice=script["voice"], speed=script["speed"], lang="en-us")
    SAMPLE_OUT.parent.mkdir(parents=True, exist_ok=True)
    soundfile.write(SAMPLE_OUT, samples, rate, format="OGG", subtype="VORBIS")
    for stop, lines in script["stops"].items():
        for moment, line in lines.items():
            samples, rate = kokoro.create(line, voice=script["voice"], speed=script["speed"], lang="en-us")
            path = OUT / f"{re.sub('[^a-z0-9]+', '_', stop.lower())}_{moment}.ogg"
            soundfile.write(path, samples, rate, format="OGG", subtype="VORBIS")
            total += len(samples) / rate
            print(f"  {path.name}: {len(samples) / rate:.1f} s, peak {abs(samples).max():.2f}, {path.stat().st_size // 1024} KB")
    print(f"{script['voice']}: {total:.0f} s of speech")


if __name__ == "__main__":
    main()
