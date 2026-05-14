import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';

export interface TimelineMetric {
  tick: number;
  energy: number;
  entropy: number;
  info: number;
  agents: number;
  bio: number;
}

export interface TimelineSnapshot {
  label: string;
  tick: number;
  agentCount: number;
  totalEnergy: number;
  avgEntropy: number;
  cells: Array<{ i: number; d: Float32Array }>;
  ts: number;
}

export class Timeline {
  private grid: VoxelGrid;
  snapshots: TimelineSnapshot[] = [];
  readonly maxSnapshots = 50;
  readonly autoSaveInterval = 100;
  metrics: TimelineMetric[] = [];
  readonly maxMetrics = 1000;
  private agentCountFn: () => number;

  constructor(grid: VoxelGrid, agentCountFn: () => number = () => 0) {
    this.grid = grid;
    this.agentCountFn = agentCountFn;
  }

  autoSave(tick: number): void {
    if (tick % this.autoSaveInterval === 0) this.saveSnapshot(`Auto t${tick}`);
    this._recordMetric(tick);
  }

  saveSnapshot(label: string): TimelineSnapshot {
    const { grid } = this;
    const { W, H, D, buffer } = grid;
    const SZ = W * H * D;
    const cells: TimelineSnapshot['cells'] = [];
    for (let i = 0; i < SZ; i++) {
      const base = i * CELL_FIELDS;
      let any = false;
      for (let f = 0; f < CELL_FIELDS; f++) if (Math.abs(buffer[base+f]) > 0.01) { any = true; break; }
      if (any) cells.push({ i, d: new Float32Array(buffer.subarray(base, base + CELL_FIELDS)) });
    }
    const snap: TimelineSnapshot = {
      label,
      tick: 0,
      agentCount: this.agentCountFn(),
      totalEnergy: this._totalField(F.ENERGY),
      avgEntropy:  this._avgField(F.ENTROPY),
      cells,
      ts: Date.now(),
    };
    this.snapshots.push(snap);
    if (this.snapshots.length > this.maxSnapshots) this.snapshots.shift();
    return snap;
  }

  restore(index: number): boolean {
    const snap = this.snapshots[index];
    if (!snap) return false;
    const { grid } = this;
    grid.buffer.fill(0);
    for (const { i, d } of snap.cells) {
      const base = i * CELL_FIELDS;
      for (let f = 0; f < CELL_FIELDS; f++) grid.buffer[base + f] = d[f];
    }
    return true;
  }

  private _recordMetric(tick: number): void {
    this.metrics.push({
      tick,
      energy:  Math.round(this._totalField(F.ENERGY)),
      entropy: Math.round(this._avgField(F.ENTROPY) * 1000) / 1000,
      info:    Math.round(this._totalField(F.INFORMATION)),
      agents:  this.agentCountFn(),
      bio:     Math.round(this._avgField(F.BIO_POTENTIAL) * 1000) / 1000,
    });
    if (this.metrics.length > this.maxMetrics) this.metrics.shift();
  }

  private _totalField(f: number): number {
    const { grid } = this;
    const { W, H, D, buffer } = grid;
    let s = 0;
    for (let i = 0; i < W * H * D; i++) s += buffer[i * CELL_FIELDS + f];
    return s;
  }

  private _avgField(f: number): number {
    const { grid } = this;
    return this._totalField(f) / (grid.W * grid.H * grid.D);
  }

  exportCSV(): void {
    const rows = ['tick,energy,entropy,information,agents,bio'];
    for (const m of this.metrics) rows.push(`${m.tick},${m.energy},${m.entropy},${m.info},${m.agents},${m.bio}`);
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reality_timeline_t${this.metrics.at(-1)?.tick ?? 0}.csv`;
    a.click();
  }

  getMetricsForChart(field: keyof TimelineMetric, lastN = 200): number[] {
    return this.metrics.slice(-lastN).map(m => (m[field] as number) || 0);
  }
}
