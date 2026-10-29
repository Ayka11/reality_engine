import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS } from '../core/CellState';

export interface Snapshot {
  tick: number;
  buffer: Float32Array; // copy of grid buffer
  metrics: { totalEnergy: number; avgEntropy: number; avgInfo: number; avgBio: number };
}

export interface RecorderStateSnapshot {
  recording: boolean;
  maxSnapshots: number;
  intervalTicks: number;
  lastSnapTick: number;
  snapshots: Snapshot[];
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

  snapshotState(): RecorderStateSnapshot {
    return {
      recording: this._recording,
      maxSnapshots: this.maxSnapshots,
      intervalTicks: this._intervalTicks,
      lastSnapTick: this._lastSnapTick,
      snapshots: this.snapshots.map(snapshot => ({
        tick: snapshot.tick,
        buffer: new Float32Array(snapshot.buffer),
        metrics: { ...snapshot.metrics },
      })),
    };
  }

  restoreState(snapshot: RecorderStateSnapshot, expectedBufferLength?: number): void {
    if (!snapshot ||
        typeof snapshot !== "object" ||
        typeof snapshot.recording !== "boolean" ||
        !Number.isSafeInteger(snapshot.maxSnapshots) || snapshot.maxSnapshots < 1 ||
        !Number.isSafeInteger(snapshot.intervalTicks) || snapshot.intervalTicks < 1 ||
        !Number.isSafeInteger(snapshot.lastSnapTick) || snapshot.lastSnapTick < 0 ||
        !Array.isArray(snapshot.snapshots) ||
        snapshot.snapshots.length > snapshot.maxSnapshots) {
      throw new Error("Invalid Recorder state snapshot");
    }
    if (expectedBufferLength !== undefined &&
        (!Number.isSafeInteger(expectedBufferLength) ||
         expectedBufferLength < 0 ||
         expectedBufferLength % CELL_FIELDS !== 0)) {
      throw new Error("Invalid expected Recorder buffer length");
    }

    // Validate and deep-copy the complete history before mutating any live field.
    const restored: Snapshot[] = [];
    let previousTick = -1;
    let bufferLength = expectedBufferLength;
    for (const entry of snapshot.snapshots as unknown[]) {
      if (!entry || typeof entry !== "object") {
        throw new Error("Invalid Recorder history entry");
      }
      const item = entry as Partial<Snapshot>;
      if (!Number.isSafeInteger(item.tick) ||
          (item.tick as number) < 0 ||
          (item.tick as number) <= previousTick ||
          !(item.buffer instanceof Float32Array) ||
          item.buffer.length % CELL_FIELDS !== 0 ||
          (bufferLength !== undefined && item.buffer.length !== bufferLength) ||
          !item.buffer.every(Number.isFinite) ||
          !item.metrics ||
          ![
            item.metrics.totalEnergy,
            item.metrics.avgEntropy,
            item.metrics.avgInfo,
            item.metrics.avgBio,
          ].every(Number.isFinite)) {
        throw new Error("Invalid Recorder history entry");
      }

      previousTick = item.tick as number;
      bufferLength ??= item.buffer.length;
      restored.push({
        tick: item.tick as number,
        buffer: new Float32Array(item.buffer),
        metrics: { ...item.metrics },
      });
    }

    if (restored.length > 0 && snapshot.lastSnapTick < restored[restored.length - 1].tick) {
      throw new Error("Recorder last-snapshot tick precedes its history");
    }

    this._recording = snapshot.recording;
    this.maxSnapshots = snapshot.maxSnapshots;
    this._intervalTicks = snapshot.intervalTicks;
    this._lastSnapTick = snapshot.lastSnapTick;
    this.snapshots = restored;
  }

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
    });
  }
}
