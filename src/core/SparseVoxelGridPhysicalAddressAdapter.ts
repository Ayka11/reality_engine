import { CellState, CELL_FIELDS } from "./CellState";
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
export interface SparseVoxelGridDenseWindow {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly origin: { readonly x: number; readonly y: number; readonly z: number };
}

export interface SparseVoxelGridPhysicalDenseCellAddress {
  readonly denseIndex: number;
  readonly localX: number;
  readonly localY: number;
  readonly localZ: number;
  readonly baseX: number;
  readonly baseY: number;
  readonly baseZ: number;
  readonly physical: SparseVoxelGridPhysicalCellAddress;
}

/** Dense samples that alias the same stored coarse-LOD cell. */
export interface SparseVoxelGridDenseCellAliasGroup {
  readonly chunkKey: string;
  readonly cellIndex: number;
  readonly level: number;
  readonly denseIndices: readonly number[];
}

/**
 * Detached front-buffer projection of a dense window. Missing physical cells
 * are zero-filled. Coarse-cell values are repeated for each covered base
 * sample; alias groups make that replication explicit. The values array is
 * caller-owned and may be mutated without affecting the adapter.
 */
export interface SparseVoxelGridDenseWindowProjection {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly origin: Readonly<{ x: number; y: number; z: number }>;
  readonly revision: number;
  readonly values: Float32Array;
  readonly coarseCellAliases: readonly SparseVoxelGridDenseCellAliasGroup[];
}

/** Coverage of one stored physical cell by samples in a dense window. */
export interface SparseVoxelGridDenseCellCoverage {
  readonly chunkKey: string;
  readonly cellIndex: number;
  readonly level: number;
  readonly expectedBaseSamples: number;
  readonly observedBaseSamples: number;
  readonly denseIndices: readonly number[];
  readonly complete: boolean;
}

/** Immutable coverage report; incomplete coarse cells are never reduction-ready. */
export interface SparseVoxelGridDenseWindowCoverage {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly origin: Readonly<{ x: number; y: number; z: number }>;
  readonly revision: number;
  readonly cells: readonly SparseVoxelGridDenseCellCoverage[];
  readonly complete: boolean;
  readonly incompleteCellCount: number;
}

