import assert from 'node:assert/strict';
import { AgentSystem } from '../src/simulation/AgentSystem.ts';
import { F } from '../src/core/CellState.ts';
import { SimulationEngine } from '../src/simulation/SimulationEngine.ts';
import type { ChemLayerSnapshot } from '../src/chemistry/ChemLayer.ts';

const engine = new SimulationEngine(16, 16, 8);
const chemistry = (engine as unknown as { chemLayer: { restore(snapshot: ChemLayerSnapshot, cellCount?: number): void; snapshot(): ChemLayerSnapshot } }).chemLayer;
chemistry.restore({ pendingDensityTransfers: [[17, -0.125], [31, 0.25]] }, engine.grid.size);
const fieldIndex = engine.grid.idx(7, 7, 3) + F.ENERGY;
engine.grid.buffer[fieldIndex] = 125;
engine.grid.backBuffer[fieldIndex] = 87;
engine.grid.syncDenseToChunks();
engine.agents.seed(engine.grid, 1);
const initialAgent = engine.agents.getAgents()[0];
assert.ok(initialAgent, 'seeded recovery fixture must create an agent');
const agentId = initialAgent.id;
initialAgent.energy = 210;
engine.grid.syncDenseToChunks();
engine.restoreTick(12);
engine.laws.setLawOverride('law_radiation', 'on');
engine.laws.toggleProcess(27, false);
engine.recorder.startRecording();
engine.causal.log(12, 1, 1, 1, 21, 'energy_spike', 45);
engine.worldEvents.trigger(engine.grid, 'meteor_strike', 12);
engine.grid.syncDenseToChunks();

// The local law RNG and generated IDs must replay from an identical snapshot.
const lawSnapshot = engine.laws.snapshot();
const firstMutation = engine.laws.spawnMutation('law_radiation');
assert.ok(firstMutation);
engine.laws.restore(lawSnapshot);
const replayedMutation = engine.laws.spawnMutation('law_radiation');
assert.deepEqual(replayedMutation, firstMutation, 'LawEngine RNG and mutation state must replay deterministically');

const before = engine.captureCoreRecoveryState();
const expectedLawMask = engine.laws.activeProcessMask;
engine.grid.buffer[fieldIndex] = -10;
engine.grid.backBuffer[fieldIndex] = -20;
engine.agents.getAgents()[0]!.energy = 1;
engine.agents.seed(engine.grid, 1);
engine.restoreTick(99);
engine.laws.setLawOverride('law_radiation', 'off');
engine.laws.toggleProcess(27, true);
engine.recorder.stopRecording();
engine.causal.clear();
engine.worldEvents.trigger(engine.grid, 'meteor_strike', 99);
chemistry.restore({ pendingDensityTransfers: [[9, 0.75]] }, engine.grid.size);

engine.restoreCoreRecoveryState(before);
assert.deepEqual(engine.captureCoreRecoveryState(), before, 'core recovery must restore all included subsystem state');
assert.deepEqual(chemistry.snapshot(), before.chemistry, 'core recovery must restore deferred chemistry boundary transfers');
assert.equal(engine.tick, 12);
assert.equal(engine.grid.buffer[fieldIndex], 125);
assert.equal(engine.grid.backBuffer[fieldIndex], 87);
assert.equal(engine.laws.getLawOverride('law_radiation'), 'on');
assert.equal(engine.laws.activeProcessMask, expectedLawMask);
assert.equal(engine.recorder.recording, true);
assert.equal(engine.causal.recent(1)[0]?.tick, 12);
assert.equal(engine.agents.getAgents().length, 1);
assert.equal(engine.agents.getAgents()[0]?.id, agentId);
assert.equal(engine.agents.getAgents()[0]?.energy, 210);

// Returned snapshots are detached from live mutable data.
const detached = engine.captureCoreRecoveryState();
detached.grid.buffer[fieldIndex] = -999;
detached.prevEnergy.fill(-1);
detached.laws.laws[0]!.name = 'mutated snapshot only';
assert.equal(engine.grid.buffer[fieldIndex], 125);
assert.notEqual(engine.laws.laws[0]?.name, 'mutated snapshot only');

// Invalid nested state must be rejected without leaving a partial restore behind.
const invalid = engine.captureCoreRecoveryState();
invalid.grid.width += 1;
const beforeInvalidRestore = engine.captureCoreRecoveryState();
assert.throws(() => engine.restoreCoreRecoveryState(invalid), /Invalid SparseVoxelGrid snapshot/);
assert.deepEqual(engine.captureCoreRecoveryState(), beforeInvalidRestore,
  'failed restore must roll back grid, entities, agents, laws, events, causal graph and recorder');
