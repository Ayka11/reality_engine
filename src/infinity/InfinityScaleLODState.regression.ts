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
  // The low-level LOD state may stage overlapping chunks for diagnostics and
  // execution-plan rejection tests. Exclusivity belongs to region ownership,
  // not to the chunk buffer map itself.
  const state = new InfinityScaleLODState(32);
  state.ensureChunk("1:0,0,0", 1);
  state.ensureChunk("0:0,0,0", 0);
  const revisionBeforeOwnership = state.getRevision();
  state.bindRegionOwnership("coarse-region", ["1:0,0,0"]);
  const revisionAfterCoarseOwnership = state.getRevision();
  if (revisionAfterCoarseOwnership !== revisionBeforeOwnership + 1) {
    throw new Error("Binding valid coarse region ownership did not advance revision exactly once");
  }

  let fineOwnershipRejected = false;
  try {
    state.bindRegionOwnership("fine-region", ["0:0,0,0"]);
  } catch (error) {
    fineOwnershipRejected = error instanceof Error &&
      error.message.includes("overlapping LOD region ownership");
  }
  if (!fineOwnershipRejected || state.getRevision() !== revisionAfterCoarseOwnership ||
      state.getRegionChunkKeys("coarse-region")?.[0] !== "1:0,0,0" ||
      state.getRegionChunkKeys("fine-region") !== undefined) {
    throw new Error("Overlapping region ownership was not rejected atomically");
  }

  const invalidSnapshot = state.snapshot();
  invalidSnapshot.regionOwnership = [
    { regionId: "coarse-region", chunkKeys: ["1:0,0,0"] },
    { regionId: "fine-region", chunkKeys: ["0:0,0,0"] },
  ];
  const revisionBeforeRestore = state.getRevision();
  let restoreRejected = false;
  try {
    state.restore(invalidSnapshot);
  } catch (error) {
    restoreRejected = error instanceof Error &&
      error.message.includes("overlapping LOD region ownership");
  }
  if (!restoreRejected || state.getRevision() !== revisionBeforeRestore ||
      state.getRegionChunkKeys("coarse-region")?.[0] !== "1:0,0,0" ||
      state.getRegionChunkKeys("fine-region") !== undefined) {
    throw new Error("Overlapping region ownership restore was not rejected atomically");
  }
}
