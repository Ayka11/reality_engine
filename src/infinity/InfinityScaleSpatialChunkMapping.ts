import { CHUNK_SIZE } from "../core/Chunk";
import { getInfinityScaleChunkBounds, parseInfinityScaleChunkKey } from "./InfinityScaleChunkKey";

export interface InfinityScaleSparseChunkKey {
  readonly key: string;
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
}

export interface InfinityScaleSpatialMappingOptions {
  /** Hierarchical chunk width in base-resolution cells. Defaults to SparseVoxelGrid's chunk width. */
  lodChunkSize?: number;
  /** Physical SparseVoxelGrid chunk width. Defaults to the authoritative CHUNK_SIZE. */
  sparseChunkSize?: number;
  /** Refuse pathological expansions before allocating the result. */
  maxSparseChunkCount?: number;
}

export interface InfinityScaleChunkSparseCoverage {
  readonly lodChunkKey: string;
  readonly level: number;
  readonly lodChunkSize: number;
  readonly sparseChunkSize: number;
  readonly bounds: Readonly<{
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  }>;
  /** Complete, deterministic list of physical level-zero chunk keys covering this LOD chunk. */
  readonly sparseChunks: readonly InfinityScaleSparseChunkKey[];
}

function formatInfinityScaleChunkKey(level: number, x: number, y: number, z: number): string {
  if (![level, x, y, z].every(Number.isSafeInteger) ||
      level < 0 || level > 30) {
    throw new RangeError("Infinity Scale spatial chunk coordinates exceed the supported integer range");
  }
  return `${level}:${x},${y},${z}`;
}

function formatSparseChunkKey(cx: number, cy: number, cz: number): string {
  if (![cx, cy, cz].every(Number.isSafeInteger)) {
    throw new RangeError("SparseVoxelGrid chunk coordinates must be safe integers");
  }
  return `${cx},${cy},${cz}`;
}

/**
 * Return the exact eight level-(L-1) children of a physical level-L chunk.
 * Higher LOD numbers are coarser; this is geometry only and does not mutate state.
 */
export function getInfinityScaleChildChunkKeys(parentKey: unknown): readonly string[] {
  const parent = parseInfinityScaleChunkKey(parentKey);
  if (parent.level === 0) {
    throw new RangeError("A level-zero Infinity Scale chunk has no finer child chunks");
  }

  const childLevel = parent.level - 1;
  const children: string[] = [];
  for (let dz = 0; dz <= 1; dz++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const childX = parent.x * 2 + dx;
        const childY = parent.y * 2 + dy;
        const childZ = parent.z * 2 + dz;
        children.push(formatInfinityScaleChunkKey(childLevel, childX, childY, childZ));
      }
    }
  }
  return Object.freeze(children);
}

/**
 * Resolve a parent only when all eight unique children form one complete,
 * canonical sibling group. Input order does not affect the returned key.
 */
export function getInfinityScaleParentChunkKey(childKeys: readonly unknown[]): string {
  if (!Array.isArray(childKeys) || childKeys.length !== 8) {
    throw new TypeError("Infinity Scale parent resolution requires exactly eight child chunk keys");
  }

  const children = childKeys.map(parseInfinityScaleChunkKey);
  const childLevel = children[0].level;
  if (childLevel >= 30 || children.some(child => child.level !== childLevel)) {
    throw new Error("Infinity Scale sibling chunks must share one child LOD below level 30");
  }

  const parentX = Math.floor(children[0].x / 2);
  const parentY = Math.floor(children[0].y / 2);
  const parentZ = Math.floor(children[0].z / 2);
  const parentKey = formatInfinityScaleChunkKey(childLevel + 1, parentX, parentY, parentZ);
  const expected = new Set(getInfinityScaleChildChunkKeys(parentKey));
  const observed = new Set(children.map(child => child.key));

  if (observed.size !== 8 || expected.size !== 8 ||
      [...expected].some(key => !observed.has(key))) {
    throw new Error("Infinity Scale child chunks do not form one complete eight-child parent group");
  }
  return parentKey;
}

