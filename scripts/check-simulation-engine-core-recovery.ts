import assert from 'node:assert/strict';
import { AgentSystem } from '../src/simulation/AgentSystem.ts';
import { F } from '../src/core/CellState.ts';
import { PROC } from '../src/process/ProcessDef.ts';
import { SimulationEngine } from '../src/simulation/SimulationEngine.ts';
import type { ChemLayerSnapshot } from '../src/chemistry/ChemLayer.ts';

// Recovery entry points must invalidate outstanding GPU readbacks whenever
// they mutate core state. Invalid tick restores must fail before changing either
// the tick value or the generation token.
const mutatorGuardEngine = new SimulationEngine(4, 4, 2);
const engineInternals = mutatorGuardEngine as unknown as { _stateGeneration: number };
const assertGenerationAdvances = (label: string, mutate: () => void): void => {
  const beforeGeneration = engineInternals._stateGeneration;
  mutate();
  assert.ok(engineInternals._stateGeneration > beforeGeneration,
    `${label} must invalidate pending GPU readback`);
};
assertGenerationAdvances("restorePrevEnergy", () =>
  mutatorGuardEngine.restorePrevEnergy(mutatorGuardEngine.snapshotPrevEnergy()));
assertGenerationAdvances("resetPreviousEnergy", () => mutatorGuardEngine.resetPreviousEnergy());
assertGenerationAdvances("restoreChemistryState", () =>
  mutatorGuardEngine.restoreChemistryState(mutatorGuardEngine.snapshotChemistryState()));
assertGenerationAdvances("resetChemistryState", () => mutatorGuardEngine.resetChemistryState());
const beforeInvalidTickRestore = mutatorGuardEngine.captureCoreRecoveryState();
const generationBeforeInvalidTickRestore = engineInternals._stateGeneration;
for (const invalidTick of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_VALUE]) {
  assert.throws(() => mutatorGuardEngine.restoreTick(invalidTick), /restoreTick requires/);
}
assert.equal(engineInternals._stateGeneration, generationBeforeInvalidTickRestore,
  "invalid restoreTick arguments must not invalidate or mutate the engine");
assert.deepEqual(mutatorGuardEngine.captureCoreRecoveryState(), beforeInvalidTickRestore,
  "invalid restoreTick arguments must not poison the recoverable tick");

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

// Reject malformed LawEngine snapshots without partially changing live laws,
// overrides, process masks, graph selection, or the local PRNG stream.
const lawRestoreBaseline = engine.laws.snapshot();
const invalidLawRngSnapshot = engine.laws.snapshot();
invalidLawRngSnapshot.rngState = 0;
assert.throws(
  () => engine.laws.restore(invalidLawRngSnapshot),
  /Invalid LawEngine snapshot/,
  'LawEngine must reject an invalid PRNG state',
);
assert.deepEqual(engine.laws.snapshot(), lawRestoreBaseline,
  'rejected LawEngine RNG snapshot must not mutate live state');

const duplicateLawIdSnapshot = engine.laws.snapshot();
assert.ok(duplicateLawIdSnapshot.laws.length >= 2,
  'LawEngine snapshot fixture must contain multiple laws');
duplicateLawIdSnapshot.laws[1]!.id = duplicateLawIdSnapshot.laws[0]!.id;
assert.throws(
  () => engine.laws.restore(duplicateLawIdSnapshot),
  /Invalid LawEngine snapshot state/,
  'LawEngine must reject duplicate law identities',
);
assert.deepEqual(engine.laws.snapshot(), lawRestoreBaseline,
  'rejected duplicate-ID LawEngine snapshot must not partially mutate live state');


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

