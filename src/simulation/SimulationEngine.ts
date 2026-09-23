import { SparseVoxelGrid } from '../core/SparseVoxelGrid';
import { WORLD } from '../core/WorldConstants';
import { F, CELL_FIELDS } from '../core/CellState';
import { FieldPhysics } from './FieldPhysics';
import { EntropyLayer } from './EntropyLayer';
import { CausalGraph } from './CausalGraph';
import { LawEngine } from '../laws/LawEngine';
import { WorldMetrics } from '../laws/MetaLaw';
import { GPUBackend } from '../gpu/GPUBackend';
import { buildMaterialBuffer } from '../materials/MaterialDef';
import { ChemLayer } from '../chemistry/ChemLayer';
import { EntityLayer } from './EntityLayer';
import { WorldEvents, EventType } from '../world/WorldEvents';
import { TemporalLayer } from './TemporalLayer';
import { InfoPhysics } from './InfoPhysics';
import { Recorder } from './Recorder';
import { AgentSystem } from './AgentSystem';
import type {
  InfinityScaleExecutionCapabilities,
  InfinityScaleExecutionPlan,
} from '../infinity/InfinityScaleExecutionAdapter';
import { InfinityScaleChunkExecutionContext } from '../infinity/InfinityScaleChunkExecutionContext';
import {
  advanceInfinityScaleGlobalFrame,
  assertInfinityScaleGlobalFramePlan,
  beginInfinityScaleGlobalFrame,
  validateInfinityScaleGlobalFrameCommit,
  type InfinityScaleGlobalExecutionFrame,
} from '../infinity/InfinityScaleGlobalExecutionFrame';

export class SimulationEngine {
  readonly grid: SparseVoxelGrid;
  readonly causal: CausalGraph;
  readonly laws: LawEngine;
  readonly gpu: GPUBackend;
  readonly worldEvents: WorldEvents;
  readonly recorder: Recorder;
  readonly agents: AgentSystem;

  readonly entityLayer: EntityLayer;
  private fieldPhysics: FieldPhysics;
  private entropyLayer: EntropyLayer;
  private chemLayer: ChemLayer;
  private temporalLayer: TemporalLayer;
  private infoPhysics: InfoPhysics;
  private prevEnergy: Float32Array;
  private _tick = 0;
  private _gpuReady = false;
  private _infinityExecutionPlan: InfinityScaleExecutionPlan | null = null;

  constructor() {
    this.grid = new SparseVoxelGrid(WORLD.W, WORLD.H, WORLD.D);
    this.causal = new CausalGraph();
    this.laws = new LawEngine();
    this.gpu = new GPUBackend();
    this.worldEvents = new WorldEvents();
    this.recorder = new Recorder();
    this.agents = new AgentSystem();
    this.fieldPhysics = new FieldPhysics();
    this.entropyLayer = new EntropyLayer();
    this.chemLayer = new ChemLayer();
    this.entityLayer = new EntityLayer();
    this.temporalLayer = new TemporalLayer();
    this.infoPhysics = new InfoPhysics();
    this.prevEnergy = new Float32Array(this.grid.size);
  }

