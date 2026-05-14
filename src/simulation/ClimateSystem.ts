import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';

export class ClimateSystem {
  private grid: VoxelGrid;
  windX: Float32Array;
  windY: Float32Array;
  pressure: Float32Array;
  globalTemp = 0;
  private tickCount = 0;

  constructor(grid: VoxelGrid) {
    this.grid = grid;
    const { W, H } = grid;
    this.windX    = new Float32Array(W * H);
    this.windY    = new Float32Array(W * H);
    this.pressure = new Float32Array(W * H);
    this._initWind();
  }

  private _initWind(): void {
    const { W, H } = this.grid;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const lat = (y / H - 0.5) * Math.PI;
      this.windX[i] = Math.cos(lat * 3) * 0.5;
      this.windY[i] = Math.sin(lat * 1.5) * 0.3;
    }
  }

  tick(dt: number): void {
    const { grid } = this;
    const { W, H, D } = grid;
    this.tickCount++;
    let totalT = 0;
    const surf = D - 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const base = (surf * H * W + y * W + x) * CELL_FIELDS;
      const localT = grid.buffer[base + F.TEMPERATURE];
      const localD = grid.buffer[base + F.DENSITY];
      this.pressure[i] = localD * 100 - localT * 0.05;
      totalT += localT;
    }
    this.globalTemp = totalT / (W * H);
    if (this.tickCount % 5 === 0) this._advectEnergy(dt * 5);
    if (this.tickCount % 8 === 0) this._precipitation();
    this._updateWind(dt);
  }

  private _advectEnergy(dt: number): void {
    const { grid } = this;
    const { W, H, D } = grid;
    const z = Math.max(0, D - 2);
    for (let y = 1; y < H-1; y++) for (let x = 1; x < W-1; x++) {
      const i = y * W + x;
      const wx = this.windX[i], wy = this.windY[i];
      const base = (z * H * W + y * W + x) * CELL_FIELDS;
      const sx = Math.max(0, Math.min(W-1, Math.round(x - wx * dt)));
      const sy = Math.max(0, Math.min(H-1, Math.round(y - wy * dt)));
      const src = (z * H * W + sy * W + sx) * CELL_FIELDS;
      grid.buffer[base + F.TEMPERATURE] = grid.buffer[base + F.TEMPERATURE] * 0.8 + grid.buffer[src + F.TEMPERATURE] * 0.2;
      grid.buffer[base + F.ENERGY]      = grid.buffer[base + F.ENERGY]      * 0.9 + grid.buffer[src + F.ENERGY]      * 0.1;
    }
  }

  private _precipitation(): void {
    const { grid } = this;
    const { W, H, D } = grid;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const surfBase = ((D-1) * H * W + y * W + x) * CELL_FIELDS;
      const d = grid.buffer[surfBase + F.DENSITY];
      const t = grid.buffer[surfBase + F.TEMPERATURE];
      if (d > 0.6 && t < 100) {
        const rain = (d - 0.6) * 0.1;
        grid.buffer[surfBase + F.DENSITY] -= rain;
        for (let z = D-2; z >= 0; z--) {
          const base = (z * H * W + y * W + x) * CELL_FIELDS;
          if (grid.buffer[base + F.DENSITY] < 0.7) {
            grid.buffer[base + F.DENSITY] = Math.min(1, grid.buffer[base + F.DENSITY] + rain * 0.5);
            grid.buffer[base + F.ENERGY]  = Math.min(9999, grid.buffer[base + F.ENERGY] + 20);
            break;
          }
        }
      }
    }
  }

  private _updateWind(dt: number): void {
    const { W, H } = this.grid;
    for (let y = 1; y < H-1; y++) for (let x = 1; x < W-1; x++) {
      const i = y * W + x;
      const dpx = (this.pressure[y*W + Math.min(W-1, x+1)] - this.pressure[y*W + Math.max(0, x-1)]) * 0.5;
      const dpy = (this.pressure[Math.min(H-1, y+1)*W + x] - this.pressure[Math.max(0, y-1)*W + x]) * 0.5;
      this.windX[i] += (-dpx * 0.01 - this.windX[i] * 0.05) * dt;
      this.windY[i] += (-dpy * 0.01 - this.windY[i] * 0.05) * dt;
      const spd = Math.sqrt(this.windX[i]**2 + this.windY[i]**2);
      if (spd > 2) { this.windX[i] *= 2/spd; this.windY[i] *= 2/spd; }
    }
  }

  getWindAt(x: number, y: number): { vx: number; vy: number } {
    const i = y * this.grid.W + x;
    return { vx: this.windX[i], vy: this.windY[i] };
  }
}