// A failed candidate restore followed by a failed rollback must preserve both
// root causes instead of replacing the candidate failure with only the rollback
// failure message. The grid is partially changed by the first apply, so verify
// the previous grid data is restored even though another domain's rollback fails.
const doubleRestoreFailureEngine = new SimulationEngine(4, 4, 2);
const doubleRestoreBaseline = doubleRestoreFailureEngine.captureCoreRecoveryState();
const doubleRestoreCandidate = doubleRestoreFailureEngine.captureCoreRecoveryState();
const doubleRestoreFieldIndex = doubleRestoreFailureEngine.grid.idx(1, 1, 1) + F.ENERGY;
doubleRestoreCandidate.grid.buffer[doubleRestoreFieldIndex] = 123;
doubleRestoreCandidate.tick = 9;
const failingEntityLayer = doubleRestoreFailureEngine.entityLayer as unknown as {
  restore: (...args: any[]) => void;
};
const originalEntityRestore = failingEntityLayer.restore;
let entityRestoreAttempt = 0;
failingEntityLayer.restore = function (...args: any[]) {
  entityRestoreAttempt++;
  if (entityRestoreAttempt === 1) throw new Error('injected candidate entity restore failure');
  if (entityRestoreAttempt === 2) throw new Error('injected rollback entity restore failure');
  return originalEntityRestore.apply(this, args);
};
let combinedRestoreError: unknown;
try {
  doubleRestoreFailureEngine.restoreCoreRecoveryState(doubleRestoreCandidate);
} catch (error) {
  combinedRestoreError = error;
} finally {
  failingEntityLayer.restore = originalEntityRestore;
}
assert.ok(combinedRestoreError instanceof AggregateError,
  'double restore failure must be exposed as AggregateError');
assert.match((combinedRestoreError as Error).message, /injected candidate entity restore failure/,
  'combined error must preserve the candidate apply failure');
assert.match((combinedRestoreError as Error).message, /injected rollback entity restore failure/,
  'combined error must preserve the rollback failure');
assert.equal((combinedRestoreError as AggregateError).errors.length, 2,
  'combined error must retain both original exception objects');
assert.equal(doubleRestoreFailureEngine.grid.buffer[doubleRestoreFieldIndex],
  doubleRestoreBaseline.grid.buffer[doubleRestoreFieldIndex],
  'rollback must restore grid state even when a later domain restore fails');

// Clearing a population is a deterministic reset boundary for its local RNG.
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

// syncTick must rotate the dense/back buffers before physics reads backBuffer.
// A direct front-buffer edit with a stale zero back buffer must not disappear.
const syncBufferEngine = new SimulationEngine(8, 8, 4);
const syncBufferEnergy = syncBufferEngine.grid.idx(3, 3, 2) + F.ENERGY;
syncBufferEngine.grid.buffer[syncBufferEnergy] = 100;
syncBufferEngine.grid.backBuffer[syncBufferEnergy] = 0;
if ((syncBufferEngine.laws.activeProcessMask & (1 << PROC.ENERGY_DIFFUSION)) === 0) {
  syncBufferEngine.laws.toggleProcess(PROC.ENERGY_DIFFUSION, true);
}
syncBufferEngine.syncTick(1);
assert.ok(syncBufferEngine.grid.buffer[syncBufferEnergy] > 0,
  "syncTick must read the direct front-buffer mutation after rotating buffers");
assert.equal(syncBufferEngine.grid.getCell(3, 3, 2)?.energy, syncBufferEngine.grid.buffer[syncBufferEnergy],
  "syncTick must publish the computed energy into the sparse chunk mirror");

// A successful synchronous CPU tick must also publish its final state to the
// device mirror; otherwise the next GPU frame can overwrite the CPU result.
const syncTickGpuEngine = new SimulationEngine(8, 8, 4);
(syncTickGpuEngine as unknown as { _gpuReady: boolean })._gpuReady = true;
const syncTickGpuUploads: Float32Array[] = [];
const syncTickGpuBackend = syncTickGpuEngine.gpu as unknown as {
  upload: (data: Float32Array) => void;
};
syncTickGpuBackend.upload = data => { syncTickGpuUploads.push(new Float32Array(data)); };
const syncTickGpuEnergy = syncTickGpuEngine.grid.idx(3, 3, 2) + F.ENERGY;
syncTickGpuEngine.grid.buffer[syncTickGpuEnergy] = 100;
syncTickGpuEngine.syncTick(1);
assert.equal(syncTickGpuUploads.length, 1,
  "syncTick must upload the committed CPU state once when GPU execution is enabled");
