import { SparseGrid } from '../core/SparseGrid';

// Field indices within the sparse cosmological grid
const FE = 0;  // energy
const FD = 1;  // density
const FS = 3;  // entropy
const FT = 4;  // temperature
const FDE = 5; // dark energy
const NF = 6;

export interface Galaxy {
  x: number; y: number; z: number;
  age: number;
  stars: number;
}

export interface CosmologicalSimSnapshot {
  tick: number;
  galaxies: Galaxy[];
  cells: Array<[string, number[]]>;
  dirtyKeys: string[];
  rngState: number;
}

export class CosmologicalSim {
  readonly W = 256;
  readonly H = 256;
  readonly D = 64;
  readonly grid: SparseGrid;
  tick = 0;
  readonly galaxies: Galaxy[] = [];
  private _rngState: number;

  constructor(seed = 0x3c6ef372) {
    this.grid = new SparseGrid(this.W, this.H, this.D, NF);
    this._rngState = Number.isSafeInteger(seed) ? (seed >>> 0) || 0x3c6ef372 : 0x3c6ef372;
  }

  private _random(): number {
    let x = this._rngState >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this._rngState = x >>> 0;
    return this._rngState / 0x100000000;
  }

  snapshot(): CosmologicalSimSnapshot {
    return {
      tick: this.tick,
      galaxies: this.galaxies.map(galaxy => ({ ...galaxy })),
      cells: [...this.grid.cells.entries()].map(([key, cell]) => [key, Array.from(cell)]),
      dirtyKeys: [...this.grid.dirty],
      rngState: this._rngState,
    };
  }

  restore(snapshot: CosmologicalSimSnapshot): void {
    if (!snapshot || !Number.isSafeInteger(snapshot.tick) || snapshot.tick < 0 ||
        !Array.isArray(snapshot.galaxies) || !Array.isArray(snapshot.cells) ||
        !Array.isArray(snapshot.dirtyKeys) || !Number.isSafeInteger(snapshot.rngState) ||
        snapshot.rngState <= 0 || snapshot.rngState > 0xffffffff) {
      throw new Error("Invalid CosmologicalSim snapshot");
    }
    const galaxies = snapshot.galaxies.map(galaxy => {
      if (!galaxy || ![galaxy.x, galaxy.y, galaxy.z, galaxy.age, galaxy.stars].every(Number.isFinite) ||
          galaxy.x < 0 || galaxy.x >= this.W || galaxy.y < 0 || galaxy.y >= this.H ||
          galaxy.z < 0 || galaxy.z >= this.D || galaxy.age < 0 || galaxy.stars < 0) {
        throw new Error("Invalid CosmologicalSim galaxy snapshot");
      }
      return { ...galaxy };
    });
    const cells = new Map<string, Float32Array>();
    for (const entry of snapshot.cells) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || cells.has(entry[0]) ||
          !Array.isArray(entry[1]) || entry[1].length !== NF || !entry[1].every(Number.isFinite)) {
        throw new Error("Invalid CosmologicalSim grid cell snapshot");
      }
      const parts = entry[0].split(",").map(Number);
      if (parts.length !== 3 || !parts.every(Number.isInteger) || parts[0] < 0 || parts[0] >= this.W ||
          parts[1] < 0 || parts[1] >= this.H || parts[2] < 0 || parts[2] >= this.D) {
        throw new Error("Invalid CosmologicalSim grid key");
      }
      cells.set(entry[0], new Float32Array(entry[1]));
    }
    for (const key of snapshot.dirtyKeys) {
      if (typeof key !== "string") throw new Error("Invalid CosmologicalSim dirty key");
      const parts = key.split(",").map(Number);
      if (parts.length !== 3 || !parts.every(Number.isInteger) || parts[0] < 0 || parts[0] >= this.W ||
          parts[1] < 0 || parts[1] >= this.H || parts[2] < 0 || parts[2] >= this.D) {
        throw new Error("Invalid CosmologicalSim dirty key");
      }
    }
    this.grid.cells.clear();
    for (const [key, cell] of cells) this.grid.cells.set(key, cell);
    this.grid.dirty.clear();
    for (const key of snapshot.dirtyKeys) this.grid.dirty.add(key);
    this.galaxies.splice(0, this.galaxies.length, ...galaxies);
    this.tick = snapshot.tick;
    this._rngState = snapshot.rngState >>> 0;
  }

  bigBang(): void {
    this.grid.clear();
    this.galaxies.length = 0;
    const cx = 128, cy = 128, cz = 32;
    this.grid.seedSphere(cx, cy, cz, 3, FE, 9999);
    this.grid.seedSphere(cx, cy, cz, 2, FT, 5000);
    for (let i = 0; i < 500; i++) {
      const x = Math.floor(this._random() * this.W);
      const y = Math.floor(this._random() * this.H);
      const z = Math.floor(this._random() * this.D);
      this.grid.set(x, y, z, FDE, 0.1 + this._random() * 0.3);
    }
  }

  seedGalaxies(n = 8): void {
    for (let i = 0; i < n; i++) {
      const x = 20 + Math.floor(this._random() * 216);
      const y = 20 + Math.floor(this._random() * 216);
      const z = 16 + Math.floor(this._random() * 32);
      this.grid.seedSphere(x, y, z, 12, FE, 800 + this._random() * 200);
      this.grid.seedSphere(x, y, z, 8,  FD, 0.7);
      this.grid.seedSphere(x, y, z, 6,  FT, 400);
      this.galaxies.push({ x, y, z, age: 0, stars: Math.floor(this._random() * 1000) });
    }
  }

  step(dt: number): void {
    // Energy diffusion (cosmic expansion)
    this.grid.diffuse(FE, 0.04, dt);
    // Dark energy accelerates expansion
    for (const [, cell] of this.grid.cells) {
      const de = cell[FDE];
      if (de > 0.05) cell[FE] *= (1 + de * 0.0001 * dt * 60);
    }
    // Entropy always increases
    for (const [, cell] of this.grid.cells) {
      cell[FS] = Math.min(1, cell[FS] + 0.0001 * dt * 60);
    }
    // Galaxy aging
    for (const g of this.galaxies) {
      g.age += dt * 60;
      g.stars = Math.max(0, g.stars - g.age * 0.00001);
    }
    this.tick++;
  }

  getStats(): { tick: number; filledCells: number; totalEnergy: number; galaxies: number } {
    let totE = 0;
    for (const [, cell] of this.grid.cells) totE += cell[FE];
    return {
      tick: this.tick,
      filledCells: this.grid.size(),
      totalEnergy: Math.round(totE),
      galaxies: this.galaxies.length,
    };
  }
}
