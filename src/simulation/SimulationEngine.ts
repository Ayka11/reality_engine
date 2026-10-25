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
    if (!Number.isFinite(tick)) {
      throw new RangeError("SimulationEngine restoreTick requires a finite tick");
    }
    const normalizedTick = Math.max(0, Math.floor(tick));
    if (!Number.isSafeInteger(normalizedTick)) {
      throw new RangeError("SimulationEngine restoreTick requires a safe integer tick");
    }
    this._stateGeneration++;
    this._tick = normalizedTick;
  }

  snapshotPrevEnergy(): Float32Array {
    return new Float32Array(this.prevEnergy);
  }

  restorePrevEnergy(snapshot: Float32Array): void {
    if (!(snapshot instanceof Float32Array) ||
        snapshot.length !== this.prevEnergy.length ||
        !snapshot.every(Number.isFinite)) {
      throw new Error("Invalid previous-energy recovery snapshot");
    }
    this.prevEnergy = new Float32Array(snapshot);
    this.invalidatePendingGPUReadback();
  }

  resetPreviousEnergy(): void {
    this.prevEnergy.fill(0);
    this.invalidatePendingGPUReadback();
  }

  snapshotChemistryState(): ChemLayerSnapshot {
    return this.chemLayer.snapshot();
  }

  restoreChemistryState(snapshot: ChemLayerSnapshot): void {
    this.chemLayer.restore(snapshot, this.grid.size);
    this.invalidatePendingGPUReadback();
  }

  resetChemistryState(): void {
    this.chemLayer.restore({ pendingDensityTransfers: [] }, this.grid.size);
    this.invalidatePendingGPUReadback();
  }

  /**
   * Run a synchronous capture after all frames already in the queue have settled.
   * Used for coherent quick-save/export snapshots during asynchronous GPU readback.
   */
  runAtStepBoundary<T>(operation: () => T): Promise<T> {
    if (typeof operation !== 'function') {
      return Promise.reject(new TypeError('Step-boundary operation requires a synchronous callback'));
    }
    const operationKind = Object.prototype.toString.call(operation);
    if (operationKind === '[object AsyncFunction]' ||
        operationKind === '[object AsyncGeneratorFunction]' ||
        operationKind === '[object GeneratorFunction]') {
      return Promise.reject(new TypeError('Step-boundary operation callback must remain synchronous'));
    }

    const run = this._stepQueue.then(() => {
      const result: unknown = operation();
      if (result !== null &&
          (typeof result === 'object' || typeof result === 'function') &&
          typeof (result as { then?: unknown }).then === 'function') {
        throw new TypeError('Step-boundary operation callback must remain synchronous');
      }
      return result as T;
    });
    // A failed capture is reported to the caller without poisoning future frames.
    this._stepQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  // nSteps allows batching multiple physics ticks per animation frame.
  // Keep each GPU submit/readback pair serialized, even if callers overlap step().
  step(dt: number, nSteps = 1): Promise<void> {
    if (!Number.isFinite(dt) || dt < 0) {
      return Promise.reject(new RangeError('SimulationEngine step dt must be a finite non-negative number'));
    }
    if (!Number.isSafeInteger(nSteps) || nSteps < 0) {
      return Promise.reject(new RangeError('SimulationEngine step nSteps must be a non-negative safe integer'));
    }
    // A zero-step request or zero elapsed time is a true no-op: logical age,
    // events, laws and the recorder must not advance without elapsed simulation time.
    if (nSteps === 0 || dt === 0) return Promise.resolve();

    const run = this._stepQueue.then(() => this._stepInternal(dt, nSteps));
    // A failed step must not permanently poison the queue; the caller still receives its rejection.
    this._stepQueue = run.catch(() => undefined);
    return run;
  }

  private async _stepInternal(dt: number, nSteps: number): Promise<void> {
    // Full-frame rollback is currently limited to CPU frames: an async GPU frame
    // may overlap external state changes, so restoring its old snapshot could erase them.
    // CPU frames snapshot before mutation. GPU frames take their recovery snapshot
    // only after readback is current, immediately before applying it to CPU state.
    // This preserves unrelated external changes made while awaiting the GPU.
    let frameRecoveryBefore = this._gpuReady ? null : this.captureCoreRecoveryState();
    try {
      const clampedDt = Math.min(dt, 0.05);

      if (this._gpuReady) {
        const readbackGeneration = this._stateGeneration;
        let data: Float32Array;
        try {
          this.gpu.writeParams(this.laws.params, this.laws.activeProcessMask, clampedDt);
          this.gpu.submitCompute(nSteps);
          data = await this.gpu.readback();
        } catch (error) {
          // submitCompute may already have advanced the device-side source buffer.
          // If readback then fails, restore the device from the authoritative CPU grid
          // before allowing a later step to proceed.
          this.resynchronizeGPUAndThrow(error, "GPU compute/readback failed");
        }
        if (readbackGeneration !== this._stateGeneration) {
          // Discard stale output without overwriting newer authoritative CPU state.
          this.resynchronizeGPUAndThrow(
            new Error('Discarded stale GPU readback: simulation state changed while awaiting GPU results'),
            "Stale GPU readback rejected",
          );
        }
        if (!(data instanceof Float32Array) || data.length !== this.grid.buffer.length) {
          const receivedLength = data instanceof Float32Array ? data.length : "non-Float32Array";
          const readbackError = new Error(
            `Invalid GPU readback: expected ${this.grid.buffer.length} floats, received ${receivedLength}`,
          );
          // Reject malformed output before capturing a commit snapshot: no CPU
          // mutation has happened yet, so resync once and preserve the real cause.
          this.resynchronizeGPUAndThrow(readbackError, "Malformed GPU readback rejected");
        }
        // Only capture once a readback has passed shape validation. From here
        // until the frame completes, the synchronous commit path owns mutations.
        try {
          frameRecoveryBefore = this.captureCoreRecoveryState();
        } catch (error) {
          this.resynchronizeGPUAndThrow(error, "GPU frame recovery snapshot failed");
        }
        this.grid.buffer.set(data);
        // The GPU solver has already advanced its field kernels nSteps times.
        // CPU-only subsystems must also advance once per logical substep with dt;
        // a single dt*nSteps call incorrectly increments age/PRNG-driven behavior
        // only once. This remains operator-split for nSteps>1, so scientific
        // CPU/GPU comparisons should use nSteps=1 for numerical consistency.
        for (let s = 0; s < nSteps; s++) {
          this.chemLayer.tick(this.grid, clampedDt);
          this.entityLayer.tick(this.grid, clampedDt);
          this.temporalLayer.tick(this.grid, clampedDt);
          this.infoPhysics.tick(this.grid, clampedDt);
          this.agents.tick(this.grid, clampedDt);
        }
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
      }

      this._detectCausality();

      // Auto world events may mutate through VoxelGrid.cell()/cellAt(), which
      // write the authoritative dense buffer directly. Publish only after all
      // per-frame field writers and events have run so chunks cannot lag one step.
      this.worldEvents.autoTick(this.grid, this._tick);
      this.grid.syncDenseToChunks();

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
      if (frameRecoveryBefore) {
        try {
          this.restoreCoreRecoveryState(frameRecoveryBefore);
        } catch (rollbackError) {
          const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          const originalMessage = error instanceof Error ? error.message : String(error);
          throw new Error(`CPU frame failed (${originalMessage}) and rollback failed (${rollbackMessage})`);
        }
      }
      throw error;
    }
  }

  /**
   * Restore the device mirror from the authoritative CPU grid after rejecting
   * a GPU result. Preserve both failures if this recovery upload also throws.
   */
  private resynchronizeGPUAndThrow(primaryError: unknown, context: string): never {
    try {
      this.gpu.upload(this.grid.buffer);
    } catch (syncError) {
      // The device state is no longer trustworthy. Fail closed to CPU execution
      // so a later step cannot consume or overwrite from a stale GPU buffer.
      this._gpuReady = false;
      const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const syncMessage = syncError instanceof Error ? syncError.message : String(syncError);
      throw new AggregateError(
        [primaryError, syncError],
        `${context} (${primaryMessage}); GPU resynchronization failed (${syncMessage})`,
      );
    }
    throw primaryError;
  }

  /**
   * Run one synchronous external mutation against the authoritative simulation.
   * This is the supported boundary for scripts/imports/edit operations that
   * directly write the public grid buffers: invalidate pending GPU readbacks
   * before entering the callback, then publish dense/chunk/GPU state together.
   * The callback must not await or publish unrelated external side effects.
   */
  mutateAuthoritativeState<T>(mutation: () => T): T {
    if (typeof mutation !== 'function') {
      throw new TypeError('Authoritative mutation requires a synchronous callback');
    }
    // Async functions begin executing as soon as they are called; rejecting their
    // returned Promise afterwards cannot cancel code scheduled after the first await.
    // Reject async/generator callbacks before invoking them at all.
    const mutationKind = Object.prototype.toString.call(mutation);
    if (mutationKind === '[object AsyncFunction]' ||
        mutationKind === '[object AsyncGeneratorFunction]' ||
        mutationKind === '[object GeneratorFunction]') {
      throw new TypeError('Authoritative mutation callback must remain synchronous');
    }

    // Invalidate any in-flight GPU result before snapshotting or exposing mutation.
    this._stateGeneration++;
    const recoveryBefore = this.captureCoreRecoveryState();
    try {
      const result = mutation();
      if (result !== null &&
          (typeof result === 'object' || typeof result === 'function') &&
          typeof (result as { then?: unknown }).then === 'function') {
        throw new TypeError('Authoritative mutation callback must remain synchronous');
      }
      this.grid.syncDenseToChunks();
      this.grid.syncBackBuffersFromFront();
      if (this._gpuReady) this.gpu.upload(this.grid.buffer);
      this._stateGeneration++;
      return result;
    } catch (error) {
      try {
        this.restoreCoreRecoveryState(recoveryBefore);
      } catch (rollbackError) {
        const originalMessage = error instanceof Error ? error.message : String(error);
        const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        throw new Error(
          `Authoritative mutation failed (${originalMessage}) and rollback failed (${rollbackMessage})`,
        );
      }
      throw error;
    }
  }

  /**
   * Invalidate GPU work that may be in flight before a legacy synchronous
   * writer mutates exposed grid buffers. Call the writer's publication/sync
   * method after its synchronous apply/rollback completes.
   */
  invalidatePendingGPUReadback(): void {
    this._stateGeneration++;
  }

  // Called after user paints/erases so GPU buffer stays consistent
  syncToGPU(): void {
    this.invalidatePendingGPUReadback();
    this.grid.syncDenseToChunks();
    this.grid.syncBackBuffersFromFront();
    if (this._gpuReady) this.gpu.upload(this.grid.buffer);
  }

  // Synchronous CPU-only step used by ScriptEngine (bypasses GPU/await)
  syncTick(n: number): void {
    if (!Number.isSafeInteger(n) || n < 0) {
      throw new RangeError('SimulationEngine syncTick n must be a non-negative safe integer');
    }
    // Even zero ticks are a synchronization boundary: callers may have made
    // direct grid writes that must invalidate an in-flight GPU readback.
    this._stateGeneration++;
    // Positive syncTicks are synchronous transactions. Because no await occurs
    // between capture and completion, rollback cannot erase interleaved external
    // mutations; zero remains a lightweight sync/invalidation boundary.
    const recoveryBefore = n > 0 ? this.captureCoreRecoveryState() : null;
    const dt = 0.016;
    try {
      for (let s = 0; s < n; s++) {
        // Match the asynchronous CPU frame: field physics reads the previous
        // authoritative front buffer through backBuffer for every tick.
        this.grid.snapshot();
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
      // syncTick is a CPU-authoritative physical step. Publish its committed
      // front buffer to the device so a subsequent GPU step cannot start from
      // stale pre-script state and overwrite the synchronous result.
      if (this._gpuReady) this.gpu.upload(this.grid.buffer);
      this._stateGeneration++;
    } catch (error) {
      if (recoveryBefore) {
        try {
          this.restoreCoreRecoveryState(recoveryBefore);
        } catch (rollbackError) {
          const originalMessage = error instanceof Error ? error.message : String(error);
          const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          throw new Error(
            `Synchronous script tick failed (${originalMessage}) and rollback failed (${rollbackMessage})`,
          );
        }
      }
      throw error;
    }
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
        // A failed rollback may leave device buffers inconsistent with CPU state.
        // Disable GPU execution rather than allowing a later step to trust them.
        this._gpuReady = false;
        const recoveryMessage = error instanceof Error ? error.message : String(error);
        const rollbackMessage = rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError);
        // Keep both failures observable: the candidate-restore failure is the
        // original fault, while the second failure explains why atomic restore
        // could not return the engine to its pre-call state.
        throw new AggregateError(
          [error, rollbackError],
          `Core recovery failed while applying candidate (${recoveryMessage}) and restoring prior state (${rollbackMessage})`,
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
    this.mutateAuthoritativeState(() => {
      this.worldEvents.trigger(this.grid, type, this._tick);
    });
  }

  agentMarkers() { return this.agents.agentMarkers(); }

  entityStats() {
    return {
      totalSpawned: this.entityLayer.totalSpawned,
      extinct: this.entityLayer.extinctCount,
    };
  }

  setEntityMutationStrength(v: number): void {
    if (!Number.isFinite(v)) {
      throw new RangeError('Entity mutation strength must be finite');
    }
    if (this.entityLayer.mutationStrength === v) return;
    this._stateGeneration++;
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
    this.mutateAuthoritativeState(() => {
      this.grid.clear();
      this.causal.clear();
      this.entityLayer.clear();
      this.agents.clear();
      this.recorder.clearSnapshots();
      this.prevEnergy.fill(0);
      this._tick = 0;
    });
  }
}
