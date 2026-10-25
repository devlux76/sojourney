export interface V3 { x: number; y: number; z: number }
export interface Hit { point: V3; distance: number }

export const TRUNK_RADIUS = 0.5;
export const MAX_FIRE_SLOPE = Math.tan((15 * Math.PI) / 180);
export const FIRE_ABOVE_WATER = 0.3;
export const FIRE_SPACING = 2.5;
const MARCH_STEP = 0.25;

export function rayTrunk(origin: V3, dir: V3, trunks: [number, number][], maxDist: number,
  radius = TRUNK_RADIUS): { trunk: [number, number]; distance: number } | null {
  let best: { trunk: [number, number]; distance: number } | null = null;
  const a = dir.x * dir.x + dir.z * dir.z;
  for (const trunk of trunks) {
    const ox = origin.x - trunk[0], oz = origin.z - trunk[1];
    const c = ox * ox + oz * oz - radius * radius;
    let t = 0;
    if (c > 0) {
      if (a < 1e-9) continue;
      const b = 2 * (ox * dir.x + oz * dir.z), disc = b * b - 4 * a * c;
      if (disc < 0) continue;
      t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t < 0) continue;
    }
    if (t <= maxDist && (!best || t < best.distance)) best = { trunk, distance: t };
  }
  return best;
}

export function rayNear(origin: V3, dir: V3, p: V3, radius: number, maxDist: number): number | null {
  const t = (p.x - origin.x) * dir.x + (p.y - origin.y) * dir.y + (p.z - origin.z) * dir.z;
  if (t < 0 || t > maxDist) return null;
  const dx = origin.x + dir.x * t - p.x;
  const dy = origin.y + dir.y * t - p.y;
  const dz = origin.z + dir.z * t - p.z;
  return dx * dx + dy * dy + dz * dz <= radius * radius ? t : null;
}

export function rayWater(origin: V3, dir: V3, waterY: number, maxHorizontal: number): Hit | null {
  if (origin.y <= waterY || dir.y >= -1e-6 || maxHorizontal < 0) return null;
  const distance = (waterY - origin.y) / dir.y;
  const x = origin.x + dir.x * distance, z = origin.z + dir.z * distance;
  const dx = x - origin.x, dz = z - origin.z;
  return dx * dx + dz * dz <= maxHorizontal * maxHorizontal
    ? { point: { x, y: waterY, z }, distance } : null;
}

export function rayGround(origin: V3, dir: V3, heightAt: (x: number, z: number) => number, maxDist: number): Hit | null {
  const below = (t: number) => origin.y + dir.y * t <= heightAt(origin.x + dir.x * t, origin.z + dir.z * t);
  let prev = 0;
  for (let t = MARCH_STEP; t <= maxDist + 1e-9; t += MARCH_STEP) {
    if (below(t)) {
      let lo = prev, hi = t;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (below(mid)) hi = mid; else lo = mid;
      }
      return { point: { x: origin.x + dir.x * hi, y: origin.y + dir.y * hi, z: origin.z + dir.z * hi }, distance: hi };
    }
    prev = t;
  }
  return null;
}

const LANDING_STEP = 0.5;

export function castLanding(origin: V3, heading: { x: number; z: number }, distance: number,
  isDeep: (x: number, z: number) => boolean): V3 | null {
  for (let d = distance; d > 0; d -= LANDING_STEP) {
    const x = origin.x + heading.x * d, z = origin.z + heading.z * d;
    if (isDeep(x, z)) return { x, y: origin.y, z };
  }
  return null;
}

export interface FireGround {
  getHeight(x: number, z: number): number;
  getSlope(x: number, z: number): number;
  blocked(x: number, z: number): boolean;
  onProp(x: number, z: number): boolean;
}

export function canLayFire(p: V3, ground: FireGround, waterY: number, fires: V3[]): boolean {
  return ground.getHeight(p.x, p.z) >= waterY + FIRE_ABOVE_WATER
    && ground.getSlope(p.x, p.z) <= MAX_FIRE_SLOPE
    && !ground.blocked(p.x, p.z)
    // A deck is never a place for a fire.
    && !ground.onProp(p.x, p.z)
    && fires.every(f => Math.hypot(f.x - p.x, f.z - p.z) >= FIRE_SPACING);
}
