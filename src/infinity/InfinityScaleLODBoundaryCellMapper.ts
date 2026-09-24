import type { InfinityScaleBoundaryTransferSpec } from "./InfinityScaleChunkExecutionContext";
import { InfinityScaleLODState } from "./InfinityScaleLODState";

export interface InfinityScaleBoundaryCellMapping {
  targetCell: [number, number, number];
  sourceCells: Array<[number, number, number]>;
}

export class InfinityScaleLODBoundaryCellMapper {
  constructor(
    private readonly state: InfinityScaleLODState,
    private readonly chunkSize = 32,
  ) {}

  map(
    spec: InfinityScaleBoundaryTransferSpec,
    targetCell: [number, number, number],
  ): InfinityScaleBoundaryCellMapping {
    const targetLevel = spec.targetLevel;
    const sourceLevel = spec.sourceLevel;
    const targetScale = 2 ** targetLevel;
    const sourceScale = 2 ** sourceLevel;

    if (spec.relation === "same-level") {
      return {
        targetCell,
        sourceCells: [targetCell],
      };
    }

    const ratio = spec.refinementRatio;
    if (!Number.isInteger(ratio) || ratio < 2) {
      throw new Error("Mixed-LOD boundary mapping requires refinement ratio >= 2");
    }

    if (sourceLevel > targetLevel) {
      // The source is coarser. All fine target cells map to the coarse source
      // cell containing the target coordinate.
      const sourceCell: [number, number, number] = [
        floorToScale(targetCell[0], sourceScale),
        floorToScale(targetCell[1], sourceScale),
        floorToScale(targetCell[2], sourceScale),
      ];
      return { targetCell, sourceCells: [sourceCell] };
    }

    // The source is finer. A coarse target cell receives the complete fine
    // footprint represented by ratio^3 source cells.
    const coarseOrigin: [number, number, number] = [
      floorToScale(targetCell[0], targetScale),
      floorToScale(targetCell[1], targetScale),
      floorToScale(targetCell[2], targetScale),
    ];
    const sourceCells: Array<[number, number, number]> = [];
    const step = sourceScale;

    for (let z = 0; z < ratio; z++) {
      for (let y = 0; y < ratio; y++) {
        for (let x = 0; x < ratio; x++) {
          sourceCells.push([
            coarseOrigin[0] + x * step,
            coarseOrigin[1] + y * step,
            coarseOrigin[2] + z * step,
          ]);
        }
      }
    }

    if (sourceCells.length !== ratio ** 3) {
      throw new Error("Mixed-LOD boundary mapping produced incomplete source footprint");
    }

    return { targetCell, sourceCells };
  }

  resolveValues(
    spec: InfinityScaleBoundaryTransferSpec,
    targetCell: [number, number, number],
  ): ReadonlyArray<ReadonlyArray<number>> {
    const mapping = this.map(spec, targetCell);
    return mapping.sourceCells.map(cell => {
      const value = this.state.readBaseCell(
        spec.targetChunk,
        spec.targetLevel,
        cell[0],
        cell[1],
        cell[2],
      );
      if (!value) {
        throw new Error(
          `Missing mixed-LOD boundary source at ${spec.targetChunk}:${cell.join(",")}`,
        );
      }
      return value;
    });
  }
}

function floorToScale(value: number, scale: number): number {
  return Math.floor(value / scale) * scale;
}

function sharedFaceAxis(
  target: ExecutionCellRange,
  source: ExecutionCellRange,
): 0 | 1 | 2 | null {
  if (target.maxX + 1 === source.minX || source.maxX + 1 === target.minX) return 0;
  if (target.maxY + 1 === source.minY || source.maxY + 1 === target.minY) return 1;
  if (target.maxZ + 1 === source.minZ || source.maxZ + 1 === target.minZ) return 2;
  return null;
}

function sourceFaceCoordinate(
  source: ExecutionCellRange,
  target: ExecutionCellRange,
  axis: 0 | 1 | 2,
): number {
  if (axis === 0) return source.minX > target.maxX ? source.minX : source.maxX;
  if (axis === 1) return source.minY > target.maxY ? source.minY : source.maxY;
  return source.minZ > target.maxZ ? source.minZ : source.maxZ;
}
