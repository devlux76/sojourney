export class TrunkGrid {
  private cells = new Map<string, [number, number][]>();

  constructor(private reach: number) {}

  add(x: number, z: number) {
    const key = this.key(Math.floor(x / this.reach), Math.floor(z / this.reach));
    const cell = this.cells.get(key);
    if (cell) cell.push([x, z]);
    else this.cells.set(key, [[x, z]]);
  }

  clear() {
    this.cells.clear();
  }

  remove(x: number, z: number): boolean {
    const cell = this.cells.get(this.key(Math.floor(x / this.reach), Math.floor(z / this.reach)));
    const i = cell ? cell.findIndex(([tx, tz]) => tx === x && tz === z) : -1;
    if (i < 0) return false;
    cell!.splice(i, 1);
    return true;
  }

  within(x: number, z: number, radius: number): [number, number][] {
    const r = Math.ceil(radius / this.reach);
    const cx = Math.floor(x / this.reach), cz = Math.floor(z / this.reach);
    const found: [number, number][] = [];
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++)
        for (const t of this.cells.get(this.key(cx + dx, cz + dz)) ?? [])
          if (Math.hypot(t[0] - x, t[1] - z) <= radius) found.push(t);
    return found;
  }

  blocked(x: number, z: number): boolean {
    const cx = Math.floor(x / this.reach), cz = Math.floor(z / this.reach);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        for (const [tx, tz] of this.cells.get(this.key(cx + dx, cz + dz)) ?? [])
          if (Math.hypot(tx - x, tz - z) < this.reach) return true;
    return false;
  }

  private key(cx: number, cz: number) {
    return `${cx},${cz}`;
  }
}
