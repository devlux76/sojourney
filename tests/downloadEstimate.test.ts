import { expect, test } from "bun:test";
import { DownloadEstimate } from "../src/ui/DownloadEstimate";

test("download estimates exclude cache hits and wait for a usable network rate", () => {
  const estimate = new DownloadEstimate(0);
  expect(estimate.display(0).text).toContain("Estimating");
  estimate.update({ loaded: 800, total: 1000, networkLoaded: 0 }, 100);
  expect(estimate.display(500)).toEqual({ percent: 80, text: "80% — Estimating time left…" });
  estimate.update({ loaded: 850, total: 1000, networkLoaded: 50 }, 1000);
  expect(estimate.display(1000)).toEqual({ percent: 85, text: "85% — About 3s left" });
});

test("a stalled download waits, recovers, and never reports a negative ETA", () => {
  const estimate = new DownloadEstimate(0);
  estimate.update({ loaded: 10, total: 1000, networkLoaded: 10 }, 1000);
  expect(estimate.display(11_000).text).toContain("Waiting for connection");
  estimate.update({ loaded: 20, total: 1000, networkLoaded: 20 }, 12_000);
  expect(estimate.display(12_000).text).toContain("About");
  estimate.update({ loaded: 1001, total: 1000, networkLoaded: 1001 }, 13_000);
  expect(estimate.display(13_000)).toEqual({ percent: 100, text: "100% — Finishing download…" });
});

test("fully cached and retried downloads have independent estimates", () => {
  const cached = new DownloadEstimate(0);
  cached.update({ loaded: 1000, total: 1000, networkLoaded: 0 }, 10);
  expect(cached.display(10).percent).toBe(100);
  const retry = new DownloadEstimate(20_000);
  retry.update({ loaded: 500, total: 1000, networkLoaded: 0 }, 20_001);
  expect(retry.display(20_001)).toEqual({ percent: 50, text: "50% — Estimating time left…" });
});

test("downloads taking more than an hour show hours", () => {
  const estimate = new DownloadEstimate(0);
  estimate.update({ loaded: 1, total: 100_000, networkLoaded: 1 }, 0);
  estimate.update({ loaded: 1, total: 100_000, networkLoaded: 1 }, 1_000);
  expect(estimate.display(1_000).text).toContain("About 28 h left");
});

test("slow downloads use minutes and the recent rate replaces startup history", () => {
  const estimate = new DownloadEstimate(0);
  estimate.update({ loaded: 10, total: 1000, networkLoaded: 10 }, 1000);
  expect(estimate.display(1000).text).toContain("2 min");
  for (let second = 2; second <= 20; second++)
    estimate.update({ loaded: second * 20, total: 1000, networkLoaded: second * 20 }, second * 1000);
  expect(estimate.display(20_000).text).toContain("30s");
});
