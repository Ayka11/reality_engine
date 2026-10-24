import { InfinityScaleGPUBoundaryTransferContract } from "./InfinityScaleGPUBoundaryTransferContract";
import type { InfinityScaleBoundaryTransferSpec } from "./InfinityScaleChunkExecutionContext";

export function runInfinityScaleGPUBoundaryTransferContractRegression(): void {
  const fineToCoarse: InfinityScaleBoundaryTransferSpec = {
    sourceChunk: "0:8,0,0",
    targetChunk: "1:0,0,0",
    relation: "fine-to-coarse",
    sourceLevel: 0,
    targetLevel: 1,
    refinementRatio: 2,
    operation: "restriction",
    readOperation: "prolongation",
  };
  const targetCell: [number, number, number] = [7, 2, 2];
  const descriptor = InfinityScaleGPUBoundaryTransferContract.descriptor(fineToCoarse, targetCell);

  if (descriptor.sourceCellCount !== 4 || descriptor.operation !== "restriction") {
    throw new Error("GPU boundary contract failed fine-to-coarse face footprint");
  }
  targetCell[0] = 99;
  if (descriptor.targetCell[0] !== 7) {
    throw new Error("GPU boundary descriptor retained a mutable target-cell reference");
  }

  const coarseToFine: InfinityScaleBoundaryTransferSpec = {
    sourceChunk: "1:0,0,0",
    targetChunk: "0:8,0,0",
    relation: "coarse-to-fine",
    sourceLevel: 1,
    targetLevel: 0,
    refinementRatio: 2,
    operation: "prolongation",
    readOperation: "restriction",
  };
  const sameLevel: InfinityScaleBoundaryTransferSpec = {
    sourceChunk: "0:0,0,0",
    targetChunk: "0:8,0,0",
    relation: "same-level",
    sourceLevel: 0,
    targetLevel: 0,
    refinementRatio: 1,
    operation: "copy",
    readOperation: "copy",
  };
  const packed = InfinityScaleGPUBoundaryTransferContract.pack([
    descriptor,
    InfinityScaleGPUBoundaryTransferContract.descriptor(coarseToFine, [8, 2, 2]),
    InfinityScaleGPUBoundaryTransferContract.descriptor(sameLevel, [3, 4, 5]),
  ]);

  if (packed.length !== 36 || packed[0] !== 0 || packed[1] !== 1 || packed[4] !== 2) {
    throw new Error("GPU boundary contract packing is not deterministic");
  }
  if (packed[12 + 3] !== 1 || packed[12 + 4] !== 1 || packed[12 + 8] !== 1) {
    throw new Error("GPU boundary contract packed incorrect coarse-to-fine metadata");
  }
  if (packed[24 + 3] !== 0 || packed[24 + 4] !== 0 || packed[24 + 8] !== 1) {
    throw new Error("GPU boundary contract packed incorrect same-level metadata");
  }

  for (const invalidRatio of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    let rejected = false;
    try {
      InfinityScaleGPUBoundaryTransferContract.descriptor(
        { ...sameLevel, refinementRatio: invalidRatio },
        [0, 0, 0],
      );
    } catch (error) {
      rejected = error instanceof Error && error.message.includes("integer refinement ratio");
    }
    if (!rejected) throw new Error("GPU boundary contract accepted invalid refinement ratio");
  }
}