// Clearing a population is a deterministic reset boundary for its local RNG.
const resetSeed = 0x12345678;
const advancedRngState = 0x76543210;
const resetAgents = new AgentSystem(resetSeed);
resetAgents.seed(engine.grid, 2);
const populatedAgentSnapshot = resetAgents.snapshot();
assert.equal(populatedAgentSnapshot.agents.length, 2);
resetAgents.restore({ ...populatedAgentSnapshot, rngState: advancedRngState });
resetAgents.clear();
const clearedAgents = resetAgents.snapshot();
assert.equal(clearedAgents.rngState, resetSeed, 'AgentSystem.clear must rewind its local RNG to the constructor seed');
assert.equal(clearedAgents.nextAgentId, 1, 'AgentSystem.clear must reset the identity allocator');
assert.equal(clearedAgents.agents.length, 0, 'AgentSystem.clear must remove all agents');

// A failed synchronous script tick must restore every engine-owned mutable
// domain after an inner subsystem has already changed CPU state.
const syncRollbackEngine = new SimulationEngine(8, 8, 4);
const syncRollbackEnergy = syncRollbackEngine.grid.idx(2, 2, 1) + F.ENERGY;
syncRollbackEngine.grid.buffer[syncRollbackEnergy] = 400;
syncRollbackEngine.grid.buffer[syncRollbackEngine.grid.idx(3, 2, 1) + F.ENERGY] = 3;
syncRollbackEngine.grid.syncDenseToChunks();
const beforeSyncTickFailure = syncRollbackEngine.captureCoreRecoveryState();
const syncRollbackChemistry = (syncRollbackEngine as unknown as {
  chemLayer: { tick: (...args: any[]) => void };
}).chemLayer;
const originalSyncRollbackChemistryTick = syncRollbackChemistry.tick;
syncRollbackChemistry.tick = function (...args: any[]) {
  originalSyncRollbackChemistryTick.apply(syncRollbackChemistry, args);
  throw new Error("injected synchronous tick chemistry failure");
};
try {
  assert.throws(
    () => syncRollbackEngine.syncTick(1),
    /injected synchronous tick chemistry failure/,
  );
} finally {
  syncRollbackChemistry.tick = originalSyncRollbackChemistryTick;
}
assert.deepEqual(
  syncRollbackEngine.captureCoreRecoveryState(),
  beforeSyncTickFailure,
  "failed syncTick must roll back changes from earlier physics layers and chemistry",
);
syncRollbackEngine.syncTick(1);
assert.equal(syncRollbackEngine.tick, 1, "syncTick must remain usable after rollback");

// External edits should invalidate pending work, publish dense/chunk state in
// one synchronous boundary, and roll back every covered domain on exceptions.
const mutationBoundaryEngine = new SimulationEngine(8, 8, 4);
const mutationBoundaryIndex = mutationBoundaryEngine.grid.idx(2, 2, 1) + F.ENERGY;
mutationBoundaryEngine.grid.buffer[mutationBoundaryIndex] = 11;
mutationBoundaryEngine.grid.syncDenseToChunks();
const beforeExternalMutationFailure = mutationBoundaryEngine.captureCoreRecoveryState();
assert.throws(() => mutationBoundaryEngine.mutateAuthoritativeState(() => {
  mutationBoundaryEngine.grid.buffer[mutationBoundaryIndex] = 777;
  mutationBoundaryEngine.agents.seed(mutationBoundaryEngine.grid, 1);
  mutationBoundaryEngine.laws.toggleProcess(15, true);
  throw new Error("injected external mutation failure");
}), /injected external mutation failure/);
assert.deepEqual(
  mutationBoundaryEngine.captureCoreRecoveryState(),
  beforeExternalMutationFailure,
  "failed authoritative mutation must restore grid, chunk metadata, agents/RNG and laws",
);

mutationBoundaryEngine.mutateAuthoritativeState(() => {
  mutationBoundaryEngine.grid.buffer[mutationBoundaryIndex] = 72;
});
assert.equal(mutationBoundaryEngine.grid.buffer[mutationBoundaryIndex], 72);
assert.equal(
  mutationBoundaryEngine.grid.getCell(2, 2, 1)?.energy,
  72,
  "successful mutation must publish dense changes to the chunk mirror",
);
const committedExternalMutation = mutationBoundaryEngine.captureCoreRecoveryState();
assert.throws(
  () => mutationBoundaryEngine.mutateAuthoritativeState(
    () => Promise.resolve("async mutation must be rejected"),
  ),
  /must remain synchronous/,
);
assert.deepEqual(
  mutationBoundaryEngine.captureCoreRecoveryState(),
  committedExternalMutation,
  "an async callback must be rejected and its synchronous prefix rolled back",
);

