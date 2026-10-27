import type { InfinityScaleBoundaryTransferSpec } from "./InfinityScaleChunkExecutionContext";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import { getInfinityScaleChunkBounds, validateInfinityScaleChunkPair } from "./InfinityScaleChunkKey";

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
  level: number;
  chunkSize: number;
  keyX: number;
  keyY: number;
  keyZ: number;
}

export function resolveInfinityScaleBoundaryFaceGeometry(
  spec: InfinityScaleBoundaryTransferSpec,
  chunkSize = 32,
): InfinityScaleBoundaryFaceGeometry | null {
  const pair = validateInfinityScaleChunkPair(
    spec.sourceChunk, spec.targetChunk, spec.relation, spec.sourceLevel, spec.targetLevel,
  );
  const target = rangeForChunk(spec.targetChunk, chunkSize);
  const source = rangeForChunk(spec.sourceChunk, chunkSize);
  const scale = 2 ** pair.target.level;

  type Axis = 0 | 1 | 2;
  const axes: Axis[] = [0, 1, 2];
  const mins = (r: ChunkRange): [number, number, number] => [r.minX, r.minY, r.minZ];
  const maxs = (r: ChunkRange): [number, number, number] => [r.maxX, r.maxY, r.maxZ];
  const tMin = mins(target), tMax = maxs(target);
  const sMin = mins(source), sMax = maxs(source);

  for (const axis of axes) {
    const tangents = axes.filter(a => a !== axis);
    const tangentialOverlap = tangents.every(a =>
      Math.min(tMax[a], sMax[a]) - Math.max(tMin[a], sMin[a]) + 1 >= scale
    );
    if (!tangentialOverlap) continue;

    let coordinate: number | null = null;
    if (tMax[axis] + 1 === sMin[axis]) {
      coordinate = tMax[axis];
    } else if (sMax[axis] + 1 === tMin[axis]) {
      coordinate = tMin[axis];
    }


    if (coordinate !== null) {
      const tangentialAxes = axes.filter(a => a !== axis);
      return {
        axis,
        coordinate,
        minU: Math.max(tMin[tangentialAxes[0]], sMin[tangentialAxes[0]]),
        maxU: Math.min(tMax[tangentialAxes[0]], sMax[tangentialAxes[0]]),
        minV: Math.max(tMin[tangentialAxes[1]], sMin[tangentialAxes[1]]),
        maxV: Math.min(tMax[tangentialAxes[1]], sMax[tangentialAxes[1]]),
        scale,
      };
    }
  }
  return null;
}

export function isInfinityScaleSourceBoundaryCell(
  spec: InfinityScaleBoundaryTransferSpec,
  targetCell: [number, number, number],
  chunkSize = 32,
): boolean {
  if (!Array.isArray(targetCell) || targetCell.length !== 3 ||
      !targetCell.every(Number.isSafeInteger)) return false;
  const face = resolveInfinityScaleBoundaryFaceGeometry(spec, chunkSize);
  if (!face) return false;

  const source = rangeForChunk(spec.sourceChunk, chunkSize);
  const sourceScale = 2 ** spec.sourceLevel;
  const coordinates = targetCell;
  const aligned = (value: number, scale: number) => value % scale === 0;

  // Source-side anchors use source LOD spacing; target-side anchors use target
  // LOD spacing. A base coordinate inside a coarse cell must not alias a
  // second transaction key for the same underlying hierarchical cell.
  const belongsToFace = (
    normalCoordinate: number,
    sourceCoordinate: number,
    tangentAxes: readonly [0 | 1 | 2, 0 | 1 | 2],
    minU: number,
    maxU: number,
    minV: number,
    maxV: number,
  ): boolean => {
    const onTargetSide = normalCoordinate === face.coordinate;
    const onSourceSide = normalCoordinate === sourceCoordinate;
    if (!onTargetSide && !onSourceSide) return false;
    if (coordinates[tangentAxes[0]] < minU || coordinates[tangentAxes[0]] > maxU ||
        coordinates[tangentAxes[1]] < minV || coordinates[tangentAxes[1]] > maxV) return false;
    const scale = onTargetSide ? face.scale : sourceScale;
    return aligned(coordinates[tangentAxes[0]], scale) &&
      aligned(coordinates[tangentAxes[1]], scale);
  };

  if (face.axis === 0) {
    const sourceCoordinate = source.maxX < face.coordinate ? source.maxX : source.minX;
    return belongsToFace(coordinates[0], sourceCoordinate, [1, 2], face.minU, face.maxU, face.minV, face.maxV);
  }
  if (face.axis === 1) {
    const sourceCoordinate = source.maxY < face.coordinate ? source.maxY : source.minY;
    return belongsToFace(coordinates[1], sourceCoordinate, [0, 2], face.minU, face.maxU, face.minV, face.maxV);
  }
  const sourceCoordinate = source.maxZ < face.coordinate ? source.maxZ : source.minZ;
  return belongsToFace(coordinates[2], sourceCoordinate, [0, 1], face.minU, face.maxU, face.minV, face.maxV);
}

/** Backward-compatible alias; new solver code should use the explicit source-side name. */
export const isInfinityScaleBoundaryCell = isInfinityScaleSourceBoundaryCell;

