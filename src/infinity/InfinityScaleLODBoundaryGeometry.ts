import type { InfinityScaleBoundaryTransferSpec } from "./InfinityScaleChunkExecutionContext";

export function validateInfinityScaleBoundaryChunks(
  spec: InfinityScaleBoundaryTransferSpec,
  chunkSize = 32,
): boolean {
  const source = chunkRange(spec.sourceChunk, chunkSize);
  const target = chunkRange(spec.targetChunk, chunkSize);
  return (
    (source.maxX + 1 === target.minX &&
      Math.max(source.minY, target.minY) <= Math.min(source.maxY, target.maxY) &&
      Math.max(source.minZ, target.minZ) <= Math.min(source.maxZ, target.maxZ)) ||
    (target.maxX + 1 === source.minX &&
      Math.max(source.minY, target.minY) <= Math.min(source.maxY, target.maxY) &&
      Math.max(source.minZ, target.minZ) <= Math.min(source.maxZ, target.maxZ)) ||
    (source.maxY + 1 === target.minY &&
      Math.max(source.minX, target.minX) <= Math.min(source.maxX, target.maxX) &&
      Math.max(source.minZ, target.minZ) <= Math.min(source.maxZ, target.maxZ)) ||
    (target.maxY + 1 === source.minY &&
      Math.max(source.minX, target.minX) <= Math.min(source.maxX, target.maxX) &&
      Math.max(source.minZ, target.minZ) <= Math.min(source.maxZ, target.maxZ)) ||
    (source.maxZ + 1 === target.minZ &&
      Math.max(source.minX, target.minX) <= Math.min(source.maxX, target.maxX) &&
      Math.max(source.minY, target.minY) <= Math.min(source.maxY, target.maxY)) ||
    (target.maxZ + 1 === source.minZ &&
      Math.max(source.minX, target.minX) <= Math.min(source.maxX, target.maxX) &&
      Math.max(source.minY, target.minY) <= Math.min(source.maxY, target.maxY))
  );
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
  const source = chunkRange(spec.sourceChunk, chunkSize);
  const target = chunkRange(spec.targetChunk, chunkSize);
  const face = resolveFace(source, target);
  if (!face) {
    return {
      valid: false,
      faceCellCount: 0,
      mappedCellCount: 0,
      unmappedCellCount: 0,
      duplicateCellCount: 0,
      invalidRatioCount: 0,
    };
  }

  const ratio = spec.refinementRatio;
  const expectedRatio = 2 ** Math.abs(spec.sourceLevel - spec.targetLevel);
  const invalidRatioCount = ratio === expectedRatio && Number.isInteger(ratio) && ratio >= 2 ? 0 : 1;
  const mapped = new Set<string>();
  let faceCellCount = 0;
  let unmappedCellCount = 0;
  let duplicateCellCount = 0;
  let firstUnmappedCell: [number, number, number] | undefined;

  for (let z = source.minZ; z <= source.maxZ; z++) {
    for (let y = source.minY; y <= source.maxY; y++) {
      for (let x = source.minX; x <= source.maxX; x++) {
        if (!isOnFace(source, target, face, x, y, z)) continue;
        faceCellCount++;

        const mapping = mapBoundaryCell(spec, face, [x, y, z], source, target, chunkSize);
        if (!mapping) {
          unmappedCellCount++;
          firstUnmappedCell ??= [x, y, z];
          continue;
        }

        if (spec.readOperation === "restriction" && mapped.has(mapping.key)) {
          duplicateCellCount++;
        }
        mapped.add(mapping.key);
      }
    }
  }

  return {
    valid:
      invalidRatioCount === 0 &&
      faceCellCount > 0 &&
      unmappedCellCount === 0 &&
      duplicateCellCount === 0,
    faceCellCount,
    mappedCellCount: mapped.size,
    unmappedCellCount,
    duplicateCellCount,
    invalidRatioCount,
    ...(firstUnmappedCell ? { firstUnmappedCell } : {}),
  };
}

