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
import { InfinityScaleLODBoundaryCellMapper } from "./InfinityScaleLODBoundaryCellMapper";

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

  private readonly boundaryMapper = new InfinityScaleLODBoundaryCellMapper(
    this.state,
    this.context.chunkSize,
  );

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
      const scale = 2 ** chunk.lod;
      for (let z = range.minZ; z <= range.maxZ; z += scale) {
        for (let y = range.minY; y <= range.maxY; y += scale) {
          for (let x = range.minX; x <= range.maxX; x += scale) {
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

    const stagedBoundaryUpdates = this.stageBoundaryTransfers(
      transaction,
      resolveBoundarySources,
    );
    const validation = transaction.synchronization.validate();
    return {
      executedCells,
      stagedBoundaryUpdates,
      transactionReady: validation.readyToCommit,
    };
  }

  /**
   * Stage only the cross-LOD face synchronization for the current frame.
   * This is intentionally separate from the local cell kernel so the runtime
   * can use the same exact mapper when another local solver owns the physics.
   */
  stageBoundaryTransfers(
    transaction: InfinityScaleGlobalLODTransaction,
    resolveBoundarySources?: InfinityScaleBoundarySourceResolver,
  ): number {
    if (transaction.committed) {
      throw new Error("Infinity Scale boundary staging rejected: transaction already committed");
    }
    this.state.assertRevision(transaction.stateRevision);

    let stagedBoundaryUpdates = 0;
    for (const spec of this.context.boundaryTransferSpecs) {
      const targetRange = this.rangeForChunk(spec.targetChunk);
      for (const targetCell of this.boundaryCells(targetRange, spec)) {
        const sources = resolveBoundarySources
          ? resolveBoundarySources(spec, targetCell)
          : this.boundaryMapper.resolveValues(spec, targetCell);
        transaction.synchronization.stageTransfer(spec, targetCell, sources);
        stagedBoundaryUpdates++;
      }
    }
    return stagedBoundaryUpdates;
  }
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
    return this.boundaryMapper.enumerateTargetFaceCells(
      spec,
      this.context.gridWidth,
      this.context.gridHeight,
      this.context.gridDepth,
    ).filter(([x, y, z]) =>
      x >= targetRange.minX && x <= targetRange.maxX &&
      y >= targetRange.minY && y <= targetRange.maxY &&
      z >= targetRange.minZ && z <= targetRange.maxZ
    );
  }

  private rangeTouches(a: ExecutionCellRange, b: ExecutionCellRange): boolean {
    return (
      a.minX <= b.maxX + 1 && a.maxX + 1 >= b.minX &&
      a.minY <= b.maxY + 1 && a.maxY + 1 >= b.minY &&
      a.minZ <= b.maxZ + 1 && a.maxZ + 1 >= b.minZ
    );
  }
}
