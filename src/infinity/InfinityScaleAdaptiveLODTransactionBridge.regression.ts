import { InfinityScaleAdaptiveLODTransactionBridge } from "./InfinityScaleAdaptiveLODTransactionBridge";
import { beginInfinityScaleGlobalFrame, advanceInfinityScaleGlobalFrame } from "./InfinityScaleGlobalExecutionFrame";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";

export function runInfinityScaleAdaptiveLODTransactionBridgeRegression(): void {
  const plan: InfinityScaleExecutionPlan = {
    revision: 0, mode: "selective-cpu-ready", observer: { x: 0, y: 0, z: 0 },
    chunks: [], simulationBudget: 0, requestedSimulationCount: 0, selectedSimulationCount: 0,
    maxSimulatingChunks: 0, boundaryReadChunks: [], boundaryReadCount: 0, boundaryReadRelations: [],
    simulationCellCount: 0, boundaryReadCellCount: 0, localExecutionLayers: [], globalExecutionLayers: [],
    selectiveCpuReady: true, selectiveGpuReady: false, gpuPhysicsReady: false,
    lodBoundaryTransferReady: false, mixedLodExecutionReady: false, entityExecutionReady: false, agentMigrationReady: false,
  };
  const state = new InfinityScaleLODState();
  const frame0 = beginInfinityScaleGlobalFrame(plan, 0, 1);
  const frame1 = advanceInfinityScaleGlobalFrame(frame0, "local-execution");
  const frame2 = advanceInfinityScaleGlobalFrame(frame1, "local-commit");
  const frame = advanceInfinityScaleGlobalFrame(frame2, "boundary-reconciliation");

  const initialStateRevision = state.getRevision();
  const bridge = new InfinityScaleAdaptiveLODTransactionBridge(plan, state);
  bridge.begin(frame);
  let topologyRejected = false;
  try {
    bridge.commit(frame, [{ regionId: "0:0,0,0", fromLOD: 0, toLOD: 1 }]);
  } catch (error) {
    topologyRejected = error instanceof Error && error.message.includes("physical chunk remapping");
  }
  if (!topologyRejected) throw new Error("Adaptive LOD topology mutation was not fail-closed");
  if (state.getRevision() !== initialStateRevision) throw new Error("Rejected topology mutation changed state revision");
  if (state.hasChunk("0:0,0,0")) throw new Error("Rejected topology mutation created a placeholder chunk");

  const blocked = new InfinityScaleAdaptiveLODTransactionBridge(plan, state);
  blocked.begin(frame);
  let staleRejected = false;
  state.beginRevision();
  try {
    blocked.commit(frame, [{ regionId: "0:0,0,0", fromLOD: 1, toLOD: 2 }]);
  } catch {
    staleRejected = true;
  }
  if (!staleRejected) throw new Error("Stale LOD transaction was not rejected");

  // A rejected commit in the wrong frame phase must clear the active
  // transaction so the bridge can be reused for a valid boundary commit.
  const retryState = new InfinityScaleLODState();
  const retryBridge = new InfinityScaleAdaptiveLODTransactionBridge(plan, retryState);
  retryBridge.begin(frame2);
  let phaseRejected = false;
  try {
    retryBridge.commit(frame2, [{ regionId: "0:0,0,0", fromLOD: 0, toLOD: 1 }]);
  } catch (error) {
    phaseRejected = error instanceof Error && error.message.includes("phase");
  }
  if (!phaseRejected) throw new Error("Wrong-phase LOD commit was not rejected");
  if (retryState.hasChunk("0:0,0,0")) throw new Error("Wrong-phase LOD commit leaked a staged chunk");

  retryBridge.begin(frame);
  const retried = retryBridge.commit(frame, []);
  if (!retried.committed) throw new Error("LOD bridge could not commit after wrong-phase rejection");

  // A stale-revision rejection must also detach the failed transaction and
  // allow a new transaction to start from the current state revision.
  const staleRetryState = new InfinityScaleLODState();
  const staleRetryBridge = new InfinityScaleAdaptiveLODTransactionBridge(plan, staleRetryState);
  staleRetryBridge.begin(frame);
  staleRetryState.beginRevision();
  let retryStaleRejected = false;
  try {
    staleRetryBridge.commit(frame, [{ regionId: "0:0,0,0", fromLOD: 0, toLOD: 1 }]);
  } catch (error) {
    retryStaleRejected = error instanceof Error && error.message.includes("revision");
  }
  if (!retryStaleRejected) throw new Error("Stale-revision LOD commit was not rejected");
  if (staleRetryState.hasChunk("0:0,0,0")) throw new Error("Stale LOD commit leaked a staged chunk");

  staleRetryBridge.begin(frame);
  const staleRetried = staleRetryBridge.commit(frame, []);
  if (!staleRetried.committed) throw new Error("LOD bridge could not commit after stale-revision rejection");

  // Runtime callers can violate TypeScript's array contract; this must still
  // reject through finally and leave the bridge reusable.
  const malformedState = new InfinityScaleLODState();
  const malformedBridge = new InfinityScaleAdaptiveLODTransactionBridge(plan, malformedState);
  malformedBridge.begin(frame);
  let malformedRejected = false;
  try {
    malformedBridge.commit(frame, undefined as never);
  } catch (error) {
    malformedRejected = error instanceof Error && error.message.includes("arrays");
  }
  if (!malformedRejected) throw new Error("Malformed adaptive LOD input was not rejected");
  malformedBridge.begin(frame);
  const malformedRetried = malformedBridge.commit(frame, []);
  if (!malformedRetried.committed) throw new Error("LOD bridge could not commit after malformed-input rejection");

  // A duplicate begin must reject without replacing the already active
  // transaction; the original transaction must still be able to commit.
  const duplicateBeginState = new InfinityScaleLODState();
  const duplicateBeginBridge = new InfinityScaleAdaptiveLODTransactionBridge(plan, duplicateBeginState);
  duplicateBeginBridge.begin(frame);
  let duplicateBeginRejected = false;
  try {
    duplicateBeginBridge.begin(frame);
  } catch (error) {
    duplicateBeginRejected = error instanceof Error && error.message.includes("already begun");
  }
  if (!duplicateBeginRejected) throw new Error("Duplicate adaptive LOD begin was not rejected");
  const originalTransactionCommitted = duplicateBeginBridge.commit(frame, [
  ]);
  if (!originalTransactionCommitted.committed) {
    throw new Error("Duplicate begin replaced or invalidated the original adaptive LOD transaction");
  }

  // An out-of-transaction write to an existing chunk must invalidate the
  // captured revision. The failed transaction must not restore its old snapshot
  // over that newer authoritative write.
  const externalWriteState = new InfinityScaleLODState();
  externalWriteState.ensureChunk("0:0,0,0", 0);
  const externalWriteBridge = new InfinityScaleAdaptiveLODTransactionBridge(plan, externalWriteState);
  externalWriteBridge.begin(frame);
  const revisionAtBegin = externalWriteState.getRevision();
  const externalCell = new Float32Array(24);
  externalCell[0] = 41;
  externalWriteState.writeBaseCell("0:0,0,0", 0, 0, 0, 0, externalCell);
  if (externalWriteState.getRevision() <= revisionAtBegin) {
    throw new Error("External LOD cell write did not invalidate the captured transaction revision");
  }
  let externalConflictRejected = false;
  try {
    externalWriteBridge.commit(frame, []);
  } catch (error) {
    externalConflictRejected = error instanceof Error && error.message.includes("revision");
  }
  if (!externalConflictRejected) {
    throw new Error("LOD transaction accepted an external write after its rollback snapshot");
  }
  const externalCellAfterRollback = externalWriteState.readBaseCell("0:0,0,0", 0, 0, 0, 0);
  if (!externalCellAfterRollback || externalCellAfterRollback[0] !== 41) {
    throw new Error("Failed LOD transaction overwrote a newer external cell write");
  }
  const externalWriteRetry = externalWriteBridge.begin(frame);
  const externalWriteRecovery = externalWriteBridge.commit(frame, []);
  if (!externalWriteRecovery.committed) {
    throw new Error("LOD bridge could not be reused after an external-write conflict");
  }
  void externalWriteRetry;

  const directBufferState = new InfinityScaleLODState();
  directBufferState.ensureChunk("0:0,0,0", 0);
  const directBufferBridge = new InfinityScaleAdaptiveLODTransactionBridge(plan, directBufferState);
  directBufferBridge.begin(frame);
  const directBufferRevision = directBufferState.getRevision();
  const publicChunk = directBufferState.getChunk("0:0,0,0");
  if (!publicChunk) throw new Error("Expected public chunk handle for direct-buffer regression");
  publicChunk.cells[0] = 43;
  if (directBufferState.getRevision() <= directBufferRevision) {
    throw new Error("Direct cells[index] write bypassed LOD state revision tracking");
  }
  let directBufferConflictRejected = false;
  try {
    directBufferBridge.commit(frame, []);
  } catch (error) {
    directBufferConflictRejected = error instanceof Error && error.message.includes("revision");
  }
  if (!directBufferConflictRejected) {
    throw new Error("LOD transaction accepted a direct mutable-buffer write after begin");
  }
  const directBufferValue = directBufferState.readBaseCell("0:0,0,0", 0, 0, 0, 0);
  if (!directBufferValue || directBufferValue[0] !== 43) {
    throw new Error("Direct buffer conflict rollback overwrote the newer cell value");
  }

  const escapedBufferChunk = directBufferState.getChunk("0:0,0,0");
  if (!escapedBufferChunk) throw new Error("Expected chunk for escaped-buffer regression");
  const escapedBuffer = escapedBufferChunk.cells.buffer;
  new Float32Array(escapedBuffer)[0] = 77;
  const afterEscapedBufferWrite = directBufferState.readBaseCell("0:0,0,0", 0, 0, 0, 0);
  if (!afterEscapedBufferWrite || afterEscapedBufferWrite[0] !== 43) {
    throw new Error("Public chunk buffer exposed authoritative mutable memory");
  }
  const escapedSubarray = escapedBufferChunk.cells.subarray(0, 1);
  escapedSubarray[0] = 88;
  const afterEscapedSubarrayWrite = directBufferState.readBaseCell("0:0,0,0", 0, 0, 0, 0);
  if (!afterEscapedSubarrayWrite || afterEscapedSubarrayWrite[0] !== 43) {
    throw new Error("Public chunk subarray exposed authoritative mutable memory");
  }

  // Inject a failure after the bridge enters commit. The authoritative cell
  // buffer must be restored byte-for-byte and the bridge must remain reusable.
  const failureState = new InfinityScaleLODState();
  const seededChunk = failureState.ensureChunk("0:0,0,0", 0);
  seededChunk.cells[0] = 17;
  seededChunk.cells[1] = -3.5;
  const beforeFailureKeys = failureState.keys().sort().join("|");
  const beforeFailureCells = new Float32Array(seededChunk.cells);
  const failureBridge = new InfinityScaleAdaptiveLODTransactionBridge(plan, failureState);
  const failingTransaction = failureBridge.begin(frame);
  const synchronization = failingTransaction.synchronization;
  const originalCommit = synchronization.commit.bind(synchronization);
  synchronization.commit = (() => {
    // Simulate a partial write inside the commit boundary before an exception.
    const liveChunk = failureState.getChunk("0:0,0,0");
    if (!liveChunk) throw new Error("Failure-injection fixture lost its seeded chunk");
    liveChunk.cells[0] = 999;
    liveChunk.cells[1] = 123;
    throw new Error("Injected post-mutation synchronization failure");
  }) as typeof synchronization.commit;

  let injectedFailureObserved = false;
  try {
    failureBridge.commit(frame, []);
  } catch (error) {
    injectedFailureObserved = error instanceof Error && error.message.includes("Injected post-mutation");
  } finally {
    synchronization.commit = originalCommit;
  }
  if (!injectedFailureObserved) throw new Error("Post-mutation synchronization failure was not propagated");
  const restoredChunk = failureState.getChunk("0:0,0,0");
  if (!restoredChunk) throw new Error("Rollback removed a pre-existing chunk");
  if (failureState.keys().sort().join("|") !== beforeFailureKeys) {
    throw new Error("Post-mutation rollback changed the chunk topology");
  }
  if (restoredChunk.level !== 0 || restoredChunk.scale !== 1) {
    throw new Error("Post-mutation rollback changed chunk metadata");
  }
  if (restoredChunk.cells.length !== beforeFailureCells.length) {
    throw new Error("Post-mutation rollback changed cell buffer length");
  }
  for (let i = 0; i < beforeFailureCells.length; i++) {
    if (!Object.is(restoredChunk.cells[i], beforeFailureCells[i])) {
      throw new Error("Post-mutation rollback did not restore cell field at offset " + i);
    }
  }
  if (failureState.getRevision() <= failingTransaction.stateRevision) {
    throw new Error("Post-mutation rollback did not invalidate the failed transaction revision");
  }
  const failureRetried = failureBridge.begin(frame);
  const recovery = failureBridge.commit(frame, []);
  if (!recovery.committed) throw new Error("LOD bridge could not be reused after post-mutation rollback");
  void failureRetried;

}