assert.deepEqual(syncTickGpuUploads[0], syncTickGpuEngine.grid.buffer,
  "the GPU mirror after syncTick must equal the authoritative CPU front buffer");

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
let asyncContinuationRan = false;
const asyncMutation = async () => {
  mutationBoundaryEngine.grid.buffer[mutationBoundaryIndex] = 888;
  await Promise.resolve();
  asyncContinuationRan = true;
  mutationBoundaryEngine.grid.buffer[mutationBoundaryIndex] = 999;
};
assert.throws(
  () => mutationBoundaryEngine.mutateAuthoritativeState(asyncMutation),
  /must remain synchronous/,
);
await Promise.resolve();
assert.equal(asyncContinuationRan, false,
  "an async callback must be rejected before invocation so its continuation cannot mutate after rollback");
assert.deepEqual(
  mutationBoundaryEngine.captureCoreRecoveryState(),
  committedExternalMutation,
  "an async callback must leave the authoritative state unchanged");

assert.throws(
  () => mutationBoundaryEngine.mutateAuthoritativeState(
    () => Promise.resolve("thenable result must be rejected"),
  ),
  /must remain synchronous/,
);
assert.deepEqual(
  mutationBoundaryEngine.captureCoreRecoveryState(),
  committedExternalMutation,
  "a synchronous callback returning a Promise must roll back its synchronous prefix",
);

// Legacy publication paths (sculpt undo/redo, older edit adapters) must update
// the chunk mirror, the back-buffer baseline, and GPU state as one sync boundary.
const legacySyncEngine = new SimulationEngine(8, 8, 4);
(legacySyncEngine as unknown as { _gpuReady: boolean })._gpuReady = true;
const legacySyncGpu = legacySyncEngine.gpu as unknown as {
  upload: (data: Float32Array) => void;
};
legacySyncGpu.upload = () => undefined;
const legacySyncIndex = legacySyncEngine.grid.idx(2, 2, 1) + F.ENERGY;
legacySyncEngine.grid.buffer[legacySyncIndex] = 23;
legacySyncEngine.syncToGPU();
assert.equal(legacySyncEngine.grid.backBuffer[legacySyncIndex], 23,
  "legacy syncToGPU must align dense back-buffer state after direct writes");
assert.equal(legacySyncEngine.grid.getCell(2, 2, 1)?.energy, 23,
  "legacy syncToGPU must publish direct writes to the sparse chunk mirror");

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

// A failed asynchronous readback may occur after submitCompute advanced the
// device-side buffer. It must resynchronize from CPU state and leave the step queue usable.
const rejectedReadbackEngine = new SimulationEngine(8, 8, 4);
(rejectedReadbackEngine as unknown as { _gpuReady: boolean })._gpuReady = true;
const rejectedReadbackGpu = rejectedReadbackEngine.gpu as unknown as {
  writeParams: (...args: unknown[]) => void;
  submitCompute: (nSteps: number) => void;
  readback: () => Promise<Float32Array>;
  upload: (data: Float32Array) => void;
};
rejectedReadbackGpu.writeParams = () => undefined;
rejectedReadbackGpu.submitCompute = () => undefined;
let rejectedReadbackUploadCount = 0;
rejectedReadbackGpu.upload = () => { rejectedReadbackUploadCount++; };
rejectedReadbackGpu.readback = async () => { throw new Error("injected GPU readback failure"); };
const beforeRejectedReadback = rejectedReadbackEngine.captureCoreRecoveryState();
await assert.rejects(rejectedReadbackEngine.step(0.016), /injected GPU readback failure/);
assert.deepEqual(rejectedReadbackEngine.captureCoreRecoveryState(), beforeRejectedReadback,
  "failed readback must preserve the authoritative CPU state and tick");
assert.equal(rejectedReadbackUploadCount, 1,
  "failed readback must re-upload the authoritative CPU grid to the device");
rejectedReadbackGpu.readback = async () => new Float32Array(rejectedReadbackEngine.grid.buffer);
await rejectedReadbackEngine.step(0.016);
assert.equal(rejectedReadbackEngine.tick, 1,
  "GPU step queue must remain usable after readback rejection");

