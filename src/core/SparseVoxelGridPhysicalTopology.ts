import { CELL_FIELDS } from "./CellState";
import { CHUNK_SIZE } from "./Chunk";
import { parseInfinityScaleChunkKey } from "../infinity/InfinityScaleChunkKey";

export interface SparseVoxelGridPhysicalChunkIdentity {
  readonly key: string;
  readonly level: number;
  readonly scale: number;
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
}

export interface SparseVoxelGridPhysicalChunkBounds extends SparseVoxelGridPhysicalChunkIdentity {
  readonly extent: number;
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxXExclusive: number;
  readonly maxYExclusive: number;
  readonly maxZExclusive: number;
}

export interface SparseVoxelGridPhysicalTopology {
  /** Canonical, immutable chunk descriptors sorted by key. */
  readonly chunks: readonly SparseVoxelGridPhysicalChunkBounds[];
}

/**
 * A base-resolution integer cell resolved to a stored cell in a physical chunk.
 * localX/Y/Z identify one of the CHUNK_SIZE^3 cells at the chunk's own LOD.
 */
export interface SparseVoxelGridPhysicalCellAddress {
  readonly chunk: SparseVoxelGridPhysicalChunkBounds;
  readonly localX: number;
  readonly localY: number;
  readonly localZ: number;
  /** Cell index, excluding the per-cell field stride. */
  readonly cellIndex: number;
  /** Float32 buffer offset of the first field for this cell. */
  readonly bufferOffset: number;
}

const MAX_PHYSICAL_CHUNK_COUNT = 4096;
const MAX_LOD_LEVEL = 30;
const TOPOLOGY_INDEX = new WeakMap<SparseVoxelGridPhysicalTopology, ReadonlyMap<string, SparseVoxelGridPhysicalChunkBounds>>();

export function formatSparseVoxelGridPhysicalChunkKey(level: number, cx: number, cy: number, cz: number): string {
  if (![level, cx, cy, cz].every(Number.isSafeInteger) ||
      level < 0 || level > MAX_LOD_LEVEL) {
    throw new RangeError("SparseVoxelGrid physical chunk identity is outside the supported integer range");
  }
  return level === 0 ? `${cx},${cy},${cz}` : `${level}:${cx},${cy},${cz}`;
}

export function parseSparseVoxelGridPhysicalChunkKey(value: unknown): SparseVoxelGridPhysicalChunkIdentity {
  if (typeof value !== "string") {
    throw new TypeError("SparseVoxelGrid physical chunk key must be a string");
  }

  if (/^-?(?:0|[1-9]\d*),-?(?:0|[1-9]\d*),-?(?:0|[1-9]\d*)$/.test(value)) {
    const parts = value.split(",").map(Number);
    if (!parts.every(Number.isSafeInteger) ||
        parts.some((part, index) => String(part) !== value.split(",")[index])) {
      throw new Error("SparseVoxelGrid level-zero chunk key is not canonical: " + value);
    }
    return Object.freeze({ key: value, level: 0, scale: 1, cx: parts[0], cy: parts[1], cz: parts[2] });
  }

  const parsed = parseInfinityScaleChunkKey(value);
  if (parsed.level === 0 || formatSparseVoxelGridPhysicalChunkKey(parsed.level, parsed.x, parsed.y, parsed.z) !== value) {
    throw new Error("SparseVoxelGrid physical chunk key is not canonical: " + value);
  }
  return Object.freeze({
    key: value,
    level: parsed.level,
    scale: 2 ** parsed.level,
    cx: parsed.x,
    cy: parsed.y,
    cz: parsed.z,
  });
}

function getPhysicalChunkBounds(identity: SparseVoxelGridPhysicalChunkIdentity): SparseVoxelGridPhysicalChunkBounds {
  const extent = CHUNK_SIZE * identity.scale;
  const minX = identity.cx * extent;
  const minY = identity.cy * extent;
  const minZ = identity.cz * extent;
  const maxXExclusive = minX + extent;
  const maxYExclusive = minY + extent;
  const maxZExclusive = minZ + extent;
  if (![extent, minX, minY, minZ, maxXExclusive, maxYExclusive, maxZExclusive]
    .every(Number.isSafeInteger)) {
    throw new RangeError("SparseVoxelGrid physical chunk bounds exceed safe integer geometry: " + identity.key);
  }
  return Object.freeze({
    ...identity,
    extent,
    minX,
    minY,
    minZ,
    maxXExclusive,
    maxYExclusive,
    maxZExclusive,
  });
}

/**
 * Compile a candidate mixed-LOD physical topology without mutating SparseVoxelGrid.
 *
 * Level zero preserves the existing SparseVoxelGrid key format (cx,cy,cz);
 * coarser chunks use the canonical Infinity Scale key format (level:cx,cy,cz).
 * Because the hierarchy is dyadic, any two aligned chunks are either disjoint
 * or one is an ancestor of the other. Checking all ancestors therefore proves
 * non-overlap without allocating cell-sized occupancy maps.
 *
 * This is a preflight/index primitive only. It does not make the current
 * SparseVoxelGrid storage, dense execution window, or GPU path LOD-aware.
 */
