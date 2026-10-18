import { F } from "../core/CellState";
import { SimulationEngine } from "../simulation/SimulationEngine";

export async function runSimulationEngineFrameRollbackRegression(): Promise<void> {
  const engine = new SimulationEngine(4, 4, 2);
  const fieldIndex = engine.grid.idx(1, 1, 1) + F.ENERGY;
  engine.grid.buffer[fieldIndex] = 25;
  engine.grid.backBuffer[fieldIndex] = 17;
  const agentId = engine.agents.spawnAt(1, 1, 1, "explorer", 90);
  engine.restoreTick(7);

  engine.setInfinityScaleExecutionPlan({
    revision: 1,
    mode: "selective-cpu-ready",
    observer: { x: 1, y: 1, z: 1 },
    chunks: [{ key: "0:0,0,0", lod: 0, amr: 1, distance: 0 }],
    simulationBudget: 32,
    requestedSimulationCount: 1,
    selectedSimulationCount: 1,
    maxSimulatingChunks: 1,
    boundaryReadChunks: [],
    boundaryReadCount: 0,
    boundaryReadRelations: [],
    simulationCellCount: 32,
    boundaryReadCellCount: 0,
    localExecutionLayers: [],
    globalExecutionLayers: [],
    selectiveCpuReady: true,
    selectiveGpuReady: false,
    gpuPhysicsReady: false,
    lodBoundaryTransferReady: true,
    mixedLodExecutionReady: true,
    entityExecutionReady: true,
    agentMigrationReady: true,
  });

  const before = engine.captureCoreRecoveryState();
  const fieldPhysics = (engine as unknown as { fieldPhysics: { tickChunks: (...args: any[]) => void } }).fieldPhysics;
  const originalTickChunks = fieldPhysics.tickChunks;
  fieldPhysics.tickChunks = ((...args: Parameters<typeof originalTickChunks>) => {
    args[0].buffer[fieldIndex] = 999;
    engine.agents.getAgents()[0].energy = 1;
    // Exercise recovery across domains that a later frame stage can mutate,
    // not just the field and the currently executing subsystem.
    engine.agents.seed(engine.grid, 1);
    engine.laws.toggleProcess(27, false);
    engine.worldEvents.trigger(engine.grid, "meteor_strike", engine.tick);
    engine.causal.log(engine.tick, 1, 1, 1, 7, "energy_spike", 12);
    engine.recorder.startRecording();
    engine.grid.assignChunkOwner("0,0,0", "rollback-test-owner");
    engine.grid.markChunksDirty(["0,0,0"]);
    throw new Error("intentional frame rollback regression failure");
  }) as typeof originalTickChunks;

  let rejected = false;
  try {
    await engine.step(0.016);
  } catch (error) {
    rejected = error instanceof Error && error.message === "intentional frame rollback regression failure";
  } finally {
    fieldPhysics.tickChunks = originalTickChunks;
  }

  if (!rejected) {
    throw new Error("Selective frame failure did not propagate the injected error");
  }
  if (engine.tick !== before.tick ||
      engine.grid.buffer[fieldIndex] !== before.grid.buffer[fieldIndex] ||
      engine.grid.backBuffer[fieldIndex] !== before.grid.backBuffer[fieldIndex]) {
    throw new Error("Selective frame failure did not restore tick and grid buffers");
  }
  const agent = engine.agents.getAgents().find(candidate => candidate.id === agentId);
  if (!agent || agent.energy !== 90 || engine.agents.getAgents().length !== 1) {
    throw new Error("Selective frame failure did not restore agent state");
  }
  const after = engine.captureCoreRecoveryState();
  // Compare the complete recovery snapshot, not only selected sentinel fields.
  // Typed arrays serialize by index and the snapshot intentionally contains
  // plain arrays for maps/sets, so this catches divergence across all captured
  // subsystem state, both grid buffers, RNG, LOD chunks and metadata.
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error("Selective frame failure did not restore the complete core recovery snapshot");
  }
  if (JSON.stringify(after.chemistry.pendingDensityTransfers) !== JSON.stringify(before.chemistry.pendingDensityTransfers) ||
      after.lod.chunks.length !== before.lod.chunks.length) {
    throw new Error("Selective frame failure did not restore deferred chemistry or LOD state");
  }
  if (after.agents.rngState !== before.agents.rngState ||
      after.laws.rngState !== before.laws.rngState ||
      after.worldEvents.rngState !== before.worldEvents.rngState) {
    throw new Error("Selective frame failure did not restore subsystem random generator state");
  }
  if (JSON.stringify(after.laws.manualOff) !== JSON.stringify(before.laws.manualOff) ||
      JSON.stringify(after.worldEvents.history) !== JSON.stringify(before.worldEvents.history) ||
      JSON.stringify(after.causal.events) !== JSON.stringify(before.causal.events) ||
      after.causal.nextId !== before.causal.nextId ||
      after.recorder.control.recording !== before.recorder.control.recording ||
      JSON.stringify(after.recorder.snapshots) !== JSON.stringify(before.recorder.snapshots) ||
      JSON.stringify(after.grid.chunkOwners) !== JSON.stringify(before.grid.chunkOwners) ||
      JSON.stringify(after.grid.dirtyChunks) !== JSON.stringify(before.grid.dirtyChunks)) {
    throw new Error("Selective frame failure did not restore auxiliary simulation state");
  }

  // A rollback is only useful if the same engine can execute the next frame.
  // The failed frame invalidates transient entity diagnostics; step() must
  // rebuild them during preflight rather than leaving the engine permanently
  // unable to satisfy its selective execution plan.
  const tickBeforeRetry = engine.tick;
  await engine.step(0.016);
  if (engine.tick !== tickBeforeRetry + 1) {
    throw new Error("Simulation did not advance after recovering from a failed selective frame");
  }

  // Compare the post-recovery frame with a clean control engine restored from
  // the exact pre-failure snapshot and given the same immutable execution plan.
  // This catches hidden RNG offsets and state that merely passes a tick check.
  const control = new SimulationEngine(4, 4, 2);
  control.restoreCoreRecoveryState(before);
  control.setInfinityScaleExecutionPlan(engine.infinityScaleExecutionPlan);
  await control.step(0.016);

  const recoveredFrame = engine.captureCoreRecoveryState();
  const controlFrame = control.captureCoreRecoveryState();
  if (JSON.stringify(recoveredFrame) !== JSON.stringify(controlFrame)) {
    throw new Error("Post-rollback frame diverged from the clean control simulation");
  }
}
