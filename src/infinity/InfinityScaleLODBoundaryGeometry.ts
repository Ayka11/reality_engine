import type { InfinityScaleBoundaryTransferSpec } from "./InfinityScaleChunkExecutionContext";
import { mapInfinityScaleBoundaryCell, resolveInfinityScaleBoundaryFaceGeometry } from "./InfinityScaleLODBoundaryCellMapper";

export function validateInfinityScaleBoundaryChunks(
  spec: InfinityScaleBoundaryTransferSpec,
  chunkSize = 32,
): boolean {
  return resolveInfinityScaleBoundaryFaceGeometry(spec, chunkSize) !== null;
}


export interface InfinityScaleBoundaryGeometry {
  axis: "x" | "y" | "z";
  direction: -1 | 1;
  sourceScale: number;
  targetScale: number;
  refinementRatio: number;
}

/**
 * Validates that a mixed-LOD transfer describes an actual shared face and
 * that the local cell is on that face. This is intentionally independent of
 * field transfer so it can be reused by execution validation.
 */
export function validateInfinityScaleBoundaryGeometry(
  spec: InfinityScaleBoundaryTransferSpec,
  targetCell: [number, number, number],
  chunkSize = 32,
): InfinityScaleBoundaryGeometry | null {
  const source = chunkRange(spec.sourceChunk, chunkSize);
  const target = chunkRange(spec.targetChunk, chunkSize);
  const [x, y, z] = targetCell;
  const sourceScale = 2 ** spec.sourceLevel;
  const targetScale = 2 ** spec.targetLevel;

  if (source.maxX + 1 === target.minX && x === source.maxX &&
      y >= target.minY && y <= target.maxY &&
      z >= target.minZ && z <= target.maxZ) {
    return { axis: "x", direction: 1, sourceScale, targetScale, refinementRatio: spec.refinementRatio };
  }
  if (target.maxX + 1 === source.minX && x === source.minX &&
      y >= target.minY && y <= target.maxY &&
      z >= target.minZ && z <= target.maxZ) {
    return { axis: "x", direction: -1, sourceScale, targetScale, refinementRatio: spec.refinementRatio };
  }
  if (source.maxY + 1 === target.minY && y === source.maxY &&
      x >= target.minX && x <= target.maxX &&
      z >= target.minZ && z <= target.maxZ) {
    return { axis: "y", direction: 1, sourceScale, targetScale, refinementRatio: spec.refinementRatio };
  }
  if (target.maxY + 1 === source.minY && y === source.minY &&
      x >= target.minX && x <= target.maxX &&
      z >= target.minZ && z <= target.maxZ) {
    return { axis: "y", direction: -1, sourceScale, targetScale, refinementRatio: spec.refinementRatio };
  }
  if (source.maxZ + 1 === target.minZ && z === source.maxZ &&
      x >= target.minX && x <= target.maxX &&
      y >= target.minY && y <= target.maxY) {
    return { axis: "z", direction: 1, sourceScale, targetScale, refinementRatio: spec.refinementRatio };
  }
  if (target.maxZ + 1 === source.minZ && z === source.minZ &&
      x >= target.minX && x <= target.maxX &&
      y >= target.minY && y <= target.maxY) {
    return { axis: "z", direction: -1, sourceScale, targetScale, refinementRatio: spec.refinementRatio };
  }

  return null;
}

function chunkRange(key: string, chunkSize: number) {
  const match = /^(\d+):(-?\d+),(-?\d+),(-?\d+)$/.exec(key);
  if (!match) throw new Error(`Invalid Infinity Scale chunk key: ${key}`);

  const level = Number(match[1]);
  const scale = 2 ** level;
  const extent = chunkSize * scale;
  const cx = Number(match[2]);
  const cy = Number(match[3]);
  const cz = Number(match[4]);

  return {
    minX: cx * extent,
    maxX: cx * extent + extent - 1,
    minY: cy * extent,
    maxY: cy * extent + extent - 1,
    minZ: cz * extent,
    maxZ: cz * extent + extent - 1,
  };
}

export interface InfinityScaleBoundaryCoverageValidation {
  valid: boolean;
  faceCellCount: number;
  mappedCellCount: number;
  unmappedCellCount: number;
  duplicateCellCount: number;
  invalidRatioCount: number;
  firstUnmappedCell?: [number, number, number];
}

/**
 * Enumerates every source-face cell and verifies that each one maps to a
 * dependency-side footprint with exactly the expected LOD ratio.
 *
 * The check is geometry-only: it does not read field values or entity IDs.
 */
export function validateInfinityScaleBoundaryCoverage(
  spec: InfinityScaleBoundaryTransferSpec,
  chunkSize = 32,
): InfinityScaleBoundaryCoverageValidation {
  const face = resolveInfinityScaleBoundaryFaceGeometry(spec, chunkSize);
  if (!face) return { valid: false, faceCellCount: 0, mappedCellCount: 0, unmappedCellCount: 0, duplicateCellCount: 0, invalidRatioCount: 0 };
  const ratio = spec.refinementRatio;
  const expectedRatio = 2 ** Math.abs(spec.sourceLevel - spec.targetLevel);
  const invalidRatioCount = ratio === expectedRatio && Number.isInteger(ratio) && ratio >= 2 ? 0 : 1;
  const mapped = new Set<string>();
  let faceCellCount = 0;
  let unmappedCellCount = 0;
  let duplicateCellCount = 0;
  let firstUnmappedCell: [number, number, number] | undefined;
  const targetScale = 2 ** spec.targetLevel;
  for (let v = face.minV; v <= face.maxV; v += targetScale) {
    for (let u = face.minU; u <= face.maxU; u += targetScale) {
      const cell: [number, number, number] = face.axis === 0 ? [face.coordinate, u, v] : face.axis === 1 ? [u, face.coordinate, v] : [u, v, face.coordinate];
      faceCellCount++;
      try {
        const mapping = mapInfinityScaleBoundaryCell(spec, cell, chunkSize);
        const key = mapping.sourceCells.map(source => source.join(",")).join(";");
        if (spec.relation === "fine-to-coarse" && mapped.has(key)) duplicateCellCount++;
        mapped.add(key);
      } catch {
        unmappedCellCount++;
        firstUnmappedCell ??= cell;
      }
    }
  }
  return {
    valid: invalidRatioCount === 0 && faceCellCount > 0 && unmappedCellCount === 0 && duplicateCellCount === 0,
    faceCellCount, mappedCellCount: mapped.size, unmappedCellCount, duplicateCellCount, invalidRatioCount,
    ...(firstUnmappedCell ? { firstUnmappedCell } : {}),
  };
}


