import { InfinityScaleMixedLODCPUExecutor } from "./InfinityScaleMixedLODCPUExecutor";
import {
  beginInfinityScaleGlobalLODTransaction,
  commitInfinityScaleGlobalLODTransaction,
} from "./InfinityScaleGlobalLODTransaction";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import { CELL_FIELDS } from "../core/CellState";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import type { InfinityScaleGlobalExecutionFrame } from "./InfinityScaleGlobalExecutionFrame";
import { InfinityScaleChunkExecutionContext } from "./InfinityScaleChunkExecutionContext";

const coarseKey = "1:0,0,0";
const fineKeys = ["0:8,0,0", "0:8,4,0", "0:8,0,4", "0:8,4,4"];

function makePlan(): InfinityScaleExecutionPlan {
  return {
    revision: 1,
    mode: "selective-cpu-ready",
    observer: { x: 0, y: 0, z: 0 },
    chunks: [{ key: coarseKey, lod: 1, amr: 2, distance: 0 }],
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
}

function makeFrame(revision: number): InfinityScaleGlobalExecutionFrame {
  return {
    revision,
    tickStart: revision - 1,
    tickEnd: revision,
    phase: "local-execution",
    planRevision: 1,
    simulationCellCount: 64,
    boundaryReadCellCount: 64,
    committed: false,
    finalized: false,
    ownershipFingerprint: "mixed-lod-multi-frame",
    capabilityFingerprint: "mixed-lod-multi-frame",
  };
}

export function runInfinityScaleMixedLODMultiFrameRegression(): void {
  const state = new InfinityScaleLODState(4);
  state.ensureChunk(coarseKey, 1);
  for (const fineKey of fineKeys) state.ensureChunk(fineKey, 0);

  for (let z = 0; z < 4; z++) {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const coarse = new Float32Array(CELL_FIELDS);
        coarse[0] = 10;
        state.writeBaseCell(coarseKey, 1, x * 2, y * 2, z * 2, coarse);
      }
    }
  }

  for (const fineKey of fineKeys) {
    const [baseX, baseY, baseZ] = fineKey.split(":")[1].split(",").map(Number).map(v => v * 4);
    for (let z = 0; z < 4; z++) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const fine = new Float32Array(CELL_FIELDS);
          fine[0] = 2;
          state.writeBaseCell(fineKey, 0, baseX + x, baseY + y, baseZ + z, fine);
        }
      }
    }
  }

  const plan = makePlan();
  const context = new InfinityScaleChunkExecutionContext(plan, 8, 8, 8, 4);

  for (let frameRevision = 1; frameRevision <= 2; frameRevision++) {
    const frame = makeFrame(frameRevision);
    const transaction = beginInfinityScaleGlobalLODTransaction(frame, plan, state);
    const executor = new InfinityScaleMixedLODCPUExecutor(state, context);

    const result = executor.execute(frame, plan, transaction, cell => {
      const output = new Float32Array(cell.input);
      output[0] += 1;
      return output;
    });

    if (result.executedCells !== 64 || result.stagedBoundaryUpdates !== 16) {
      throw new Error(
        `Frame ${frameRevision}: expected 64 executions and 16 boundary updates, received ${result.executedCells}/${result.stagedBoundaryUpdates}`,
      );
    }

    frame.phase = "boundary-reconciliation";
    commitInfinityScaleGlobalLODTransaction(transaction, frame);

    if (state.getRevision() !== frameRevision) {
      throw new Error(
        `Frame ${frameRevision}: expected state revision ${frameRevision}, received ${state.getRevision()}`,
      );
    }
  }

  const owned = state.readBaseCell(coarseKey, 1, 0, 0, 0);
  if (!owned || owned[0] !== 12) {
    throw new Error(
      `Expected owned coarse state to persist and advance across two frames to 12, received ${owned?.[0]}`,
    );
  }

  const boundary = state.readBaseCell(coarseKey, 1, 2, 0, 0);
  if (!boundary || boundary[0] !== 2) {
    throw new Error(
      `Expected fine-to-coarse boundary state to persist across frames at value 2, received ${boundary?.[0]}`,
    );
  }
}
