import type { InfinityScaleBoundaryTransferSpec } from "./InfinityScaleChunkExecutionContext";

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
