import {
  beginInfinityScaleGlobalLODTransaction,
  commitInfinityScaleGlobalLODTransaction,
} from "./InfinityScaleGlobalLODTransaction";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import type { InfinityScaleGlobalExecutionFrame } from "./InfinityScaleGlobalExecutionFrame";

const plan: InfinityScaleExecutionPlan = {
  revision: 1,
  mode: "selective-cpu-ready",
  observer: [0, 0, 0],
  chunks: [{ key: "0:0,0,0", lod: 0, distance: 0 }],
  simulationBudget: 64,
  requestedSimulationCount: 1,
  selectedSimulationCount: 1,
  maxSimulatingChunks: 1,
  boundaryReadChunks: [],
  boundaryReadCount: 0,
  boundaryReadRelations: [],
  simulationCellCount: 64,
  boundaryReadCellCount: 0,
  localExecutionLayers: 1,
  globalExecutionLayers: 1,
  selectiveCpuReady: true,
  selectiveGpuReady: false,
  gpuPhysicsReady: false,
  lodBoundaryTransferReady: false,
  mixedLodExecutionReady: true,
  entityExecutionReady: true,
  agentMigrationReady: true,
};

function makeFrame(revision: number): InfinityScaleGlobalExecutionFrame {
  return {
    revision,
    tickStart: revision - 1,
    tickEnd: revision,
    phase: "boundary-reconciliation",
    planRevision: 1,
    simulationCellCount: 64,
    boundaryReadCellCount: 0,
    committed: false,
    finalized: false,
    ownershipFingerprint: "multi-frame",
    capabilityFingerprint: "multi-frame",
  };
}

export function runInfinityScaleLODMultiFrameRegression(): void {
  const state = new InfinityScaleLODState(4);
  const key = "0:0,0,0";
  state.ensureChunk(key, 0);

  const first = beginInfinityScaleGlobalLODTransaction(makeFrame(1), plan, state);
  first.synchronization.stageTransfer(
    {
      sourceChunk: key,
      targetChunk: key,
      relation: "same-level",
      sourceLevel: 0,
      targetLevel: 0,
      refinementRatio: 1,
      operation: "copy",
      readOperation: "copy",
    },
    [0, 0, 0],
    [new Float32Array(24)],
  );
  const firstResult = commitInfinityScaleGlobalLODTransaction(first, makeFrame(1));

  if (state.getRevision() !== 1 || firstResult.revision !== 1) {
    throw new Error("Expected first committed LOD frame to advance state revision to 1");
  }

  const stale = beginInfinityScaleGlobalLODTransaction(makeFrame(2), plan, state);
  const second = beginInfinityScaleGlobalLODTransaction(makeFrame(2), plan, state);

  second.synchronization.stageTransfer(
    {
      sourceChunk: key,
      targetChunk: key,
      relation: "same-level",
      sourceLevel: 0,
      targetLevel: 0,
      refinementRatio: 1,
      operation: "copy",
      readOperation: "copy",
    },
    [1, 0, 0],
    [new Float32Array(24)],
  );
  commitInfinityScaleGlobalLODTransaction(second, makeFrame(2));

  let staleRejected = false;
  try {
    commitInfinityScaleGlobalLODTransaction(stale, makeFrame(2));
  } catch (error) {
    staleRejected = error instanceof Error &&
      error.message.includes("revision");
  }

  if (!staleRejected) {
    throw new Error("Expected stale multi-frame LOD transaction to be rejected");
  }

  if (state.getRevision() !== 2) {
    throw new Error(`Expected second frame commit to advance revision to 2, received ${state.getRevision()}`);
  }

  const persisted = state.readBaseCell(key, 0, 1, 0, 0);
  if (!persisted || persisted.length !== 24) {
    throw new Error("Expected hierarchical LOD state to persist across committed frames");
  }
}
