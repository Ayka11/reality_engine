import { LawEngine } from '../laws/LawEngine';
import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';
import { WorldMetrics } from '../laws/MetaLaw';

export class MetaLawEvolution {
  private laws: LawEngine;
  private grid: VoxelGrid;
  private cycleLength = 500;
  private lastCycle = 0;
  public lastAction = 'awaiting first cycle';
  public cycleCount = 0;
  public topLaw = '';

  constructor(laws: LawEngine, grid: VoxelGrid) {
    this.laws = laws;
    this.grid = grid;
  }

  tick(tick: number): void {
    if (tick - this.lastCycle < this.cycleLength) return;
    this.lastCycle = tick;
    const metrics = this._metrics();
    this.laws.tick(metrics);
    this._evolve();
    this.cycleCount++;
  }

  private _metrics(): WorldMetrics {
    const { grid } = this;
    const n = grid.size;
    let totalE = 0, sumS = 0, sumI = 0, sumD = 0, sumB = 0;
    for (let i = 0; i < n; i++) {
      const o = i * CELL_FIELDS;
      totalE += grid.buffer[o + F.ENERGY];
      sumS   += grid.buffer[o + F.ENTROPY];
      sumI   += grid.buffer[o + F.INFORMATION];
      sumD   += grid.buffer[o + F.DENSITY];
      sumB   += grid.buffer[o + F.BIO_POTENTIAL];
    }
    return { totalEnergy: totalE, avgEntropy: sumS / n, avgInfo: sumI / n, avgDensity: sumD / n, avgBio: sumB / n, tick: this.lastCycle };
  }

  private _evolve(): void {
    const all = this.laws.laws;
    if (all.length < 3) { this.lastAction = 'too few laws'; return; }

    const core = new Set(['law_thermo', 'law_gravity', 'law_info']);
    const sorted = [...all].sort((a, b) => a.fitness - b.fitness);
    const mutable = sorted.filter(l => !core.has(l.id));

    const cullCount = Math.max(1, Math.floor(mutable.length * 0.2));
    const culled: string[] = [];
    for (const law of mutable) {
      if (culled.length >= cullCount) break;
      culled.push(law.id);
    }

    const topPool = mutable.length > 0 ? mutable.slice(-cullCount) : sorted.slice(-1);
    this.topLaw = topPool[topPool.length - 1]?.name ?? '?';

    for (const id of culled) this.laws.removeLaw(id);
    for (const w of topPool) this.laws.spawnMutation(w.id);

    this.lastAction = culled.length > 0
      ? `culled ${culled.length}, spawned ${topPool.length} from "${this.topLaw}"`
      : `spawned ${topPool.length} from "${this.topLaw}"`;
  }
}
