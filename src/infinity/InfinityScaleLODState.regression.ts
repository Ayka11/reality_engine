import {
  beginInfinityScaleGlobalLODTransaction,
  commitInfinityScaleGlobalLODTransaction,
} from "./InfinityScaleGlobalLODTransaction";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import type { InfinityScaleGlobalExecutionFrame } from "./InfinityScaleGlobalExecutionFrame";

function plan(): InfinityScaleExecutionPlan {
  return {
    revision: 1,
    mode: "selective-cpu-ready",
    observer: { x: 0, y: 0, z: 0 },
    chunks: [{ key: "0:0,0,0", lod: 0, amr: 1, distance: 0 }],
    simulationBudget: 64,
    requestedSimulationCount: 1,
    selectedSimulationCount: 1,
    maxSimulatingChunks: 1,
    boundaryReadChunks: [],
    boundaryReadCount: 0,
    boundaryReadRelations: [],
    simulationCellCount: 64,
    boundaryReadCellCount: 0,
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
}

function frame(): InfinityScaleGlobalExecutionFrame {
  return {
    revision: 1,
    tickStart: 0,
    tickEnd: 1,
    phase: "boundary-reconciliation",
    planRevision: 1,
    simulationCellCount: 64,
    boundaryReadCellCount: 0,
    committed: false,
    finalized: false,
    ownershipFingerprint: "reset-regression",
    capabilityFingerprint: "reset-regression",
  };
}

export function runInfinityScaleLODResetInvalidationRegression(): void {
  const state = new InfinityScaleLODState(4);
  state.ensureChunk("0:0,0,0", 0);
  const transaction = beginInfinityScaleGlobalLODTransaction(frame(), plan(), state);
  const revisionBeforeClear = state.getRevision();

  state.clear();
  const expectedRevisionAfterClear = revisionBeforeClear + 1;

  let rejected = false;
  try {
    commitInfinityScaleGlobalLODTransaction(transaction, frame());
  } catch (error) {
    rejected = error instanceof Error &&
      error.message.includes("revision");
  }

  if (!rejected) {
    throw new Error("Expected a pre-reset LOD transaction to be rejected after state clear");
  }

  if (state.getRevision() !== expectedRevisionAfterClear) {
    throw new Error(
      `Expected LOD reset to advance revision to ${expectedRevisionAfterClear}, received ${state.getRevision()}`,
    );
  }

  if (state.keys().length !== 0) {
    throw new Error("Expected LOD reset to remove all hierarchical chunks");
  }
}


export function runInfinityScaleLODTopologyRevisionRegression(): void {
  const state = new InfinityScaleLODState(2);
  state.ensureChunk("0:0,0,0", 0);
  const transaction = beginInfinityScaleGlobalLODTransaction(frame(), plan(), state);
  const revisionBeforeTopologyChange = state.getRevision();

  state.ensureChunk("1:1,0,0", 1);
  if (state.getRevision() <= revisionBeforeTopologyChange) {
    throw new Error("Creating a hierarchical LOD chunk did not advance topology revision");
  }

  let rejected = false;
  try {
    commitInfinityScaleGlobalLODTransaction(transaction, frame());
  } catch (error) {
    rejected = error instanceof Error && error.message.includes("revision");
  }
  if (!rejected) {
    throw new Error("LOD transaction remained valid after hierarchical topology changed");
  }
  if (!state.hasChunk("1:1,0,0")) {
    throw new Error("Stale transaction rollback removed the newer authoritative LOD chunk");
  }
}


export function runInfinityScaleLODOverlapRejectionRegression(): void {
  const fineFirst = new InfinityScaleLODState(2);
  fineFirst.ensureChunk("0:0,0,0", 0);
  const fineRevision = fineFirst.getRevision();
  let coarseRejected = false;
  try {
    fineFirst.ensureChunk("1:0,0,0", 1);
  } catch (error) {
    coarseRejected = error instanceof Error && error.message.includes("overlaps");
  }
  if (!coarseRejected || fineFirst.getRevision() !== fineRevision ||
      fineFirst.keys().length !== 1 || !fineFirst.hasChunk("0:0,0,0")) {
    throw new Error("Overlapping coarse chunk was not rejected atomically after a fine chunk");
  }

  const coarseFirst = new InfinityScaleLODState(2);
  coarseFirst.ensureChunk("1:0,0,0", 1);
  const coarseRevision = coarseFirst.getRevision();
  let fineRejected = false;
  try {
    coarseFirst.ensureChunk("0:0,0,0", 0);
  } catch (error) {
    fineRejected = error instanceof Error && error.message.includes("overlaps");
  }
  if (!fineRejected || coarseFirst.getRevision() !== coarseRevision ||
      coarseFirst.keys().length !== 1 || !coarseFirst.hasChunk("1:0,0,0")) {
    throw new Error("Overlapping fine chunk was not rejected atomically after a coarse chunk");
  }

  const restoreState = new InfinityScaleLODState(2);
  restoreState.ensureChunk("0:0,0,0", 0);
  const invalidSnapshot = restoreState.snapshot();
  invalidSnapshot.chunks.push({
    key: "1:0,0,0",
    level: 1,
    scale: 2,
    cells: new Float32Array(invalidSnapshot.chunks[0].cells.length),
  });
  const revisionBeforeRestore = restoreState.getRevision();
  let restoreRejected = false;
  try {
    restoreState.restore(invalidSnapshot);
  } catch (error) {
    restoreRejected = error instanceof Error && error.message.includes("overlaps");
  }
  if (!restoreRejected || restoreState.getRevision() !== revisionBeforeRestore ||
      restoreState.keys().length !== 1 || !restoreState.hasChunk("0:0,0,0")) {
    throw new Error("Overlapping LOD restore was not rejected without mutating authoritative state");
  }
}
