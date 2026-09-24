import type { InfinityScaleBoundaryTransferSpec } from "./InfinityScaleChunkExecutionContext";
import { InfinityScaleLODState } from "./InfinityScaleLODState";

export interface InfinityScaleBoundaryCellMapping {
  targetCell: [number, number, number];
  sourceCells: Array<[number, number, number]>;
}

interface ChunkRange {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
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
    const targetScale = 2 ** spec.targetLevel;
    const sourceScale = 2 ** spec.sourceLevel;

    if (spec.relation === "same-level") {
      return { targetCell, sourceCells: [targetCell] };
    }

    const ratio = spec.refinementRatio;
    if (!Number.isInteger(ratio) || ratio < 2) {
      throw new Error("Mixed-LOD boundary mapping requires refinement ratio >= 2");
    }
    if (ratio !== Math.max(sourceScale, targetScale) / Math.min(sourceScale, targetScale)) {
      throw new Error("Mixed-LOD boundary mapping has inconsistent refinement ratio");
    }

    const sourceRange = this.rangeForChunk(spec.sourceChunk);
    const targetRange = this.rangeForChunk(spec.targetChunk);
    const axis = sharedFaceAxis(targetRange, sourceRange);
    if (axis === null) {
      throw new Error(
        `Mixed-LOD boundary mapping requires adjacent chunks: ${spec.sourceChunk} -> ${spec.targetChunk}`,
      );
    }

    if (sourceScale > targetScale) {
      // Coarse source -> fine target: map every fine boundary cell to the
      // coarse source cell touching the shared face.
      const sourceCell: [number, number, number] = [
        floorToScale(targetCell[0], sourceScale),
        floorToScale(targetCell[1], sourceScale),
        floorToScale(targetCell[2], sourceScale),
      ];
      sourceCell[axis] = sourceFaceCoordinate(sourceRange, targetRange, axis);
      return { targetCell, sourceCells: [sourceCell] };
    }

    // Fine source -> coarse target: map the coarse boundary cell to the
    // complete fine face footprint represented by ratio^2 source cells.
    const sourceNormal = sourceFaceCoordinate(sourceRange, targetRange, axis);
    const sourceCells: Array<[number, number, number]> = [];
    const step = sourceScale;

    const tangentialAxes = ([0, 1, 2] as const).filter(value => value !== axis);
    const origins = new Map<number, number>();
    for (const tangentialAxis of tangentialAxes) {
      origins.set(
        tangentialAxis,
        floorToScale(targetCell[tangentialAxis], targetScale),
      );
    }

    for (let a = 0; a < ratio; a++) {
      for (let b = 0; b < ratio; b++) {
        const cell: [number, number, number] = [0, 0, 0];
        cell[axis] = sourceNormal;
        cell[tangentialAxes[0]] = (origins.get(tangentialAxes[0]) ?? 0) + a * step;
        cell[tangentialAxes[1]] = (origins.get(tangentialAxes[1]) ?? 0) + b * step;
        sourceCells.push(cell);
      }
    }

    if (sourceCells.length !== ratio ** 2) {
      throw new Error("Mixed-LOD boundary mapping produced incomplete face footprint");
    }

