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
  #revision = 0;

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
      copy.addMutationListener(() => { this.#revision += 1; });
      this.#chunks.set(copy.key, copy);
    }
  }

  get size(): number {
    return this.#chunks.size;
  }

  /** Monotonic revision for tracked physical cell and topology-buffer mutations. */
  get revision(): number {
    return this.#revision;
  }

  /**
   * Atomically promote every prepared back buffer to front.
   * The expected revision is checked before the first swap; all swaps are
   * synchronous and the adapter exposes no callbacks during publication.
   */
  swapBuffers(expectedRevision: number): number {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new RangeError("Physical address adapter expected revision must be a non-negative safe integer");
    }
    if (expectedRevision !== this.#revision) {
      throw new Error(
        "Physical address adapter revision conflict: expected " + expectedRevision +
        ", current " + this.#revision,
      );
    }
    for (const chunk of this.#chunks.values()) chunk.swapBuffers();
    return this.#revision;
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

  /** Return a tracked back-buffer CellState for a base-resolution coordinate. */
  getBackCellAtBase(x: number, y: number, z: number): CellState | null {
    const address = this.resolve(x, y, z);
    if (!address) return null;
    const chunk = this.#chunks.get(address.chunk.key);
    if (!chunk) {
      throw new Error("Physical address adapter index/store mismatch for " + address.chunk.key);
    }
    return chunk.getBackCell(address.localX, address.localY, address.localZ);
  }

  /** Validate local coordinates once for both physical buffer sides. */
  #getChunkForLocalCell(key: string, localX: number, localY: number, localZ: number): SparseVoxelGridPhysicalChunk | null {
    const chunk = this.#chunks.get(key);
    if (!chunk) return null;
    if (![localX, localY, localZ].every(Number.isSafeInteger) ||
        localX < 0 || localX >= 32 ||
        localY < 0 || localY >= 32 ||
        localZ < 0 || localZ >= 32) {
      throw new RangeError("Physical address adapter local cell coordinates are out of bounds");
    }
    return chunk;
  }

  /** Return a tracked front-buffer CellState by canonical physical chunk key. */
  getCell(key: string, localX: number, localY: number, localZ: number): CellState | null {
    return this.#getChunkForLocalCell(key, localX, localY, localZ)?.getCell(localX, localY, localZ) ?? null;
  }

  /** Return a tracked back-buffer CellState by canonical physical chunk key. */
  getBackCell(key: string, localX: number, localY: number, localZ: number): CellState | null {
    return this.#getChunkForLocalCell(key, localX, localY, localZ)?.getBackCell(localX, localY, localZ) ?? null;
  }
}
