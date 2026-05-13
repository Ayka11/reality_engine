import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS } from '../core/CellState';

export interface Snapshot {
  tick: number;
  buffer: Float32Array; // copy of grid buffer
  metrics: { totalEnergy: number; avgEntropy: number; avgInfo: number; avgBio: number };
}

export class Recorder {
  private snapshots: Snapshot[] = [];
  private maxSnapshots: number;
  private _recording = false;
  private _intervalTicks: number;
  private _lastSnapTick = 0;

  constructor(maxSnapshots = 60, intervalTicks = 30) {
    this.maxSnapshots = maxSnapshots;
    this._intervalTicks = intervalTicks;
  }

  get recording() { return this._recording; }
  get count() { return this.snapshots.length; }
  get snapList(): Snapshot[] { return this.snapshots; }

  startRecording(): void { this._recording = true; }
  stopRecording(): void  { this._recording = false; }
  clearSnapshots(): void { this.snapshots = []; this._lastSnapTick = 0; }

  tick(grid: VoxelGrid, currentTick: number): void {
    if (!this._recording) return;
    if (currentTick - this._lastSnapTick < this._intervalTicks) return;
    this._lastSnapTick = currentTick;
    this._capture(grid, currentTick);
  }

  private _capture(grid: VoxelGrid, tick: number): void {
    const buf = new Float32Array(grid.buffer); // copy
    let totalEnergy = 0, sumEntropy = 0, sumInfo = 0, sumBio = 0;
    const n = grid.size;
    for (let i = 0; i < n; i++) {
      const base = i * CELL_FIELDS;
      totalEnergy += buf[base + 0];  // F.ENERGY
      sumEntropy  += buf[base + 3];  // F.ENTROPY
      sumInfo     += buf[base + 4];  // F.INFORMATION
      sumBio      += buf[base + 5];  // F.BIO_POTENTIAL
    }
    const snap: Snapshot = {
      tick,
      buffer: buf,
      metrics: {
        totalEnergy,
        avgEntropy: sumEntropy / n,
        avgInfo:    sumInfo / n,
        avgBio:     sumBio / n,
      },
    };
    this.snapshots.push(snap);
    if (this.snapshots.length > this.maxSnapshots) this.snapshots.shift();
  }

  diffAt(idxA: number, idxB: number): Float32Array | null {
    const a = this.snapshots[idxA];
    const b = this.snapshots[idxB];
    if (!a || !b || a.buffer.length !== b.buffer.length) return null;
    const diff = new Float32Array(a.buffer.length);
    for (let i = 0; i < diff.length; i++) diff[i] = b.buffer[i] - a.buffer[i];
    return diff;
  }

  exportCSV(): string {
    const header = 'tick,totalEnergy,avgEntropy,avgInfo,avgBio\n';
    const rows = this.snapshots.map(s =>
      `${s.tick},${s.metrics.totalEnergy.toFixed(2)},${s.metrics.avgEntropy.toFixed(6)},${s.metrics.avgInfo.toFixed(4)},${s.metrics.avgBio.toFixed(6)}`
    ).join('\n');
    return header + rows;
  }

  restoreSnapshot(grid: VoxelGrid, idx: number): boolean {
    const snap = this.snapshots[idx];
    if (!snap || snap.buffer.length !== grid.buffer.length) return false;
    grid.buffer.set(snap.buffer);
    return true;
  }
}