  async initGPU(): Promise<boolean> {
    this._gpuReady = await this.gpu.init(WORLD.W, WORLD.H, WORLD.D);
    if (this._gpuReady) {
      const selectiveGpu =
        !!selectivePlan &&
        selectivePlan.mode === 'selective-gpu-ready';

      if (selectiveGpu) {
        // A batched frame still advances lifecycle systems one simulation tick
        // at a time. This preserves agent age, entity lifecycle, chemistry
        // ordering and migration generation semantics instead of collapsing
        // nSteps into one oversized CPU update.
        const executionContext = frameContext;
        if (!executionContext) {
          throw new Error('Infinity Scale selective GPU execution requires an active frame context');
        }

        for (let s = 0; s < nSteps; s++) {
          this.gpu.writeParams(this.laws.params, this.laws.activeProcessMask, clampedDt);
          this.gpu.submitCompute(1, executionContext);
          const data = await this.gpu.readback();
          if (data.length > 0) this.grid.buffer.set(data);
          this.grid.syncDenseToChunks();

          this.chemLayer.tickChunks(this.grid, clampedDt, executionContext);
          this.agents.tickChunks(this.grid, clampedDt, executionContext);
          this.entityLayer.tickChunks(this.grid, clampedDt, executionContext);

          // CPU-owned state must be visible to the next GPU tick.
          this.gpu.upload(this.grid.buffer);
        }
      } else {
        // Legacy full-domain GPU path may retain its batched kernel semantics.
        this.gpu.writeParams(this.laws.params, this.laws.activeProcessMask, clampedDt);
        this.gpu.submitCompute(nSteps, null);
        const data = await this.gpu.readback();
        if (data.length > 0) this.grid.buffer.set(data);
        this.grid.syncDenseToChunks();

        this.chemLayer.tick(this.grid, clampedDt * nSteps);
        this.entityLayer.tick(this.grid, clampedDt * nSteps);
        this.temporalLayer.tick(this.grid, clampedDt * nSteps);
        this.infoPhysics.tick(this.grid, clampedDt * nSteps);
        this.agents.tick(this.grid, clampedDt * nSteps);
      }
    } else {
      // CPU fallback — runs each step serially
      for (let s = 0; s < nSteps; s++) {
        this.grid.snapshot();
        // A selective frame owns one immutable execution context for all
        // ticks. Do not rebuild it from the mutable active plan between ticks:
        // that would let a mid-frame plan change mix ownership domains.
        const executionContext = frameContext;
        if (executionContext && selectivePlan) {
          this.fieldPhysics.tickChunks(
            this.grid,
            clampedDt,
            this.laws.params,
            this.laws.activeProcessMask,
            executionContext,
          );
          this.entropyLayer.tickChunks(
            this.grid,
            clampedDt,
            this.laws.params,
            this.laws.activeProcessMask,
            executionContext,
          );
          this.infoPhysics.tickChunks(this.grid, clampedDt, executionContext);
          this.temporalLayer.tickChunks(this.grid, clampedDt, executionContext);
          this.chemLayer.tickChunks(this.grid, clampedDt, executionContext);
          this.agents.tickChunks(this.grid, clampedDt, executionContext);
          this.entityLayer.tickChunks(this.grid, clampedDt, executionContext);
        } else {
          this.fieldPhysics.tick(
            this.grid,
            clampedDt,
            this.laws.params,
            this.laws.activeProcessMask,
          );
          this.entropyLayer.tick(
            this.grid,
            clampedDt,
            this.laws.params,
            this.laws.activeProcessMask,
          );
          this.infoPhysics.tick(this.grid, clampedDt);
          this.temporalLayer.tick(this.grid, clampedDt);
        }
      }
      this.grid.syncDenseToChunks();
    }

    // Agent migrations cross ownership boundaries only at the frame barrier.
    if (frameContext) {
      const migrationRequests = this.agents.consumeMigrationRequests();
      this.agents.applyMigrationRequests(
        this.grid,
        migrationRequests,
        frameContext,
      );

      // Entity reconciliation is a boundary commit, not a local behavior step.
      // tickChunks() has already analyzed the owned workset; identities are
      // committed only after all local systems have finished.
      this.entityLayer.applyChunkReconciliation(this.grid, frameContext);
    }

    this._detectCausality(frameContext);

    // Boundary reconciliation is the single commit barrier for deferred
    // cross-workset state. The plan must remain identical from frame start
    // through commit; a changed ownership set is rejected rather than merged
    // against stale local results.
    if (frameState && frameContext) {
      if (!selectivePlan) {
        throw new Error('Infinity Scale frame lost its execution plan');
      }
      validateInfinityScaleGlobalFrameCommit(frameState, selectivePlan);
      this.chemLayer.commitPendingDensityTransfers(this.grid, frameContext);
      frameState = advanceInfinityScaleGlobalFrame(frameState, 'local-commit');
      frameState = advanceInfinityScaleGlobalFrame(frameState, 'boundary-reconciliation');
    }

    const eventContext = frameContext;
    if (frameState) frameState = advanceInfinityScaleGlobalFrame(frameState, 'global-metrics');
    const metrics = this._worldMetrics();

    if (frameState) frameState = advanceInfinityScaleGlobalFrame(frameState, 'global-control');
    this.laws.tick(metrics);
    this.worldEvents.autoTick(this.grid, this._tick, eventContext);

    if (frameState) frameState = advanceInfinityScaleGlobalFrame(frameState, 'observation');
    this.recorder.tick(this.grid, this._tick);

    if (frameState) frameState = advanceInfinityScaleGlobalFrame(frameState, 'finalize');

    // Keep GPU in sync after CPU changes (presets, painting)
    if (this._gpuReady) this.gpu.upload(this.grid.buffer);
    if (this._tick % 500 === 0) {
      this.grid.markEmptyChunksInactive();
      this.grid.cullInactive();
    }

    this._tick += nSteps;
  }

