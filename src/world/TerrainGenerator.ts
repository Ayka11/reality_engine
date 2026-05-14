import { VoxelGrid } from '../core/VoxelGrid';
import { F } from '../core/CellState';

export const BIOME_LIST = [
  'earth', 'alien', 'ocean', 'volcanic', 'arctic', 'desert', 'forest', 'crystalline'
] as const;
export type BiomeName = typeof BIOME_LIST[number];

export class TerrainGenerator {
  private grid: VoxelGrid;

  constructor(grid: VoxelGrid) {
    this.grid = grid;
  }

  private _noise2(x: number, y: number, seed = 0): number {
    const grads = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
    const dot = (g: number[], gx: number, gy: number) => g[0]*gx + g[1]*gy;
    const p: number[] = [];
    for (let i = 0; i < 256; i++) p.push(i);
    let s = seed + 1;
    for (let i = 255; i > 0; i--) {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      const j = ((s >>> 0) % (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    const perm = [...p, ...p];
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = xf*xf*xf*(xf*(xf*6-15)+10);
    const v = yf*yf*yf*(yf*(yf*6-15)+10);
    const aa = perm[perm[X]+Y], ab = perm[perm[X]+Y+1];
    const ba = perm[perm[X+1]+Y], bb = perm[perm[X+1]+Y+1];
    return (
      u*(v*(dot(grads[bb%8], xf-1, yf-1) - dot(grads[ab%8], xf, yf-1))
        +  (dot(grads[ba%8], xf-1, yf  ) - dot(grads[aa%8], xf, yf  )))
     +(1-u)*(v*(dot(grads[ab%8], xf, yf-1) - dot(grads[aa%8], xf, yf))
            +  (dot(grads[ba%8], xf-1, yf ) - dot(grads[aa%8], xf, yf)))
    ) * 0.5 + 0.5;
  }

  private _fbm(x: number, y: number, octaves = 5, seed = 0): number {
    let val = 0, amp = 0.5, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      val += this._noise2(x * freq, y * freq, seed + i * 37) * amp;
      max += amp; amp *= 0.5; freq *= 2.1;
    }
    return val / max;
  }

  generate(biome: BiomeName = 'earth', seed = Math.floor(Math.random() * 9999)): string {
    const { grid } = this;
    grid.buffer.fill(0);
    grid.backBuffer.fill(0);
    const biomes: Record<BiomeName, (s: number) => void> = {
      earth:       s => this._earthBiome(s),
      alien:       s => this._alienBiome(s),
      ocean:       s => this._oceanBiome(s),
      volcanic:    s => this._volcanicBiome(s),
      arctic:      s => this._arcticBiome(s),
      desert:      s => this._desertBiome(s),
      forest:      s => this._forestBiome(s),
      crystalline: s => this._crystallineBiome(s),
    };
    (biomes[biome] ?? biomes.earth)(seed);
    return `Terrain "${biome}" generated (seed ${seed})`;
  }

  private _set(x: number, y: number, z: number, field: number, value: number): void {
    const { grid } = this;
    if (!grid.inBounds(x, y, z)) return;
    grid.buffer[grid.idx(x, y, z) + field] = value;
  }

  private _add(x: number, y: number, z: number, field: number, value: number): void {
    const { grid } = this;
    if (!grid.inBounds(x, y, z)) return;
    const i = grid.idx(x, y, z) + field;
    grid.buffer[i] = Math.min(grid.buffer[i] + value, 9999);
  }

  private _earthBiome(seed: number): void {
    const { grid } = this;
    const { W, H, D } = grid;
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const h = this._fbm(x/W*3, y/H*3, 6, seed);
      const heightCells = Math.round(h * D * 0.6) + 1;
      const m = this._fbm(x/W*2.5+100, y/H*2.5+100, 4, seed+1);
      const lat = Math.abs(y/H - 0.5) * 2;
      const tempBase = clamp(1 - lat*0.8 + this._fbm(x/W*4, y/H*4, 3, seed+2)*0.3, 0, 1);

      for (let z = 0; z <= heightCells && z < D; z++) {
        const depth = (heightCells - z) / heightCells;
        if (z < heightCells * 0.3) {
          this._set(x, y, z, F.DENSITY,     0.9);
          this._set(x, y, z, F.ENERGY,      10);
          this._set(x, y, z, F.TEMPERATURE, 20 + depth*40);
          continue;
        }
        this._set(x, y, z, F.DENSITY, clamp(0.6 + depth*0.3, 0.1, 1));
        if (tempBase > 0.7 && m > 0.5) {
          this._set(x, y, z, F.ENERGY,       120 + m*200);
          this._set(x, y, z, F.TEMPERATURE,  200 + tempBase*150);
          this._set(x, y, z, F.INFORMATION,  m*180);
          this._set(x, y, z, F.BIO_POTENTIAL, m*0.7);
        } else if (tempBase > 0.5 && m > 0.4) {
          this._set(x, y, z, F.ENERGY,       80 + m*120);
          this._set(x, y, z, F.TEMPERATURE,  100 + tempBase*100);
          this._set(x, y, z, F.INFORMATION,  m*80);
          this._set(x, y, z, F.BIO_POTENTIAL, m*0.4);
        } else if (tempBase < 0.25) {
          this._set(x, y, z, F.ENERGY,      20);
          this._set(x, y, z, F.TEMPERATURE, 5 + tempBase*40);
          this._set(x, y, z, F.ENTROPY,     0.05);
          this._set(x, y, z, F.DENSITY,     0.8);
        } else if (m < 0.25) {
          this._set(x, y, z, F.ENERGY,      200 + tempBase*200);
          this._set(x, y, z, F.TEMPERATURE, 300 + tempBase*200);
          this._set(x, y, z, F.INFORMATION, 5);
          this._set(x, y, z, F.ENTROPY,     0.15);
        } else {
          this._set(x, y, z, F.ENERGY,      50);
          this._set(x, y, z, F.TEMPERATURE, 60 + tempBase*80);
        }
      }
      // Water bodies
      if (h < 0.35) {
        const waterTop = Math.round(0.35 * D * 0.6) + 1;
        for (let z = heightCells; z < waterTop && z < D; z++) {
          this._set(x, y, z, F.ENERGY,      30 + m*60);
          this._set(x, y, z, F.DENSITY,     0.6 + m*0.2);
          this._set(x, y, z, F.TEMPERATURE, 60 + tempBase*80);
          this._set(x, y, z, F.INFORMATION, m*40);
        }
      }
    }
  }

  private _alienBiome(seed: number): void {
    const { grid } = this;
    const { W, H, D } = grid;
    for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const n1 = this._fbm(x/W*4, y/H*4, 5, seed);
      const n2 = this._fbm(x/W*3+50, z/D*3, 4, seed+7);
      if (n1 > 0.55) {
        this._set(x, y, z, F.ENERGY,       n1*800);
        this._set(x, y, z, F.TEMPERATURE,  n2*400);
        this._set(x, y, z, F.INFORMATION,  n1*n2*300);
        this._set(x, y, z, F.DENSITY,      n1*0.9);
        this._set(x, y, z, F.ENTROPY,      0.02);
      }
      if (n2 > 0.7) {
        this._add(x, y, z, F.ENERGY,      500);
        this._add(x, y, z, F.TEMPERATURE, 200);
      }
    }
  }