// A zero-step sync remains an explicit mutation boundary for public typed-array
// writes: invalidate an in-flight GPU result and preserve the newer CPU state.
const staleGpuEngine = new SimulationEngine(8, 8, 4);
(staleGpuEngine as unknown as { _gpuReady: boolean })._gpuReady = true;
const staleGpuMock = staleGpuEngine.gpu as unknown as {
  writeParams: (...args: unknown[]) => void;
  submitCompute: (nSteps: number) => void;
  readback: () => Promise<Float32Array>;
  upload: (data: Float32Array) => void;
};
staleGpuMock.writeParams = () => undefined;
staleGpuMock.submitCompute = () => undefined;
staleGpuMock.upload = () => undefined;
const staleEnergyIndex = staleGpuEngine.grid.idx(2, 2, 1) + F.ENERGY;
const staleGpuReadback = new Float32Array(staleGpuEngine.grid.buffer);
staleGpuReadback[staleEnergyIndex] = 7;
let signalReadbackStarted: (() => void) | undefined;
let finishStaleReadback: (data: Float32Array) => void = () => {
  throw new Error("stale readback was not requested");
};
const staleReadbackStarted = new Promise<void>(resolve => {
  signalReadbackStarted = resolve;
});
staleGpuMock.readback = () => {
  signalReadbackStarted?.();
  return new Promise<Float32Array>(resolve => {
    finishStaleReadback = resolve;
  });
};
const staleStep = staleGpuEngine.step(0.016);
await staleReadbackStarted;
staleGpuEngine.grid.buffer[staleEnergyIndex] = 42;
staleGpuEngine.syncTick(0);
const authoritativeAfterSync = staleGpuEngine.captureCoreRecoveryState();
finishStaleReadback(staleGpuReadback);
await assert.rejects(staleStep, /Discarded stale GPU readback/);
assert.deepEqual(
  staleGpuEngine.captureCoreRecoveryState(),
  authoritativeAfterSync,
  "stale GPU readback must not overwrite direct grid changes synchronized through syncTick(0)",
);
assert.equal(staleGpuEngine.tick, 0, "stale GPU readback must not advance the authoritative tick");
staleGpuMock.readback = async () => new Float32Array(staleGpuEngine.grid.buffer);
await staleGpuEngine.step(0.016);
assert.equal(staleGpuEngine.tick, 1, "GPU queue must remain usable after rejecting stale readback");

// Exercise the GPU readback commit path with a deterministic test double. The
// injected failure occurs after readback is applied and causality updates, so
// the frame must restore its local pre-commit snapshot without discarding any
// external state (there is none in this controlled case).
const gpuEngine = new SimulationEngine(8, 8, 4);
const gpuState = gpuEngine as unknown as { _gpuReady: boolean };
gpuState._gpuReady = true;
const gpuMock = gpuEngine.gpu as unknown as {
  writeParams: (...args: unknown[]) => void;
  submitCompute: (nSteps: number) => void;
  readback: () => Promise<Float32Array>;
  upload: (data: Float32Array) => void;
};
gpuMock.writeParams = () => undefined;
gpuMock.submitCompute = () => undefined;
gpuMock.upload = () => undefined;
const gpuEnergyIndex = gpuEngine.grid.idx(2, 2, 1) + F.ENERGY;
gpuEngine.grid.buffer[gpuEnergyIndex] = 14;
gpuEngine.grid.syncDenseToChunks();
const gpuReadback = new Float32Array(gpuEngine.grid.buffer);
gpuReadback[gpuEnergyIndex] = 999;
gpuMock.readback = async () => new Float32Array(gpuReadback);

const eventsDouble = gpuEngine.worldEvents as unknown as {
  autoTick: (...args: unknown[]) => void;
};
const originalAutoTick = eventsDouble.autoTick;
const beforeGpuCommit = gpuEngine.captureCoreRecoveryState();
eventsDouble.autoTick = () => {
  throw new Error("injected post-readback GPU-frame failure");
};
await assert.rejects(
  gpuEngine.step(0.016),
  /injected post-readback GPU-frame failure/,
);
eventsDouble.autoTick = originalAutoTick;
assert.deepEqual(
  gpuEngine.captureCoreRecoveryState(),
  beforeGpuCommit,
  "failed GPU CPU-commit must restore the state captured after validating the readback revision",
);
await gpuEngine.step(0.016);
assert.equal(gpuEngine.tick, 1, "GPU step queue must remain usable after a rolled-back commit");

console.log('SimulationEngine core recovery and deterministic LawEngine replay: PASS');
