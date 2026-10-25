#!/usr/bin/env bash
# Starts the game: a fresh dev server, then Chromium full screen on it.
#
# The server is always restarted because Vite lists the files under public/ once, when it starts.
# A server left running from before a pack was rebuilt answers requests for the new pack files with
# index.html, and the game fails with "Unexpected magic" on the first ground GLB.
#
# Usage: ./start-game.sh [--gpu intel|amd]
# With --gpu the browser is shown only that graphics card, so the game cannot run on the other one
# (--gpu intel leaves the AMD card free). Without it Chromium picks, which is the AMD card.
cd "$(dirname "$0")"

GPU=
while [ $# -gt 0 ]; do
  case "$1" in
    --gpu) GPU="$2"; shift 2 ;;
    --gpu=*) GPU="${1#--gpu=}"; shift ;;
    *) echo "Usage: $0 [--gpu intel|amd]" >&2; exit 2 ;;
  esac
done
case "$GPU" in
  '') ;;
  intel) VENDOR=0x8086 ;;
  amd) VENDOR=0x1002 ;;
  *) echo "Unknown GPU '$GPU': use intel or amd" >&2; exit 2 ;;
esac
if [ -n "$GPU" ]; then
  # Mesa's device-select layer takes vendor:device in hex; the trailing ! hides every other device
  # from Vulkan, which is what both ANGLE and WebGPU draw through here.
  for card in /sys/class/drm/renderD*/device; do
    if [ "$(cat "$card/vendor")" = "$VENDOR" ]; then
      device=$(cat "$card/device")
      export MESA_VK_DEVICE_SELECT="${VENDOR#0x}:${device#0x}!"
    fi
  done
  if [ -z "$MESA_VK_DEVICE_SELECT" ]; then echo "No $GPU graphics card found" >&2; exit 1; fi
  echo "Graphics card: $GPU ($MESA_VK_DEVICE_SELECT)"
fi

URL=http://127.0.0.1:3000/
LOG=/tmp/sojourney-dev.log

# Every wait below gives up after 30 seconds instead of holding the terminal, and each request after 2.
up() { curl -s -m 2 -o /dev/null "$URL"; }

pkill -f 'node_modules/\.bin/vite'
# Wait for the old server to let go of the port; --strictPort below fails rather than move to 3001.
SECONDS=0
while up; do
  if [ $SECONDS -ge 30 ]; then echo "Something other than Vite is still answering on $URL" >&2; exit 1; fi
  sleep 0.2
done

# The server outlives this script and its terminal, so it has no input. Vite shuts down when its
# input closes, taking that to mean its parent has gone, unless CI is set.
CI=true nohup bun run dev --strictPort > "$LOG" 2>&1 &
SECONDS=0
until up; do
  if ! kill -0 $! 2>/dev/null || [ $SECONDS -ge 30 ]; then echo "The dev server did not start; see $LOG" >&2; exit 1; fi
  sleep 0.2
done

# Chromium is detached too, so the script returns as soon as the window is opening.
# allow_unsafe_apis lets WebGPU report real GPU timings (Babylon's captureGPUFrameTime); without it
# Chromium hides them and every reading is 0.
nohup /snap/chromium/current/usr/lib/chromium-browser/chrome --enable-features=DefaultANGLEVulkan,Vulkan --ignore-gpu-blocklist --disable-gpu-sandbox --enable-dawn-features=allow_unsafe_apis --start-fullscreen "$URL" > /dev/null 2>&1 &
