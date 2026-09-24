import { InfinityScaleGPUBoundaryTransferContract } from "./InfinityScaleGPUBoundaryTransferContract";

export function runInfinityScaleGPUBoundaryDescriptorRegression(): void {
  const descriptor = InfinityScaleGPUBoundaryTransferContract.descriptor(
    {
      sourceChunk: "0:8,0,0",
      targetChunk: "1:0,0,0",
      relation: "fine-to-coarse",
      sourceLevel: 0,
      targetLevel: 1,
      refinementRatio: 2,
      operation: "restriction",
      readOperation: "prolongation",
    },
    [7, 2, 2],
  );
  if (descriptor.sourceCellCount !== 4) {
    throw new Error("GPU descriptor regression: fine-to-coarse boundary must reference four face sources");
  }

  const packed = InfinityScaleGPUBoundaryTransferContract.pack([descriptor]);
  if (packed.length !== 12 || packed[0] !== 0 || packed[1] !== 1 || packed[2] !== 2 || packed[8] !== 4) {
    throw new Error("GPU descriptor regression: packed boundary descriptor is invalid");
  }
}
