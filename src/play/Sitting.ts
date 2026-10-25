import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Play, Activity, ViewRay, Found, REACH } from "./Play";
import { rayNear } from "./targeting";
import type { Flora } from "../engine/flora";

// A rock too low is not worth sitting on, and one too high cannot be climbed onto.
const MIN_SIT_RISE = 0.25;
const MAX_SIT_RISE = 1.4;

// Rocks the player can sit on. The seat is aimed at the middle of the rock's side so the
// reticle catches it while looking at the rock, and sitting puts the player on its top.
export class Sitting implements Activity {
  constructor(private play: Play, private flora: Flora) {}

  find(ray: ViewRay): Found | null {
    const { origin, dir } = ray;
    let best: Found | null = null;
    for (const seat of this.flora.seatsNear(origin.x, origin.z, REACH + 2)) {
      const rise = seat.y - this.play.ground.getHeight(seat.x, seat.z);
      if (rise < MIN_SIT_RISE || rise > MAX_SIT_RISE) continue;
      // Reach is to the rock's surface, which is a radius nearer than the centre the ray is tested against.
      const centre = rayNear(origin, dir, { x: seat.x, y: seat.y - rise / 2, z: seat.z }, seat.radius, REACH + seat.radius);
      if (centre === null) continue;
      const d = Math.max(0, centre - seat.radius);
      if (!best || d < best.distance)
        best = { target: { kind: "seat" }, distance: d, perform: () => this.play.sit(new Vector3(seat.x, seat.y, seat.z)) };
    }
    return best;
  }

  update() {}
}
