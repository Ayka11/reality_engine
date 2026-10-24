import { SparseVoxelGrid, type SparseVoxelGridSnapshot } from '../core/SparseVoxelGrid';
import { WORLD } from '../core/WorldConstants';
import { F, CELL_FIELDS } from '../core/CellState';
import { FieldPhysics } from './FieldPhysics';
import { EntropyLayer } from './EntropyLayer';
import { CausalGraph, type CausalGraphSnapshot } from './CausalGraph';
import { LawEngine, type LawEngineSnapshot } from '../laws/LawEngine';
import { WorldMetrics } from '../laws/MetaLaw';
import { GPUBackend } from '../gpu/GPUBackend';
import { buildMaterialBuffer } from '../materials/MaterialDef';
import { ChemLayer, type ChemLayerSnapshot } from '../chemistry/ChemLayer';
import { EntityLayer, type EntityLayerSnapshot } from './EntityLayer';
import { WorldEvents, type EventType, type WorldEventsSnapshot } from '../world/WorldEvents';
import { TemporalLayer } from './TemporalLayer';
import { InfoPhysics } from './InfoPhysics';
import { Recorder, type RecorderStateSnapshot } from './Recorder';
import { AgentSystem, type AgentSystemSnapshot } from './AgentSystem';

export interface SimulationEngineCoreRecoverySnapshot {
  width: number;
  height: number;
  depth: number;
  tick: number;
  prevEnergy: Float32Array;
  grid: SparseVoxelGridSnapshot;
  entities: EntityLayerSnapshot;
  agents: AgentSystemSnapshot;
  chemistry: ChemLayerSnapshot;
  worldEvents: WorldEventsSnapshot;
  causal: CausalGraphSnapshot;
  laws: LawEngineSnapshot;
  recorder: RecorderStateSnapshot;
}

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
  /** Changes whenever an engine-owned operation invalidates an in-flight GPU readback. */
  private _stateGeneration = 0;
  /** Serialize async steps so GPU submit/readback pairs cannot overlap. */
  private _stepQueue: Promise<void> = Promise.resolve();

  constructor(
    width: number = WORLD.W,
    height: number = WORLD.H,
    depth: number = WORLD.D,
  ) {
    if (!Number.isSafeInteger(width) || width <= 0 ||
        !Number.isSafeInteger(height) || height <= 0 ||
        !Number.isSafeInteger(depth) || depth <= 0) {
      throw new Error('SimulationEngine dimensions must be positive integers');
    }
    this.grid = new SparseVoxelGrid(width, height, depth);
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
    this._gpuReady = await this.gpu.init(this.grid.W, this.grid.H, this.grid.D);
    if (this._gpuReady) {
      this.gpu.upload(this.grid.buffer);
      this.gpu.uploadMaterials(buildMaterialBuffer());
    }
    return this._gpuReady;
  }

  get tick() { return this._tick; }
  get gpuActive() { return this._gpuReady; }

  restoreTick(tick: number): void {
    this._stateGeneration++;
    this._tick = Math.max(0, Math.floor(tick));
  }

  // nSteps allows batching multiple physics ticks per animation frame.
  // Keep each GPU submit/readback pair serialized, even if callers overlap step().
  step(dt: number, nSteps = 1): Promise<void> {
    const run = this._stepQueue.then(() => this._stepInternal(dt, nSteps));
    // A failed step must not permanently poison the queue; the caller still receives its rejection.
    this._stepQueue = run.catch(() => undefined);
    return run;
  }

  private async _stepInternal(dt: number, nSteps: number): Promise<void> {
    // Full-frame rollback is currently limited to CPU frames: an async GPU frame
    // may overlap external state changes, so restoring its old snapshot could erase them.
    const cpuRecoveryBefore = this._gpuReady ? null : this.captureCoreRecoveryState();
    try {
    const clampedDt = Math.min(dt, 0.05);

    if (this._gpuReady) {
      const readbackGeneration = this._stateGeneration;
      this.gpu.writeParams(this.laws.params, this.laws.activeProcessMask, clampedDt);
      this.gpu.submitCompute(nSteps);
      const data = await this.gpu.readback();
      if (readbackGeneration !== this._stateGeneration) {
        // Discard stale GPU output and resynchronize the device with the newer authoritative CPU state.
        this.gpu.upload(this.grid.buffer);
        throw new Error('Discarded stale GPU readback: simulation state changed while awaiting GPU results');
      }
      if (data.length > 0) this.grid.buffer.set(data);
      this.grid.syncDenseToChunks();
      this.chemLayer.tick(this.grid, clampedDt * nSteps);
      this.entityLayer.tick(this.grid, clampedDt * nSteps);
      this.temporalLayer.tick(this.grid, clampedDt * nSteps);
      this.infoPhysics.tick(this.grid, clampedDt * nSteps);
      this.agents.tick(this.grid, clampedDt * nSteps);
    } else {
      // CPU fallback — runs each step serially
      for (let s = 0; s < nSteps; s++) {
        this.grid.snapshot();
        this.fieldPhysics.tick(this.grid, clampedDt, this.laws.params, this.laws.activeProcessMask);
        this.entropyLayer.tick(this.grid, clampedDt, this.laws.params, this.laws.activeProcessMask);
        this.chemLayer.tick(this.grid, clampedDt);
        this.entityLayer.tick(this.grid, clampedDt);
        this.temporalLayer.tick(this.grid, clampedDt);
        this.infoPhysics.tick(this.grid, clampedDt);
        this.agents.tick(this.grid, clampedDt);
      }
      this.grid.syncDenseToChunks();
    }

    this._detectCausality();

    // Auto world events
    this.worldEvents.autoTick(this.grid, this._tick);

    // Scientific recorder
    this.recorder.tick(this.grid, this._tick);

    // Law engine uses global metrics to evolve which laws are active
    this.laws.tick(this._worldMetrics());

    // Keep GPU in sync after CPU changes (presets, painting)
    if (this._gpuReady) this.gpu.upload(this.grid.buffer);
    if (this._tick % 500 === 0) {
      this.grid.markEmptyChunksInactive();
      this.grid.cullInactive();
    }

    this._tick += nSteps;
    this._stateGeneration++;
    } catch (error) {
      if (cpuRecoveryBefore) {
        try {
          this.restoreCoreRecoveryState(cpuRecoveryBefore);
        } catch (rollbackError) {
          const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          const originalMessage = error instanceof Error ? error.message : String(error);
          throw new Error(`CPU frame failed (${originalMessage}) and rollback failed (${rollbackMessage})`);
        }
      }
      throw error;
    }
  }

  // Called after user paints/erases so GPU buffer stays consistent
  syncToGPU(): void {
    this._stateGeneration++;
    this.grid.syncDenseToChunks();
    if (this._gpuReady) this.gpu.upload(this.grid.buffer);
  }

  // Synchronous CPU-only step used by ScriptEngine (bypasses GPU/await)
  syncTick(n: number): void {
    // A synchronous script tick invalidates any asynchronous GPU result already in flight.
    this._stateGeneration++;
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
    this._stateGeneration++;
  }

  /**
   * Capture the mutable core domains that this engine can recover.
   * GPU device state is excluded and rebuilt from the CPU grid after restore.
   */
  captureCoreRecoveryState(): SimulationEngineCoreRecoverySnapshot {
    return {
      width: this.grid.W,
      height: this.grid.H,
      depth: this.grid.D,
      tick: this._tick,
      prevEnergy: new Float32Array(this.prevEnergy),
      grid: this.grid.captureState(),
      entities: this.entityLayer.snapshot(),
      agents: this.agents.snapshot(),
      chemistry: this.chemLayer.snapshot(),
      worldEvents: this.worldEvents.snapshot(),
      causal: this.causal.snapshot(),
      laws: this.laws.snapshot(),
      recorder: this.recorder.snapshotState(),
    };
  }

  /**
   * Restore core domains atomically. If any nested subsystem rejects the
   * candidate, restore the pre-call snapshot before rethrowing the failure.
   * This does not roll back omitted physics internals or external side effects.
   */
  restoreCoreRecoveryState(snapshot: SimulationEngineCoreRecoverySnapshot): void {
    if (!snapshot || typeof snapshot !== 'object' ||
        snapshot.width !== this.grid.W ||
        snapshot.height !== this.grid.H ||
        snapshot.depth !== this.grid.D ||
        !Number.isSafeInteger(snapshot.tick) || snapshot.tick < 0 ||
        !(snapshot.prevEnergy instanceof Float32Array) ||
        snapshot.prevEnergy.length !== this.prevEnergy.length ||
        !snapshot.prevEnergy.every(Number.isFinite)) {
      throw new Error('Invalid SimulationEngine core recovery snapshot');
    }

    const previous = this.captureCoreRecoveryState();
    const apply = (state: SimulationEngineCoreRecoverySnapshot): void => {
      this.grid.restoreState(state.grid);
      this.entityLayer.restore(state.entities, this.grid.size);
      this.agents.restore(state.agents);
      this.chemLayer.restore(state.chemistry, this.grid.size);
      this.worldEvents.restore(state.worldEvents);
      this.causal.restore(state.causal);
      this.laws.restore(state.laws);
      this.recorder.restoreState(state.recorder, this.grid.buffer.length);
      this.prevEnergy = new Float32Array(state.prevEnergy);
      this._tick = state.tick;
    };

    // Do not restore the monotonic generation counter: every recovery attempt
    // invalidates in-flight GPU results, including a rejected snapshot.
    this._stateGeneration++;
    try {
      apply(snapshot);
      if (this._gpuReady) this.gpu.upload(this.grid.buffer);
    } catch (error) {
      try {
        apply(previous);
        if (this._gpuReady) this.gpu.upload(this.grid.buffer);
      } catch (rollbackError) {
        const rollbackMessage = rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError);
        throw new Error(
          `Core recovery failed and rollback could not restore prior state: ${rollbackMessage}`,
        );
      }
      throw error;
    }
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

  triggerEvent(type: EventType): void {
    this._stateGeneration++;
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
    this._stateGeneration++;
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