/**
 * Maps a dense-window sample to its physical stored-cell address without
 * exposing mutable buffers or defining a write/reduction policy.
 *
 * Multiple dense samples may intentionally resolve to the same coarse physical
 * cell. Callers must not treat this descriptor as a one-to-one writable mapping.
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

  /**
   * Resolve a dense-window-local sample through its global base coordinate.
   * This is a read-address bridge only: it does not copy values or imply that
   * each dense sample owns a distinct physical cell at coarser LOD.
   */
  resolveDenseWindowCell(
    localX: number,
    localY: number,
    localZ: number,
    window: SparseVoxelGridDenseWindow,
  ): SparseVoxelGridPhysicalDenseCellAddress | null {
    if (!window || typeof window !== "object" ||
        ![window.width, window.height, window.depth].every(Number.isSafeInteger) ||
        window.width <= 0 || window.height <= 0 || window.depth <= 0 ||
        !window.origin ||
        ![window.origin.x, window.origin.y, window.origin.z].every(Number.isSafeInteger)) {
      throw new RangeError("Sparse physical dense window requires positive safe dimensions and an integer origin");
    }
    if (![localX, localY, localZ].every(Number.isSafeInteger) ||
        localX < 0 || localX >= window.width ||
        localY < 0 || localY >= window.height ||
        localZ < 0 || localZ >= window.depth) {
      throw new RangeError("Sparse physical dense-window local coordinates are out of bounds");
    }

    const baseX = window.origin.x + localX;
    const baseY = window.origin.y + localY;
    const baseZ = window.origin.z + localZ;
    const denseIndex = (localZ * window.height + localY) * window.width + localX;
    if (![baseX, baseY, baseZ, denseIndex].every(Number.isSafeInteger)) {
      throw new RangeError("Sparse physical dense-window address exceeds safe integer geometry");
    }
    const physical = this.resolve(baseX, baseY, baseZ);
    if (!physical) return null;
    return Object.freeze({ denseIndex, localX, localY, localZ, baseX, baseY, baseZ, physical });
  }

  /**
   * Report how much of each touched physical cell is represented by a dense
   * window. A level-L cell requires (2^L)^3 base samples; partial intersections
   * are explicitly incomplete and must not be reduced or written as if absent
   * samples were zero. This method is metadata-only and never mutates buffers.
   */
  analyzeDenseWindowCoverage(window: SparseVoxelGridDenseWindow): SparseVoxelGridDenseWindowCoverage {
    if (!window || typeof window !== "object" ||
        ![window.width, window.height, window.depth].every(Number.isSafeInteger) ||
        window.width <= 0 || window.height <= 0 || window.depth <= 0 ||
        !window.origin ||
        ![window.origin.x, window.origin.y, window.origin.z].every(Number.isSafeInteger)) {
      throw new RangeError("Sparse physical dense window requires positive safe dimensions and an integer origin");
    }

    const revision = this.#revision;
    const groups = new Map<string, {
      chunkKey: string;
      cellIndex: number;
      level: number;
      expectedBaseSamples: number;
      denseIndices: number[];
    }>();

    for (let z = 0; z < window.depth; z++)
    for (let y = 0; y < window.height; y++)
    for (let x = 0; x < window.width; x++) {
      const address = this.resolveDenseWindowCell(x, y, z, window);
      if (!address) continue;
      const level = address.physical.chunk.level;
      const scale = 2 ** level;
      const expectedBaseSamples = scale * scale * scale;
      if (!Number.isSafeInteger(expectedBaseSamples) || expectedBaseSamples <= 0) {
        throw new RangeError("Physical dense-window coverage exceeds safe LOD sample geometry");
      }
      const key = address.physical.chunk.key + "#" + address.physical.cellIndex;
      let group = groups.get(key);
      if (!group) {
        group = {
          chunkKey: address.physical.chunk.key,
          cellIndex: address.physical.cellIndex,
          level,
          expectedBaseSamples,
          denseIndices: [],
        };
        groups.set(key, group);
      } else if (group.level !== level || group.expectedBaseSamples !== expectedBaseSamples) {
        throw new Error("Physical dense-window coverage identity has inconsistent LOD metadata");
      }
      group.denseIndices.push(address.denseIndex);
    }

    if (this.#revision !== revision) {
      throw new Error("Physical dense-window coverage observed a concurrent adapter mutation");
    }

    const cells = Object.freeze([...groups.values()].map(group => {
      const observedBaseSamples = group.denseIndices.length;
      return Object.freeze({
        chunkKey: group.chunkKey,
        cellIndex: group.cellIndex,
        level: group.level,
        expectedBaseSamples: group.expectedBaseSamples,
        observedBaseSamples,
        denseIndices: Object.freeze(group.denseIndices.slice()),
        complete: observedBaseSamples === group.expectedBaseSamples,
      });
    }));
    const incompleteCellCount = cells.filter(cell => !cell.complete).length;
    return Object.freeze({
      width: window.width,
      height: window.height,
      depth: window.depth,
      origin: Object.freeze({ x: window.origin.x, y: window.origin.y, z: window.origin.z }),
      revision,
      cells,
      complete: incompleteCellCount === 0,
      incompleteCellCount,
    });
  }

  /**
   * Copy a dense-window projection from the authoritative physical front
   * buffers. Each base sample receives the complete stored cell state. When
   * several samples resolve to one coarse cell, the value is repeated and an
   * explicit alias group lists their dense linear indices.
   *
   * This is a detached read snapshot only. It performs no reduction, write,
   * back-buffer access, or dense-window synchronization.
   */
  projectDenseWindow(window: SparseVoxelGridDenseWindow): SparseVoxelGridDenseWindowProjection {
    if (!window || typeof window !== "object" ||
        ![window.width, window.height, window.depth].every(Number.isSafeInteger) ||
        window.width <= 0 || window.height <= 0 || window.depth <= 0 ||
        !window.origin ||
        ![window.origin.x, window.origin.y, window.origin.z].every(Number.isSafeInteger)) {
      throw new RangeError("Sparse physical dense window requires positive safe dimensions and an integer origin");
    }

    const cellCount = window.width * window.height * window.depth;
    const valueCount = cellCount * CELL_FIELDS;
    if (!Number.isSafeInteger(cellCount) || cellCount <= 0 ||
        !Number.isSafeInteger(valueCount) || valueCount <= 0) {
      throw new RangeError("Sparse physical dense-window projection exceeds safe typed-array geometry");
    }

    const revision = this.#revision;
    const values = new Float32Array(valueCount);
    const aliases = new Map<string, {
      chunkKey: string;
      cellIndex: number;
      level: number;
      denseIndices: number[];
    }>();

    for (let z = 0; z < window.depth; z++)
    for (let y = 0; y < window.height; y++)
    for (let x = 0; x < window.width; x++) {
      const address = this.resolveDenseWindowCell(x, y, z, window);
      if (!address) continue;

      const chunk = this.#chunks.get(address.physical.chunk.key);
      if (!chunk) {
        throw new Error("Physical dense-window projection index/store mismatch for " + address.physical.chunk.key);
      }
      const targetOffset = address.denseIndex * CELL_FIELDS;
      chunk.copyFrontRangeTo(values, address.physical.bufferOffset, targetOffset, CELL_FIELDS);

      if (address.physical.chunk.level > 0) {
        const aliasKey = address.physical.chunk.key + "#" + address.physical.cellIndex;
        let group = aliases.get(aliasKey);
        if (!group) {
          group = {
            chunkKey: address.physical.chunk.key,
            cellIndex: address.physical.cellIndex,
            level: address.physical.chunk.level,
            denseIndices: [],
          };
          aliases.set(aliasKey, group);
        }
        group.denseIndices.push(address.denseIndex);
      }
    }

    if (this.#revision !== revision) {
      throw new Error("Physical dense-window projection observed a concurrent adapter mutation");
    }

    const coarseCellAliases = Object.freeze([...aliases.values()]
      .filter(group => group.denseIndices.length > 1)
      .map(group => Object.freeze({
        chunkKey: group.chunkKey,
        cellIndex: group.cellIndex,
        level: group.level,
        denseIndices: Object.freeze(group.denseIndices.slice()),
      })));

    return Object.freeze({
      width: window.width,
      height: window.height,
      depth: window.depth,
      origin: Object.freeze({ x: window.origin.x, y: window.origin.y, z: window.origin.z }),
      revision,
      values,
      coarseCellAliases,
    });
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
