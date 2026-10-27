import { CELL_FIELDS } from "../core/CellState";
import { InfinityScaleLODTransfer } from "./InfinityScaleLODTransfer";
import { parseInfinityScaleChunkKey } from "./InfinityScaleChunkKey";

export interface InfinityScaleLODChunkState {
  key: string;
  level: number;
  scale: number;
  cells: Float32Array;
}

/** Deep snapshot of hierarchical cells for a failed-frame recovery boundary. */
export interface InfinityScaleLODStateSnapshot {
  chunks: InfinityScaleLODChunkState[];
}

/**
 * Hierarchical state store for Infinity Scale LOD chunks.
 *
 * Every logical chunk contains chunkSize^3 simulation cells at its own
 * resolution. A level-N cell covers 2^N base-resolution cells along each
 * axis. This is deliberately separate from SparseVoxelGrid: dense storage
 * remains the level-0 execution substrate until a layer explicitly opts into
 * hierarchical state.
 */
export class InfinityScaleLODState {
  private readonly states = new Map<string, InfinityScaleLODChunkState>();
  private revision = 0;

  constructor(readonly chunkSize = 32) {}

  getRevision(): number {
    return this.revision;
  }

  /**
   * Capture every hierarchical chunk without sharing mutable cell buffers.
   * The snapshot intentionally excludes the revision: restoring content must
   * invalidate all outstanding transactions rather than resurrect old tokens.
   */
  snapshot(): InfinityScaleLODStateSnapshot {
    return {
      chunks: [...this.states.values()].map(state => ({
        key: state.key,
        level: state.level,
        scale: state.scale,
        cells: new Float32Array(state.cells),
      })),
    };
  }