  // Called after user paints/erases so GPU buffer stays consistent
  syncToGPU(): void {
    this.grid.syncDenseToChunks();
    if (this._gpuReady) this.gpu.upload(this.grid.buffer);
  }

  // Synchronous CPU-only step used by ScriptEngine (bypasses GPU/await)
  syncTick(n: number): void {
    const dt = 0.016;
    for (let s = 0; s < n; s++) {
      this.fieldPhysics.tick(this.grid, dt, this.laws.params, this.laws.activeProcessMask);
      this.entropyLayer.tick(this.grid, dt, this.laws.params, this.laws.activeProcessMask);
      this.chemLayer.tick(this.grid, dt);
      this.entityLayer.tick(this.grid, dt);
      this.temporalLayer.tick(this.grid, dt);
      this.infoPhysics.tick(this.grid, dt);
      this.agents.tick(this.grid, dt);
      this.laws.tick(this._worldMetrics());
      this._tick++;
    }
    this.grid.syncDenseToChunks();
  }

  private _worldMetrics(): WorldMetrics {
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
    return {
      totalEnergy: totalE,
      avgEntropy:  sumS / n,
      avgInfo:     sumI / n,
      avgDensity:  sumD / n,
      avgBio:      sumB / n,
      tick:        this._tick,
    };
  }

  private _detectCausality(
    context: InfinityScaleChunkExecutionContext | null = null,
  ): void {
    const { grid } = this;
    const { W, H, D } = grid;
    for (let z = 0; z < D; z++)
    for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const cell = grid.cell(x, y, z);
      const lin  = z * H * W + y * W + x;
      const owned = !context || context.containsSimulationCell(x, y, z);
      const delta = cell.energy - this.prevEnergy[lin];

      // Causality is a simulation-owned write: selective execution may only
      // emit events and mutate CAUSALITY_ID for cells in its simulation set.
      // The energy baseline is still refreshed for every cell so inactive
      // cells do not accumulate a false spike while outside the workset.
      if (owned && Math.abs(delta) > WORLD.CAUSALITY_THRESHOLD) {
        this.causal.log(this._tick, x, y, z, lin, 'energy_spike', Math.round(delta));
        cell.set(F.CAUSALITY_ID, this.causal.recent(1)[0]?.id ?? 0);
      }

      this.prevEnergy[lin] = cell.energy;
    }
  }

  triggerEvent(type: EventType): void {
    this.worldEvents.trigger(this.grid, type, this._tick);
    if (this._gpuReady) this.gpu.upload(this.grid.buffer);
  }

  agentMarkers() { return this.agents.agentMarkers(); }

  entityStats() {
    return {
      totalSpawned: this.entityLayer.totalSpawned,
      extinct: this.entityLayer.extinctCount,
    };
  }

  setEntityMutationStrength(v: number): void {
    this.entityLayer.mutationStrength = v;
  }

  totalField(fieldIdx: number): number { return this.grid.totalField(fieldIdx); }

  entityMarkers() {
    return this.entityLayer.getEntities().map(e => ({
      id:       String(e.id),
      centroid: e.centroid,
      stability: e.stage === 'juvenile' ? 0.3 : e.stage === 'mature' ? 0.9 : 0.5,
      age:      e.age,
      color:    (e.stage === 'juvenile' ? [0.2, 0.9, 0.4]
               : e.stage === 'mature'  ? [0.9, 0.7, 0.1]
               :                        [0.5, 0.3, 0.7]) as [number, number, number],
    }));
  }

  reset(): void {
    this.grid.clear();
    this.causal.clear();
    this.entityLayer.clear();
    this.agents.clear();
    this.recorder.clearSnapshots();
    this.prevEnergy.fill(0);
    this._tick = 0;
    this.grid.syncDenseToChunks();
    if (this._gpuReady) this.gpu.upload(this.grid.buffer);
  }
}
