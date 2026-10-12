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

  // Chunk-key coordinates are expressed in chunk units at each LOD. A fine
  // chunk may sit next to a coarse chunk whose edge is several fine chunks away.
  // Derive the interface from the ranges, not from exact one-cell adjacency.
  const xOverlap = Math.max(target.minX, source.minX) <= Math.min(target.maxX, source.maxX);
  const yOverlap = Math.max(target.minY, source.minY) <= Math.min(target.maxY, source.maxY);
  const zOverlap = Math.max(target.minZ, source.minZ) <= Math.min(target.maxZ, source.maxZ);
  if (target.maxX < source.minX && yOverlap && zOverlap) {
    return { axis: 0, coordinate: target.maxX, minU: Math.max(target.minY, source.minY), maxU: Math.min(target.maxY, source.maxY), minV: Math.max(target.minZ, source.minZ), maxV: Math.min(target.maxZ, source.maxZ), scale };
  }
  if (source.maxX < target.minX && yOverlap && zOverlap) {
    return { axis: 0, coordinate: target.minX, minU: Math.max(target.minY, source.minY), maxU: Math.min(target.maxY, source.maxY), minV: Math.max(target.minZ, source.minZ), maxV: Math.min(target.maxZ, source.maxZ), scale };
  }
  if (target.maxY < source.minY && xOverlap && zOverlap) {
    return { axis: 1, coordinate: target.maxY, minU: Math.max(target.minX, source.minX), maxU: Math.min(target.maxX, source.maxX), minV: Math.max(target.minZ, source.minZ), maxV: Math.min(target.maxZ, source.maxZ), scale };
  }
  if (source.maxY < target.minY && xOverlap && zOverlap) {
    return { axis: 1, coordinate: target.minY, minU: Math.max(target.minX, source.minX), maxU: Math.min(target.maxX, source.maxX), minV: Math.max(target.minZ, source.minZ), maxV: Math.min(target.maxZ, source.maxZ), scale };
  }
  if (target.maxZ < source.minZ && xOverlap && yOverlap) {
    return { axis: 2, coordinate: target.maxZ, minU: Math.max(target.minX, source.minX), maxU: Math.min(target.maxX, source.maxX), minV: Math.max(target.minY, source.minY), maxV: Math.min(target.maxY, source.maxY), scale };
  }
  if (source.maxZ < target.minZ && xOverlap && yOverlap) {
    return { axis: 2, coordinate: target.minZ, minU: Math.max(target.minX, source.minX), maxU: Math.min(target.maxX, source.maxX), minV: Math.max(target.minY, source.minY), maxV: Math.min(target.maxY, source.maxY), scale };
  }
  return null;
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
  const extent = chunkSize * (2 ** level);
  const x = Number(match[2]) * extent, y = Number(match[3]) * extent, z = Number(match[4]) * extent;
  return { minX: x, maxX: x + extent - 1, minY: y, maxY: y + extent - 1, minZ: z, maxZ: z + extent - 1 };
}
function sharedFaceAxis(a: ChunkRange, b: ChunkRange): 0 | 1 | 2 | null {
  // Chunk-key coordinates are in chunk units at their own LOD. Their world
  // ranges may overlap after conversion to base-cell coordinates; the shared
  // face must therefore be identified from the LOD-relative chunk indices.
  const aKeyLevel = a.level;
  const bKeyLevel = b.level;
  const aScale = 2 ** aKeyLevel;
  const bScale = 2 ** bKeyLevel;
  const chunkSize = a.chunkSize;
  const aExtent = chunkSize * aScale;
  const bExtent = chunkSize * bScale;
  const overlapsX = a.minX <= b.maxX && a.maxX >= b.minX;
  const overlapsY = a.minY <= b.maxY && a.maxY >= b.minY;
  const overlapsZ = a.minZ <= b.maxZ && a.maxZ >= b.minZ;

  // A true interface has touching range boundaries, not an arbitrary gap.
  if ((a.maxX + 1 === b.minX || b.maxX + 1 === a.minX) && overlapsY && overlapsZ) return 0;
  if ((a.maxY + 1 === b.minY || b.maxY + 1 === a.minY) && overlapsX && overlapsZ) return 1;
  if ((a.maxZ + 1 === b.minZ || b.maxZ + 1 === a.minZ) && overlapsX && overlapsY) return 2;

  // When one chunk is coarser, its index-grid face spans multiple fine chunks.
  // Normalize chunk origin coordinates into the common coarser grid to test
  // adjacency without confusing overlapping cell extents for contact.
  const ax = a.minX / aExtent, ay = a.minY / aExtent, az = a.minZ / aExtent;
  const bx = b.minX / bExtent, by = b.minY / bExtent, bz = b.minZ / bExtent;
  const scaleRatio = Math.max(aScale, bScale) / Math.min(aScale, bScale);
  if (!Number.isInteger(scaleRatio)) return null;
  if (a.maxX < b.minX && overlapsY && overlapsZ && Math.abs((ax + 1) - bx) <= scaleRatio) return 0;
  if (b.maxX < a.minX && overlapsY && overlapsZ && Math.abs((bx + 1) - ax) <= scaleRatio) return 0;
  if (a.maxY < b.minY && overlapsX && overlapsZ && Math.abs((ay + 1) - by) <= scaleRatio) return 1;
  if (b.maxY < a.minY && overlapsX && overlapsZ && Math.abs((by + 1) - ay) <= scaleRatio) return 1;
  if (a.maxZ < b.minZ && overlapsX && overlapsY && Math.abs((az + 1) - bz) <= scaleRatio) return 2;
  if (b.maxZ < a.minZ && overlapsX && overlapsY && Math.abs((bz + 1) - az) <= scaleRatio) return 2;
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
