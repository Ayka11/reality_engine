import { InfinityScaleAdaptiveLODTransactionBridge } from "./InfinityScaleAdaptiveLODTransactionBridge";
import { assertInfinityScaleGlobalFramePlan, beginInfinityScaleGlobalFrame, advanceInfinityScaleGlobalFrame } from "./InfinityScaleGlobalExecutionFrame";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import { InfinityScaleExecutionAdapter } from "./InfinityScaleExecutionAdapter";

export function runInfinityScaleAdaptiveLODTransactionBridgeRegression(): void {
  // The adapter is advisory until the production solver actually consumes its work set.
  const defaultExecutionPlan = new InfinityScaleExecutionAdapter().getPlan();
  if (defaultExecutionPlan.mode !== "advisory") {
    throw new Error("Unwired Infinity Scale runtime must default to advisory execution mode");
  }
  if (defaultExecutionPlan.selectiveCpuReady) {
    throw new Error("Unwired Infinity Scale runtime must not claim selective CPU readiness");
  }
  if (defaultExecutionPlan.entityExecutionReady) {
    throw new Error("Entity reconciliation must remain not-ready until wired to runtime transactions");
  }
  if (defaultExecutionPlan.agentMigrationReady) {
    throw new Error("Agent migration must remain not-ready until wired to the authoritative runtime transaction");
  }
  const plan: InfinityScaleExecutionPlan = {
    revision: 0, mode: "selective-cpu-ready", observer: { x: 0, y: 0, z: 0 },
    chunks: [], simulationBudget: 0, requestedSimulationCount: 0, selectedSimulationCount: 0,
    maxSimulatingChunks: 0, boundaryReadChunks: [], boundaryReadCount: 0, boundaryReadRelations: [],
    simulationCellCount: 0, boundaryReadCellCount: 0, localExecutionLayers: [], globalExecutionLayers: [],
    selectiveCpuReady: true, selectiveGpuReady: false, gpuPhysicsReady: false,
    lodBoundaryTransferReady: false, mixedLodExecutionReady: false, entityExecutionReady: false, agentMigrationReady: false,
  };
  const state = new InfinityScaleLODState(2);
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
  const retryState = new InfinityScaleLODState(2);
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

  // Invalid same-LOD commands must not become successful no-op commits.
  // Reject before state mutation and release the bridge transaction for retry.
  const invalidNoopState = new InfinityScaleLODState(2);
  const invalidNoopBridge = new InfinityScaleAdaptiveLODTransactionBridge(plan, invalidNoopState);
  invalidNoopBridge.begin(frame);
  const invalidNoopRevision = invalidNoopState.getRevision();
  let invalidNoopRejected = false;
  try {
    invalidNoopBridge.commit(frame, [{ regionId: "0:0,0,0", fromLOD: -1, toLOD: -1 }]);
  } catch (error) {
    invalidNoopRejected = error instanceof Error && error.message.includes("range 0..30");
  }
  if (!invalidNoopRejected) throw new Error("Adaptive LOD bridge accepted an invalid same-level no-op");
  if (invalidNoopState.getRevision() !== invalidNoopRevision || invalidNoopState.hasChunk("0:0,0,0")) {
    throw new Error("Invalid no-op command mutated authoritative LOD state");
  }
  invalidNoopBridge.begin(frame);
  if (!invalidNoopBridge.commit(frame, []).committed) {
    throw new Error("Adaptive LOD bridge could not be reused after invalid no-op rejection");
  }

  const duplicateNoopState = new InfinityScaleLODState(2);
  const duplicateNoopBridge = new InfinityScaleAdaptiveLODTransactionBridge(plan, duplicateNoopState);
  duplicateNoopBridge.begin(frame);
  const duplicateNoopRevision = duplicateNoopState.getRevision();
  let duplicateNoopRejected = false;
  try {
    duplicateNoopBridge.commit(frame, [
      { regionId: "0:0,0,0", fromLOD: 0, toLOD: 0 },
      { regionId: "0:0,0,0", fromLOD: 0, toLOD: 0 },
    ]);
  } catch (error) {
    duplicateNoopRejected = error instanceof Error && error.message.includes("duplicate region ID");
  }
  if (!duplicateNoopRejected) throw new Error("Adaptive LOD bridge accepted duplicate no-op region IDs");
  if (duplicateNoopState.getRevision() !== duplicateNoopRevision || duplicateNoopState.hasChunk("0:0,0,0")) {
    throw new Error("Duplicate no-op region request mutated authoritative LOD state");
  }
  duplicateNoopBridge.begin(frame);
  if (!duplicateNoopBridge.commit(frame, []).committed) {
    throw new Error("Adaptive LOD bridge could not be reused after duplicate region rejection");
  }

  // A stale-revision rejection must also detach the failed transaction and
  // allow a new transaction to start from the current state revision.
  const staleRetryState = new InfinityScaleLODState(2);
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
  const malformedState = new InfinityScaleLODState(2);
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
  const duplicateBeginState = new InfinityScaleLODState(2);
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
  const externalWriteState = new InfinityScaleLODState(2);
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

  const directBufferState = new InfinityScaleLODState(2);
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
  // valueOf() must not reveal the backing typed array, whose buffer would
  // bypass the proxy's revision tracking and rollback-conflict protection.
  const valueOfChunk = directBufferState.getChunk("0:0,0,0");
  if (!valueOfChunk) throw new Error("Expected chunk for valueOf escape regression");
  const valueOfRevision = directBufferState.getRevision();
  const valueOfResult = valueOfChunk.cells.valueOf();
  valueOfResult[0] = 89;
  if (directBufferState.getRevision() <= valueOfRevision) {
    throw new Error("Typed-array valueOf() bypassed LOD state revision tracking");
  }
  const afterValueOfWrite = directBufferState.readBaseCell("0:0,0,0", 0, 0, 0, 0);
  if (!afterValueOfWrite || afterValueOfWrite[0] !== 89) {
    throw new Error("valueOf() result was not routed through guarded chunk access");
  }

  // Callback methods must not leak the raw receiver through their third
  // argument, and must preserve the caller-provided thisArg.
  const callbackChunk = directBufferState.getChunk("0:0,0,0");
  if (!callbackChunk) throw new Error("Expected chunk for callback-buffer regression");
  let callbackBuffer: ArrayBufferLike | undefined;
  let callbackThisPreserved = false;
  const callbackContext = { marker: 123 };
  callbackChunk.cells.forEach(function (this: typeof callbackContext, _value, _index, callbackCells) {
    callbackThisPreserved = this.marker === 123;
    callbackBuffer = callbackCells.buffer;
  }, callbackContext);
  if (!callbackThisPreserved) throw new Error("Typed-array callback wrapper did not preserve thisArg");
  if (!callbackBuffer) throw new Error("Typed-array callback did not provide a guarded receiver");
  new Float32Array(callbackBuffer)[0] = 999;
  const afterCallbackBufferWrite = directBufferState.readBaseCell("0:0,0,0", 0, 0, 0, 0);
  if (!afterCallbackBufferWrite || afterCallbackBufferWrite[0] !== 89) {
    throw new Error("Typed-array callback leaked mutable authoritative buffer");
  }

  // Common typed-array mutators and descriptor-based writes must invalidate
  // an active transaction just like direct numeric-index assignment.
  for (const mutation of [
    {
      label: "set()",
      apply: (cells: Float32Array) => cells.set([51], 0),
      expected: 51,
    },
    {
      label: "fill()",
      apply: (cells: Float32Array) => cells.fill(52, 0, 1),
      expected: 52,
    },
    {
      label: "copyWithin()",
      apply: (cells: Float32Array) => {
        cells[1] = 53;
        cells.copyWithin(0, 1, 2);
      },
      expected: 53,
    },
    {
      label: "Object.defineProperty()",
      apply: (cells: Float32Array) => {
        Object.defineProperty(cells, "0", {
          value: 54,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      },
      expected: 54,
    },
  ]) {
    const mutationState = new InfinityScaleLODState(2);
    mutationState.ensureChunk("0:0,0,0", 0);
    const mutationBridge = new InfinityScaleAdaptiveLODTransactionBridge(plan, mutationState);
    mutationBridge.begin(frame);
    const revisionBeforeMutation = mutationState.getRevision();
    const mutationChunk = mutationState.getChunk("0:0,0,0");
    if (!mutationChunk) throw new Error(`Expected public chunk for ${mutation.label} regression`);
    mutation.apply(mutationChunk.cells);
    if (mutationState.getRevision() <= revisionBeforeMutation) {
      throw new Error(`${mutation.label} bypassed LOD state revision tracking`);
    }
    let mutationConflictRejected = false;
    try {
      mutationBridge.commit(frame, []);
    } catch (error) {
      mutationConflictRejected = error instanceof Error && error.message.includes("revision");
    }
    if (!mutationConflictRejected) {
      throw new Error(`LOD transaction accepted a ${mutation.label} write after begin`);
    }
    const mutationValue = mutationState.readBaseCell("0:0,0,0", 0, 0, 0, 0);
    if (!mutationValue || mutationValue[0] !== mutation.expected) {
      throw new Error(`Rollback overwrote the newer ${mutation.label} value`);
    }
  }

  // Inject a failure after the bridge enters commit. The authoritative cell
  // buffer must be restored byte-for-byte and the bridge must remain reusable.
  const failureState = new InfinityScaleLODState(2);
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
    const injectedCell = failureState.readBaseCell("0:0,0,0", 0, 0, 0, 0);
    if (!injectedCell) throw new Error("Failure-injection fixture lost its seeded chunk");
    injectedCell[0] = 999;
    injectedCell[1] = 123;
    failureState.writeBaseCellForTransaction(
      failingTransaction.stateRevision,
      "0:0,0,0",
      0,
      0,
      0,
      0,
      injectedCell,
    );
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


  // A plan can be replaced after begin(); commit must fail closed even for an
  // empty mutation set and must leave the authoritative LOD state untouched.
  const guardedState = new InfinityScaleLODState(2);
  const guardedPlan: InfinityScaleExecutionPlan = {
    ...plan,
    chunks: plan.chunks.map(chunk => ({ ...chunk })),
    boundaryReadChunks: [...plan.boundaryReadChunks],
    boundaryReadRelations: plan.boundaryReadRelations.map(relation => ({ ...relation })),
  };
  const guardedBridge = new InfinityScaleAdaptiveLODTransactionBridge(guardedPlan, guardedState);
  const guardedRevision = guardedState.getRevision();
  const guardedKeys = guardedState.keys().join("|");

  guardedBridge.begin(frame);
  guardedPlan.revision += 1;
  let changedPlanRejected = false;
  try {
    guardedBridge.commit(frame, []);
  } catch (error) {
    changedPlanRejected = error instanceof Error && error.message.includes("plan revision changed");
  }
  if (!changedPlanRejected) {
    throw new Error("Adaptive LOD bridge accepted a changed execution-plan revision");
  }
  if (guardedState.getRevision() !== guardedRevision || guardedState.keys().join("|") !== guardedKeys) {
    throw new Error("Stale execution-plan rejection mutated authoritative LOD state");
  }

  // Matching revision numbers are not enough: ownership geometry is part of
  // the captured frame contract and must also remain unchanged until commit.
  guardedPlan.revision = plan.revision;
  guardedBridge.begin(frame);
  guardedPlan.boundaryReadChunks.push("0:4,0,0");
  let changedOwnershipRejected = false;
  try {
    guardedBridge.commit(frame, []);
  } catch (error) {
    changedOwnershipRejected = error instanceof Error && error.message.includes("ownership geometry changed");
  }
  if (!changedOwnershipRejected) {
    throw new Error("Adaptive LOD bridge accepted changed execution-plan ownership geometry");
  }
  if (guardedState.getRevision() !== guardedRevision || guardedState.keys().join("|") !== guardedKeys) {
    throw new Error("Stale ownership rejection mutated authoritative LOD state");
  }

  // Both fail-closed paths must detach the rejected transaction and permit reuse.
  guardedPlan.boundaryReadChunks.pop();
  guardedBridge.begin(frame);
  const planGuardRetry = guardedBridge.commit(frame, []);
  if (!planGuardRetry.committed) {
    throw new Error("Adaptive LOD bridge could not be reused after stale-plan rejection");
  }


  // A geometry mutation with the same plan revision and chunk key must still
  // invalidate the frame when LOD/AMR ownership changes.
  const geometryPlan: InfinityScaleExecutionPlan = {
    ...plan,
    chunks: [{ key: "0:0,0,0", lod: 0, amr: 1, distance: 0 }],
    simulationCellCount: 8,
  };
  const geometryFrame0 = beginInfinityScaleGlobalFrame(geometryPlan, 0, 1);
  const geometryFrame1 = advanceInfinityScaleGlobalFrame(geometryFrame0, "local-execution");
  const geometryFrame2 = advanceInfinityScaleGlobalFrame(geometryFrame1, "local-commit");
  const geometryFrame = advanceInfinityScaleGlobalFrame(geometryFrame2, "boundary-reconciliation");
  const geometryState = new InfinityScaleLODState(2);
  const geometryStateRevision = geometryState.getRevision();
  const geometryBridge = new InfinityScaleAdaptiveLODTransactionBridge(geometryPlan, geometryState);

  geometryBridge.begin(geometryFrame);
  geometryPlan.chunks[0].lod = 1;
  geometryPlan.chunks[0].amr = 2;
  let changedLODRejected = false;
  try {
    geometryBridge.commit(geometryFrame, []);
  } catch (error) {
    changedLODRejected = error instanceof Error && error.message.includes("ownership geometry changed");
  }
  if (!changedLODRejected) {
    throw new Error("Adaptive LOD bridge accepted changed chunk LOD/AMR under the same plan revision");
  }
  if (geometryState.getRevision() !== geometryStateRevision || geometryState.keys().length !== 0) {
    throw new Error("Stale chunk LOD/AMR rejection mutated authoritative LOD state");
  }

  geometryPlan.chunks[0].lod = 0;
  geometryPlan.chunks[0].amr = 1;
  geometryBridge.begin(geometryFrame);
  if (!geometryBridge.commit(geometryFrame, []).committed) {
    throw new Error("Adaptive LOD bridge could not be reused after changed LOD/AMR rejection");
  }


  // Scheduling inputs are part of the captured plan too. Distances and
  // budgets can change the selected work set without changing revision or keys.
  const schedulingPlan: InfinityScaleExecutionPlan = {
    ...geometryPlan,
    chunks: geometryPlan.chunks.map(chunk => ({ ...chunk })),
    observer: { ...geometryPlan.observer },
    boundaryReadChunks: [...geometryPlan.boundaryReadChunks],
    boundaryReadRelations: geometryPlan.boundaryReadRelations.map(relation => ({ ...relation })),
    localExecutionLayers: [...geometryPlan.localExecutionLayers],
    globalExecutionLayers: [...geometryPlan.globalExecutionLayers],
  };
  const schedulingFrame0 = beginInfinityScaleGlobalFrame(schedulingPlan, 0, 1);
  const schedulingFrame1 = advanceInfinityScaleGlobalFrame(schedulingFrame0, "local-execution");
  const schedulingFrame2 = advanceInfinityScaleGlobalFrame(schedulingFrame1, "local-commit");
  const schedulingFrame = advanceInfinityScaleGlobalFrame(schedulingFrame2, "boundary-reconciliation");
  const schedulingState = new InfinityScaleLODState(2);
  const schedulingStateRevision = schedulingState.getRevision();
  const schedulingBridge = new InfinityScaleAdaptiveLODTransactionBridge(schedulingPlan, schedulingState);

  schedulingBridge.begin(schedulingFrame);
  const originalDistance = schedulingPlan.chunks[0].distance;
  schedulingPlan.chunks[0].distance = originalDistance + 1;
  let assertChangedDistanceRejected = false;
  try {
    assertInfinityScaleGlobalFramePlan(schedulingFrame, schedulingPlan);
  } catch (error) {
    assertChangedDistanceRejected = error instanceof Error && error.message.includes("ownership changed");
  }
  if (!assertChangedDistanceRejected) {
    throw new Error("Frame-plan assertion accepted changed chunk distance without a context");
  }
  let changedDistanceRejected = false;
  try {
    schedulingBridge.commit(schedulingFrame, []);
  } catch (error) {
    changedDistanceRejected = error instanceof Error && error.message.includes("ownership geometry changed");
  }
  if (!changedDistanceRejected) {
    throw new Error("Adaptive LOD bridge accepted changed chunk distance under the same plan revision");
  }
  if (schedulingState.getRevision() !== schedulingStateRevision || schedulingState.keys().length !== 0) {
    throw new Error("Stale scheduling-distance rejection mutated authoritative LOD state");
  }

  schedulingPlan.chunks[0].distance = originalDistance;
  schedulingBridge.begin(schedulingFrame);
  const originalBudget = schedulingPlan.simulationBudget;
  schedulingPlan.simulationBudget = originalBudget + 1;
  let changedBudgetRejected = false;
  try {
    schedulingBridge.commit(schedulingFrame, []);
  } catch (error) {
    changedBudgetRejected = error instanceof Error && error.message.includes("ownership geometry changed");
  }
  if (!changedBudgetRejected) {
    throw new Error("Adaptive LOD bridge accepted changed simulation budget under the same plan revision");
  }
  if (schedulingState.getRevision() !== schedulingStateRevision || schedulingState.keys().length !== 0) {
    throw new Error("Stale scheduling-budget rejection mutated authoritative LOD state");
  }

  schedulingPlan.simulationBudget = originalBudget;
  schedulingBridge.begin(schedulingFrame);
  if (!schedulingBridge.commit(schedulingFrame, []).committed) {
    throw new Error("Adaptive LOD bridge could not be reused after scheduling-plan rejection");
  }


  // Runtime capability flags are part of the frame contract too. A plan may
  // keep the same revision while its readiness claim changes; commit must reject.
  const capabilityPlan: InfinityScaleExecutionPlan = { ...plan };
  const capabilityFrame0 = beginInfinityScaleGlobalFrame(capabilityPlan, 0, 1);
  const capabilityFrame1 = advanceInfinityScaleGlobalFrame(capabilityFrame0, "local-execution");
  const capabilityFrame2 = advanceInfinityScaleGlobalFrame(capabilityFrame1, "local-commit");
  const capabilityFrame = advanceInfinityScaleGlobalFrame(capabilityFrame2, "boundary-reconciliation");
  const capabilityState = new InfinityScaleLODState(2);
  const capabilityStateRevision = capabilityState.getRevision();
  const capabilityBridge = new InfinityScaleAdaptiveLODTransactionBridge(capabilityPlan, capabilityState);

  capabilityBridge.begin(capabilityFrame);
  capabilityPlan.selectiveGpuReady = !capabilityPlan.selectiveGpuReady;
  let assertChangedCapabilityRejected = false;
  try {
    assertInfinityScaleGlobalFramePlan(capabilityFrame, capabilityPlan);
  } catch (error) {
    assertChangedCapabilityRejected = error instanceof Error && error.message.includes("capabilities changed");
  }
  if (!assertChangedCapabilityRejected) {
    throw new Error("Frame-plan assertion accepted changed capabilities without a context");
  }
  let changedCapabilityRejected = false;
  try {
    capabilityBridge.commit(capabilityFrame, []);
  } catch (error) {
    changedCapabilityRejected = error instanceof Error && error.message.includes("execution capabilities changed");
  }
  if (!changedCapabilityRejected) {
    throw new Error("Adaptive LOD bridge accepted changed plan capabilities under the same revision");
  }
  if (capabilityState.getRevision() !== capabilityStateRevision || capabilityState.keys().length !== 0) {
    throw new Error("Stale capability rejection mutated authoritative LOD state");
  }

  capabilityPlan.selectiveGpuReady = !capabilityPlan.selectiveGpuReady;
  capabilityBridge.begin(capabilityFrame);
  if (!capabilityBridge.commit(capabilityFrame, []).committed) {
    throw new Error("Adaptive LOD bridge could not be reused after capability rejection");
  }

}
