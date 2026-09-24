import type { InfinityScaleBoundaryTransferSpec } from "./InfinityScaleChunkExecutionContext";
import { InfinityScaleLODState } from "./InfinityScaleLODState";

export interface InfinityScaleBoundaryCellMapping {
  targetCell: [number, number, number];
  sourceCells: Array<[number, number, number]>;
}

export interface InfinityScaleBoundaryFaceGeometry {
  axis: 0 | 1 | 2;
  coordinate: number;
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
  scale: number;
}

interface ChunkRange {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export function resolveInfinityScaleBoundaryFaceGeometry(
  spec: InfinityScaleBoundaryTransferSpec,
  chunkSize = 32,
): InfinityScaleBoundaryFaceGeometry | null {
  const target = rangeForChunk(spec.targetChunk, chunkSize);
  const source = rangeForChunk(spec.sourceChunk, chunkSize);
  const scale = 2 ** spec.targetLevel;
  const x0 = Math.max(target.minX, source.minX);
  const x1 = Math.min(target.maxX, source.maxX);
  const y0 = Math.max(target.minY, source.minY);
  const y1 = Math.min(target.maxY, source.maxY);
  const z0 = Math.max(target.minZ, source.minZ);
  const z1 = Math.min(target.maxZ, source.maxZ);
  if (target.maxX + 1 === source.minX && y0 <= y1 && z0 <= z1) return { axis: 0, coordinate: target.maxX, minU: y0, maxU: y1, minV: z0, maxV: z1, scale };
  if (source.maxX + 1 === target.minX && y0 <= y1 && z0 <= z1) return { axis: 0, coordinate: target.minX, minU: y0, maxU: y1, minV: z0, maxV: z1, scale };
  if (target.maxY + 1 === source.minY && x0 <= x1 && z0 <= z1) return { axis: 1, coordinate: target.maxY, minU: x0, maxU: x1, minV: z0, maxV: z1, scale };
  if (source.maxY + 1 === target.minY && x0 <= x1 && z0 <= z1) return { axis: 1, coordinate: target.minY, minU: x0, maxU: x1, minV: z0, maxV: z1, scale };
  if (target.maxZ + 1 === source.minZ && x0 <= x1 && y0 <= y1) return { axis: 2, coordinate: target.maxZ, minU: x0, maxU: x1, minV: y0, maxV: y1, scale };
  if (source.maxZ + 1 === target.minZ && x0 <= x1 && y0 <= y1) return { axis: 2, coordinate: target.minZ, minU: x0, maxU: x1, minV: y0, maxV: y1, scale };
  return null;
}

export function isInfinityScaleBoundaryCell(
  spec: InfinityScaleBoundaryTransferSpec,
  targetCell: [number, number, number],
  chunkSize = 32,
): boolean {
  const face = resolveInfinityScaleBoundaryFaceGeometry(spec, chunkSize);
  if (!face) return false;

  const source = rangeForChunk(spec.sourceChunk, chunkSize);
  const [x, y, z] = targetCell;

  if (face.axis === 0) {
    const sourceCoordinate = source.maxX < face.coordinate ? source.maxX : source.minX;
    return x === sourceCoordinate && y >= face.minU && y <= face.maxU && z >= face.minV && z <= face.maxV;
  }
  if (face.axis === 1) {
    const sourceCoordinate = source.maxY < face.coordinate ? source.maxY : source.minY;
    return y === sourceCoordinate && x >= face.minU && x <= face.maxU && z >= face.minV && z <= face.maxV;
  }
  const sourceCoordinate = source.maxZ < face.coordinate ? source.maxZ : source.minZ;
  return z === sourceCoordinate && x >= face.minU && x <= face.maxU && y >= face.minV && y <= face.maxV;
}

export function mapInfinityScaleBoundaryCell(
  spec: InfinityScaleBoundaryTransferSpec,
  targetCell: [number, number, number],
  chunkSize = 32,
): InfinityScaleBoundaryCellMapping {
  const targetScale = 2 ** spec.targetLevel;
  const sourceScale = 2 ** spec.sourceLevel;

  if (spec.relation === "same-level") {
    const sourceRange = rangeForChunk(spec.sourceChunk, chunkSize);
    const targetRange = rangeForChunk(spec.targetChunk, chunkSize);
    const axis = sharedFaceAxis(targetRange, sourceRange);
    if (axis === null) throw new Error(`Same-level boundary mapping requires adjacent chunks: ${spec.sourceChunk} -> ${spec.targetChunk}`);
    const sourceCell: [number, number, number] = [...targetCell];
    const targetIsLower = axis === 0
      ? targetRange.maxX < sourceRange.minX
      : axis === 1
        ? targetRange.maxY < sourceRange.minY
        : targetRange.maxZ < sourceRange.minZ;
    sourceCell[axis] += targetIsLower ? 1 : -1;
    return { targetCell, sourceCells: [sourceCell] };
  }
  const ratio = spec.refinementRatio;
  if (!Number.isInteger(ratio) || ratio < 2) throw new Error("Mixed-LOD boundary mapping requires refinement ratio >= 2");
  if (ratio !== Math.max(sourceScale, targetScale) / Math.min(sourceScale, targetScale)) {
    throw new Error("Mixed-LOD boundary mapping has inconsistent refinement ratio");
  }
  const sourceRange = rangeForChunk(spec.sourceChunk, chunkSize);
  const targetRange = rangeForChunk(spec.targetChunk, chunkSize);
  const axis = sharedFaceAxis(targetRange, sourceRange);
  if (axis === null) throw new Error(`Mixed-LOD boundary mapping requires adjacent chunks: ${spec.sourceChunk} -> ${spec.targetChunk}`);

  if (sourceScale > targetScale) {
    const sourceCell: [number, number, number] = [
      floorToScale(targetCell[0], sourceScale),
      floorToScale(targetCell[1], sourceScale),
      floorToScale(targetCell[2], sourceScale),
    ];
    sourceCell[axis] = sourceFaceCoordinate(sourceRange, targetRange, axis, sourceScale);
    return { targetCell, sourceCells: [sourceCell] };
  }

  const sourceNormal = sourceFaceCoordinate(sourceRange, targetRange, axis, sourceScale);
  const sourceCells: Array<[number, number, number]> = [];
  const tangentialAxes = ([0, 1, 2] as const).filter(value => value !== axis);
  const origins = new Map<number, number>();
  for (const tangentialAxis of tangentialAxes) origins.set(tangentialAxis, floorToScale(targetCell[tangentialAxis], targetScale));
  for (let a = 0; a < ratio; a++) for (let b = 0; b < ratio; b++) {
    const cell: [number, number, number] = [0, 0, 0];
    cell[axis] = sourceNormal;
    cell[tangentialAxes[0]] = (origins.get(tangentialAxes[0]) ?? 0) + a * sourceScale;
    cell[tangentialAxes[1]] = (origins.get(tangentialAxes[1]) ?? 0) + b * sourceScale;
    sourceCells.push(cell);
  }
  if (sourceCells.length !== ratio ** 2) throw new Error("Mixed-LOD boundary mapping produced incomplete face footprint");
  return { targetCell, sourceCells };
}

export class InfinityScaleLODBoundaryCellMapper {
  constructor(
    private readonly state: InfinityScaleLODState,
    private readonly chunkSize = 32,
  ) {}

  map(spec: InfinityScaleBoundaryTransferSpec, targetCell: [number, number, number]): InfinityScaleBoundaryCellMapping {
    return mapInfinityScaleBoundaryCell(spec, targetCell, this.chunkSize);
  }

  enumerateTargetFaceCells(
    spec: InfinityScaleBoundaryTransferSpec,
    gridWidth: number,
    gridHeight: number,
    gridDepth: number,
  ): Array<[number, number, number]> {
    const face = resolveInfinityScaleBoundaryFaceGeometry(spec, this.chunkSize);
    if (!face) return [];
    const cells: Array<[number, number, number]> = [];
    for (let v = face.minV; v <= face.maxV; v += face.scale) {
      for (let u = face.minU; u <= face.maxU; u += face.scale) {
        const cell: [number, number, number] = face.axis === 0 ? [face.coordinate, u, v] : face.axis === 1 ? [u, face.coordinate, v] : [u, v, face.coordinate];
        if (cell[0] >= 0 && cell[0] < gridWidth && cell[1] >= 0 && cell[1] < gridHeight && cell[2] >= 0 && cell[2] < gridDepth) cells.push(cell);
      }
    }
    return cells;
  }

