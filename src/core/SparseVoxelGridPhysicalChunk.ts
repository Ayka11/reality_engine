import { CellState, CELL_FIELDS } from "./CellState";
import { Chunk, CHUNK_SIZE } from "./Chunk";
import { parseSparseVoxelGridPhysicalChunkKey } from "./SparseVoxelGridPhysicalTopology";

interface PreparedPhysicalChunkIdentity {
  key: string;
  level: number;
  scale: number;
  cx: number;
  cy: number;
  cz: number;
  minX: number;
  minY: number;
  minZ: number;
  maxXExclusive: number;
  maxYExclusive: number;
  maxZExclusive: number;
  extent: number;
}

export interface SparseVoxelGridPhysicalLocalCellAddress {
  readonly localX: number;
  readonly localY: number;
  readonly localZ: number;
  readonly cellIndex: number;
  readonly bufferOffset: number;
}

function preparePhysicalChunkIdentity(key: string): PreparedPhysicalChunkIdentity {
  const identity = parseSparseVoxelGridPhysicalChunkKey(key);
  const extent = CHUNK_SIZE * identity.scale;
  const minX = identity.cx * extent;
  const minY = identity.cy * extent;
  const minZ = identity.cz * extent;
  const maxXExclusive = minX + extent;
  const maxYExclusive = minY + extent;
  const maxZExclusive = minZ + extent;
  if (![extent, minX, minY, minZ, maxXExclusive, maxYExclusive, maxZExclusive]
    .every(Number.isSafeInteger)) {
    throw new RangeError("SparseVoxelGrid physical chunk bounds exceed safe integer geometry: " + key);
  }
  return {
    ...identity,
    minX,
    minY,
    minZ,
    maxXExclusive,
    maxYExclusive,
    maxZExclusive,
    extent,
  };
}

/**
 * A physical SparseVoxelGrid chunk whose 32^3 stored cells live at one
 * explicit dyadic LOD. It deliberately extends the existing Chunk so the
 * tracked front/back buffers, mutation listeners, and CellState behavior
 * remain identical while the owning grid is migrated incrementally.
 *
 * This class is not yet installed in SparseVoxelGrid's authoritative map.
 * Dense-window, GPU, worker, ownership, and persistence publication paths
 * must be migrated before mixed-level chunks can be used in production.
 */
export class SparseVoxelGridPhysicalChunk extends Chunk {
  readonly key!: string;
  readonly level!: number;
  readonly scale!: number;
  readonly minX!: number;
  readonly minY!: number;
  readonly minZ!: number;
  readonly maxXExclusive!: number;
  readonly maxYExclusive!: number;
  readonly maxZExclusive!: number;
  readonly extent!: number;

  constructor(key: string) {
    const identity = preparePhysicalChunkIdentity(key);
    super(identity.cx, identity.cy, identity.cz);
    Object.defineProperties(this, {
      key: { value: identity.key, enumerable: true, writable: false, configurable: false },
      level: { value: identity.level, enumerable: true, writable: false, configurable: false },
      scale: { value: identity.scale, enumerable: true, writable: false, configurable: false },
      minX: { value: identity.minX, enumerable: true, writable: false, configurable: false },
      minY: { value: identity.minY, enumerable: true, writable: false, configurable: false },
      minZ: { value: identity.minZ, enumerable: true, writable: false, configurable: false },
      maxXExclusive: { value: identity.maxXExclusive, enumerable: true, writable: false, configurable: false },
      maxYExclusive: { value: identity.maxYExclusive, enumerable: true, writable: false, configurable: false },
      maxZExclusive: { value: identity.maxZExclusive, enumerable: true, writable: false, configurable: false },
      extent: { value: identity.extent, enumerable: true, writable: false, configurable: false },
    });
  }

  /**
   * Resolve an integer base-resolution cell coordinate to this chunk's stored
   * cell. Bounds are half-open; a level-N stored cell covers 2^N base cells
   * along each axis. Returns null when the coordinate belongs to another chunk.
   */
  resolveBaseCell(x: number, y: number, z: number): SparseVoxelGridPhysicalLocalCellAddress | null {
    if (![x, y, z].every(Number.isSafeInteger)) {
      throw new RangeError("SparseVoxelGrid base-cell coordinates must be safe integers");
    }
    if (x < this.minX || x >= this.maxXExclusive ||
        y < this.minY || y >= this.maxYExclusive ||
        z < this.minZ || z >= this.maxZExclusive) {
      return null;
    }

    const localX = Math.floor((x - this.minX) / this.scale);
    const localY = Math.floor((y - this.minY) / this.scale);
    const localZ = Math.floor((z - this.minZ) / this.scale);
    if (![localX, localY, localZ].every(Number.isSafeInteger) ||
        localX < 0 || localX >= CHUNK_SIZE ||
        localY < 0 || localY >= CHUNK_SIZE ||
        localZ < 0 || localZ >= CHUNK_SIZE) {
      throw new Error("SparseVoxelGrid physical chunk produced an invalid local cell address");
    }

    const cellIndex = (localZ * CHUNK_SIZE + localY) * CHUNK_SIZE + localX;
    const bufferOffset = cellIndex * CELL_FIELDS;
    if (!Number.isSafeInteger(cellIndex) || !Number.isSafeInteger(bufferOffset) ||
        bufferOffset < 0 || bufferOffset + CELL_FIELDS > CHUNK_SIZE ** 3 * CELL_FIELDS) {
      throw new RangeError("SparseVoxelGrid physical chunk buffer address exceeds its layout");
    }
    return Object.freeze({ localX, localY, localZ, cellIndex, bufferOffset });
  }

  /** Read/write a stored cell through the existing revision-tracked CellState API. */
  getCellAtBase(x: number, y: number, z: number): CellState | null {
    const address = this.resolveBaseCell(x, y, z);
    if (!address) return null;
    return this.getCell(address.localX, address.localY, address.localZ);
  }
}