export function mapInfinityScaleBoundaryCell(
  spec: InfinityScaleBoundaryTransferSpec,
  targetCell: [number, number, number],
  chunkSize = 32,
): InfinityScaleBoundaryCellMapping {
  const pair = validateInfinityScaleChunkPair(
    spec.sourceChunk, spec.targetChunk, spec.relation, spec.sourceLevel, spec.targetLevel,
  );
  const targetScale = 2 ** pair.target.level;
  const sourceScale = 2 ** pair.source.level;
  const faceGeometry = resolveInfinityScaleBoundaryFaceGeometry(spec, chunkSize);
  if (!faceGeometry) {
    throw new Error(`Boundary mapping requires adjacent chunks: ${spec.sourceChunk} -> ${spec.targetChunk}`);
  }
  if (!Array.isArray(targetCell) || targetCell.length !== 3 ||
      !targetCell.every(Number.isSafeInteger)) {
    throw new Error("Boundary mapping requires three safe integer target coordinates");
  }
  const targetRangeForValidation = rangeForChunk(spec.targetChunk, chunkSize);
  const targetMins = [
    targetRangeForValidation.minX,
    targetRangeForValidation.minY,
    targetRangeForValidation.minZ,
  ];
  const tangentAxes = faceGeometry.axis === 0
    ? [1, 2] as const
    : faceGeometry.axis === 1
      ? [0, 2] as const
      : [0, 1] as const;
  const u = targetCell[tangentAxes[0]];
  const v = targetCell[tangentAxes[1]];
  if (
    targetCell[faceGeometry.axis] !== faceGeometry.coordinate ||
    u < faceGeometry.minU || u > faceGeometry.maxU ||
    v < faceGeometry.minV || v > faceGeometry.maxV ||
    (u - targetMins[tangentAxes[0]]) % targetScale !== 0 ||
    (v - targetMins[tangentAxes[1]]) % targetScale !== 0
  ) {
    throw new Error("Boundary mapping requires an aligned target face cell");
  }

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

  resolveValues(
    spec: InfinityScaleBoundaryTransferSpec,
    targetCell: [number, number, number],
  ): ReadonlyArray<ReadonlyArray<number>> {
    const mapping = this.map(spec, targetCell);
    return mapping.sourceCells.map(([x, y, z]) => {
      const values = this.state.readBaseCell(spec.sourceChunk, spec.sourceLevel, x, y, z);
      if (!values) throw new Error(`Infinity Scale boundary source cell is missing: ${spec.sourceChunk}:${x},${y},${z}`);
      return Array.from(values);
    });
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
}


function rangeForChunk(key: string, chunkSize: number): ChunkRange {
  const bounds = getInfinityScaleChunkBounds(key, chunkSize);
  return {
    minX: bounds.minX, maxX: bounds.maxX,
    minY: bounds.minY, maxY: bounds.maxY,
    minZ: bounds.minZ, maxZ: bounds.maxZ,
    level: bounds.level, chunkSize: bounds.chunkSize,
    keyX: bounds.x, keyY: bounds.y, keyZ: bounds.z,
  };
}
function sharedFaceAxis(a: ChunkRange, b: ChunkRange): 0 | 1 | 2 | null {
  const overlapsX = a.minX <= b.maxX && a.maxX >= b.minX;
  const overlapsY = a.minY <= b.maxY && a.maxY >= b.minY;
  const overlapsZ = a.minZ <= b.maxZ && a.maxZ >= b.minZ;

  // Same-LOD chunks use neighboring chunk indices.
  if (a.level === b.level) {
    if (Math.abs(a.keyX - b.keyX) === 1 && a.keyY === b.keyY && a.keyZ === b.keyZ) return 0;
    if (Math.abs(a.keyY - b.keyY) === 1 && a.keyX === b.keyX && a.keyZ === b.keyZ) return 1;
    if (Math.abs(a.keyZ - b.keyZ) === 1 && a.keyX === b.keyX && a.keyY === b.keyY) return 2;
    return null;
  }

  // Cross-LOD neighbours can have either touching ranges or a fine chunk
  // embedded in the outermost slice of a coarse chunk. Require that the
  // smaller chunk occupies the coarse chunk's exterior plane and shares the
  // other two chunk-origin coordinates; a diagonal/edge-only contact fails.
  if ((a.maxX + 1 === b.minX || b.maxX + 1 === a.minX) && overlapsY && overlapsZ) return 0;
  if ((a.maxY + 1 === b.minY || b.maxY + 1 === a.minY) && overlapsX && overlapsZ) return 1;
  if ((a.maxZ + 1 === b.minZ || b.maxZ + 1 === a.minZ) && overlapsX && overlapsY) return 2;

  if (a.maxX === b.maxX && overlapsY && overlapsZ) {
    const sameTangentialOrigin = a.keyY === b.keyY && a.keyZ === b.keyZ;
    if (sameTangentialOrigin) return 0;
  }
  if (a.maxY === b.maxY && overlapsX && overlapsZ) {
    const sameTangentialOrigin = a.keyX === b.keyX && a.keyZ === b.keyZ;
    if (sameTangentialOrigin) return 1;
  }
  if (a.maxZ === b.maxZ && overlapsX && overlapsY) {
    const sameTangentialOrigin = a.keyX === b.keyX && a.keyY === b.keyY;
    if (sameTangentialOrigin) return 2;
  }
  return null;
}
function floorToScale(value: number, scale: number): number { return Math.floor(value / scale) * scale; }
function sourceFaceCoordinate(source: ChunkRange, target: ChunkRange, axis: 0 | 1 | 2, sourceScale: number): number {
  const sMin = axis === 0 ? source.minX : axis === 1 ? source.minY : source.minZ;
  const sMax = axis === 0 ? source.maxX : axis === 1 ? source.maxY : source.maxZ;
  const tMin = axis === 0 ? target.minX : axis === 1 ? target.minY : target.minZ;
  const raw = sMax < tMin ? sMax : sMin;
  return floorToScale(raw, sourceScale);
}
