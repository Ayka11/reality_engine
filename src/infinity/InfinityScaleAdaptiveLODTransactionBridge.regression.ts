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
  const result = bridge.commit(frame, [{ regionId: "0:0,0,0", fromLOD: 0, toLOD: 1 }]);

  if (!result.committed) throw new Error("Adaptive LOD transaction did not commit");
  if (result.stateRevisionAfter !== initialStateRevision + 2) {
    throw new Error("LOD state revision did not account for chunk creation and transaction commit");
  }
  if (!state.hasChunk("0:0,0,0")) throw new Error("Committed adaptive chunk is missing");

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
  const retried = retryBridge.commit(frame, [{ regionId: "0:0,0,0", fromLOD: 0, toLOD: 1 }]);
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
  const staleRetried = staleRetryBridge.commit(frame, [{ regionId: "0:0,0,0", fromLOD: 0, toLOD: 1 }]);
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
  const malformedRetried = malformedBridge.commit(frame, [{ regionId: "0:0,0,0", fromLOD: 0, toLOD: 1 }]);
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
    { regionId: "0:0,0,0", fromLOD: 0, toLOD: 1 },
  ]);
  if (!originalTransactionCommitted.committed) {
    throw new Error("Duplicate begin replaced or invalidated the original adaptive LOD transaction");
  }
}