    return { targetCell, sourceCells };
  }

  enumerateTargetFaceCells(
    spec: InfinityScaleBoundaryTransferSpec,
    gridWidth: number,
    gridHeight: number,
    gridDepth: number,
  ): Array<[number, number, number]> {
    const target = this.rangeForChunk(spec.targetChunk);
    const source = this.rangeForChunk(spec.sourceChunk);
    const scale = 2 ** spec.targetLevel;
    const cells: Array<[number, number, number]> = [];

    const x0 = Math.max(target.minX, source.minX);
    const x1 = Math.min(target.maxX, source.maxX);
    const y0 = Math.max(target.minY, source.minY);
    const y1 = Math.min(target.maxY, source.maxY);
    const z0 = Math.max(target.minZ, source.minZ);
    const z1 = Math.min(target.maxZ, source.maxZ);

    const pushFace = (
      axis: 0 | 1 | 2,
      coordinate: number,
      minU: number,
      maxU: number,
      minV: number,
      maxV: number,
    ) => {
      for (let v = minV; v <= maxV; v += scale) {
        for (let u = minU; u <= maxU; u += scale) {
          const cell: [number, number, number] =
            axis === 0 ? [coordinate, u, v] :
            axis === 1 ? [u, coordinate, v] :
            [u, v, coordinate];
          if (
            cell[0] >= 0 && cell[0] < gridWidth &&
            cell[1] >= 0 && cell[1] < gridHeight &&
            cell[2] >= 0 && cell[2] < gridDepth
          ) {
            cells.push(cell);
          }
        }
      }
    };

    if (target.maxX + 1 === source.minX) {
      pushFace(0, target.maxX, y0, y1, z0, z1);
    } else if (source.maxX + 1 === target.minX) {
      pushFace(0, target.minX, y0, y1, z0, z1);
    } else if (target.maxY + 1 === source.minY) {
      pushFace(1, target.maxY, x0, x1, z0, z1);
    } else if (source.maxY + 1 === target.minY) {
      pushFace(1, target.minY, x0, x1, z0, z1);
    } else if (target.maxZ + 1 === source.minZ) {
      pushFace(2, target.maxZ, x0, x1, y0, y1);
    } else if (source.maxZ + 1 === target.minZ) {
      pushFace(2, target.minZ, x0, x1, y0, y1);
    }

    return cells;
  }

  resolveValues(
    spec: InfinityScaleBoundaryTransferSpec,
    targetCell: [number, number, number],
  ): ReadonlyArray<ReadonlyArray<number>> {
    const mapping = this.map(spec, targetCell);
    return mapping.sourceCells.map(cell => {
      const value = this.state.readBaseCell(
        spec.sourceChunk,
        spec.sourceLevel,
        cell[0],
        cell[1],
        cell[2],
      );
      if (!value) {
        throw new Error(
          `Missing mixed-LOD boundary source at ${spec.sourceChunk}:${cell.join(",")}`,
        );
      }
      return value;
    });
  }

  private rangeForChunk(key: string): ChunkRange {
    const match = /^(\d+):(-?\d+),(-?\d+),(-?\d+)$/.exec(key);
    if (!match) throw new Error(`Invalid Infinity Scale chunk key: ${key}`);
    const level = Number(match[1]);
    const scale = 2 ** level;
    const extent = this.chunkSize * scale;
    const originX = Number(match[2]) * extent;
    const originY = Number(match[3]) * extent;
    const originZ = Number(match[4]) * extent;
    return {
      minX: originX,
      maxX: originX + extent - 1,
      minY: originY,
      maxY: originY + extent - 1,
      minZ: originZ,
      maxZ: originZ + extent - 1,
    };
  }
}

function floorToScale(value: number, scale: number): number {
  return Math.floor(value / scale) * scale;
}

function sharedFaceAxis(
  target: ChunkRange,
  source: ChunkRange,
): 0 | 1 | 2 | null {
  if (target.maxX + 1 === source.minX || source.maxX + 1 === target.minX) return 0;
  if (target.maxY + 1 === source.minY || source.maxY + 1 === target.minY) return 1;
  if (target.maxZ + 1 === source.minZ || source.maxZ + 1 === target.minZ) return 2;
  return null;
}

function sourceFaceCoordinate(
  source: ChunkRange,
  target: ChunkRange,
  axis: 0 | 1 | 2,
): number {
  if (axis === 0) return source.minX > target.maxX ? source.minX : source.maxX;
  if (axis === 1) return source.minY > target.maxY ? source.minY : source.maxY;
  return source.minZ > target.maxZ ? source.minZ : source.maxZ;
}
