import { InfinityScaleMixedLODCPUExecutor } from "./InfinityScaleMixedLODCPUExecutor";
import {
  beginInfinityScaleGlobalLODTransaction,
  commitInfinityScaleGlobalLODTransaction,
} from "./InfinityScaleGlobalLODTransaction";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import { CELL_FIELDS } from "../core/CellState";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import type { InfinityScaleChunkExecutionContext } from "./InfinityScaleChunkExecutionContext";
import type { InfinityScaleGlobalExecutionFrame } from "./InfinityScaleGlobalExecutionFrame";

export function runInfinityScaleMixedLODCPURegression(): void {
  const state = new InfinityScaleLODState(4);
  const coarseKey = "1:0,0,0";
  const fineKeys = ["0:8,0,0", "0:8,4,0", "0:8,0,4", "0:8,4,4"];

  state.ensureChunk(coarseKey, 1);
  for (const fineKey of fineKeys) state.ensureChunk(fineKey, 0);

  for (let z = 0; z < 4; z++) {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const coarse = new Float32Array(CELL_FIELDS);
        coarse[0] = 8;
        coarse[1] = 3;
        state.writeBaseCell(coarseKey, 1, x * 2, y * 2, z * 2, coarse);
      }
    }
  }

  for (const fineKey of fineKeys) {
    const parts = fineKey.split(":")[1].split(",").map(Number);
    const baseX = parts[0] * 4;
    const baseY = parts[1] * 4;
    const baseZ = parts[2] * 4;
    for (let z = 0; z < 4; z++) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const fine = new Float32Array(CELL_FIELDS);
          fine[0] = 1;
          fine[1] = 5;
          state.writeBaseCell(fineKey, 0, baseX + x, baseY + y, baseZ + z, fine);
        }
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
    boundaryReadChunks: [...fineKeys],
    boundaryReadCount: fineKeys.length,
    boundaryReadRelations: fineKeys.map(sourceChunk => ({
      sourceChunk,
      targetChunk: coarseKey,
      relation: "fine-to-coarse" as const,
    })),
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

  const context = new InfinityScaleChunkExecutionContext(plan, 8, 8, 8, 4);
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

  const transaction = beginInfinityScaleGlobalLODTransaction(frame, plan, state);
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
  if (result.stagedBoundaryUpdates !== 16) {
    throw new Error(
      `Expected 16 boundary updates from four fine neighbors, received ${result.stagedBoundaryUpdates}`,
    );
  }
  if (!result.transactionReady) {
    throw new Error("Expected CPU mixed-LOD transaction to be ready");
  }

  const staged = transaction.synchronization.getStagedUpdates();
  if (staged.length !== 16 || staged.some(update => update.sourceCells.length !== 4)) {
    throw new Error("Expected ratio-2 face restriction to use exactly four source cells");
  }

  frame.phase = "boundary-reconciliation";
  commitInfinityScaleGlobalLODTransaction(transaction, frame);

  const sample = state.readBaseCell(coarseKey, 1, 0, 0, 0);
  if (!sample || sample[0] !== 9) {
    throw new Error("CPU mixed-LOD local execution did not commit owned coarse state");
  }
}
