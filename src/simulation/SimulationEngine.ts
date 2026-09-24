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
import { InfinityScaleLODState } from '../infinity/InfinityScaleLODState';
import { InfinityScaleLODTransfer } from '../infinity/InfinityScaleLODTransfer';
import { InfinityScaleLODBoundarySnapshot } from '../infinity/InfinityScaleLODBoundarySnapshot';
import { validateInfinityScaleMixedLOD, type InfinityScaleMixedLODValidation } from '../infinity/InfinityScaleMixedLODValidation';
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
  private readonly infinityScaleLODState: InfinityScaleLODState;

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
    this.infinityScaleLODState = new InfinityScaleLODState(32);
  }

  async initGPU(): Promise<boolean> {
    this._gpuReady = await this.gpu.init(WORLD.W, WORLD.H, WORLD.D);
    if (this._gpuReady) {
      this.gpu.upload(this.grid.buffer);
      this.gpu.uploadMaterials(buildMaterialBuffer());
    }
    return this._gpuReady;
  }

  get tick() { return this._tick; }
  get gpuActive() { return this._gpuReady; }

  getInfinityScaleMixedLODValidation(): InfinityScaleMixedLODValidation | null {
    const plan = this._infinityExecutionPlan;
    if (!plan) return null;
    const context = new InfinityScaleChunkExecutionContext(
      plan,
      this.grid.W,
      this.grid.H,
      this.grid.D,
    );
    const connectivity = this.entityLayer.getChunkConnectivityDiagnostics() ?? undefined;
    const reconciliation = this.entityLayer.getChunkReconciliationDiagnostics() ?? undefined;
    return validateInfinityScaleMixedLOD(
      plan,
      context,
      connectivity,
      reconciliation,
    );
  }

  getInfinityScaleExecutionCapabilities(): InfinityScaleExecutionCapabilities {
    return {
      selectiveCpuReady: true,
      selectiveGpuReady: this._gpuReady,
      gpuPhysicsReady: this._gpuReady,
      // Mixed-LOD prolongation/restriction is described by the execution
      // contract but is not yet applied to field values by the dense solver.
      lodBoundaryTransferReady: false,
    };
  }

  /**
   * Receives the bounded Infinity Scale work contract.
   *
   * The current dense solver remains full-domain by design. This contract is
   * observable and ready for selective dispatch once chunk-local stencil
   * boundaries and synchronization are implemented.
   */
  setInfinityScaleExecutionPlan(plan: InfinityScaleExecutionPlan | null): void {
    if (!plan) {
      this._infinityExecutionPlan = null;
      return;
    }

    // The engine accepts a GPU plan only when the runtime capability handshake
    // actually reports an initialized GPU. It never promotes CPU plans itself.
    if (plan.mode === 'selective-gpu-ready' && !this._gpuReady) {
      throw new Error(
        'Infinity Scale GPU execution plan requires initialized GPU capability',
      );
    }

    this._infinityExecutionPlan = {
      ...plan,
      observer: { ...plan.observer },
      chunks: plan.chunks.map(chunk => ({ ...chunk })),
      boundaryReadChunks: [...plan.boundaryReadChunks],
      boundaryReadRelations: plan.boundaryReadRelations.map(relation => ({ ...relation })),
    };
  }

  get infinityScaleExecutionPlan(): InfinityScaleExecutionPlan | null {
    if (!this._infinityExecutionPlan) return null;
    return {
      ...this._infinityExecutionPlan,
      observer: { ...this._infinityExecutionPlan.observer },
      chunks: this._infinityExecutionPlan.chunks.map(chunk => ({ ...chunk })),
      boundaryReadChunks: [...this._infinityExecutionPlan.boundaryReadChunks],
      boundaryReadRelations: this._infinityExecutionPlan.boundaryReadRelations.map(relation => ({ ...relation })),
    };
  }

  restoreTick(tick: number): void {
    this._tick = Math.max(0, Math.floor(tick));
  }

  // nSteps allows batching multiple physics ticks per animation frame
  async step(dt: number, nSteps = 1): Promise<void> {
    const clampedDt = Math.min(dt, 0.05);

    const selectivePlan =
      this._infinityExecutionPlan &&
      this._infinityExecutionPlan.mode !== 'advisory'
        ? this._infinityExecutionPlan
        : null;

    const frame: InfinityScaleGlobalExecutionFrame | null = selectivePlan
      ? beginInfinityScaleGlobalFrame(selectivePlan, this._tick, this._tick + nSteps)
      : null;
    let frameState = frame
      ? advanceInfinityScaleGlobalFrame(frame, 'local-execution')
      : null;
    const frameContext = selectivePlan
      ? new InfinityScaleChunkExecutionContext(selectivePlan, this.grid.W, this.grid.H, this.grid.D)
      : null;
    if (frameState && frameContext) {
      assertInfinityScaleGlobalFramePlan(frameState, selectivePlan!, frameContext);
    }

    if (this._gpuReady) {
      const selectiveGpu =
        !!selectivePlan &&
        selectivePlan.mode === 'selective-gpu-ready';

      if (selectiveGpu) {
        const executionContext = frameContext;
        if (!executionContext) {
          throw new Error('Infinity Scale selective GPU execution requires an active frame context');
        }

        // Preserve per-tick lifecycle semantics inside a batched frame.
        for (let s = 0; s < nSteps; s++) {
          this.gpu.writeParams(this.laws.params, this.laws.activeProcessMask, clampedDt);
          this.gpu.submitCompute(1, executionContext);
          const data = await this.gpu.readback();
          if (data.length > 0) this.grid.buffer.set(data);
          this.grid.syncDenseToChunks();

          this.chemLayer.tickChunks(this.grid, clampedDt, executionContext);
          this.agents.tickChunks(this.grid, clampedDt, executionContext);
          this.entityLayer.tickChunks(this.grid, clampedDt, executionContext);

          // Causality is sampled at the same temporal boundary as the
          // simulation tick, so batched frames do not collapse multiple
          // energy transitions into one synthetic event.
          this._detectCausality(executionContext);
          this._tick++;
          this.gpu.upload(this.grid.buffer);
        }
      } else {
        // Legacy full-domain GPU path.
        this.chemLayer.tick(this.grid, clampedDt * nSteps);
        this.entityLayer.tick(this.grid, clampedDt * nSteps);
        this.temporalLayer.tick(this.grid, clampedDt * nSteps);
        this.infoPhysics.tick(this.grid, clampedDt * nSteps);
        this.agents.tick(this.grid, clampedDt * nSteps);
        this._tick += nSteps;
      }
    } else {
      // CPU fallback — runs each step serially
      for (let s = 0; s < nSteps; s++) {
        this.grid.snapshot();
        const executionContext = frameContext;
        const boundarySnapshot =
          executionContext && selectivePlan
            ? this.captureInfinityScaleBoundarySnapshot(executionContext)
            : undefined;
        if (executionContext && selectivePlan) {
          this.fieldPhysics.tickChunks(
            this.grid,
            clampedDt,
            this.laws.params,
            this.laws.activeProcessMask,
            executionContext,
            boundarySnapshot,
          );
          this.entropyLayer.tickChunks(
            this.grid,
            clampedDt,
            this.laws.params,
            this.laws.activeProcessMask,
            executionContext,
          );
          this.infoPhysics.tickChunks(
            this.grid,
            clampedDt,
            executionContext,
            boundarySnapshot,
          );
          this.temporalLayer.tickChunks(
            this.grid,
            clampedDt,
            executionContext,
            boundarySnapshot,
          );
          this.chemLayer.tickChunks(
            this.grid,
            clampedDt,
            executionContext,
            boundarySnapshot,
          );
          this.agents.tickChunks(
            this.grid,
            clampedDt,
            executionContext,
            boundarySnapshot,
          );
          this.entityLayer.tickChunks(
            this.grid,
            clampedDt,
            executionContext,
            boundarySnapshot,
          );

          // Keep causality aligned with each selective CPU simulation tick.
          this._detectCausality(executionContext);
          this._tick++;
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
      if (!selectivePlan) this._tick += nSteps;
    }

    // Validate the immutable frame contract before any deferred boundary
    // mutation. A changed ownership plan must fail atomically, before agents,
    // entities, or chemistry can publish cross-workset state.
    if (frameState && frameContext) {
      if (!selectivePlan) {
        throw new Error('Infinity Scale frame lost its execution plan');
      }
      validateInfinityScaleGlobalFrameCommit(frameState, selectivePlan);
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

    // Selective execution already samples causality per simulation tick.
    // Legacy full-domain execution keeps its historical post-batch sampling.
    if (!frameContext) {
      this._detectCausality(null);
    }

    // Boundary reconciliation is the single commit barrier for deferred
    // cross-workset state. The plan was validated before mutation; now all
    // deferred local writes become visible together.
    if (frameState && frameContext) {
      this.chemLayer.commitPendingDensityTransfers(this.grid, frameContext);
      frameState = advanceInfinityScaleGlobalFrame(frameState, 'local-commit');
      frameState = advanceInfinityScaleGlobalFrame(frameState, 'boundary-reconciliation');
    }

    const eventContext = frameContext;
    if (frameState) frameState = advanceInfinityScaleGlobalFrame(frameState, 'global-metrics');
    const metrics = this._worldMetrics();

    if (frameState) frameState = advanceInfinityScaleGlobalFrame(frameState, 'global-control');
    // LawEngine and WorldEvents are frame-level global control systems.
    // Advance their elapsed-time state by the complete batched interval rather
    // than aging them once per render frame.
    this.laws.tick(metrics, nSteps);
    this.worldEvents.autoTick(this.grid, this._tick, eventContext, nSteps);

    if (frameState) frameState = advanceInfinityScaleGlobalFrame(frameState, 'observation');
    if (frameContext) {
      // Infinity Scale observation stores only simulation-owned cells. Full
      // snapshots remain available for non-selective execution.
      this.recorder.tickSelective(this.grid, this._tick, frameContext);
    } else {
      this.recorder.tick(this.grid, this._tick);
    }

    if (frameState) frameState = advanceInfinityScaleGlobalFrame(frameState, 'finalize');

    // Keep GPU in sync after CPU changes (presets, painting)
    if (this._gpuReady) this.gpu.upload(this.grid.buffer);
    if (this._tick % 500 === 0) {
      this.grid.markEmptyChunksInactive();
      this.grid.cullInactive();
    }

    // _tick has already advanced in the selective per-tick loop or in the
    // legacy batched CPU/GPU path. Do not advance it again at the frame tail.
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
  /**
   * Builds an immutable LOD boundary snapshot from the pre-tick dense state.
   *
   * Only mixed-LOD dependency chunks are materialized. Level-0 dependencies
   * are copied directly; coarser dependencies are restricted from their
   * corresponding base-resolution blocks. The snapshot is read-only for all
   * local solvers and is discarded after the tick.
   */
  private captureInfinityScaleBoundarySnapshot(
    context: InfinityScaleChunkExecutionContext,
  ): InfinityScaleLODBoundarySnapshot | undefined {
    const specs = context.boundaryTransferSpecs.filter(
      spec => spec.sourceLevel !== spec.targetLevel,
    );
    if (specs.length === 0) return undefined;

    const targetKeys = [...new Set(specs.map(spec => spec.targetChunk))];
    for (const key of targetKeys) {
      const match = /^(\d+):(-?\d+),(-?\d+),(-?\d+)$/.exec(key);
      if (!match) throw new Error(`Invalid Infinity Scale chunk key: ${key}`);

      const level = Number(match[1]);
      const cx = Number(match[2]);
      const cy = Number(match[3]);
      const cz = Number(match[4]);
      const scale = 2 ** level;
      const state = this.infinityScaleLODState.ensureChunk(key, level);

      for (let lz = 0; lz < 32; lz++) {
        for (let ly = 0; ly < 32; ly++) {
          for (let lx = 0; lx < 32; lx++) {
            const baseX = cx * 32 * scale + lx * scale;
            const baseY = cy * 32 * scale + ly * scale;
            const baseZ = cz * 32 * scale + lz * scale;

            if (level === 0) {
              if (
                baseX < 0 || baseX >= this.grid.W ||
                baseY < 0 || baseY >= this.grid.H ||
                baseZ < 0 || baseZ >= this.grid.D
              ) continue;
              const cell = this.grid.cellBack(baseX, baseY, baseZ);
              const offset = ((lz * 32 * 32) + ly * 32 + lx) * CELL_FIELDS;
              for (let field = 0; field < CELL_FIELDS; field++) {
                state.cells[offset + field] = cell.get(field);
              }
              continue;
            }

            const fineCells: Float32Array[] = [];
            let complete = true;
            for (let dz = 0; dz < scale && complete; dz++) {
              for (let dy = 0; dy < scale && complete; dy++) {
                for (let dx = 0; dx < scale; dx++) {
                  const x = baseX + dx;
                  const y = baseY + dy;
                  const z = baseZ + dz;
                  if (
                    x < 0 || x >= this.grid.W ||
                    y < 0 || y >= this.grid.H ||
                    z < 0 || z >= this.grid.D
                  ) {
                    complete = false;
                    break;
                  }
                  const cell = this.grid.cellBack(x, y, z);
                  const values = new Float32Array(CELL_FIELDS);
                  for (let field = 0; field < CELL_FIELDS; field++) {
                    values[field] = cell.get(field);
                  }
                  fineCells.push(values);
                }
              }
            }
            if (!complete) continue;

            const coarse = new Array<number>(CELL_FIELDS).fill(0);
            InfinityScaleLODTransfer.restrict(
              fineCells,
              coarse,
              0,
              level,
            );
            const offset = ((lz * 32 * 32) + ly * 32 + lx) * CELL_FIELDS;
            for (let field = 0; field < CELL_FIELDS; field++) {
              state.cells[offset + field] = coarse[field];
            }
          }
        }
      }
    }

    return InfinityScaleLODBoundarySnapshot.capture(
      this.infinityScaleLODState,
      specs,
      this._tick,
      32,
    );
  }

}
