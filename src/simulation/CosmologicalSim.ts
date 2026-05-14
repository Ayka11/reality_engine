import { SparseGrid } from '../core/SparseGrid';

// Field indices within the sparse cosmological grid
const FE = 0;  // energy
const FD = 1;  // density
const FS = 3;  // entropy
const FT = 4;  // temperature
const FDE = 5; // dark energy
const NF = 6;

interface Galaxy {
  x: number; y: number; z: number;
  age: number;
  stars: number;
}

export class CosmologicalSim {
  readonly W = 256;
  readonly H = 256;
  readonly D = 64;
  readonly grid: SparseGrid;
  tick = 0;
  readonly galaxies: Galaxy[] = [];

  constructor() {
    this.grid = new SparseGrid(this.W, this.H, this.D, NF);
  }

  bigBang(): void {
    this.grid.clear();
    this.galaxies.length = 0;
    const cx = 128, cy = 128, cz = 32;
    this.grid.seedSphere(cx, cy, cz, 3, FE, 9999);
    this.grid.seedSphere(cx, cy, cz, 2, FT, 5000);
    for (let i = 0; i < 500; i++) {
      const x = Math.floor(Math.random() * this.W);
      const y = Math.floor(Math.random() * this.H);
      const z = Math.floor(Math.random() * this.D);
      this.grid.set(x, y, z, FDE, 0.1 + Math.random() * 0.3);
    }
  }

  seedGalaxies(n = 8): void {
    for (let i = 0; i < n; i++) {
      const x = 20 + Math.floor(Math.random() * 216);
      const y = 20 + Math.floor(Math.random() * 216);
      const z = 16 + Math.floor(Math.random() * 32);
      this.grid.seedSphere(x, y, z, 12, FE, 800 + Math.random() * 200);
      this.grid.seedSphere(x, y, z, 8,  FD, 0.7);
      this.grid.seedSphere(x, y, z, 6,  FT, 400);
      this.galaxies.push({ x, y, z, age: 0, stars: Math.floor(Math.random() * 1000) });
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