// If recovery upload itself fails, stop trusting the device and fall back to CPU.
const failedResyncEngine = new SimulationEngine(8, 8, 4);
(failedResyncEngine as unknown as { _gpuReady: boolean })._gpuReady = true;
const failedResyncGpu = failedResyncEngine.gpu as unknown as {
  writeParams: (...args: any[]) => void;
  submitCompute: (nSteps: number) => void;
  readback: () => Promise<Float32Array>;
  upload: (data: Float32Array) => void;
};
failedResyncGpu.writeParams = () => undefined;
failedResyncGpu.submitCompute = () => undefined;
failedResyncGpu.readback = async () => { throw new Error("injected readback failure before resync"); };
failedResyncGpu.upload = () => { throw new Error("injected persistent GPU upload failure"); };
await assert.rejects(failedResyncEngine.step(0.016), error =>
  error instanceof AggregateError &&
  error.message.includes("GPU resynchronization failed") &&
  error.errors.some((nested: unknown) => nested instanceof Error && nested.message.includes("injected readback failure")) &&
  error.errors.some((nested: unknown) => nested instanceof Error && nested.message.includes("persistent GPU upload failure")),
  "failed GPU recovery must preserve both the original error and the resync error");
assert.equal(failedResyncEngine.gpuActive, false,
  "failed GPU resynchronization must disable the untrusted device path");
await failedResyncEngine.step(0.016);
assert.equal(failedResyncEngine.tick, 1,
  "the simulation must continue on CPU after GPU resynchronization failure");

// Empty/truncated GPU readback must fail closed instead of silently advancing
// the simulation without a valid device result, and must keep CPU state intact.
const malformedReadbackEngine = new SimulationEngine(8, 8, 4);
(malformedReadbackEngine as unknown as { _gpuReady: boolean })._gpuReady = true;
const malformedReadbackGpu = malformedReadbackEngine.gpu as unknown as {
  writeParams: (...args: unknown[]) => void;
  submitCompute: (nSteps: number) => void;
  readback: () => Promise<Float32Array>;
  upload: (data: Float32Array) => void;
};
malformedReadbackGpu.writeParams = () => undefined;
malformedReadbackGpu.submitCompute = () => undefined;
let malformedPayload = new Float32Array(0);
let malformedReadbackUploadCount = 0;
malformedReadbackGpu.readback = async () => new Float32Array(malformedPayload);
malformedReadbackGpu.upload = () => { malformedReadbackUploadCount++; };
const beforeMalformedReadback = malformedReadbackEngine.captureCoreRecoveryState();
await assert.rejects(malformedReadbackEngine.step(0.016), /Invalid GPU readback: expected .* floats, received 0/);
assert.deepEqual(malformedReadbackEngine.captureCoreRecoveryState(), beforeMalformedReadback,
  "empty GPU readback must not mutate grid or advance simulation tick");
malformedPayload = new Float32Array(malformedReadbackEngine.grid.buffer.length - 1);
await assert.rejects(malformedReadbackEngine.step(0.016), /Invalid GPU readback: expected .* floats, received/);
assert.deepEqual(malformedReadbackEngine.captureCoreRecoveryState(), beforeMalformedReadback,
  "truncated GPU readback must not partially overwrite the authoritative grid");
assert.equal(malformedReadbackUploadCount, 2,
  "malformed GPU readback must attempt device resynchronization from the authoritative CPU grid");
malformedPayload = new Float32Array(malformedReadbackEngine.grid.buffer);
await malformedReadbackEngine.step(0.016);
assert.equal(malformedReadbackEngine.tick, 1,
  "GPU step queue must remain usable after malformed readback rejection");

