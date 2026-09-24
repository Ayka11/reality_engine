import { InfinityScaleMixedLODCPUExecutor } from "./InfinityScaleMixedLODCPUExecutor";
import { InfinityScaleGlobalLODTransaction } from "./InfinityScaleGlobalLODTransaction";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import type { InfinityScaleChunkExecutionContext } from "./InfinityScaleChunkExecutionContext";
import type { InfinityScaleGlobalExecutionFrame } from "./InfinityScaleGlobalExecutionFrame";

export function runInfinityScaleMixedLODCPURegression(): void {
  const state = new InfinityScaleLODState(4);
  const context = new InfinityScaleChunkExecutionContext(4, 8, 8, 8);
  const coarseKey = "1:0,0,0";
  const fineKey = "0:8,0,0";

  state.ensureChunk(coarseKey, 1);
  state.ensureChunk(fineKey, 0);

  for (let z = 0; z < 4; z++) {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const coarse = new Float32Array(state.fieldCount);
        coarse[0] = 8;
        coarse[1] = 3;
        state.writeBaseCell(coarseKey, 1, x * 2, y * 2, z * 2, coarse);

        const fine = new Float32Array(state.fieldCount);
        fine[0] = 1;
        fine[1] = 5;
        state.writeBaseCell(fineKey, 0, 8 + x, y, z, fine);
      }
    }
  }

  const plan: InfinityScaleExecutionPlan = {
    revision: 1,
    mode: "selective-cpu-ready",
    observer: [0, 0, 0],
    chunks: [
      { key: coarseKey, lod: 1, distance: 0 },
    ],
    simulationBudget: 64,
    requestedSimulationCount: 1,
    selectedSimulationCount: 1,
    maxSimulatingChunks: 1,
    boundaryReadChunks: [fineKey],
    boundaryReadCount: 1,
    boundaryReadRelations: [{
      sourceChunk: fineKey,
      targetChunk: coarseKey,
      relation: "fine-to-coarse",
    }],
    simulationCellCount: 64,
    boundaryReadCellCount: 64,
    localExecutionLayers: 1,
    globalExecutionLayers: 1,
    selectiveCpuReady: true,
    selectiveGpuReady: false,
    gpuPhysicsReady: false,
    lodBoundaryTransferReady: true,
    mixedLodExecutionReady: true,
    entityExecutionReady: false,
    agentMigrationReady: false,
  };

  const frame: InfinityScaleGlobalExecutionFrame = {
    revision: 1,
    tickStart: 0,
    tickEnd: 1,
    phase: "local-execution",
    planRevision: 1,
    simulationCellCount: 64,
    boundaryReadCellCount: 64,
    committed: false,
    finalized: false,
    ownershipFingerprint: "regression",
    capabilityFingerprint: "regression",
  };

  const transaction = new InfinityScaleGlobalLODTransaction(state, frame);
  const executor = new InfinityScaleMixedLODCPUExecutor(state, context);

  const result = executor.execute(
    frame,
    plan,
    transaction,
    cell => {
      const output = new Float32Array(cell.input);
      output[0] += 1;
      return output;
    },
  );

  if (result.executedCells !== 64) {
    throw new Error(`Expected 64 executed coarse cells, received ${result.executedCells}`);
  }
  if (result.stagedBoundaryUpdates === 0) {
    throw new Error("Expected mixed-LOD boundary updates to be staged");
  }
  if (!result.transactionReady) {
    throw new Error("Expected CPU mixed-LOD transaction to be ready");
  }

  frame.phase = "boundary-reconciliation";
  transaction.commit(frame);

  const sample = state.readBaseCell(coarseKey, 1, 0, 0, 0);
  if (!sample || sample[0] !== 9) {
    throw new Error("CPU mixed-LOD local execution did not commit owned coarse state");
  }
}
