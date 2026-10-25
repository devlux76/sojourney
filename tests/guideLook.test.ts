import { describe, expect, test } from "bun:test";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { easeGuideAngles, guideAngles } from "../src/engine/player/guideLook";

interface Stop { name: string; distance: number; lookAt: [number, number, number] }
interface Route { length: number; docks: (Stop & { position: [number, number] })[]; sights: Stop[]; points: [number, number][] }

const route = await Bun.file("public/packs/crater-lake/route/boat_tour.json").json() as Route;
// The eye rides ~3.5 m over the water on deck.
const EYE_Y = 3.5;

function boatAt(distance: number): Vector3 {
  const points = route.points, f = (distance / route.length) * points.length;
  const i0 = Math.floor(f) % points.length, i1 = (i0 + 1) % points.length, t = f - Math.floor(f);
  const [ax, az] = points[i0], [bx, bz] = points[i1];
  return new Vector3(ax + (bx - ax) * t, EYE_Y, az + (bz - az) * t);
}

const stops: Stop[] = [...route.docks, ...route.sights];

describe("guide look targets", () => {
  test("every stop carries a sane world aim point", () => {
    expect(stops.length).toBe(6);
    for (const stop of stops) {
      const [x, y, z] = stop.lookAt;
      for (const v of [x, y, z]) expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(x)).toBeLessThan(9000);
      expect(Math.abs(z)).toBeLessThan(9000);
      expect(y).toBeGreaterThan(-100);
      expect(y).toBeLessThan(600);
    }
  });

  test("each aim sits a plausible throw from its stop, pitched up at the feature", () => {
    for (const stop of stops) {
      const eye = boatAt(stop.distance);
      const target = new Vector3(...stop.lookAt);
      const horizontal = Math.hypot(target.x - eye.x, target.z - eye.z);
      expect(horizontal).toBeGreaterThan(10);
      expect(horizontal).toBeLessThan(1500);
      const { pitch } = guideAngles(eye, target);
      // All six features stand above the boat's eye: Llao's face, the Backbone spine, the island
      // cone, the Ship stack, the Castle band and the cove shore. Looking up is negative pitch.
      expect(pitch).toBeLessThan(0.05);
      expect(pitch).toBeGreaterThan(-0.8);
    }
  });

  test("the tour order matches the narration's next-stop lines", () => {
    const order = [...stops].sort((a, b) => a.distance - b.distance).map(s => s.name);
    expect(order).toEqual(["Cleetwood Cove", "Llao Rock", "Devils Backbone", "Wizard Island", "Phantom Ship", "Pumice Castle"]);
  });
});

describe("guide easing", () => {
  test("swings the short way round the yaw branch", () => {
    const eased = easeGuideAngles(-Math.PI + 0.1, 0, { yaw: Math.PI - 0.1, pitch: 0 }, 3, 1 / 60);
    expect(eased.yaw).toBeLessThan(-Math.PI + 0.1);
  });

  test("settles on every stop's aim from the worst seat in well under the line", () => {
    for (const stop of stops) {
      const eye = boatAt(stop.distance);
      const aim = guideAngles(eye, new Vector3(...stop.lookAt));
      // Worst seat: facing dead away, level head.
      let yaw = aim.yaw + Math.PI, pitch = 0;
      for (let i = 0; i < 120; i++) ({ yaw, pitch } = easeGuideAngles(yaw, pitch, aim, 3, 1 / 60));
      expect(Math.abs(yaw - aim.yaw)).toBeLessThan(0.01);
      expect(Math.abs(pitch - aim.pitch)).toBeLessThan(0.01);
    }
  });
});