// GPU batching dispatches N field substeps and must advance every CPU-only
// subsystem N times too, using the one-step dt. The ordering is still operator
// split (GPU field integration precedes CPU layers), which is documented above.
const gpuBatchEngine = new SimulationEngine(4, 4, 2);
(gpuBatchEngine as unknown as { _gpuReady: boolean })._gpuReady = true;
const gpuBatchBackend = gpuBatchEngine.gpu as unknown as {
  writeParams: (...args: unknown[]) => void;
  submitCompute: (nSteps: number) => void;
  readback: () => Promise<Float32Array>;
  upload: (data: Float32Array) => void;
};
let gpuBatchDispatchSteps = 0;
gpuBatchBackend.writeParams = () => undefined;
gpuBatchBackend.submitCompute = nSteps => { gpuBatchDispatchSteps += nSteps; };
gpuBatchBackend.readback = async () => new Float32Array(gpuBatchEngine.grid.buffer);
gpuBatchBackend.upload = () => undefined;
const gpuBatchCounts = { chemistry: 0, entity: 0, temporal: 0, info: 0, agents: 0 };
const gpuBatchInternals = gpuBatchEngine as unknown as {
  chemLayer: { tick: (...args: any[]) => void };
  temporalLayer: { tick: (...args: any[]) => void };
  infoPhysics: { tick: (...args: any[]) => void };
};
const originalBatchChemistry = gpuBatchInternals.chemLayer.tick;
const originalBatchEntity = gpuBatchEngine.entityLayer.tick;
const originalBatchTemporal = gpuBatchInternals.temporalLayer.tick;
const originalBatchInfo = gpuBatchInternals.infoPhysics.tick;
const originalBatchAgents = gpuBatchEngine.agents.tick;
gpuBatchInternals.chemLayer.tick = () => { gpuBatchCounts.chemistry++; };
gpuBatchEngine.entityLayer.tick = () => { gpuBatchCounts.entity++; };
gpuBatchInternals.temporalLayer.tick = () => { gpuBatchCounts.temporal++; };
gpuBatchInternals.infoPhysics.tick = () => { gpuBatchCounts.info++; };
gpuBatchEngine.agents.tick = () => { gpuBatchCounts.agents++; };
try {
  await gpuBatchEngine.step(0.016, 3);
} finally {
  gpuBatchInternals.chemLayer.tick = originalBatchChemistry;
  gpuBatchEngine.entityLayer.tick = originalBatchEntity;
  gpuBatchInternals.temporalLayer.tick = originalBatchTemporal;
  gpuBatchInternals.infoPhysics.tick = originalBatchInfo;
  gpuBatchEngine.agents.tick = originalBatchAgents;
}
assert.equal(gpuBatchDispatchSteps, 3, "GPU field solver must receive all requested substeps");
assert.deepEqual(gpuBatchCounts, { chemistry: 3, entity: 3, temporal: 3, info: 3, agents: 3 },
  "each CPU-only subsystem must advance once per logical GPU substep");
assert.equal(gpuBatchEngine.tick, 3, "batched GPU step must advance logical tick by nSteps");

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

const boundaryGpuEngine = new SimulationEngine(8, 8, 4);
(boundaryGpuEngine as unknown as { _gpuReady: boolean })._gpuReady = true;
const boundaryGpuMock = boundaryGpuEngine.gpu as unknown as {
  writeParams: (...args: unknown[]) => void;
  submitCompute: (nSteps: number) => void;
  readback: () => Promise<Float32Array>;
  upload: (data: Float32Array) => void;
};
boundaryGpuMock.writeParams = () => undefined;
boundaryGpuMock.submitCompute = () => undefined;
boundaryGpuMock.upload = () => undefined;
const boundaryEnergyIndex = boundaryGpuEngine.grid.idx(2, 2, 1) + F.ENERGY;
let signalBoundaryReadbackStarted: (() => void) | undefined;
let finishBoundaryReadback: ((data: Float32Array) => void) | undefined;
const boundaryReadbackStarted = new Promise<void>(resolve => {
  signalBoundaryReadbackStarted = resolve;
});
boundaryGpuMock.readback = () => new Promise<Float32Array>(resolve => {
  finishBoundaryReadback = resolve;
  signalBoundaryReadbackStarted?.();
});
const boundaryFrame = boundaryGpuEngine.step(0.016);
await boundaryReadbackStarted;
let boundaryCaptureExecuted = false;
const queuedSnapshot = boundaryGpuEngine.runAtStepBoundary(() => {
  boundaryCaptureExecuted = true;
  return {
    tick: boundaryGpuEngine.tick,
    energy: boundaryGpuEngine.grid.buffer[boundaryEnergyIndex],
  };
});
await Promise.resolve();
assert.equal(boundaryCaptureExecuted, false,
  'snapshot capture must wait while a GPU frame is awaiting readback');

const boundaryReadbackData = new Float32Array(boundaryGpuEngine.grid.buffer);
boundaryReadbackData[boundaryEnergyIndex] = 314;
if (!finishBoundaryReadback) throw new Error('Boundary GPU readback resolver was not installed');
finishBoundaryReadback(boundaryReadbackData);
await boundaryFrame;
const capturedBoundaryState = await queuedSnapshot;
assert.equal(capturedBoundaryState.tick, 1,
  'snapshot capture must run after the queued GPU frame increments tick');
