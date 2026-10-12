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
  const target = rangeForChunk(spec.targetChunk, chunkSize);
  const source = rangeForChunk(spec.sourceChunk, chunkSize);
  const targetScale = 2 ** spec.targetLevel;

  const positiveSpan = (aMin: number, aMax: number, bMin: number, bMax: number, scale: number) =>
    Math.min(aMax, bMax) - Math.max(aMin, bMin) + 1 >= scale;

  const candidates: Array<{
    axis: 0 | 1 | 2;
    coordinate: number;
    targetMin: number;
    targetMax: number;
    sourceMin: number;
    sourceMax: number;
    targetUmin: number;
    targetUmax: number;
    sourceUmin: number;
    sourceUmax: number;
    targetVmin: number;
    targetVmax: number;
    sourceVmin: number;
    sourceVmax: number;
  }> = [];

  const addCandidate = (
    axis: 0 | 1 | 2,
    tMin: number, tMax: number, sMin: number, sMax: number,
    tUmin: number, tUmax: number, sUmin: number, sUmax: number,
    tVmin: number, tVmax: number, sVmin: number, sVmax: number,
  ) => {
    let coordinate: number | null = null;
    if (tMax + 1 === sMin) coordinate = tMax;
    else if (sMax + 1 === tMin) coordinate = tMin;
    else if (target.level !== source.level) {
      // The fine chunk must abut the exterior face of the coarse chunk on the
      // normal axis. Do not use mere bounding-box overlap to infer adjacency.
      const targetCoarse = target.level > source.level;
      const coarseMin = targetCoarse ? tMin : sMin;
      const coarseMax = targetCoarse ? tMax : sMax;
      const fineMin = targetCoarse ? sMin : tMin;
      const fineMax = targetCoarse ? sMax : tMax;
      const spansTouchAtOuterPlane =
        fineMax + 1 === coarseMin || coarseMax + 1 === fineMin;
      if (spansTouchAtOuterPlane) {
        // The geometry coordinate must always belong to the target-side face.
        // For target=fine / source=coarse, the fine face is its minimum when
        // the coarse chunk is immediately before it; for target=coarse / source=fine,
        // the coarse face is its maximum in the mirrored arrangement.
        if (targetCoarse) {
          coordinate = fineMax + 1 === coarseMin ? tMin : tMax;
        } else {
          coordinate = fineMax + 1 === coarseMin ? tMax : tMin;
        }
      }
    }
    if (coordinate === null) return;
    if (!positiveSpan(tUmin, tUmax, sUmin, sUmax, targetScale) ||
        !positiveSpan(tVmin, tVmax, sVmin, sVmax, targetScale)) return;
    candidates.push({
      axis, coordinate,
      targetMin: tMin, targetMax: tMax, sourceMin: sMin, sourceMax: sMax,
      targetUmin: tUmin, targetUmax: tUmax, sourceUmin: sUmin, sourceUmax: sUmax,
      targetVmin: tVmin, targetVmax: tVmax, sourceVmin: sVmin, sourceVmax: sVmax,
    });
  };

  addCandidate(0, target.minX, target.maxX, source.minX, source.maxX,
    target.minY, target.maxY, source.minY, source.maxY,
    target.minZ, target.maxZ, source.minZ, source.maxZ);
  addCandidate(1, target.minY, target.maxY, source.minY, source.maxY,
    target.minX, target.maxX, source.minX, source.maxX,
    target.minZ, target.maxZ, source.minZ, source.maxZ);
  addCandidate(2, target.minZ, target.maxZ, source.minZ, source.maxZ,
    target.minX, target.maxX, source.minX, source.maxX,
    target.minY, target.maxY, source.minY, source.maxY);

  if (candidates.length === 0) return null;
  const face = candidates[0];
  return {
    axis: face.axis,
    coordinate: face.coordinate,
    minU: Math.max(face.targetUmin, face.sourceUmin),
    maxU: Math.min(face.targetUmax, face.sourceUmax),
    minV: Math.max(face.targetVmin, face.sourceVmin),
    maxV: Math.min(face.targetVmax, face.sourceVmax),
    scale: targetScale,
  };
}

export function isInfinityScaleSourceBoundaryCell(
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

/** Backward-compatible alias; new solver code should use the explicit source-side name. */
export const isInfinityScaleBoundaryCell = isInfinityScaleSourceBoundaryCell;

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
  const match = /^(\d+):(-?\d+),(-?\d+),(-?\d+)$/.exec(key);
  if (!match) throw new Error(`Invalid Infinity Scale chunk key: ${key}`);
  const level = Number(match[1]);
  if (!Number.isInteger(level) || level < 0 || level > 30) throw new Error(`Invalid Infinity Scale LOD level: ${match[1]}`);
  const keyX = Number(match[2]), keyY = Number(match[3]), keyZ = Number(match[4]);
  const extent = chunkSize * (2 ** level);
  const x = keyX * extent, y = keyY * extent, z = keyZ * extent;
  return { minX: x, maxX: x + extent - 1, minY: y, maxY: y + extent - 1, minZ: z, maxZ: z + extent - 1, level, chunkSize, keyX, keyY, keyZ };
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
