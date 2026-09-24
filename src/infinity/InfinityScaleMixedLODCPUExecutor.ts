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
    const chunk = this.context.simulationRanges[
      this.context.simulationRanges.findIndex((_, index) =>
        this.contextContainsChunkRange(key, index),
      )
    ];
    if (!chunk) {
      throw new Error(`Infinity Scale CPU execution chunk is outside the execution context: ${key}`);
    }
    return chunk;
  }

  private contextContainsChunkRange(key: string, index: number): boolean {
    const match = /^(\d+):/.exec(key);
    if (!match) return false;
    const level = Number(match[1]);
    const planRange = this.context.simulationRanges[index];
    return planRange !== undefined && level >= 0;
  }

  private boundaryCells(
    sourceRange: ExecutionCellRange,
    spec: InfinityScaleBoundaryTransferSpec,
  ): Array<[number, number, number]> {
    const cells: Array<[number, number, number]> = [];
    const targetRange = this.context.readRanges.find(range => this.rangeTouches(range, sourceRange));
    if (!targetRange) return cells;

    if (spec.relation === "same-level") {
      for (let z = sourceRange.minZ; z <= sourceRange.maxZ; z++) {
        for (let y = sourceRange.minY; y <= sourceRange.maxY; y++) {
          for (let x = sourceRange.minX; x <= sourceRange.maxX; x++) {
            if (
              x === sourceRange.minX || x === sourceRange.maxX ||
              y === sourceRange.minY || y === sourceRange.maxY ||
              z === sourceRange.minZ || z === sourceRange.maxZ
            ) cells.push([x, y, z]);
          }
        }
      }
    } else {
      const minX = Math.max(sourceRange.minX, targetRange.minX);
      const maxX = Math.min(sourceRange.maxX, targetRange.maxX);
      const minY = Math.max(sourceRange.minY, targetRange.minY);
      const maxY = Math.min(sourceRange.maxY, targetRange.maxY);
      const minZ = Math.max(sourceRange.minZ, targetRange.minZ);
      const maxZ = Math.min(sourceRange.maxZ, targetRange.maxZ);
      if (minX <= maxX && minY <= maxY && minZ <= maxZ) {
        for (let z = minZ; z <= maxZ; z++)
          for (let y = minY; y <= maxY; y++)
            for (let x = minX; x <= maxX; x++) cells.push([x, y, z]);
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
