export interface Ground {
  getHeight(x: number, z: number): number;
  getSlope(x: number, z: number): number;
  inBounds(x: number, z: number): boolean;
  blocked(x: number, z: number): boolean;
  // True where the ground is a deck (a pier or the ship) rather than the terrain.
  onProp(x: number, z: number): boolean;
}

export const MAX_WALK_SLOPE = 1.0;
