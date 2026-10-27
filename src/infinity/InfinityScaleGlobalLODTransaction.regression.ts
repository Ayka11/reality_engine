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
import { InfinityScaleLODSynchronization } from "./InfinityScaleLODSynchronization";

export function runInfinityScaleGlobalLODTransactionRegression(): void {
  const state = new InfinityScaleLODState(2);
  state.ensureChunk("0:2,0,0", 0);
  state.ensureChunk("1:0,0,0", 1);

  const plan = {
    revision: 1,
    mode: "advisory",
    chunks: [{ key: "0:2,0,0" }],
    boundaryReadChunks: ["1:0,0,0"],
    boundaryReadRelations: [{
      sourceChunk: "0:2,0,0",
      targetChunk: "1:0,0,0",
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

  // Fine-to-coarse restriction sums extensive ENERGY across four source cells
  // (2 each => 8) while intensive DENSITY is averaged (10 remains 10).
  const sources = Array.from({ length: 4 }, () => {
    const cell = new Array<number>(CELL_FIELDS).fill(0);
    cell[F.ENERGY] = 2;
    cell[F.DENSITY] = 10;
    return cell;
  });

  transaction.synchronization.stageTransfer(
    {
      sourceChunk: "0:2,0,0",
      targetChunk: "1:0,0,0",
      relation: "fine-to-coarse",
      sourceLevel: 0,
      targetLevel: 1,
      refinementRatio: 2,
      operation: "restriction",
      readOperation: "prolongation",
    },
    [3, 0, 0],
    sources,
  );

  // Duplicate target writes must be rejected rather than silently replacing
  // the first staged boundary value in the synchronization map.
  const conflictingSources = Array.from({ length: 4 }, () => {
    const cell = new Array<number>(CELL_FIELDS).fill(0);
    cell[F.ENERGY] = 99;
    cell[F.DENSITY] = 99;
    return cell;
  });
  let duplicateRejected = false;
  try {
    transaction.synchronization.stageTransfer(
      {
        sourceChunk: "0:2,0,0",
        targetChunk: "1:0,0,0",
        relation: "fine-to-coarse",
        sourceLevel: 0,
        targetLevel: 1,
        refinementRatio: 2,
        operation: "restriction",
        readOperation: "prolongation",
      },
      [3, 0, 0],
      conflictingSources,
    );
  } catch (error) {
    duplicateRejected = error instanceof Error &&
      error.message.includes("duplicate target cell");
  }
  const stagedAfterDuplicate = transaction.synchronization.getStagedUpdates();
  if (!duplicateRejected || stagedAfterDuplicate.length !== 1 ||
      stagedAfterDuplicate[0].value[F.ENERGY] !== 8 ||
      stagedAfterDuplicate[0].value[F.DENSITY] !== 10) {
    throw new Error("Infinity Scale duplicate boundary target regression failed");
  }

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

  const committed = state.readBaseCell("1:0,0,0", 1, 3, 0, 0);
  if (!committed || committed[F.ENERGY] !== 8 || committed[F.DENSITY] !== 10) {
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

  // Invalid target coordinates must be rejected before they can be coerced to
  // typed-array offset zero during a boundary commit.
  const guardedSync = new InfinityScaleLODSynchronization(state);
  guardedSync.begin(state.getRevision());
  const guardedSources = Array.from({ length: 4 }, () => new Array<number>(CELL_FIELDS).fill(1));
  let invalidTargetRejected = false;
  try {
    guardedSync.stageTransfer({
      sourceChunk: "0:2,0,0",
      targetChunk: "1:0,0,0",
      relation: "fine-to-coarse",
      sourceLevel: 0,
      targetLevel: 1,
      refinementRatio: 2,
      operation: "restriction",
      readOperation: "prolongation",
    }, [Number.NaN, 0, 0] as [number, number, number], guardedSources);
  } catch {
    invalidTargetRejected = true;
  }
  if (!invalidTargetRejected || guardedSync.getStagedUpdates().length !== 0) {
    throw new Error("Infinity Scale invalid boundary target was not rejected before staging");
  }

  let interiorTargetRejected = false;
  try {
    guardedSync.stageTransfer({
      sourceChunk: "0:2,0,0",
      targetChunk: "1:0,0,0",
      relation: "fine-to-coarse",
      sourceLevel: 0,
      targetLevel: 1,
      refinementRatio: 2,
      operation: "restriction",
      readOperation: "prolongation",
    }, [2, 0, 0], guardedSources);
  } catch (error) {
    interiorTargetRejected = error instanceof Error &&
      error.message.includes("canonical shared face");
  }
  if (!interiorTargetRejected || guardedSync.getStagedUpdates().length !== 0) {
    throw new Error("Infinity Scale synchronization accepted an interior cell as a boundary target");
  }

  let sparseTargetRejected = false;
  try {
    guardedSync.stageTransfer({
      sourceChunk: "0:2,0,0",
      targetChunk: "1:0,0,0",
      relation: "fine-to-coarse",
      sourceLevel: 0,
      targetLevel: 1,
      refinementRatio: 2,
      operation: "restriction",
      readOperation: "prolongation",
    }, [, 0, 0] as unknown as [number, number, number], guardedSources);
  } catch {
    sparseTargetRejected = true;
  }
  if (!sparseTargetRejected || guardedSync.getStagedUpdates().length !== 0) {
    throw new Error("Infinity Scale sparse boundary target was not rejected before staging");
  }

  const invalidSource = new Array<number>(CELL_FIELDS).fill(1);
  invalidSource[F.ENERGY] = Number.POSITIVE_INFINITY;
  let invalidSourceRejected = false;
  try {
    guardedSync.stageTransfer({
      sourceChunk: "0:2,0,0",
      targetChunk: "1:0,0,0",
      relation: "fine-to-coarse",
      sourceLevel: 0,
      targetLevel: 1,
      refinementRatio: 2,
      operation: "restriction",
      readOperation: "prolongation",
    }, [3, 0, 0], [invalidSource, ...guardedSources.slice(1)]);
  } catch {
    invalidSourceRejected = true;
  }
  if (!invalidSourceRejected || guardedSync.getStagedUpdates().length !== 0) {
    throw new Error("Infinity Scale non-finite boundary source was not rejected before staging");
  }

  const sparseSource = new Array<number>(CELL_FIELDS).fill(1);
  delete sparseSource[3];
  let sparseSourceRejected = false;
  try {
    guardedSync.stageTransfer({
      sourceChunk: "0:2,0,0",
      targetChunk: "1:0,0,0",
      relation: "fine-to-coarse",
      sourceLevel: 0,
      targetLevel: 1,
      refinementRatio: 2,
      operation: "restriction",
      readOperation: "prolongation",
    }, [3, 0, 0], [sparseSource, ...guardedSources.slice(1)]);
  } catch {
    sparseSourceRejected = true;
  }
  if (!sparseSourceRejected || guardedSync.getStagedUpdates().length !== 0) {
    throw new Error("Infinity Scale sparse boundary source was not rejected before staging");
  }
}
