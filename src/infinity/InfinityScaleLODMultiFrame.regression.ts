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
  observer: { x: 0, y: 0, z: 0 },
  chunks: [{ key: "0:0,0,0", lod: 0, amr: 1, distance: 0 }],
  simulationBudget: 64,
  requestedSimulationCount: 1,
  selectedSimulationCount: 1,
  maxSimulatingChunks: 1,
  boundaryReadChunks: ["0:1,0,0"],
  boundaryReadCount: 1,
  boundaryReadRelations: [{
    sourceChunk: "0:1,0,0",
    targetChunk: "0:0,0,0",
    relation: "same-level",
  }],
  simulationCellCount: 64,
  boundaryReadCellCount: 64,
  localExecutionLayers: [],
  globalExecutionLayers: [],
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
    boundaryReadCellCount: 64,
    committed: false,
    finalized: false,
    ownershipFingerprint: "multi-frame",
    capabilityFingerprint: "multi-frame",
  };
}

export function runInfinityScaleLODMultiFrameRegression(): void {
  const state = new InfinityScaleLODState(4);
  const key = "0:0,0,0";
  const targetKey = "0:1,0,0";
  state.ensureChunk(key, 0);
  state.ensureChunk(targetKey, 0);
  const initialRevision = state.getRevision();

  const first = beginInfinityScaleGlobalLODTransaction(makeFrame(1), plan, state);
  first.synchronization.stageTransfer(
    {
      sourceChunk: targetKey,
      targetChunk: key,
      relation: "same-level",
      sourceLevel: 0,
      targetLevel: 0,
      refinementRatio: 1,
      operation: "copy",
      readOperation: "copy",
    },
    [3, 0, 0],
    [new Float32Array(24)],
  );
  const firstResult = commitInfinityScaleGlobalLODTransaction(first, makeFrame(1));

  const expectedFirstRevision = initialRevision + 1;
  if (state.getRevision() !== expectedFirstRevision || firstResult.revision !== expectedFirstRevision) {
    throw new Error(
      `Expected first committed LOD frame revision ${expectedFirstRevision}, received state=${state.getRevision()} result=${firstResult.revision}`,
    );
  }

  const stale = beginInfinityScaleGlobalLODTransaction(makeFrame(2), plan, state);
  const second = beginInfinityScaleGlobalLODTransaction(makeFrame(2), plan, state);

  second.synchronization.stageTransfer(
    {
      sourceChunk: targetKey,
      targetChunk: key,
      relation: "same-level",
      sourceLevel: 0,
      targetLevel: 0,
      refinementRatio: 1,
      operation: "copy",
      readOperation: "copy",
    },
    [3, 1, 0],
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

  const expectedSecondRevision = expectedFirstRevision + 1;
  if (state.getRevision() !== expectedSecondRevision) {
    throw new Error(
      `Expected second frame commit revision ${expectedSecondRevision}, received ${state.getRevision()}`,
    );
  }

  const persisted = state.readBaseCell(key, 0, 3, 1, 0);
  if (!persisted || persisted.length !== 24) {
    throw new Error("Expected hierarchical LOD state to persist across committed frames");
  }
}