  /**
   * Restore hierarchical content after an aborted frame. This is a recovery
   * boundary, not a transaction commit; always advance revision so stale
   * transactions cannot become valid again.
   */
  restore(snapshot: InfinityScaleLODStateSnapshot): void {
    // Validate and materialize the entire candidate state before touching the
    // authoritative map or revision. A rejected snapshot must be a no-op.
    if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.chunks)) {
      throw new Error("Cannot restore invalid Infinity Scale LOD snapshot");
    }

    const restored = new Map<string, InfinityScaleLODChunkState>();
    const expectedCellCount = this.chunkSize ** 3 * CELL_FIELDS;
    for (const candidate of snapshot.chunks as unknown[]) {
      if (!candidate || typeof candidate !== "object") {
        throw new Error("Cannot restore invalid Infinity Scale LOD chunk");
      }

      const chunk = candidate as Partial<InfinityScaleLODChunkState>;
      const key = chunk.key;
      const level = chunk.level;
      const scale = chunk.scale;
      const cells = chunk.cells;
      if (typeof key !== "string") {
        throw new Error("Cannot restore Infinity Scale LOD chunk with an invalid key");
      }

      const parsedKey = parseInfinityScaleChunkKey(key);
      const { level: keyLevel, x: cx, y: cy, z: cz } = parsedKey;

      if (
        typeof level !== "number" ||
        !Number.isInteger(level) ||
        level < 0 ||
        level > 30 ||
        keyLevel !== level ||
        typeof scale !== "number" ||
        scale !== 2 ** level ||
        !(cells instanceof Float32Array) ||
        cells.length !== expectedCellCount ||
        !cells.every(Number.isFinite)
      ) {
        throw new Error(`Cannot restore invalid Infinity Scale LOD chunk ${key}`);
      }
      if (restored.has(key)) {
        throw new Error(`Cannot restore duplicate Infinity Scale LOD chunk ${key}`);
      }

      restored.set(key, {
        key,
        level,
        scale,
        cells: new Float32Array(cells),
      });
    }

    // No validation remains after this point. Commit the complete, detached map
    // in one synchronous section and invalidate every outstanding transaction.
    this.states.clear();
    for (const [key, chunk] of restored) this.states.set(key, chunk);
    this.revision += 1;
  }

  beginRevision(): number {
    this.revision += 1;
    return this.revision;
  }

  assertRevision(expectedRevision: number): void {
    if (expectedRevision !== this.revision) {
      throw new Error(
        `Infinity Scale LOD state revision mismatch: expected ${expectedRevision}, current ${this.revision}`,
      );
    }
  }

  cloneChunk(key: string): InfinityScaleLODChunkState | undefined {
    const state = this.states.get(key);
    if (!state) return undefined;
    return {
      key: state.key,
      level: state.level,
      scale: state.scale,
      cells: new Float32Array(state.cells),
    };
  }

  ensureChunk(key: string, level: number): InfinityScaleLODChunkState {
    if (!Number.isInteger(level) || level < 0 || level > 30) {
      throw new Error(`Invalid Infinity Scale LOD level: ${level}`);
    }
    // The LOD level is part of the physical chunk identity, not just metadata.
    // Reject non-canonical or mismatched keys before reading or mutating the map.
    const { level: keyLevel } = parseInfinityScaleChunkKey(key);
    if (keyLevel !== level) {
      throw new Error(`Infinity Scale LOD chunk key/level mismatch for ${key}: key=${keyLevel}, level=${level}`);
    }

    const existing = this.states.get(key);
    if (existing) {
      if (existing.level !== level) {
        throw new Error(`Infinity Scale LOD chunk level mismatch for ${key}`);
      }
      return this.exposeChunk(existing);
    }

    const scale = 2 ** level;
    const state: InfinityScaleLODChunkState = {
      key,
      level,
      scale,
      cells: new Float32Array(this.chunkSize ** 3 * CELL_FIELDS),
    };
    this.states.set(key, state);
    this.revision += 1;
    return this.exposeChunk(state);
  }

  /**
   * Public chunk handles never expose the authoritative ArrayBuffer. Direct
   * index writes and mutating typed-array methods invalidate open transactions.
   */
  private exposeChunk(state: InfinityScaleLODChunkState): InfinityScaleLODChunkState {
    const owner = this;
    let proxy: Float32Array;
    proxy = new Proxy(state.cells, {
      get(target, property) {
        if (property === "buffer") return target.slice().buffer;
        if (property === "subarray") {
          return (begin?: number, end?: number) => target.slice(begin, end);
        }
        // Object.prototype.valueOf, when bound to the backing typed array,
        // would hand callers the raw target and bypass every mutation trap.
        if (property === "valueOf") return () => proxy;
        const value = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        if (property === "set") {
          return (source: ArrayLike<number>, offset?: number) => {
            assertFiniteFloat32ArrayLike(source, undefined, "LOD chunk cells.set");
            try {
              return Reflect.apply(value, target, [source, offset]);
            } finally {
              // The native operation may have partially written before throwing;
              // invalidate any transaction that captured the prior contents.
              owner.revision += 1;
            }
          };
        }
        if (property === "fill") {
          return (fillValue: number, start?: number, end?: number) => {
            assertFiniteFloat32Value(fillValue, "LOD chunk cells.fill");
            try {
              const result = Reflect.apply(value, target, [fillValue, start, end]);
              return result === target ? proxy : result;
            } finally {
              owner.revision += 1;
            }
          };
        }
        if (property === "copyWithin" || property === "reverse" || property === "sort") {
          return (...args: unknown[]) => {
            try {
              const result = Reflect.apply(value, target, args);
              return result === target ? proxy : result;
            } finally {
              // sort callbacks may throw after changing part of the target.
              owner.revision += 1;
            }
          };
        }
        // Typed-array callback methods pass their receiver as a callback
        // argument. Passing the backing target here would leak its mutable
        // buffer even though .buffer and valueOf() are guarded.
        const callbackMethods = new Set<PropertyKey>([
          "every", "filter", "find", "findIndex", "findLast", "findLastIndex",
          "forEach", "map", "some", "reduce", "reduceRight",
        ]);
        if (callbackMethods.has(property)) {
          return (...args: unknown[]) => {
            const callback = args[0];
            if (typeof callback !== "function") {
              return Reflect.apply(value, target, args);
            }
            const callbackThis = property === "reduce" || property === "reduceRight"
              ? undefined
              : args[1];
            args[0] = (...callbackArgs: unknown[]) => {
              if (callbackArgs.length > 0) callbackArgs[callbackArgs.length - 1] = proxy;
              return Reflect.apply(callback, callbackThis, callbackArgs);
            };
            return Reflect.apply(value, target, args);
          };
        }
        return value.bind(target);
      },
      set(target, property, value) {
        const isIndex = typeof property === "string" && /^(0|[1-9]\d*)$/.test(property);
        if (isIndex) assertFiniteFloat32Value(value, "LOD chunk indexed write");
        const ok = Reflect.set(target, property, value, target);
        if (ok && isIndex) owner.revision += 1;
        return ok;
      },
      defineProperty(target, property, descriptor) {
        const isIndex = typeof property === "string" && /^(0|[1-9]\d*)$/.test(property);
        if (isIndex && "value" in descriptor) {
          assertFiniteFloat32Value(descriptor.value, "LOD chunk indexed defineProperty");
        }
        const ok = Reflect.defineProperty(target, property, descriptor);
        if (ok && isIndex) owner.revision += 1;
        return ok;
      },
    });
    return { key: state.key, level: state.level, scale: state.scale, cells: proxy };
  }

  getChunk(key: string): InfinityScaleLODChunkState | undefined {
    const state = this.states.get(key);
    return state ? this.exposeChunk(state) : undefined;
  }

  hasChunk(key: string): boolean {
    return this.states.has(key);
  }

  deleteChunk(key: string): boolean {
    const deleted = this.states.delete(key);
    if (deleted) {
      // Removing a chunk changes the topology captured by open transactions.
      this.revision += 1;
    }
    return deleted;
  }

  clear(): void {
    this.states.clear();
    // Clearing hierarchical state invalidates every outstanding transaction
    // that captured the previous state revision.
    this.revision += 1;
  }

  keys(): string[] {
    return [...this.states.keys()];
  }

  /**
   * Reads the hierarchical cell corresponding to a base-resolution coordinate.
   */
  readBaseCell(
    key: string,
    level: number,
    baseX: number,
    baseY: number,
    baseZ: number,
  ): Float32Array | null {
    const state = this.states.get(key);
    if (!state) return null;
    if (state.level !== level) {
      throw new Error(`Infinity Scale LOD chunk level mismatch for ${key}`);
    }
    const parsedKey = parseInfinityScaleChunkKey(key);
    const { level: keyLevel, x: cx, y: cy, z: cz } = parsedKey;
    if (keyLevel !== level) throw new Error(`Infinity Scale LOD chunk key level mismatch for ${key}`);
    const scale = state.scale;

    const originX = cx * this.chunkSize * scale;
    const originY = cy * this.chunkSize * scale;
    const originZ = cz * this.chunkSize * scale;

    const lx = Math.floor((baseX - originX) / scale);
    const ly = Math.floor((baseY - originY) / scale);
    const lz = Math.floor((baseZ - originZ) / scale);

    if (
      lx < 0 || lx >= this.chunkSize ||
      ly < 0 || ly >= this.chunkSize ||
      lz < 0 || lz >= this.chunkSize
    ) {
      throw new Error(`Base coordinate is outside LOD chunk ${key}`);
    }

    const out = new Float32Array(CELL_FIELDS);
    const offset = ((lz * this.chunkSize * this.chunkSize) +
      (ly * this.chunkSize) + lx) * CELL_FIELDS;
    out.set(state.cells.subarray(offset, offset + CELL_FIELDS));
    return out;
  }

  writeBaseCell(
    key: string,
    level: number,
    baseX: number,
    baseY: number,
    baseZ: number,
    source: ArrayLike<number>,
  ): void {
    this.writeBaseCellUnchecked(key, level, baseX, baseY, baseZ, source);
    // Public writes are external mutations from the perspective of any open
    // snapshot transaction. Invalidate it even when the chunk already exists.
    this.revision += 1;
  }

  /**
   * Transaction-owned write used only after synchronization has validated the
   * captured revision. It deliberately defers revision advancement until the
   * complete synchronization batch commits.
   */
  writeBaseCellForTransaction(
    expectedRevision: number,
    key: string,
    level: number,
    baseX: number,
    baseY: number,
    baseZ: number,
    source: ArrayLike<number>,
  ): void {
    this.assertRevision(expectedRevision);
    const state = this.states.get(key);
    if (!state) throw new Error(`LOD transaction target chunk is missing: ${key}`);
    if (state.level !== level) {
      throw new Error(`LOD transaction target level mismatch for ${key}: expected ${state.level}, received ${level}`);
    }
    this.writeBaseCellUnchecked(key, level, baseX, baseY, baseZ, source);
  }

  private writeBaseCellUnchecked(
    key: string,
    level: number,
    baseX: number,
    baseY: number,
    baseZ: number,
    source: ArrayLike<number>,
  ): void {
    assertFiniteFloat32ArrayLike(source, CELL_FIELDS, "Infinity Scale LOD cell write");
    if (!Number.isInteger(level) || level < 0 || level > 30) {
      throw new Error(`Invalid Infinity Scale LOD level: ${level}`);
    }
    if (![baseX, baseY, baseZ].every(Number.isSafeInteger)) {
      throw new Error("Infinity Scale LOD base coordinates must be safe integers");
    }
    const parsedKey = parseInfinityScaleChunkKey(key);
    const { level: keyLevel, x: cx, y: cy, z: cz } = parsedKey;
    if (keyLevel !== level) throw new Error(`Infinity Scale LOD chunk key/level mismatch for ${key}`);
    const scale = 2 ** level;

    const originX = cx * this.chunkSize * scale;
    const originY = cy * this.chunkSize * scale;
    const originZ = cz * this.chunkSize * scale;

    const lx = Math.floor((baseX - originX) / scale);
    const ly = Math.floor((baseY - originY) / scale);
    const lz = Math.floor((baseZ - originZ) / scale);

    if (
      lx < 0 || lx >= this.chunkSize ||
      ly < 0 || ly >= this.chunkSize ||
      lz < 0 || lz >= this.chunkSize
    ) {
      throw new Error(`Base coordinate is outside LOD chunk ${key}`);
    }

    let state = this.states.get(key);
    if (state && state.level !== level) {
      throw new Error(`Infinity Scale LOD chunk level mismatch for ${key}`);
    }
    // Only materialize a missing chunk after every input and coordinate check
    // has passed, so rejected writes cannot leave a placeholder behind.
    if (!state) {
      this.ensureChunk(key, level);
      state = this.states.get(key);
    }
    if (!state) throw new Error(`Failed to create Infinity Scale LOD chunk ${key}`);

    const offset = ((lz * this.chunkSize * this.chunkSize) +
      (ly * this.chunkSize) + lx) * CELL_FIELDS;
    // Use the private backing record here; public chunk handles wrap cells in
    // a proxy and belong only at API boundaries.
    state.cells.set(source, offset);
  }

  /**
   * Restricts a complete fine cell block into one coarse LOD cell.
   */
  restrictCellBlock(
    sourceCells: ReadonlyArray<ReadonlyArray<number>>,
    target: number[],
    sourceLevel: number,
    targetLevel: number,
  ): void {
    InfinityScaleLODTransfer.restrict(
      sourceCells,
      target,
      sourceLevel,
      targetLevel,
    );
  }

  /**
   * Prolongates one coarse cell into its complete fine child block.
   */
  prolongateCellBlock(
    source: ReadonlyArray<number>,
    targets: Array<number[]>,
    sourceLevel: number,
    targetLevel: number,
  ): void {
    InfinityScaleLODTransfer.prolongate(
      source,
      targets,
      sourceLevel,
      targetLevel,
    );
  }
}

function assertFiniteFloat32Value(value: unknown, context: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
    throw new Error(`${context} requires a finite Float32 value`);
  }
}

function assertFiniteFloat32ArrayLike(
  source: ArrayLike<number>,
  expectedLength: number | undefined,
  context: string,
): void {
  if (!source || !Number.isSafeInteger(source.length) || source.length < 0) {
    throw new Error(`${context} requires a valid array-like source`);
  }
  if (expectedLength !== undefined && source.length !== expectedLength) {
    throw new Error(`${context} requires exactly ${expectedLength} fields; received ${source.length}`);
  }
  for (let index = 0; index < source.length; index++) {
    assertFiniteFloat32Value(source[index], `${context} at field ${index}`);
  }
}

