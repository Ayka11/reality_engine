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

const PACKED_STRIDE = 12;

/**
 * CPU-side contract for preparing mixed-LOD boundary-transfer metadata.
 * This module does not execute GPU work or mutate topology; callers must still
 * pass any actual transfer through the existing LOD transaction barrier.
 */
export class InfinityScaleGPUBoundaryTransferContract {
  static descriptor(
    spec: InfinityScaleBoundaryTransferSpec,
    targetCell: [number, number, number],
  ): InfinityScaleGPUBoundaryTransferDescriptor {
    if (!spec.sourceChunk || !spec.targetChunk) {
      throw new Error("GPU boundary transfer requires source and target chunks");
    }
    if (
      spec.relation !== "same-level" &&
      spec.relation !== "coarse-to-fine" &&
      spec.relation !== "fine-to-coarse"
    ) {
      throw new Error("GPU boundary transfer requires a known boundary relation");
    }
    if (
      spec.operation !== "copy" &&
      spec.operation !== "prolongation" &&
      spec.operation !== "restriction"
    ) {
      throw new Error("GPU boundary transfer requires a known operation");
    }
    if (
      !Number.isSafeInteger(spec.sourceLevel) ||
      !Number.isSafeInteger(spec.targetLevel) ||
      spec.sourceLevel < 0 ||
      spec.targetLevel < 0 ||
      spec.sourceLevel > 30 ||
      spec.targetLevel > 30
    ) {
      throw new Error("GPU boundary transfer requires integer LOD levels in the runtime-supported range 0..30");
    }
    validateChunkKey(spec.sourceChunk, spec.sourceLevel, "source");
    validateChunkKey(spec.targetChunk, spec.targetLevel, "target");
    if (!Number.isSafeInteger(spec.refinementRatio) || spec.refinementRatio < 1) {
      throw new Error("GPU boundary transfer requires an integer refinement ratio");
    }
    if (!Array.isArray(targetCell) || targetCell.length !== 3) {
      throw new Error("GPU boundary transfer target cell must contain exactly three coordinates");
    }
    for (let axis = 0; axis < 3; axis++) {
      if (!Number.isSafeInteger(targetCell[axis]) || targetCell[axis] < 0) {
        throw new Error("GPU boundary transfer target cell coordinates must be non-negative safe integers");
      }
    }

    const expectedRatio = 2 ** Math.abs(spec.sourceLevel - spec.targetLevel);
    if (!Number.isSafeInteger(expectedRatio) || spec.refinementRatio !== expectedRatio) {
      throw new Error("GPU boundary transfer refinement ratio does not match LOD levels");
    }

    const expectedOperation =
      spec.relation === "same-level"
        ? "copy"
        : spec.relation === "coarse-to-fine"
          ? "prolongation"
          : "restriction";
    if (spec.operation !== expectedOperation) {
      throw new Error("GPU boundary transfer operation does not match relation");
    }

    if (spec.relation === "same-level" && spec.sourceLevel !== spec.targetLevel) {
      throw new Error("Same-level GPU boundary transfer requires matching LOD levels");
    }
    if (spec.relation === "coarse-to-fine" && spec.sourceLevel <= spec.targetLevel) {
      throw new Error("Coarse-to-fine transfer requires a coarser source level");
    }
    if (spec.relation === "fine-to-coarse" && spec.sourceLevel >= spec.targetLevel) {
      throw new Error("Fine-to-coarse transfer requires a finer source level");
    }

    const sourceCellCount = spec.relation === "fine-to-coarse"
      ? spec.refinementRatio ** 2
      : 1;
    if (!Number.isSafeInteger(sourceCellCount)) {
      throw new Error("GPU boundary transfer source footprint exceeds safe integer range");
    }

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
    const packed = new Float32Array(descriptors.length * PACKED_STRIDE);

    descriptors.forEach((d, i) => {
      if (!d.sourceChunk || !d.targetChunk) {
        throw new Error("GPU boundary transfer descriptor requires source and target chunks");
      }
      if (
        d.relation !== "same-level" &&
        d.relation !== "coarse-to-fine" &&
        d.relation !== "fine-to-coarse"
      ) {
        throw new Error("GPU boundary transfer descriptor contains an unknown relation");
      }
      if (
        d.operation !== "copy" &&
        d.operation !== "prolongation" &&
        d.operation !== "restriction"
      ) {
        throw new Error("GPU boundary transfer descriptor contains an unknown operation");
      }
      const expectedOperation =
        d.relation === "same-level"
          ? "copy"
          : d.relation === "coarse-to-fine"
            ? "prolongation"
            : "restriction";
      if (d.operation !== expectedOperation) {
        throw new Error("GPU boundary transfer descriptor operation does not match relation");
      }
      if (
        !Number.isSafeInteger(d.sourceLevel) ||
        !Number.isSafeInteger(d.targetLevel) ||
        d.sourceLevel < 0 ||
        d.targetLevel < 0 ||
        d.sourceLevel > 30 ||
        d.targetLevel > 30
      ) {
        throw new Error("GPU boundary transfer descriptor contains LOD levels outside the runtime-supported range 0..30");
      }
      validateChunkKey(d.sourceChunk, d.sourceLevel, "source");
      validateChunkKey(d.targetChunk, d.targetLevel, "target");
      const expectedRatio = 2 ** Math.abs(d.sourceLevel - d.targetLevel);
      if (!Number.isSafeInteger(expectedRatio) || d.refinementRatio !== expectedRatio) {
        throw new Error("GPU boundary transfer descriptor refinement ratio does not match LOD levels");
      }
      if (
        (d.relation === "same-level" && d.sourceLevel !== d.targetLevel) ||
        (d.relation === "coarse-to-fine" && d.sourceLevel <= d.targetLevel) ||
        (d.relation === "fine-to-coarse" && d.sourceLevel >= d.targetLevel)
      ) {
        throw new Error("GPU boundary transfer descriptor relation does not match LOD levels");
      }
      const expectedSourceCellCount = d.relation === "fine-to-coarse"
        ? d.refinementRatio ** 2
        : 1;
      if (!Number.isSafeInteger(expectedSourceCellCount) || d.sourceCellCount !== expectedSourceCellCount) {
        throw new Error("GPU boundary transfer descriptor source footprint is inconsistent");
      }

      if (!Array.isArray(d.targetCell) || d.targetCell.length !== 3) {
        throw new Error("GPU boundary transfer descriptor target cell must contain exactly three coordinates");
      }
      const numericFields = [
        d.sourceLevel,
        d.targetLevel,
        d.refinementRatio,
        ...d.targetCell,
        d.sourceCellCount,
      ];
      if (numericFields.some(value => !Number.isFinite(value))) {
        throw new Error("GPU boundary transfer descriptor contains non-finite numeric data");
      }
      // Float32 packing is lossy for integers above 2^24; reject rather than
      // silently dispatching a descriptor with altered cell/LOD coordinates.
      if (numericFields.some(value => Math.fround(value) !== value)) {
        throw new Error("GPU boundary transfer descriptor is not exactly representable in Float32");
      }
      if (
        !Number.isInteger(d.sourceLevel) ||
        !Number.isInteger(d.targetLevel) ||
        !Number.isInteger(d.refinementRatio) ||
        d.refinementRatio < 1 ||
        d.targetCell.some(value => !Number.isSafeInteger(value) || value < 0) ||
        !Number.isInteger(d.sourceCellCount) ||
        d.sourceCellCount < 1
      ) {
        throw new Error("GPU boundary transfer descriptor contains invalid numeric data");
      }

      const o = i * PACKED_STRIDE;
      packed[o] = d.sourceLevel;
      packed[o + 1] = d.targetLevel;
      packed[o + 2] = d.refinementRatio;
      packed[o + 3] = operationCode(d.operation);
      packed[o + 4] = relationCode(d.relation);
      packed[o + 5] = d.targetCell[0];
      packed[o + 6] = d.targetCell[1];
      packed[o + 7] = d.targetCell[2];
      packed[o + 8] = d.sourceCellCount;
      // Reserved slots for stable future GPU chunk-index fields.
      packed[o + 9] = 0;
      packed[o + 10] = 0;
      packed[o + 11] = 0;
    });

    return packed;
  }
}

function validateChunkKey(key: string, expectedLevel: number, role: "source" | "target"): void {
  const match = /^(\d+):(-?\d+),(-?\d+),(-?\d+)$/.exec(key);
  if (!match) {
    throw new Error(`GPU boundary transfer ${role} chunk has an invalid key`);
  }

  const level = Number(match[1]);
  const coordinates = match.slice(2).map(Number);
  if (
    !Number.isSafeInteger(level) ||
    level < 0 ||
    level > 30 ||
    level !== expectedLevel ||
    coordinates.some(value => !Number.isSafeInteger(value))
  ) {
    throw new Error(`GPU boundary transfer ${role} chunk key does not match its declared LOD level or safe coordinates`);
  }
}

function operationCode(operation: InfinityScaleGPUBoundaryTransferDescriptor["operation"]): number {
  return operation === "copy" ? 0 : operation === "prolongation" ? 1 : 2;
}

function relationCode(relation: InfinityScaleGPUBoundaryTransferDescriptor["relation"]): number {
  return relation === "same-level" ? 0 : relation === "coarse-to-fine" ? 1 : 2;
}
