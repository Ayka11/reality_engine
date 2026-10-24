import type { InfinityScaleBoundaryTransferSpec } from "./InfinityScaleChunkExecutionContext";

export interface InfinityScaleGPUBoundaryTransferDescriptor {
  sourceChunk: string;
  targetChunk: string;
  relation: "same-level" | "coarse-to-fine" | "fine-to-coarse";
  sourceLevel: number;
  targetLevel: number;
  refinementRatio: number;
  operation: "copy" | "prolongation" | "restriction";
  targetCell: [number, number, number];
  sourceCellCount: number;
}

/**
 * GPU boundary-transfer contract.
 *
 * This module is deliberately CPU-side and pure: it serializes the canonical
 * mixed-LOD transfer geometry into descriptors that a future GPU boundary
 * pass can consume. It does not execute WebGPU work and therefore cannot
 * accidentally bypass the global transaction barrier.
 */
export class InfinityScaleGPUBoundaryTransferContract {
  static descriptor(
    spec: InfinityScaleBoundaryTransferSpec,
    targetCell: [number, number, number],
  ): InfinityScaleGPUBoundaryTransferDescriptor {
    if (spec.refinementRatio < 1 || !Number.isInteger(spec.refinementRatio)) {
      throw new Error("GPU boundary transfer requires an integer refinement ratio");
    }

    const sourceCellCount =
      spec.relation === "same-level"
        ? 1
        : spec.relation === "coarse-to-fine"
          ? 1
          : spec.refinementRatio ** 2;

    return {
      sourceChunk: spec.sourceChunk,
      targetChunk: spec.targetChunk,
      relation: spec.relation,
      sourceLevel: spec.sourceLevel,
      targetLevel: spec.targetLevel,
      refinementRatio: spec.refinementRatio,
      operation: spec.operation,
      targetCell: [...targetCell] as [number, number, number],
      sourceCellCount,
    };
  }

  static pack(
    descriptors: ReadonlyArray<InfinityScaleGPUBoundaryTransferDescriptor>,
  ): Float32Array {
    // 12 scalar slots per descriptor:
    // source/target levels, ratio, operation/relation codes, target xyz,
    // source-cell count, plus reserved slots for future GPU chunk indices.
    const stride = 12;
    const packed = new Float32Array(descriptors.length * stride);

    descriptors.forEach((d, i) => {
      const o = i * stride;
      packed[o] = d.sourceLevel;
      packed[o + 1] = d.targetLevel;
      packed[o + 2] = d.refinementRatio;
      packed[o + 3] = operationCode(d.operation);
      packed[o + 4] = relationCode(d.relation);
      packed[o + 5] = d.targetCell[0];
      packed[o + 6] = d.targetCell[1];
      packed[o + 7] = d.targetCell[2];
      packed[o + 8] = d.sourceCellCount;
      packed[o + 9] = 0;
      packed[o + 10] = 0;
      packed[o + 11] = 0;
    });

    return packed;
  }
}

function operationCode(operation: InfinityScaleGPUBoundaryTransferDescriptor["operation"]): number {
  return operation === "copy" ? 0 : operation === "prolongation" ? 1 : 2;
}

function relationCode(relation: InfinityScaleGPUBoundaryTransferDescriptor["relation"]): number {
  return relation === "same-level" ? 0 : relation === "coarse-to-fine" ? 1 : 2;
}
