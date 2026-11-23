import { SparseVoxelGridPhysicalChunk } from "./SparseVoxelGridPhysicalChunk";
import {
  compileSparseVoxelGridPhysicalTopology,
  type SparseVoxelGridPhysicalTopology,
} from "./SparseVoxelGridPhysicalTopology";

const CHUNK_BUFFER_LENGTH = 32 ** 3 * 24;

/**
 * Isolated authoritative owner for physical mixed-LOD chunks.
 *
 * This store is deliberately not wired into SparseVoxelGrid yet. Publication
 * is whole-map and compare-and-swap: no candidate becomes visible until every
 * identity, topology and buffer has been validated and detached from caller
 * ownership. Reads return detached chunk copies so callers cannot mutate the
 * store behind its revision counter.
 */
export class SparseVoxelGridPhysicalChunkStore {
  #chunks = new Map<string, SparseVoxelGridPhysicalChunk>();
  #revision = 0;

  get revision(): number { return this.#revision; }
  get size(): number { return this.#chunks.size; }
  get keys(): readonly string[] { return Object.freeze([...this.#chunks.keys()].sort()); }

  get topology(): SparseVoxelGridPhysicalTopology {
    return compileSparseVoxelGridPhysicalTopology([...this.#chunks.keys()]);
  }

  has(key: string): boolean { return this.#chunks.has(key); }

  /** Return a detached chunk copy; mutations cannot affect this store. */
  get(key: string): SparseVoxelGridPhysicalChunk | undefined {
    const chunk = this.#chunks.get(key);
    return chunk ? this.#cloneChunk(chunk) : undefined;
  }

  /** Return detached copies in canonical key order. */
  snapshot(): readonly SparseVoxelGridPhysicalChunk[] {
    return Object.freeze([...this.#chunks.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(chunk => this.#cloneChunk(chunk)));
  }

  /**
   * Atomically replace the complete physical topology.
   * A stale expected revision or any invalid chunk rejects without publication.
   */
  replaceAll(
    expectedRevision: number,
    chunks: readonly SparseVoxelGridPhysicalChunk[],
  ): number {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new RangeError("Physical chunk store expected revision must be a non-negative safe integer");
    }
    if (expectedRevision !== this.#revision) {
      throw new Error(
        "Physical chunk store revision conflict: expected " + expectedRevision +
        ", current " + this.#revision,
      );
    }
    if (!Array.isArray(chunks)) {
      throw new TypeError("Physical chunk store replacement requires a chunk array");
    }

    const keys: string[] = [];
    const seen = new Set<string>();
    for (const chunk of chunks) {
      if (!(chunk instanceof SparseVoxelGridPhysicalChunk)) {
        throw new TypeError("Physical chunk store accepts only SparseVoxelGridPhysicalChunk instances");
      }
      if (chunk.key !== (chunk.level === 0
        ? `${chunk.cx},${chunk.cy},${chunk.cz}`
        : `${chunk.level}:${chunk.cx},${chunk.cy},${chunk.cz}`)) {
        throw new Error("Physical chunk identity does not match its canonical key");
      }
      if (seen.has(chunk.key)) {
        throw new Error("Physical chunk store replacement contains duplicate key: " + chunk.key);
      }
      seen.add(chunk.key);
      keys.push(chunk.key);
    }

    // Compile first: duplicate, invalid, excessive and overlapping topologies
    // fail before any chunk copies are allocated or store state is changed.
    compileSparseVoxelGridPhysicalTopology(keys);

    const candidate = new Map<string, SparseVoxelGridPhysicalChunk>();
    for (const chunk of chunks) {
      candidate.set(chunk.key, this.#cloneChunk(chunk));
    }

    // Single synchronous publication point. No callbacks or user code run here.
    this.#chunks = candidate;
    this.#revision += 1;
    return this.#revision;
  }

  #cloneChunk(source: SparseVoxelGridPhysicalChunk): SparseVoxelGridPhysicalChunk {
    const front = source.buffer.slice();
    const back = source.backBuffer.slice();
    if (!(front instanceof Float32Array) || !(back instanceof Float32Array) ||
        front.length !== CHUNK_BUFFER_LENGTH || back.length !== CHUNK_BUFFER_LENGTH) {
      throw new Error("Physical chunk buffers do not match the canonical 32^3 cell layout");
    }
    const clone = new SparseVoxelGridPhysicalChunk(source.key);
    clone.buffer = front;
    clone.backBuffer = back;
    clone.active = source.active;
    clone.lastAccessed = source.lastAccessed;
    return clone;
  }
}
