import { VoxelGrid } from '../core/VoxelGrid';
import { WORLD } from '../core/WorldConstants';
import { F } from '../core/CellState';
import { FieldPhysics } from './FieldPhysics';
import { EntropyLayer } from './EntropyLayer';
import { CausalGraph } from './CausalGraph';
import { LawEngine } from '../laws/LawEngine';
import { WorldMetrics } from '../laws/MetaLaw';
import { GPUBackend } from '../gpu/GPUBackend';

export class SimulationEngine {
  readonly grid: VoxelGrid;
  readonly causal: CausalGraph;
  readonly laws: LawEngine;
  readonly gpu: GPUBackend;

  private fieldPhysics: FieldPhysics;
  private entropyLayer: EntropyLayer;
  private prevEnergy: Float32Array;
  private _tick = 0;
  private _gpuReady = false;

  constructor() {
    this.grid = new VoxelGrid(WORLD.W, WORLD.H, WORLD.D);
    this.causal = new CausalGraph();
    this.laws = new LawEngine();
    this.gpu = new GPUBackend();
    this.fieldPhysics = new FieldPhysics();
    this.entropyLayer = new EntropyLayer();
    this.prevEnergy = new Float32Array(this.grid.size);
  }

  async initGPU(): Promise<boolean> {
    this._gpuReady = await this.gpu.init(WORLD.W, WORLD.H, WORLD.D);
    if (this._gpuReady) {
      // Sync initial grid state to GPU
      this.gpu.upload(this.grid.buffer);
    }
    return this._gpuReady;
  }

  get tick() { return this._tick; }
  get gpuActive() { return this._gpuReady; }

  // nSteps allows batching multiple physics ticks per animation frame
  async step(dt: number, nSteps = 1): Promise<void> {
    const clampedDt = Math.min(dt, 0.05);

    if (this._gpuReady) {
      this.gpu.writeParams(this.laws.params, this.laws.activeProcessMask, clampedDt);
      this.gpu.submitCompute(nSteps);
      const data = await this.gpu.readback();
      if (data.length > 0) this.grid.buffer.set(data);
    } else {
      // CPU fallback — runs each step serially
      for (let s = 0; s < nSteps; s++) {
        this.grid.snapshot();
        this.fieldPhysics.tick(this.grid, clampedDt, this.laws.params, this.laws.activeProcessMask);
        this.entropyLayer.tick(this.grid, clampedDt, this.laws.params, this.laws.activeProcessMask);
      }
    }

    this._detectCausality();

    // Law engine uses global metrics to evolve which laws are active
    this.laws.tick(this._worldMetrics());

    // Keep GPU in sync after CPU changes (presets, painting)
    if (this._gpuReady) this.gpu.upload(this.grid.buffer);

    this._tick += nSteps;
  }

  // Called after user paints/erases so GPU buffer stays consistent
  syncToGPU(): void {
    if (this._gpuReady) this.gpu.upload(this.grid.buffer);
  }

  private _worldMetrics(): WorldMetrics {
    const { grid } = this;
    const n = grid.size;
    let totalE = 0, sumS = 0, sumI = 0, sumD = 0, sumB = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 16;
      totalE += grid.buffer[o + F.ENERGY];
      sumS   += grid.buffer[o + F.ENTROPY];
      sumI   += grid.buffer[o + F.INFORMATION];
      sumD   += grid.buffer[o + F.DENSITY];
      sumB   += grid.buffer[o + F.BIO_POTENTIAL];
    }
    return {
      totalEnergy: totalE,
      avgEntropy:  sumS / n,
      avgInfo:     sumI / n,
      avgDensity:  sumD / n,
      avgBio:      sumB / n,
      tick:        this._tick,
    };
  }

  private _detectCausality(): void {
    const { grid } = this;
    const { W, H, D } = grid;
    for (let z = 0; z < D; z++)
    for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const cell = grid.cell(x, y, z);
      const lin  = z * H * W + y * W + x;
      const delta = cell.energy - this.prevEnergy[lin];
      if (Math.abs(delta) > WORLD.CAUSALITY_THRESHOLD) {
        this.causal.log(this._tick, x, y, z, lin, 'energy_spike', Math.round(delta));
        cell.set(F.CAUSALITY_ID, this.causal.recent(1)[0]?.id ?? 0);
      }
      this.prevEnergy[lin] = cell.energy;
    }
  }

  totalField(fieldIdx: number): number { return this.grid.totalField(fieldIdx); }

  reset(): void {
    this.grid.clear();
    this.causal.clear();
    this.prevEnergy.fill(0);
    this._tick = 0;
    if (this._gpuReady) this.gpu.upload(this.grid.buffer);
  }
}