function mapBoundaryCell(
  spec: InfinityScaleBoundaryTransferSpec,
  face: { axis: "x" | "y" | "z"; direction: -1 | 1 },
  cell: [number, number, number],
  source: ReturnType<typeof chunkRange>,
  target: ReturnType<typeof chunkRange>,
  chunkSize: number,
): { key: string } | null {
  const sourceScale = 2 ** spec.sourceLevel;
  const targetScale = 2 ** spec.targetLevel;
  const [x, y, z] = cell;

  if (spec.readOperation === "prolongation") {
    const shifted = shift(cell, face, 1);
    const lx = Math.floor((shifted[0] - target.minX) / targetScale);
    const ly = Math.floor((shifted[1] - target.minY) / targetScale);
    const lz = Math.floor((shifted[2] - target.minZ) / targetScale);
    return inChunk(lx, ly, lz, chunkSize) ? { key: `${lx},${ly},${lz}` } : null;
  }

  if (spec.readOperation === "restriction") {
    if (sourceScale <= targetScale || sourceScale % targetScale !== 0) return null;

    const localOrigin: [number, number, number] = [
      Math.floor(x / sourceScale) * sourceScale,
      Math.floor(y / sourceScale) * sourceScale,
      Math.floor(z / sourceScale) * sourceScale,
    ];
    const neighborOrigin = shift(localOrigin, face, sourceScale);
    const ratio = sourceScale / targetScale;

    // Verify the complete fine-side footprint and preserve tangential alignment.
    for (let dz = 0; dz < ratio; dz++) {
      for (let dy = 0; dy < ratio; dy++) {
        for (let dx = 0; dx < ratio; dx++) {
          const fx = neighborOrigin[0] + dx * targetScale;
          const fy = neighborOrigin[1] + dy * targetScale;
          const fz = neighborOrigin[2] + dz * targetScale;
          const lx = Math.floor((fx - target.minX) / targetScale);
          const ly = Math.floor((fy - target.minY) / targetScale);
          const lz = Math.floor((fz - target.minZ) / targetScale);
          if (!inChunk(lx, ly, lz, chunkSize)) return null;

          if (face.axis === "x" && (fx < target.minX || fx > target.maxX)) return null;
          if (face.axis === "y" && (fy < target.minY || fy > target.maxY)) return null;
          if (face.axis === "z" && (fz < target.minZ || fz > target.maxZ)) return null;
        }
      }
    }

    const lx = Math.floor((neighborOrigin[0] - target.minX) / targetScale);
    const ly = Math.floor((neighborOrigin[1] - target.minY) / targetScale);
    const lz = Math.floor((neighborOrigin[2] - target.minZ) / targetScale);
    return { key: `${lx},${ly},${lz}` };
  }

  return null;
}

function resolveFace(
  source: ReturnType<typeof chunkRange>,
  target: ReturnType<typeof chunkRange>,
): { axis: "x" | "y" | "z"; direction: -1 | 1 } | null {
  if (source.maxX + 1 === target.minX && overlaps(source.minY, source.maxY, target.minY, target.maxY) && overlaps(source.minZ, source.maxZ, target.minZ, target.maxZ)) return { axis: "x", direction: 1 };
  if (target.maxX + 1 === source.minX && overlaps(source.minY, source.maxY, target.minY, target.maxY) && overlaps(source.minZ, source.maxZ, target.minZ, target.maxZ)) return { axis: "x", direction: -1 };
  if (source.maxY + 1 === target.minY && overlaps(source.minX, source.maxX, target.minX, target.maxX) && overlaps(source.minZ, source.maxZ, target.minZ, target.maxZ)) return { axis: "y", direction: 1 };
  if (target.maxY + 1 === source.minY && overlaps(source.minX, source.maxX, target.minX, target.maxX) && overlaps(source.minZ, source.maxZ, target.minZ, target.maxZ)) return { axis: "y", direction: -1 };
  if (source.maxZ + 1 === target.minZ && overlaps(source.minX, source.maxX, target.minX, target.maxX) && overlaps(source.minY, source.maxY, target.minY, target.maxY)) return { axis: "z", direction: 1 };
  if (target.maxZ + 1 === source.minZ && overlaps(source.minX, source.maxX, target.minX, target.maxX) && overlaps(source.minY, source.maxY, target.minY, target.maxY)) return { axis: "z", direction: -1 };
  return null;
}

function isOnFace(
  source: ReturnType<typeof chunkRange>,
  target: ReturnType<typeof chunkRange>,
  face: { axis: "x" | "y" | "z"; direction: -1 | 1 },
  x: number,
  y: number,
  z: number,
): boolean {
  if (face.axis === "x") return x === (face.direction > 0 ? source.maxX : source.minX) && overlaps(y, y, target.minY, target.maxY) && overlaps(z, z, target.minZ, target.maxZ);
  if (face.axis === "y") return y === (face.direction > 0 ? source.maxY : source.minY) && overlaps(x, x, target.minX, target.maxX) && overlaps(z, z, target.minZ, target.maxZ);
  return z === (face.direction > 0 ? source.maxZ : source.minZ) && overlaps(x, x, target.minX, target.maxX) && overlaps(y, y, target.minY, target.maxY);
}

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 <= b1 && a1 >= b0;
}

function shift(
  point: [number, number, number],
  face: { axis: "x" | "y" | "z"; direction: -1 | 1 },
  distance: number,
): [number, number, number] {
  const out: [number, number, number] = [...point];
  out[face.axis === "x" ? 0 : face.axis === "y" ? 1 : 2] += face.direction * distance;
  return out;
}

function inChunk(x: number, y: number, z: number, chunkSize: number): boolean {
  return x >= 0 && x < chunkSize && y >= 0 && y < chunkSize && z >= 0 && z < chunkSize;
}
