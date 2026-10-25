import { DownloadEstimate } from "./DownloadEstimate";
import { BIOME_SUMMARIES } from "../biomes/registry";
import { requestFullscreen } from "../core/Fullscreen";
import { packSizeBytes, isPackCached, loadPack } from "../biomes/PackLoader";

export function showDestinationScreen(onChoose: (id: string) => void) {
  const root = document.createElement("div");
  root.id = "destination";

  const panel = document.createElement("div");
  panel.id = "destination-panel";

  const heading = document.createElement("h1");
  heading.textContent = "Choose your destination";
  panel.appendChild(heading);

  const cardsRow = document.createElement("div");
  cardsRow.className = "destination-cards";
  panel.appendChild(cardsRow);

  let selected = 0;
  let busy = false;

  const cards = BIOME_SUMMARIES.map((b, i) => {
    const card = document.createElement("div");
    card.className = "destination-card";
    card.innerHTML = `
      <img src="${b.thumbnailUrl}" alt="" onerror="this.style.visibility='hidden'">
      <div class="info">
        <h2>${b.name}</h2>
        <p>${b.blurb}</p>
        <p class="size">…</p>
      </div>
    `;
    card.addEventListener("click", () => { selected = i; render(); });
    packSizeBytes(b.id).then(async bytes => {
      const mb = (bytes / 1e6).toFixed(0);
      const cached = await isPackCached(b.id);
      card.querySelector(".size")!.textContent = cached ? "Downloaded ✓" : `${mb} MB`;
    }).catch(() => { card.querySelector(".size")!.textContent = ""; });
    return card;
  });
  cards.forEach(c => cardsRow.appendChild(c));

  const enter = document.createElement("button");
  enter.id = "destination-enter";
  enter.textContent = "Enter";
  enter.addEventListener("click", choose);
  panel.appendChild(enter);

  const progress = document.createElement("div");
  progress.id = "destination-progress";
  const progressFill = document.createElement("div");
  progressFill.className = "fill";
  progress.appendChild(progressFill);
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-label", "Destination download");
  progress.setAttribute("aria-valuemin", "0");
  progress.setAttribute("aria-valuemax", "100");
  progress.hidden = true;
  panel.appendChild(progress);

  const progressText = document.createElement("p");
  progressText.id = "destination-progress-text";
  progressText.hidden = true;
  panel.appendChild(progressText);

  const error = document.createElement("p");
  error.id = "destination-error";
  error.hidden = true;
  panel.appendChild(error);

  root.appendChild(panel);

  function render() {
    cards.forEach((c, i) => c.classList.toggle("selected", i === selected));
  }
  render();

  function choose() {
    requestFullscreen();
    if (busy) return;
    void download();
  }

  async function download() {
    busy = true;
    error.hidden = true;
    const id = BIOME_SUMMARIES[selected].id;
    let progressTimer: ReturnType<typeof setInterval> | undefined;
    try {
      if (!(await isPackCached(id))) {
        enter.disabled = true;
        progressFill.style.width = "0%";
        progress.hidden = false;
        progressText.hidden = false;
        const estimate = new DownloadEstimate(performance.now());
        // A timer keeps the ETA and stalled state current even when no fetch chunk arrives.
        const renderProgress = () => {
          const { percent, text } = estimate.display(performance.now());
          progressFill.style.width = `${percent}%`;
          progress.setAttribute("aria-valuenow", String(percent));
          progress.setAttribute("aria-valuetext", text);
          progressText.textContent = text;
        };
        renderProgress();
        progressTimer = setInterval(renderProgress, 250);
        await loadPack(id, p => estimate.update(p, performance.now()));
      }
    } catch {
      progressText.hidden = true;
      progress.hidden = true;
      enter.disabled = false;
      busy = false;
      error.textContent = "Download failed — check your connection and press Enter to retry";
      error.hidden = false;
      return;
    } finally {
      clearInterval(progressTimer);
    }
    root.remove();
    window.removeEventListener("keydown", onKey);
    onChoose(id);
  }

  function onKey(e: KeyboardEvent) {
    if (e.code === "ArrowRight") { selected = (selected + 1) % cards.length; render(); }
    else if (e.code === "ArrowLeft") { selected = (selected - 1 + cards.length) % cards.length; render(); }
    else if (e.code === "Enter" || e.code === "NumpadEnter") choose();
  }
  window.addEventListener("keydown", onKey);

  document.body.appendChild(root);
  // For now there is one destination, so there is nothing to choose: it is entered at once, and this
  // screen is seen only while its pack downloads or if the download fails.
  if (cards.length === 1) void download();
}
