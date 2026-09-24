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
 * Validates that a target cell belongs to the canonical shared face.
 * Face topology is resolved exclusively by the canonical boundary mapper.
 */
export function validateInfinityScaleBoundaryGeometry(
  spec: InfinityScaleBoundaryTransferSpec,
  targetCell: [number, number, number],
  chunkSize = 32,
): InfinityScaleBoundaryGeometry | null {
  const face = resolveInfinityScaleBoundaryFaceGeometry(spec, chunkSize);
  if (!face) return null;

  const [x, y, z] = targetCell;
  const onFace =
    face.axis === 0
      ? x === face.coordinate && y >= face.minU && y <= face.maxU && z >= face.minV && z <= face.maxV
      : face.axis === 1
        ? y === face.coordinate && x >= face.minU && x <= face.maxU && z >= face.minV && z <= face.maxV
        : z === face.coordinate && x >= face.minU && x <= face.maxU && y >= face.minV && y <= face.maxV;

  if (!onFace) return null;

  // The canonical face coordinate is on the target side. The source lies
  // outside that face. Resolve direction from the target chunk bounds without
  // maintaining an independent source/target adjacency algorithm.
  const targetLevel = spec.targetLevel;
  const targetScale = 2 ** targetLevel;
  const match = /^(\\d+):(-?\\d+),(-?\\d+),(-?\\d+)$/.exec(spec.targetChunk);
  if (!match) throw new Error(`Invalid Infinity Scale chunk key: ${spec.targetChunk}`);
  const extent = chunkSize * targetScale;
  const tx = Number(match[2]) * extent;
  const ty = Number(match[3]) * extent;
  const tz = Number(match[4]) * extent;
  const targetMin = [tx, ty, tz];
  const axis = face.axis;
  const resolvedDirection: -1 | 1 = face.coordinate === targetMin[axis] ? -1 : 1;

  return {
    axis: axis === 0 ? "x" : axis === 1 ? "y" : "z",
    direction: resolvedDirection,
    sourceScale: 2 ** spec.sourceLevel,
    targetScale,
    refinementRatio: spec.refinementRatio,
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