assert.equal(capturedBoundaryState.tick, boundaryGpuEngine.tick,
  'snapshot tick must match the settled engine tick');
assert.equal(capturedBoundaryState.energy, boundaryGpuEngine.grid.buffer[boundaryEnergyIndex],
  'snapshot fields must match the settled authoritative CPU state');

async function assertPostEventChunkConsistency(useGpu: boolean): Promise<void> {
  const consistencyEngine = new SimulationEngine(8, 8, 4);
  const eventFieldIndex = consistencyEngine.grid.idx(2, 2, 1) + F.ENERGY;
  if (useGpu) {
    (consistencyEngine as unknown as { _gpuReady: boolean })._gpuReady = true;
    const backend = consistencyEngine.gpu as unknown as {
      writeParams: (...args: unknown[]) => void;
      submitCompute: (nSteps: number) => void;
      readback: () => Promise<Float32Array>;
      upload: (data: Float32Array) => void;
    };
    backend.writeParams = () => undefined;
    backend.submitCompute = () => undefined;
    backend.readback = async () => new Float32Array(consistencyEngine.grid.buffer);
    backend.upload = () => undefined;
  }
  const events = consistencyEngine.worldEvents as unknown as {
    autoTick: (grid: unknown, tick: number) => unknown;
  };
  const originalAutoTick = events.autoTick;
  events.autoTick = grid => {
    (grid as { cell: (x: number, y: number, z: number) => { energy: number } })
      .cell(2, 2, 1).energy = 321;
    return null;
  };
  try {
    await consistencyEngine.step(0.016);
  } finally {
    events.autoTick = originalAutoTick;
  }
  assert.equal(consistencyEngine.grid.buffer[eventFieldIndex], 321,
    `${useGpu ? 'GPU' : 'CPU'} frame must keep the event's dense field mutation`);
  assert.equal(consistencyEngine.grid.getCell(2, 2, 1)?.energy, 321,
    `${useGpu ? 'GPU' : 'CPU'} frame must publish event mutations to sparse chunks before resolving`);
}
await assertPostEventChunkConsistency(false);
await assertPostEventChunkConsistency(true);



// Rollback wrappers must preserve both exception objects, not only their messages.
function assertRollbackAggregate(
  error: unknown,
  primary: Error,
  rollback: Error,
  context: string,
): void {
  assert.ok(error instanceof AggregateError, `${context} must expose AggregateError`);
  assert.equal(error.errors.length, 2, `${context} must preserve exactly both failure causes`);
  assert.equal(error.errors[0], primary, `${context} must preserve the original failure object`);
  assert.equal(error.errors[1], rollback, `${context} must preserve the rollback failure object`);
  assert.match(error.message, /rollback failed/, `${context} must identify rollback failure`);
}

// CPU async frame: both the original frame cause and failed rollback remain inspectable.
{
  const engine = new SimulationEngine(4, 4, 2);
  const primary = new Error("injected CPU frame cause");
  const rollback = new Error("injected CPU frame rollback cause");
  const events = engine.worldEvents as unknown as { autoTick: (...args: unknown[]) => void };
  const originalAutoTick = events.autoTick;
  const originalRestore = engine.restoreCoreRecoveryState.bind(engine);
  events.autoTick = () => { throw primary; };
  (engine as unknown as { restoreCoreRecoveryState: (snapshot: any) => void })
    .restoreCoreRecoveryState = () => { throw rollback; };
  try {
    let observed: unknown;
    try { await engine.step(0.016); } catch (error) { observed = error; }
    assertRollbackAggregate(observed, primary, rollback, "CPU frame rollback");
  } finally {
    events.autoTick = originalAutoTick;
    (engine as unknown as { restoreCoreRecoveryState: (snapshot: any) => void })
      .restoreCoreRecoveryState = originalRestore;
  }
}

