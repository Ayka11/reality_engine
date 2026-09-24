import type {
  InfinityScaleExecutionPlan,
} from "./InfinityScaleExecutionAdapter";
import type {
  InfinityScaleChunkExecutionContext,
  ExecutionCellRange,
} from "./InfinityScaleChunkExecutionContext";
import {
  InfinityScaleGlobalLODTransaction,
} from "./InfinityScaleGlobalLODTransaction";
import {
  InfinityScaleLODState,
} from "./InfinityScaleLODState";
import type {
  InfinityScaleBoundaryTransferSpec,
} from "./InfinityScaleChunkExecutionContext";
import type { InfinityScaleGlobalExecutionFrame } from "./InfinityScaleGlobalExecutionFrame";

export interface InfinityScaleCPUCellExecution {
  chunk: string;
  level: number;
  x: number;
  y: number;
  z: number;
  input: Float32Array;
  output: Float32Array;
}

export type InfinityScaleCPUCellKernel = (
  cell: InfinityScaleCPUCellExecution,
) => Float32Array;

export type InfinityScaleBoundarySourceResolver = (
  spec: InfinityScaleBoundaryTransferSpec,
  targetCell: [number, number, number],
) => ReadonlyArray<ReadonlyArray<number>>;

export interface InfinityScaleMixedLODCPUExecutionResult {
  executedCells: number;
  stagedBoundaryUpdates: number;
  transactionReady: boolean;
}

/**
 * CPU mixed-LOD execution kernel.
 *
 * Ownership is explicit: only simulation ranges are writable. Boundary chunks
 * are read dependencies and are never mutated by the local execution pass.
 * Boundary synchronization remains staged until the global
 * boundary-reconciliation phase.
 */
export class InfinityScaleMixedLODCPUExecutor {
  constructor(
    private readonly state: InfinityScaleLODState,
    private readonly context: InfinityScaleChunkExecutionContext,
  ) {}

  execute(
    frame: InfinityScaleGlobalExecutionFrame,
    plan: InfinityScaleExecutionPlan,
    transaction: InfinityScaleGlobalLODTransaction,
    kernel: InfinityScaleCPUCellKernel,
    resolveBoundarySources?: InfinityScaleBoundarySourceResolver,
  ): InfinityScaleMixedLODCPUExecutionResult {
    if (frame.phase !== "local-execution") {
      throw new Error(
        `Infinity Scale CPU execution requires local-execution phase; received ${frame.phase}`,
      );
    }
    if (frame.planRevision !== plan.revision) {
      throw new Error("Infinity Scale CPU execution rejected: plan revision changed");
    }
    this.state.assertRevision(transaction.stateRevision);

    let executedCells = 0;
    for (const chunk of plan.chunks) {
      const range = this.rangeForChunk(chunk.key);
      for (let z = range.minZ; z <= range.maxZ; z++) {
        for (let y = range.minY; y <= range.maxY; y++) {
          for (let x = range.minX; x <= range.maxX; x++) {
            const input = this.state.readBaseCell(chunk.key, chunk.lod, x, y, z);
            if (!input) {
              throw new Error(
                `Infinity Scale CPU execution missing owned cell at ${chunk.key}:${x},${y},${z}`,
              );
            }

            const output = kernel({
              chunk: chunk.key,
              level: chunk.lod,
              x,
              y,
              z,
              input: new Float32Array(input),
              output: new Float32Array(input),
            });

            if (output.length !== input.length) {
              throw new Error("Infinity Scale CPU cell kernel returned invalid field count");
            }

            this.state.writeBaseCell(chunk.key, chunk.lod, x, y, z, output);
            executedCells++;
          }
        }
      }
    }

    let stagedBoundaryUpdates = 0;
    if (resolveBoundarySources) {
      for (const spec of this.context.boundaryTransferSpecs) {
        const targetRange = this.rangeForChunk(spec.sourceChunk);
        for (const targetCell of this.boundaryCells(targetRange, spec)) {
          const sources = resolveBoundarySources(spec, targetCell);
          transaction.synchronization.stageTransfer(spec, targetCell, sources);
          stagedBoundaryUpdates++;
        }
      }
    }

    const validation = transaction.synchronization.validate();
    return {
      executedCells,
      stagedBoundaryUpdates,
      transactionReady: validation.readyToCommit,
    };
  }

  private rangeForChunk(key: string): ExecutionCellRange {
    const match = /^(\\d+):(-?\\d+),(-?\\d+),(-?\\d+)$/.exec(key);
    if (!match) throw new Error(`Invalid Infinity Scale chunk key: ${key}`);
    const level = Number(match[1]);
    const scale = 2 ** level;
    const extent = this.context.chunkSize * scale;
    const originX = Number(match[2]) * extent;
    const originY = Number(match[3]) * extent;
    const originZ = Number(match[4]) * extent;
    return {
      minX: Math.max(0, originX),
      maxX: Math.min(this.context.gridWidth - 1, originX + extent - 1),
      minY: Math.max(0, originY),
      maxY: Math.min(this.context.gridHeight - 1, originY + extent - 1),
      minZ: Math.max(0, originZ),
      maxZ: Math.min(this.context.gridDepth - 1, originZ + extent - 1),
    };
  }

  private boundaryCells(
    targetRange: ExecutionCellRange,
    spec: InfinityScaleBoundaryTransferSpec,
  ): Array<[number, number, number]> {
    const cells: Array<[number, number, number]> = [];
    const sourceRange = this.rangeForChunk(spec.sourceChunk);

    const minX = Math.max(targetRange.minX, sourceRange.minX - 1);
    const maxX = Math.min(targetRange.maxX, sourceRange.maxX + 1);
    const minY = Math.max(targetRange.minY, sourceRange.minY - 1);
    const maxY = Math.min(targetRange.maxY, sourceRange.maxY + 1);
    const minZ = Math.max(targetRange.minZ, sourceRange.minZ - 1);
    const maxZ = Math.min(targetRange.maxZ, sourceRange.maxZ + 1);

    if (minX > maxX || minY > maxY || minZ > maxZ) return cells;

    for (let z = minZ; z <= maxZ; z++) {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const onTargetFace =
            x === targetRange.minX || x === targetRange.maxX ||
            y === targetRange.minY || y === targetRange.maxY ||
            z === targetRange.minZ || z === targetRange.maxZ;
          if (onTargetFace) cells.push([x, y, z]);
        }
      }
    }
    return cells;
  }

  private rangeTouches(a: ExecutionCellRange, b: ExecutionCellRange): boolean {
    return (
      a.minX <= b.maxX + 1 && a.maxX + 1 >= b.minX &&
      a.minY <= b.maxY + 1 && a.maxY + 1 >= b.minY &&
      a.minZ <= b.maxZ + 1 && a.maxZ + 1 >= b.minZ
    );
  }
}
