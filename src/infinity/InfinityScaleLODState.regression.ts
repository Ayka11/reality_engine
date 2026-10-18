import {
  beginInfinityScaleGlobalLODTransaction,
  commitInfinityScaleGlobalLODTransaction,
} from "./InfinityScaleGlobalLODTransaction";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import { CELL_FIELDS } from "../core/CellState";
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

  state.clear();

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

  if (state.getRevision() !== 2) {
    throw new Error(
      `Expected chunk creation and reset to advance revision to 2, received ${state.getRevision()}`,
    );
  }

  if (state.keys().length !== 0) {
    throw new Error("Expected LOD reset to remove all hierarchical chunks");
  }
}


function expectTopologyMutationToInvalidateTransaction(
  mutation: (state: InfinityScaleLODState) => void,
  label: string,
): void {
  const state = new InfinityScaleLODState(4);
  state.ensureChunk("0:0,0,0", 0);
  const transaction = beginInfinityScaleGlobalLODTransaction(frame(), plan(), state);

  mutation(state);

  let rejected = false;
  try {
    commitInfinityScaleGlobalLODTransaction(transaction, frame());
  } catch (error) {
    rejected = error instanceof Error && error.message.includes("revision");
  }
  if (!rejected) {
    throw new Error(`Expected LOD transaction to reject after topology mutation: ${label}`);
  }
}

export function runInfinityScaleLODTopologyRevisionRegression(): void {
  expectTopologyMutationToInvalidateTransaction(
    state => { state.ensureChunk("1:1,0,0", 1); },
    "create chunk",
  );
  expectTopologyMutationToInvalidateTransaction(
    state => {
      if (!state.deleteChunk("0:0,0,0")) {
        throw new Error("Regression setup failed to delete existing LOD chunk");
      }
    },
    "delete chunk",
  );

  // Existing-chunk writes are data mutations inside a transaction, not topology changes.
  const state = new InfinityScaleLODState(4);
  state.ensureChunk("0:0,0,0", 0);
  const transaction = beginInfinityScaleGlobalLODTransaction(frame(), plan(), state);
  state.writeBaseCell("0:0,0,0", 0, 0, 0, 0, new Float32Array(CELL_FIELDS));
  state.assertRevision(transaction.stateRevision);

  // Spatial cell access must reject keys whose encoded LOD contradicts stored metadata.
  const inconsistent = new InfinityScaleLODState(4);
  inconsistent.ensureChunk("0:0,0,0", 1);
  let readRejected = false;
  try {
    inconsistent.readBaseCell("0:0,0,0", 1, 0, 0, 0);
  } catch (error) {
    readRejected = error instanceof Error && error.message.includes("key level mismatch");
  }
  if (!readRejected) throw new Error("Spatial read accepted a chunk key with contradictory LOD metadata");

  let writeRejected = false;
  try {
    inconsistent.writeBaseCell("0:0,0,0", 1, 0, 0, 0, new Float32Array(CELL_FIELDS));
  } catch (error) {
    writeRejected = error instanceof Error && error.message.includes("key level mismatch");
  }
  if (!writeRejected) throw new Error("Spatial write accepted a chunk key with contradictory LOD metadata");
}
