/** Canonical parsing and geometry validation for hierarchical Infinity Scale chunk identities. */
export type InfinityScaleChunkRelation = "same-level" | "coarse-to-fine" | "fine-to-coarse";

export interface ParsedInfinityScaleChunkKey {
  readonly key: string;
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface InfinityScaleChunkBounds extends ParsedInfinityScaleChunkKey {
  readonly chunkSize: number;
  readonly extent: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Parses only canonical, safely representable chunk keys such as "1:-2,0,3". */
export function parseInfinityScaleChunkKey(value: unknown): ParsedInfinityScaleChunkKey {
  if (typeof value !== "string") {
    throw new Error(`Invalid Infinity Scale chunk key type: ${typeof value}`);
  }
  const match = /^(\d+):(-?\d+),(-?\d+),(-?\d+)$/.exec(value);
  if (!match) throw new Error(`Invalid Infinity Scale chunk key: ${value}`);

  const raw = match.slice(1);
  const values = raw.map(Number);
  if (
    !values.every(Number.isSafeInteger) ||
    values[0] < 0 || values[0] > 30 ||
    values.some((number, index) => String(number) !== raw[index])
  ) {
    throw new Error(`Invalid or non-canonical Infinity Scale chunk key: ${value}`);
  }

  return { key: value, level: values[0], x: values[1], y: values[2], z: values[3] };
}

/**
 * Validates that a transfer's LOD declaration agrees with both physical keys.
 * Higher numerical levels are coarser.
 */
export function validateInfinityScaleChunkPair(
  sourceKey: unknown,
  targetKey: unknown,
  relation: unknown,
  expectedSourceLevel?: unknown,
  expectedTargetLevel?: unknown,
): { source: ParsedInfinityScaleChunkKey; target: ParsedInfinityScaleChunkKey } {
  const source = parseInfinityScaleChunkKey(sourceKey);
  const target = parseInfinityScaleChunkKey(targetKey);

  if (expectedSourceLevel !== undefined &&
      (!Number.isInteger(expectedSourceLevel) || expectedSourceLevel !== source.level)) {
    throw new Error(`Infinity Scale source key/level mismatch for ${source.key}`);
  }
  if (expectedTargetLevel !== undefined &&
      (!Number.isInteger(expectedTargetLevel) || expectedTargetLevel !== target.level)) {
    throw new Error(`Infinity Scale target key/level mismatch for ${target.key}`);
  }

  if (relation === "same-level") {
    if (source.level !== target.level) {
      throw new Error("Infinity Scale same-level relation requires equal source and target levels");
    }
  } else if (relation === "coarse-to-fine") {
    if (source.level <= target.level) {
      throw new Error("Infinity Scale coarse-to-fine relation requires a coarser source level");
    }
  } else if (relation === "fine-to-coarse") {
    if (source.level >= target.level) {
      throw new Error("Infinity Scale fine-to-coarse relation requires a finer source level");
    }
  } else {
    throw new Error(`Invalid Infinity Scale boundary relation: ${String(relation)}`);
  }

  return { source, target };
}

/** Resolves inclusive base-resolution bounds without permitting unsafe arithmetic. */
export function getInfinityScaleChunkBounds(
  key: unknown,
  chunkSize: number,
): InfinityScaleChunkBounds {
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("Infinity Scale chunk size must be a positive safe integer");
  }
  const parsed = parseInfinityScaleChunkKey(key);
  const extent = chunkSize * (2 ** parsed.level);
  const minX = parsed.x * extent;
  const minY = parsed.y * extent;
  const minZ = parsed.z * extent;
  const maxX = minX + extent - 1;
  const maxY = minY + extent - 1;
  const maxZ = minZ + extent - 1;
  if (![extent, minX, minY, minZ, maxX, maxY, maxZ].every(Number.isSafeInteger)) {
    throw new Error(`Infinity Scale chunk bounds exceed safe integer geometry: ${parsed.key}`);
  }
  return { ...parsed, chunkSize, extent, minX, maxX, minY, maxY, minZ, maxZ };
}