export function compileSparseVoxelGridPhysicalTopology(
  keys: readonly string[],
  maxChunkCount = MAX_PHYSICAL_CHUNK_COUNT,
): SparseVoxelGridPhysicalTopology {
  if (!Array.isArray(keys)) {
    throw new TypeError("SparseVoxelGrid physical topology requires a chunk-key array");
  }
  if (!Number.isSafeInteger(maxChunkCount) || maxChunkCount <= 0 ||
      maxChunkCount > MAX_PHYSICAL_CHUNK_COUNT) {
    throw new RangeError("SparseVoxelGrid physical topology limit must be in the range 1..4096");
  }
  if (keys.length > maxChunkCount) {
    throw new RangeError("SparseVoxelGrid physical topology exceeds the chunk-count limit");
  }

  const byKey = new Map<string, SparseVoxelGridPhysicalChunkBounds>();
  for (const candidate of keys) {
    const identity = parseSparseVoxelGridPhysicalChunkKey(candidate);
    if (byKey.has(identity.key)) {
      throw new Error("SparseVoxelGrid physical topology contains a duplicate chunk: " + identity.key);
    }
    byKey.set(identity.key, getPhysicalChunkBounds(identity));
  }

  for (const chunk of byKey.values()) {
    let cx = chunk.cx;
    let cy = chunk.cy;
    let cz = chunk.cz;
    for (let level = chunk.level + 1; level <= MAX_LOD_LEVEL; level++) {
      cx = Math.floor(cx / 2);
      cy = Math.floor(cy / 2);
      cz = Math.floor(cz / 2);
      const ancestorKey = formatSparseVoxelGridPhysicalChunkKey(level, cx, cy, cz);
      if (byKey.has(ancestorKey)) {
        throw new Error(
          "SparseVoxelGrid physical topology overlaps: " + chunk.key + " is covered by " + ancestorKey,
        );
      }
    }
  }

  const chunks = Object.freeze([...byKey.values()].sort((a, b) => a.key.localeCompare(b.key)));
  const topology = Object.freeze({ chunks });
  TOPOLOGY_INDEX.set(topology, byKey);
  return topology;
}

/**
 * Resolve one base-resolution integer cell to its unique physical chunk.
 * The topology compiler rejects overlap, so at most one level can match.
 */
export function resolveSparseVoxelGridPhysicalChunk(
  topology: SparseVoxelGridPhysicalTopology,
  x: number,
  y: number,
  z: number,
): SparseVoxelGridPhysicalChunkBounds | null {
  const index = TOPOLOGY_INDEX.get(topology);
  if (!index) {
    throw new Error("SparseVoxelGrid physical topology was not produced by the topology compiler");
  }
  if (![x, y, z].every(Number.isSafeInteger)) {
    throw new RangeError("SparseVoxelGrid base-cell coordinates must be safe integers");
  }

  for (let level = 0; level <= MAX_LOD_LEVEL; level++) {
    const extent = CHUNK_SIZE * (2 ** level);
    const cx = Math.floor(x / extent);
    const cy = Math.floor(y / extent);
    const cz = Math.floor(z / extent);
    const key = formatSparseVoxelGridPhysicalChunkKey(level, cx, cy, cz);
    const chunk = index.get(key);
    if (chunk) return chunk;
  }
  return null;
}

/**
 * Resolve one base-resolution integer cell to its exact stored cell address.
 *
 * A level-N stored cell covers 2^N base cells on each axis. The returned local
 * coordinates are therefore floor((baseCell - chunkOrigin) / scale), not the
 * level-zero local coordinates. This helper is a pure addressing primitive:
 * it does not read/write buffers or enable mixed-LOD execution in SparseVoxelGrid.
 */
export function resolveSparseVoxelGridPhysicalCell(
  topology: SparseVoxelGridPhysicalTopology,
  x: number,
  y: number,
  z: number,
): SparseVoxelGridPhysicalCellAddress | null {
  const chunk = resolveSparseVoxelGridPhysicalChunk(topology, x, y, z);
  if (!chunk) return null;

  const localX = Math.floor((x - chunk.minX) / chunk.scale);
  const localY = Math.floor((y - chunk.minY) / chunk.scale);
  const localZ = Math.floor((z - chunk.minZ) / chunk.scale);
  if (![localX, localY, localZ].every(Number.isSafeInteger) ||
      localX < 0 || localX >= CHUNK_SIZE ||
      localY < 0 || localY >= CHUNK_SIZE ||
      localZ < 0 || localZ >= CHUNK_SIZE) {
    throw new Error("SparseVoxelGrid physical cell address is inconsistent with its chunk bounds");
  }

  const cellIndex = (localZ * CHUNK_SIZE + localY) * CHUNK_SIZE + localX;
  const bufferOffset = cellIndex * CELL_FIELDS;
  if (!Number.isSafeInteger(cellIndex) || cellIndex < 0 ||
      !Number.isSafeInteger(bufferOffset) ||
      bufferOffset + CELL_FIELDS > CHUNK_SIZE ** 3 * CELL_FIELDS) {
    throw new RangeError("SparseVoxelGrid physical cell buffer address exceeds the chunk layout");
  }

  return Object.freeze({ chunk, localX, localY, localZ, cellIndex, bufferOffset });
}
