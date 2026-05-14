import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';

const MACRO_DIV = 8;
const UPDATE_INTERVAL = 20;
const COUPLING = 0.0015;

export class MultiScaleSystem {
  private grid: VoxelGrid;
  readonly mW: number;
  readonly mH: number;
  readonly mD: number;
  readonly macroEnergy:  Float32Array;
  readonly macroEntropy: Float32Array;
  readonly macroBio:     Float32Array;
  readonly macroTemp:    Float32Array;
  private _count:        Float32Array;
  private tickCount = 0;

  constructor(grid: VoxelGrid) {
    this.grid = grid;
    const { W, H, D } = grid;
    this.mW = Math.max(1, Math.floor(W / MACRO_DIV));
    this.mH = Math.max(1, Math.floor(H / MACRO_DIV));
    this.mD = Math.max(1, Math.floor(D / MACRO_DIV));
    const sz = this.mW * this.mH * this.mD;
    this.macroEnergy  = new Float32Array(sz);
    this.macroEntropy = new Float32Array(sz);
    this.macroBio     = new Float32Array(sz);
    this.macroTemp    = new Float32Array(sz);
    this._count       = new Float32Array(sz);
  }

  tick(): void {
    if (++this.tickCount % UPDATE_INTERVAL !== 0) return;
    this._downscale();
    this._microTick();
    this._upscale();
  }

  private _mi(mx: number, my: number, mz: number): number {
    return mz * this.mH * this.mW + my * this.mW + mx;
  }

  private _downscale(): void {
    const { grid, mW, mH, mD } = this;
    const { W, H, D } = grid;
    const buf = grid.buffer;
    this.macroEnergy.fill(0);
    this.macroEntropy.fill(0);
    this.macroBio.fill(0);
    this.macroTemp.fill(0);
    this._count.fill(0);

    for (let gz = 0; gz < D; gz++)
    for (let gy = 0; gy < H; gy++)
    for (let gx = 0; gx < W; gx++) {
      const mx = Math.min(Math.floor(gx / MACRO_DIV), mW - 1);
      const my = Math.min(Math.floor(gy / MACRO_DIV), mH - 1);
      const mz = Math.min(Math.floor(gz / MACRO_DIV), mD - 1);
      const mi = this._mi(mx, my, mz);
      const gi = (gz * H * W + gy * W + gx) * CELL_FIELDS;
      this.macroEnergy[mi]  += buf[gi + F.ENERGY];
      this.macroEntropy[mi] += buf[gi + F.ENTROPY];
      this.macroBio[mi]     += buf[gi + F.BIO_POTENTIAL];
      this.macroTemp[mi]    += buf[gi + F.TEMPERATURE];
      this._count[mi]++;
    }
    for (let i = 0; i < this._count.length; i++) {
      if (this._count[i] === 0) continue;
      this.macroEnergy[i]  /= this._count[i];
      this.macroEntropy[i] /= this._count[i];
      this.macroBio[i]     /= this._count[i];
      this.macroTemp[i]    /= this._count[i];
    }
  }

  // Micro-level: per-cell simple organic chemistry in high-bio cells
  private _microTick(): void {
    const { grid } = this;
    const { W, H, D } = grid;
    const buf = grid.buffer;
    const n = W * H * D;
    for (let i = 0; i < n; i++) {
      const o = i * CELL_FIELDS;
      const bio = buf[o + F.BIO_POTENTIAL];
      if (bio < 0.3) continue;
      const e = buf[o + F.ENERGY];
      // Organic catalysis: bio + energy → more information
      if (e > 50) {
        buf[o + F.INFORMATION] = Math.min(buf[o + F.INFORMATION] + bio * 0.05, 500);
        buf[o + F.ENERGY]      = Math.max(0, e - bio * 0.1);
      }
    }
  }

  // Bidirectional coupling: push macro averages back as gentle field nudges
  private _upscale(): void {
    const { grid, mW, mH, mD } = this;
    const { W, H, D } = grid;
    const buf = grid.buffer;

    for (let gz = 0; gz < D; gz++)
    for (let gy = 0; gy < H; gy++)
    for (let gx = 0; gx < W; gx++) {
      const mx = Math.min(Math.floor(gx / MACRO_DIV), mW - 1);
      const my = Math.min(Math.floor(gy / MACRO_DIV), mH - 1);
      const mz = Math.min(Math.floor(gz / MACRO_DIV), mD - 1);
      const mi = this._mi(mx, my, mz);
      const gi = (gz * H * W + gy * W + gx) * CELL_FIELDS;
      buf[gi + F.ENERGY] += (this.macroEnergy[mi] - buf[gi + F.ENERGY]) * COUPLING;
    }
  }

  getMacroStats(): { energy: number; entropy: number; bio: number; temp: number } {
    let e = 0, s = 0, b = 0, t = 0;
    const n = this.macroEnergy.length || 1;
    for (let i = 0; i < n; i++) { e += this.macroEnergy[i]; s += this.macroEntropy[i]; b += this.macroBio[i]; t += this.macroTemp[i]; }
    return { energy: e / n, entropy: s / n, bio: b / n, temp: t / n };
  }
}
