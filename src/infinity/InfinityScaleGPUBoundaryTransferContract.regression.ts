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
  const descriptor = InfinityScaleGPUBoundaryTransferContract.descriptor(
    fineToCoarse,
    [7, 2, 2],
  );

  if (descriptor.sourceCellCount !== 4 || descriptor.operation !== "restriction") {
    throw new Error("GPU boundary contract failed fine-to-coarse face footprint");
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
  const packed = InfinityScaleGPUBoundaryTransferContract.pack([
    descriptor,
    InfinityScaleGPUBoundaryTransferContract.descriptor(coarseToFine, [8, 2, 2]),
  ]);

  if (packed.length !== 24 || packed[0] !== 0 || packed[1] !== 1 || packed[4] !== 2) {
    throw new Error("GPU boundary contract packing is not deterministic");
  }
}
