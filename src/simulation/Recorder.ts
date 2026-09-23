import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS } from '../core/CellState';
import type { InfinityScaleChunkExecutionContext } from '../infinity/InfinityScaleChunkExecutionContext';

export interface SelectiveObservationSnapshot {
  tick: number;
  cellCount: number;
  cells: Array<[number, number[]]>;
  metrics: { totalEnergy: number; avgEntropy: number; avgInfo: number; avgBio: number };
}

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
  private _nextSnapTick = 0;
  private selectiveSnapshots: SelectiveObservationSnapshot[] = [];

  constructor(maxSnapshots = 60, intervalTicks = 30) {
    this.maxSnapshots = maxSnapshots;
    this._intervalTicks = intervalTicks;
  }

  get recording() { return this._recording; }
  get count() { return this.snapshots.length; }
  get snapList(): Snapshot[] { return this.snapshots; }
  get selectiveSnapList(): SelectiveObservationSnapshot[] { return this.selectiveSnapshots; }

  startRecording(): void {
    this._recording = true;
    if (this._nextSnapTick <= this._lastSnapTick) {
      this._nextSnapTick = this._lastSnapTick + Math.max(1, this._intervalTicks);
    }
  }
  stopRecording(): void  { this._recording = false; }
  clearSnapshots(): void {
    this.snapshots = [];
    this.selectiveSnapshots = [];
    this._lastSnapTick = 0;
    this._nextSnapTick = Math.max(1, this._intervalTicks);
  }

  tick(grid: VoxelGrid, currentTick: number): void {
    if (!this._recording) return;

    const interval = Math.max(1, this._intervalTicks);
    if (this._nextSnapTick <= 0) this._nextSnapTick = interval;
    if (currentTick < this._nextSnapTick) return;

    // The recorder is invoked at frame boundaries, so a batched step may
    // cross one or more nominal snapshot ticks. We cannot reconstruct an
    // intermediate state that was never captured; capture the first observed
    // post-boundary state, then keep the schedule anchored to simulation time
    // instead of drifting by interval from the capture frame.
    this._lastSnapTick = currentTick;
    this._capture(grid, currentTick);

    do {
      this._nextSnapTick += interval;
    } while (this._nextSnapTick <= currentTick);
  }

  tickSelective(
    grid: VoxelGrid,
    currentTick: number,
    context: InfinityScaleChunkExecutionContext,
  ): void {
    if (!this._recording) return;

    const interval = Math.max(1, this._intervalTicks);
    if (this._nextSnapTick <= 0) this._nextSnapTick = interval;
    if (currentTick < this._nextSnapTick) return;

    const cells: Array<[number, number[]]> = [];
    let totalEnergy = 0, sumEntropy = 0, sumInfo = 0, sumBio = 0;
    let count = 0;

    for (const range of context.simulationRanges) {
      for (let z = range.minZ; z <= range.maxZ; z++)
      for (let y = range.minY; y <= range.maxY; y++)
      for (let x = range.minX; x <= range.maxX; x++) {
        const cell = grid.cell(x, y, z);
        const index = z * grid.H * grid.W + y * grid.W + x;
        const base = index * CELL_FIELDS;
        const values = Array.from(grid.buffer.subarray(base, base + CELL_FIELDS));
        cells.push([index, values]);

        totalEnergy += values[0];
        sumEntropy += values[3];
        sumInfo += values[4];
        sumBio += values[5];
        count++;
      }
    }

    this.selectiveSnapshots.push({
      tick: currentTick,
      cellCount: count,
      cells,
      metrics: {
        totalEnergy,
        avgEntropy: count ? sumEntropy / count : 0,
        avgInfo: count ? sumInfo / count : 0,
        avgBio: count ? sumBio / count : 0,
      },
    });
    if (this.selectiveSnapshots.length > this.maxSnapshots) {
      this.selectiveSnapshots.shift();
    }

    this._lastSnapTick = currentTick;
    do {
      this._nextSnapTick += interval;
    } while (this._nextSnapTick <= currentTick);
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

  exportRecording(): string {
    if (!this.snapshots.length) return JSON.stringify({ error: 'No snapshots recorded' });
    const sparse = (buf: Float32Array) => {
      const cells: Array<[number, number[]]> = [];
      const count = buf.length / CELL_FIELDS;
      for (let i = 0; i < count; i++) {
        const o = i * CELL_FIELDS;
        if (buf[o] < 1) continue; // skip near-zero energy cells
        cells.push([i, Array.from(buf.subarray(o, o + CELL_FIELDS)).map(v => parseFloat(v.toFixed(3)))]);
      }
      return cells;
    };
    return JSON.stringify({
      version: 3,
      exported: new Date().toISOString(),
      snapshots: this.snapshots.map(s => ({
        tick:    s.tick,
        metrics: s.metrics,
        cells:   sparse(s.buffer),
      })),
      selectiveSnapshots: this.selectiveSnapshots,
    });
  }
}
