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
    observer: { x: 0, y: 0, z: 0 },
    chunks: [
      { key: coarseKey, lod: 1, amr: 2, distance: 0 },
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
    localExecutionLayers: [],
    globalExecutionLayers: [],
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
  const targetKeys = new Set(
    staged.map(update => `${update.targetCell[0]},${update.targetCell[1]},${update.targetCell[2]}`),
  );
  if (targetKeys.size !== staged.length) {
    throw new Error("Four fine neighbors produced overlapping boundary target ownership");
  }

  frame.phase = "boundary-reconciliation";
  commitInfinityScaleGlobalLODTransaction(transaction, frame);

  const sample = state.readBaseCell(coarseKey, 1, 0, 0, 0);
  if (!sample || sample[0] !== 9) {
    throw new Error("CPU mixed-LOD local execution did not commit owned coarse state");
  }
}


export function runInfinityScaleMixedLODCPUProlongationRegression(): void {
  const state = new InfinityScaleLODState(4);
  const coarseKey = "1:0,0,0";
  const fineKeys = ["0:8,0,0", "0:8,4,0", "0:8,0,4", "0:8,4,4"];

  state.ensureChunk(coarseKey, 1);
  for (const fineKey of fineKeys) state.ensureChunk(fineKey, 0);

  // Give every coarse face cell a distinct value. The fine face must inherit
  // each value into exactly four fine target cells (2x2 tangential footprint).
  for (let z = 0; z < 4; z++) {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const coarse = new Float32Array(CELL_FIELDS);
        coarse[0] = 100 + y * 10 + z;
        coarse[1] = 7;
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
          fine[0] = 0;
          fine[1] = 11;
          state.writeBaseCell(fineKey, 0, baseX + x, baseY + y, baseZ + z, fine);
        }
      }
    }
  }

  const plan: InfinityScaleExecutionPlan = {
    revision: 2,
    mode: "selective-cpu-ready",
    observer: { x: 0, y: 0, z: 0 },
    chunks: fineKeys.map(key => ({ key, lod: 0, amr: 1, distance: 0 })),
    simulationBudget: 256,
    requestedSimulationCount: 4,
    selectedSimulationCount: 4,
    maxSimulatingChunks: 4,
    boundaryReadChunks: [coarseKey],
    boundaryReadCount: 1,
    boundaryReadRelations: fineKeys.map(targetChunk => ({
      sourceChunk: coarseKey,
      targetChunk,
      relation: "coarse-to-fine" as const,
    })),
    simulationCellCount: 256,
    boundaryReadCellCount: 64,
    localExecutionLayers: [],
    globalExecutionLayers: [],
    selectiveCpuReady: true,
    selectiveGpuReady: false,
    gpuPhysicsReady: false,
    lodBoundaryTransferReady: true,
    mixedLodExecutionReady: true,
    entityExecutionReady: false,
    agentMigrationReady: false,
  };

  const context = new InfinityScaleChunkExecutionContext(plan, 12, 8, 8, 4);
  const frame: InfinityScaleGlobalExecutionFrame = {
    revision: 2,
    tickStart: 1,
    tickEnd: 2,
    phase: "local-execution",
    planRevision: 2,
    simulationCellCount: 256,
    boundaryReadCellCount: 64,
    committed: false,
    finalized: false,
    ownershipFingerprint: "prolongation-regression",
    capabilityFingerprint: "prolongation-regression",
  };

  const transaction = beginInfinityScaleGlobalLODTransaction(frame, plan, state);
  const executor = new InfinityScaleMixedLODCPUExecutor(state, context);

  const result = executor.execute(
    frame,
    plan,
    transaction,
    cell => new Float32Array(cell.input),
  );

  if (result.executedCells !== 256) {
    throw new Error(
      `Expected 256 executed fine cells, received ${result.executedCells}`,
    );
  }
  if (result.stagedBoundaryUpdates !== 64) {
    throw new Error(
      `Expected 64 coarse-to-fine boundary updates, received ${result.stagedBoundaryUpdates}`,
    );
  }
  if (!result.transactionReady) {
    throw new Error("Expected CPU coarse-to-fine transaction to be ready");
  }

  const staged = transaction.synchronization.getStagedUpdates();
  if (staged.length !== 64 || staged.some(update => update.sourceCells.length !== 1)) {
    throw new Error(
      "Expected coarse-to-fine prolongation to use exactly one coarse source cell per fine target",
    );
  }

  const targetKeys = new Set(
    staged.map(update => `${update.targetCell[0]},${update.targetCell[1]},${update.targetCell[2]}`),
  );
  if (targetKeys.size !== 64) {
    throw new Error("Coarse-to-fine boundary staging produced overlapping fine target ownership");
  }

  const sourceToTargets = new Map<string, number>();
  for (const update of staged) {
    const source = update.sourceCells[0];
    const key = `${source[0]},${source[1]},${source[2]}`;
    sourceToTargets.set(key, (sourceToTargets.get(key) ?? 0) + 1);
  }
  if (sourceToTargets.size !== 16 || [...sourceToTargets.values()].some(count => count !== 4)) {
    throw new Error(
      "Expected each of the 16 coarse face cells to feed exactly four fine boundary cells",
    );
  }

  frame.phase = "boundary-reconciliation";
  commitInfinityScaleGlobalLODTransaction(transaction, frame);

  for (const update of staged) {
    const source = update.sourceCells[0];
    const expected = 100 + (source[1] / 2) * 10 + source[2] / 2;
    const actual = state.readBaseCell(
      update.targetChunk,
      update.targetLevel,
      ...update.targetCell,
    );
    if (!actual || actual[0] !== expected) {
      throw new Error(
        `Coarse-to-fine prolongation mismatch at ${update.targetChunk}:${update.targetCell.join(",")}`,
      );
    }
  }
}
