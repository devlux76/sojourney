import type { LoadProgress } from "../biomes/PackLoader";

const WINDOW_MS = 10_000;
const MIN_SAMPLE_MS = 1_000;

// A rolling network-only rate includes time spent fetching and caching, but excludes cached-byte jumps.
// The clock is supplied by the caller so slow connections and stalls can be checked deterministically.
export class DownloadEstimate {
  private progress: LoadProgress = { loaded: 0, total: 0, networkLoaded: 0 };
  private samples: { at: number; bytes: number }[];
  private lastNetworkAt: number;

  constructor(start: number) {
    this.samples = [{ at: start, bytes: 0 }];
    this.lastNetworkAt = start;
  }

  update(progress: LoadProgress, now: number) {
    if (progress.networkLoaded > this.progress.networkLoaded) this.lastNetworkAt = now;
    this.progress = progress;
    this.samples.push({ at: now, bytes: progress.networkLoaded });
    this.prune(now);
  }

  display(now: number): { percent: number; text: string } {
    this.prune(now);
    const { loaded, total, networkLoaded } = this.progress;
    const percent = total > 0 ? Math.max(0, Math.min(100, Math.floor(loaded / total * 100))) : 0;
    if (total > 0 && loaded >= total) return { percent, text: "100% — Finishing download…" };
    if (now - this.lastNetworkAt >= WINDOW_MS)
      return { percent, text: `${percent}% — Waiting for connection…` };
    const first = this.samples[0];
    const elapsed = now - first.at;
    const bytes = networkLoaded - first.bytes;
    if (total <= 0 || elapsed < MIN_SAMPLE_MS || bytes <= 0)
      return { percent, text: `${percent}% — Estimating time left…` };
    // Round up so the remaining-time label does not promise completion before the bytes arrive.
    const seconds = Math.max(1, Math.ceil((total - loaded) / (bytes / elapsed) / 1000));
    const remaining = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.ceil(seconds / 60)} min` : `${Math.ceil(seconds / 3600)} h`;
    return { percent, text: `${percent}% — About ${remaining} left` };
  }

  private prune(now: number) {
    // Retain the sample immediately before the window boundary to avoid a zero-length rate.
    while (this.samples.length > 1 && this.samples[1].at <= now - WINDOW_MS) this.samples.shift();
  }
}
