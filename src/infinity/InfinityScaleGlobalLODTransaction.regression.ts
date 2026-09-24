import { F, CELL_FIELDS } from "../core/CellState";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import {
  advanceInfinityScaleGlobalFrame,
  beginInfinityScaleGlobalFrame,
} from "./InfinityScaleGlobalExecutionFrame";
import {
  beginInfinityScaleGlobalLODTransaction,
  commitInfinityScaleGlobalLODTransaction,
} from "./InfinityScaleGlobalLODTransaction";

export function runInfinityScaleGlobalLODTransactionRegression(): void {
  const state = new InfinityScaleLODState(2);
  state.ensureChunk("0:0,0,0", 0);
  state.ensureChunk("1:1,0,0", 1);

  const plan = {
    revision: 1,
    mode: "advisory",
    chunks: [{ key: "0:0,0,0" }],
    boundaryReadChunks: ["1:1,0,0"],
    boundaryReadRelations: [{
      sourceChunk: "0:0,0,0",
      targetChunk: "1:1,0,0",
      relation: "fine-to-coarse",
    }],
    simulationCellCount: 8,
    boundaryReadCellCount: 8,
    entityExecutionReady: true,
    agentMigrationReady: true,
    selectiveCpuReady: true,
    selectiveGpuReady: false,
    gpuPhysicsReady: false,
    lodBoundaryTransferReady: false,
    mixedLodExecutionReady: false,
  } as unknown as InfinityScaleExecutionPlan;

  const frame = beginInfinityScaleGlobalFrame(plan, 0, 1);
  const transaction = beginInfinityScaleGlobalLODTransaction(frame, plan, state);

  const sources = Array.from({ length: 8 }, () => {
    const cell = new Array<number>(CELL_FIELDS).fill(0);
    cell[F.ENERGY] = 2;
    cell[F.DENSITY] = 10;
    return cell;
  });

  transaction.synchronization.stageTransfer(
    {
      sourceChunk: "0:0,0,0",
      targetChunk: "1:1,0,0",
      relation: "fine-to-coarse",
      sourceLevel: 0,
      targetLevel: 1,
      refinementRatio: 2,
      operation: "restriction",
      readOperation: "prolongation",
    },
    [2, 0, 0],
    sources,
  );

  const readyFrame = advanceInfinityScaleGlobalFrame(frame, "local-execution");
  const localCommittedFrame = advanceInfinityScaleGlobalFrame(readyFrame, "local-commit");
  const boundaryFrame = advanceInfinityScaleGlobalFrame(
    localCommittedFrame,
    "boundary-reconciliation",
  );

  const result = commitInfinityScaleGlobalLODTransaction(transaction, boundaryFrame);
  if (!result.readyToCommit || !result.conservationValid || !result.topologyValid) {
    throw new Error("Infinity Scale global LOD transaction regression failed");
  }

  const committed = state.readBaseCell("1:1,0,0", 1, 2, 0, 0);
  if (!committed || committed[F.ENERGY] !== 16 || committed[F.DENSITY] !== 10) {
    throw new Error("Infinity Scale global LOD conservation regression failed");
  }

  const staleStateRevision = state.beginRevision();
  const staleTransaction = beginInfinityScaleGlobalLODTransaction(
    boundaryFrame,
    plan,
    state,
  );
  state.beginRevision();

  let rejected = false;
  try {
    staleTransaction.synchronization.validate();
  } catch {
    rejected = true;
  }
  if (!rejected || staleStateRevision === state.getRevision()) {
    throw new Error("Infinity Scale stale revision regression failed");
  }
}