  private _volcanicBiome(seed: number): void {
    const { grid } = this;
    const { W, H, D } = grid;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const bh = Math.round(this._fbm(x/W*3, y/H*3, 5, seed) * D * 0.4) + 1;
      for (let z = 0; z <= bh && z < D; z++) {
        this._set(x, y, z, F.DENSITY,     0.85);
        this._set(x, y, z, F.TEMPERATURE, 80 + z*15);
        this._set(x, y, z, F.ENERGY,      30);
      }
    }
    for (let v = 0; v < 4; v++) {
      const vx = 8 + Math.floor(Math.random() * (W-16));
      const vy = 8 + Math.floor(Math.random() * (H-16));
      for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const dx = x-vx, dy = y-vy, d = Math.sqrt(dx*dx+dy*dy);
        if (d < 6) {
          const e = Math.exp(-d*d/12) * 900;
          this._add(x, y, z, F.ENERGY,      e);
          this._add(x, y, z, F.TEMPERATURE, e*0.8);
          this._set(x, y, z, F.ENTROPY,     0.35);
        }
      }
    }
  }

  private _oceanBiome(seed: number): void {
    const { grid } = this;
    const { W, H, D } = grid;
    for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const depth = (D-1-z) / (D-1);
      this._set(x, y, z, F.DENSITY,     0.5 + depth*0.4);
      this._set(x, y, z, F.ENERGY,      20 + depth*60);
      this._set(x, y, z, F.TEMPERATURE, 80 - depth*60);
      this._set(x, y, z, F.INFORMATION, this._fbm(x/W*5, y/H*5, 4, seed)*60);
      if (z < 2) { this._add(x, y, z, F.ENERGY, 100); this._set(x, y, z, F.BIO_POTENTIAL, 0.3); }
    }
  }

  private _arcticBiome(seed: number): void {
    const { grid } = this;
    const { W, H, D } = grid;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const h = Math.round(this._fbm(x/W*3, y/H*3, 5, seed) * D * 0.5) + 1;
      for (let z = 0; z <= h && z < D; z++) {
        this._set(x, y, z, F.DENSITY,     0.8);
        this._set(x, y, z, F.TEMPERATURE, Math.max(0, 10-z*3));
        this._set(x, y, z, F.ENTROPY,     0.04);
        this._set(x, y, z, F.ENERGY,      15);
      }
    }
  }

  private _desertBiome(seed: number): void {
    const { grid } = this;
    const { W, H, D } = grid;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const h = Math.round(this._fbm(x/W*4, y/H*4, 6, seed) * D * 0.35) + 1;
      for (let z = 0; z <= h && z < D; z++) {
        const surf = z === h;
        this._set(x, y, z, F.DENSITY,     surf ? 0.4 : 0.75);
        this._set(x, y, z, F.ENERGY,      surf ? 400 + this._fbm(x/W*8, y/H*8, 3, seed)*200 : 80);
        this._set(x, y, z, F.TEMPERATURE, surf ? 350 : 120);
        this._set(x, y, z, F.ENTROPY,     0.12);
      }
    }
  }

  private _forestBiome(seed: number): void {
    const { grid } = this;
    const { W, H, D } = grid;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const h = Math.round(this._fbm(x/W*3, y/H*3, 5, seed) * D * 0.4) + 2;
      for (let z = 0; z <= h && z < D; z++) {
        this._set(x, y, z, F.DENSITY,     z < h*0.3 ? 0.8 : 0.5);
        this._set(x, y, z, F.ENERGY,      100 + this._fbm(x/W*6, y/H*6, 3, seed)*150);
        this._set(x, y, z, F.TEMPERATURE, 80);
        this._set(x, y, z, F.INFORMATION, 80);
        this._set(x, y, z, F.BIO_POTENTIAL, 0.5);
      }
      for (let z = h; z <= Math.min(h+2, D-1); z++) {
        this._set(x, y, z, F.ENERGY,       200);
        this._set(x, y, z, F.INFORMATION,  200);
        this._set(x, y, z, F.BIO_POTENTIAL, 0.8);
        this._set(x, y, z, F.DENSITY,      0.3);
      }
    }
  }

  private _crystallineBiome(seed: number): void {
    const { grid } = this;
    const { W, H, D } = grid;
    for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const n = this._fbm(x/W*6, y/H*6, 3, seed) + this._fbm(z/D*6, x/W*4, 3, seed+13);
      if (n > 0.9) {
        this._set(x, y, z, F.ENERGY,      n*700);
        this._set(x, y, z, F.INFORMATION, n*400);
        this._set(x, y, z, F.ENTROPY,     0.01);
        this._set(x, y, z, F.DENSITY,     0.7);
      }
    }
  }
}