/**
 * Map a hierarchical chunk's inclusive base-cell footprint to the complete
 * set of physical level-zero SparseVoxelGrid chunk coordinates.
 *
 * The function never creates chunks or writes cell data. It rejects partial
 * sparse-chunk coverage, unsafe geometry, and expansions above the explicit cap.
 */
export function mapInfinityScaleChunkToSparseChunks(
  key: unknown,
  options: InfinityScaleSpatialMappingOptions = {},
): InfinityScaleChunkSparseCoverage {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Infinity Scale spatial mapping options must be an object");
  }
  const lodChunkSize = options.lodChunkSize ?? CHUNK_SIZE;
  const sparseChunkSize = options.sparseChunkSize ?? CHUNK_SIZE;
  const maxSparseChunkCount = options.maxSparseChunkCount ?? 4096;

  if (!Number.isSafeInteger(sparseChunkSize) || sparseChunkSize <= 0) {
    throw new RangeError("SparseVoxelGrid chunk size must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maxSparseChunkCount) || maxSparseChunkCount <= 0) {
    throw new RangeError("Sparse chunk expansion limit must be a positive safe integer");
  }

  const bounds = getInfinityScaleChunkBounds(key, lodChunkSize);
  if (bounds.extent % sparseChunkSize !== 0 ||
      bounds.minX % sparseChunkSize !== 0 ||
      bounds.minY % sparseChunkSize !== 0 ||
      bounds.minZ % sparseChunkSize !== 0) {
    throw new Error(
      `Infinity Scale chunk ${bounds.key} does not align to complete SparseVoxelGrid chunks of size ${sparseChunkSize}`,
    );
  }

  const chunksPerAxis = bounds.extent / sparseChunkSize;
  const sparseChunkCount = chunksPerAxis ** 3;
  if (!Number.isSafeInteger(chunksPerAxis) ||
      !Number.isSafeInteger(sparseChunkCount) ||
      sparseChunkCount > maxSparseChunkCount) {
    throw new RangeError(
      `Infinity Scale chunk ${bounds.key} expands to too many SparseVoxelGrid chunks: ${String(sparseChunkCount)} (limit ${maxSparseChunkCount})`,
    );
  }

  const minCX = bounds.minX / sparseChunkSize;
  const minCY = bounds.minY / sparseChunkSize;
  const minCZ = bounds.minZ / sparseChunkSize;
  const maxCX = minCX + chunksPerAxis - 1;
  const maxCY = minCY + chunksPerAxis - 1;
  const maxCZ = minCZ + chunksPerAxis - 1;
  if (![minCX, minCY, minCZ, maxCX, maxCY, maxCZ].every(Number.isSafeInteger)) {
    throw new RangeError(`Infinity Scale chunk ${bounds.key} maps outside safe SparseVoxelGrid coordinates`);
  }

  const sparseChunks: InfinityScaleSparseChunkKey[] = [];
  for (let cz = minCZ; cz <= maxCZ; cz++) {
    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const chunkKey = formatSparseChunkKey(cx, cy, cz);
        sparseChunks.push(Object.freeze({ key: chunkKey, cx, cy, cz }));
      }
    }
  }

  if (sparseChunks.length !== sparseChunkCount) {
    throw new Error(`Infinity Scale physical chunk coverage is incomplete for ${bounds.key}`);
  }

  return Object.freeze({
    lodChunkKey: bounds.key,
    level: bounds.level,
    lodChunkSize,
    sparseChunkSize,
    bounds: Object.freeze({
      minX: bounds.minX,
      maxX: bounds.maxX,
      minY: bounds.minY,
      maxY: bounds.maxY,
      minZ: bounds.minZ,
      maxZ: bounds.maxZ,
    }),
    sparseChunks: Object.freeze(sparseChunks),
  });
}
