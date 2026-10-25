export function startFullscreenToggle() {
  window.addEventListener("keydown", (e) => {
    if (e.code !== "KeyF" || e.repeat) return;
    toggleFullscreen();
  });
}

export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else requestFullscreen();
}

export function requestFullscreen() {
  document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
}