// Explicit authoritative mutation: structured causes survive a failed rollback.
{
  const engine = new SimulationEngine(4, 4, 2);
  const primary = new Error("injected authoritative mutation cause");
  const rollback = new Error("injected authoritative mutation rollback cause");
  const originalRestore = engine.restoreCoreRecoveryState.bind(engine);
  (engine as unknown as { restoreCoreRecoveryState: (snapshot: any) => void })
    .restoreCoreRecoveryState = () => { throw rollback; };
  try {
    let observed: unknown;
    try { engine.mutateAuthoritativeState(() => { throw primary; }); }
    catch (error) { observed = error; }
    assertRollbackAggregate(observed, primary, rollback, "authoritative mutation rollback");
  } finally {
    (engine as unknown as { restoreCoreRecoveryState: (snapshot: any) => void })
      .restoreCoreRecoveryState = originalRestore;
  }
}

// Synchronous script tick: both lower-layer and rollback errors remain inspectable.
{
  const engine = new SimulationEngine(4, 4, 2);
  const primary = new Error("injected syncTick cause");
  const rollback = new Error("injected syncTick rollback cause");
  const internals = engine as unknown as {
    chemLayer: { tick: (...args: any[]) => void };
    restoreCoreRecoveryState: (snapshot: any) => void;
  };
  const originalChemTick = internals.chemLayer.tick;
  const originalRestore = engine.restoreCoreRecoveryState.bind(engine);
  internals.chemLayer.tick = () => { throw primary; };
  internals.restoreCoreRecoveryState = () => { throw rollback; };
  try {
    let observed: unknown;
    try { engine.syncTick(1); } catch (error) { observed = error; }
    assertRollbackAggregate(observed, primary, rollback, "syncTick rollback");
  } finally {
    internals.chemLayer.tick = originalChemTick;
    internals.restoreCoreRecoveryState = originalRestore;
  }
}



// GPU initialization is not considered active until device and material uploads both succeed.
{
  const engine = new SimulationEngine(4, 4, 2);
  const initialUploadFailure = new Error("injected initial material upload failure");
  const backend = engine.gpu as unknown as {
    init: (...args: unknown[]) => Promise<boolean>;
    upload: (data: Float32Array) => void;
    uploadMaterials: (data: Float32Array) => void;
  };
  backend.init = async () => true;
  backend.upload = () => undefined;
  backend.uploadMaterials = () => { throw initialUploadFailure; };
  await assert.rejects(engine.initGPU(), error => error === initialUploadFailure);
  assert.equal(engine.gpuActive, false,
    "GPU must remain disabled when any initial device publication fails");
}

// If a runtime upload fails after CPU edits, keep CPU state authoritative and disable GPU fallback.
{
  const engine = new SimulationEngine(4, 4, 2);
  (engine as unknown as { _gpuReady: boolean })._gpuReady = true;
  const uploadFailure = new Error("injected syncToGPU upload failure");
  const backend = engine.gpu as unknown as {
    upload: (data: Float32Array) => void;
  };
  backend.upload = () => { throw uploadFailure; };
  const energyIndex = engine.grid.idx(2, 2, 1) + F.ENERGY;
  engine.grid.buffer[energyIndex] = 47;
  const originalWarn = console.warn;
  let warningArgs: unknown[] = [];
  console.warn = (...args: unknown[]) => { warningArgs = args; };
  try {
    assert.doesNotThrow(() => engine.syncToGPU(),
      "GPU upload failure should fall back instead of aborting the caller's frame");
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warningArgs.includes(uploadFailure),
    "GPU fallback warning must preserve the upload failure for diagnostics");
  assert.equal(engine.gpuActive, false,
    "syncToGPU must disable a device whose authoritative upload failed");
  assert.equal(engine.grid.buffer[energyIndex], 47,
    "failed GPU publication must not discard the authoritative CPU edit");
  assert.equal(engine.grid.backBuffer[energyIndex], 47,
    "syncToGPU must complete CPU buffer alignment before attempting the failing upload");
  assert.equal(engine.grid.getCell(2, 2, 1)?.energy, 47,
    "failed GPU publication must still leave the CPU dense/chunk state published");
  await engine.step(0.016);
  assert.equal(engine.tick, 1,
    "simulation must continue on the CPU after syncToGPU disables an untrusted device");
}

console.log('SimulationEngine core recovery and deterministic LawEngine replay: PASS');
