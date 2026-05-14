export class SparseGrid {
  readonly W: number;
  readonly H: number;
  readonly D: number;
  readonly NF: number;
  readonly cells: Map<string, Float32Array> = new Map();
  readonly dirty: Set<string> = new Set();
  private readonly _empty: Float32Array;

  constructor(W: number, H: number, D: number, NF: number) {
    this.W = W; this.H = H; this.D = D; this.NF = NF;
    this._empty = new Float32Array(NF);
  }

  key(x: number, y: number, z: number): string { return `${x},${y},${z}`; }

  get(x: number, y: number, z: number): Float32Array {
    if (x < 0 || x >= this.W || y < 0 || y >= this.H || z < 0 || z >= this.D) return this._empty;
    return this.cells.get(this.key(x, y, z)) ?? this._empty;
  }

  set(x: number, y: number, z: number, field: number, value: number): void {
    if (x < 0 || x >= this.W || y < 0 || y >= this.H || z < 0 || z >= this.D) return;
    const k = this.key(x, y, z);
    if (!this.cells.has(k)) this.cells.set(k, new Float32Array(this.NF));
    this.cells.get(k)![field] = value;
    this.dirty.add(k);
    const cell = this.cells.get(k)!;
    if (cell.every(v => Math.abs(v) < 0.001)) this.cells.delete(k);
  }

  add(x: number, y: number, z: number, field: number, delta: number): void {
    const cur = this.get(x, y, z)[field];
    this.set(x, y, z, field, cur + delta);
  }

  diffuse(field: number, rate: number, dt: number): void {
    const newVals = new Map<string, number>();
    for (const [k, cell] of this.cells) {
      const [x, y, z] = k.split(',').map(Number);
      const dirs: Array<[number,number,number]> = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]];
      let lap = -6 * cell[field];
      for (const [dx, dy, dz] of dirs) lap += this.get(x+dx, y+dy, z+dz)[field];
      newVals.set(k, cell[field] + rate * lap * dt);
    }
    for (const [k, v] of newVals) {
      const [x, y, z] = k.split(',').map(Number);
      this.set(x, y, z, field, Math.max(0, v));
    }
  }

  size(): number { return this.cells.size; }

  toDenseSlice(z: number, field: number): Float32Array {
    const out = new Float32Array(this.W * this.H);
    for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++)
        out[y * this.W + x] = this.get(x, y, z)[field];
    return out;
  }

  seedSphere(cx: number, cy: number, cz: number, r: number, field: number, value: number): void {
    for (let dz = -r; dz <= r; dz++)
    for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (d > r) continue;
      const g = Math.exp(-d*d / (r*r) * 2);
      this.set(cx+dx, cy+dy, cz+dz, field, value * g);
    }
  }

  clear(): void { this.cells.clear(); this.dirty.clear(); }
}
