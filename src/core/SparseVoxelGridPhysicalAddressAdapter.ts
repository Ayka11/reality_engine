import { CellState } from "./CellState";
import { SparseVoxelGridPhysicalChunk } from "./SparseVoxelGridPhysicalChunk";
import {
  compileSparseVoxelGridPhysicalTopology,
  resolveSparseVoxelGridPhysicalCell,
  type SparseVoxelGridPhysicalCellAddress,
  type SparseVoxelGridPhysicalTopology,
} from "./SparseVoxelGridPhysicalTopology";

/**
 * Read/write addressing facade for an owned physical mixed-LOD chunk set.
 *
 * The adapter takes detached ownership of its chunks and compiles one immutable
 * spatial index. It deliberately does not replace SparseVoxelGrid's legacy
 * level-zero map or dense-window API; callers must opt into this facade until
 * those execution paths are migrated together.
 */
export class SparseVoxelGridPhysicalAddressAdapter {
  #chunks = new Map<string, SparseVoxelGridPhysicalChunk>();
  #topology: SparseVoxelGridPhysicalTopology;

  constructor(chunks: readonly SparseVoxelGridPhysicalChunk[]) {
    if (!Array.isArray(chunks)) {
      throw new TypeError("Physical address adapter requires a chunk array");
    }

    const keys: string[] = [];
    const seen = new Set<string>();
    for (const chunk of chunks) {
      if (!(chunk instanceof SparseVoxelGridPhysicalChunk)) {
        throw new TypeError("Physical address adapter accepts only physical chunks");
      }
      if (seen.has(chunk.key)) {
        throw new Error("Physical address adapter contains duplicate chunk key: " + chunk.key);
      }
      seen.add(chunk.key);
      keys.push(chunk.key);
    }

    // Compile and validate the complete spatial set before allocating owned copies.
    this.#topology = compileSparseVoxelGridPhysicalTopology(keys);

    for (const source of chunks) {
      const copy = new SparseVoxelGridPhysicalChunk(source.key);
      copy.buffer = source.buffer.slice();
      copy.backBuffer = source.backBuffer.slice();
      copy.active = source.active;
      copy.lastAccessed = source.lastAccessed;
      this.#chunks.set(copy.key, copy);
    }
  }

  get size(): number {
    return this.#chunks.size;
  }

  get topology(): SparseVoxelGridPhysicalTopology {
    return this.#topology;
  }

  /**
   * Resolve base-resolution coordinates to the unique stored physical cell.
   * The returned descriptor contains no mutable chunk or buffer references.
   */
  resolve(x: number, y: number, z: number): SparseVoxelGridPhysicalCellAddress | null {
    return resolveSparseVoxelGridPhysicalCell(this.#topology, x, y, z);
  }

  /** Return a tracked front-buffer CellState for a base-resolution coordinate. */
  getCellAtBase(x: number, y: number, z: number): CellState | null {
    const address = this.resolve(x, y, z);
    if (!address) return null;
    const chunk = this.#chunks.get(address.chunk.key);
    if (!chunk) {
      throw new Error("Physical address adapter index/store mismatch for " + address.chunk.key);
    }
    return chunk.getCellAtBase(x, y, z);
  }

  /** Return a tracked front-buffer CellState by canonical physical chunk key. */
  getCell(key: string, localX: number, localY: number, localZ: number): CellState | null {
    const chunk = this.#chunks.get(key);
    if (!chunk) return null;
    if (![localX, localY, localZ].every(Number.isSafeInteger) ||
        localX < 0 || localX >= 32 ||
        localY < 0 || localY >= 32 ||
        localZ < 0 || localZ >= 32) {
      throw new RangeError("Physical address adapter local cell coordinates are out of bounds");
    }
    return chunk.getCell(localX, localY, localZ);
  }
}
