import { CellState, CELL_FIELDS, F, validateGridDimensions } from "./CellState";
import { Chunk, CHUNK_SIZE, CHUNK_VOLUME, type ChunkRawBufferSnapshot } from "./Chunk";
import { createTrackedFloat32Array, INTERNAL_MUTABLE_BUFFER, lockInternalMutableBufferOwner, type MutableBufferSide } from "./TrackedFloat32Array";
import {
  compileSparseVoxelGridPhysicalTopology,
  resolveSparseVoxelGridPhysicalCell,
  type SparseVoxelGridPhysicalCellAddress,
  type SparseVoxelGridPhysicalTopology,
} from "./SparseVoxelGridPhysicalTopology";
import {
  upgradeSparseVoxelGridDeltaIdentity,
  upgradeSparseVoxelGridPersistenceDocument,
  upgradeSparseVoxelGridSnapshotIdentity,
  type SparseVoxelGridPersistenceSchemaVersion,
} from "./SparseVoxelGridPersistenceSchema";

export interface SerializedChunk {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  /** Present in v2 saves. Missing fields identify the historical level-zero format. */
  level?: number;
  scale?: number;
  active: boolean;
  buffer: ArrayBuffer;
}

export interface DenseWindowRawChunkSnapshot {
  key: string;
  chunk: Chunk;
  snapshot: ChunkRawBufferSnapshot;
}

export interface SparseVoxelGridSnapshot {
  /** Version 2 identifies every physical chunk with an explicit level and scale. */
  schemaVersion?: 2;
  width: number;
  height: number;
  depth: number;
  buffer: Float32Array;
  backBuffer: Float32Array;
  denseOrigin: { x: number; y: number; z: number };
  activeChunkRange: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  chunks: Array<{
    key: string;
    cx: number;
    cy: number;
    cz: number;
    /** Optional only for legacy in-memory snapshots; v2 snapshots always include both fields. */
    level?: number;
    scale?: number;
    active: boolean;
    lastAccessed: number;
    buffer: Float32Array;
    backBuffer: Float32Array;
  }>;
  dirtyChunks: string[];
  chunkOwners: Array<[string, string]>;
}

export interface SparseVoxelGridArrayDelta {
  indices: Uint32Array;
  before: Float32Array;
  after: Float32Array;
}

export interface SparseVoxelGridChunkDelta {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  /** Physical identity; absent only in legacy v1 deltas. */
  level?: number;
  scale?: number;
  beforeExists: boolean;
  afterExists: boolean;
  beforeFull?: SparseVoxelGridSnapshot["chunks"][number];
  afterFull?: SparseVoxelGridSnapshot["chunks"][number];
  beforeActive?: boolean;
  afterActive?: boolean;
  beforeLastAccessed?: number;
  afterLastAccessed?: number;
  front?: SparseVoxelGridArrayDelta;
  back?: SparseVoxelGridArrayDelta;
}

export interface SparseVoxelGridDelta {
  /** Version 2 identifies all delta entries and full chunk payloads. */
  schemaVersion?: 2;
  width: number;
  height: number;
  depth: number;
  buffer: SparseVoxelGridArrayDelta;
  backBuffer: SparseVoxelGridArrayDelta;
  beforeDenseOrigin: { x: number; y: number; z: number };
  afterDenseOrigin: { x: number; y: number; z: number };
  beforeActiveChunkRange: SparseVoxelGridSnapshot["activeChunkRange"];
  afterActiveChunkRange: SparseVoxelGridSnapshot["activeChunkRange"];
  beforeDirtyChunks: string[];
  afterDirtyChunks: string[];
  beforeChunkOwners: Array<[string, string]>;
  afterChunkOwners: Array<[string, string]>;
  chunks: SparseVoxelGridChunkDelta[];
}

function cloneGridChunkSnapshot(
  chunk: SparseVoxelGridSnapshot["chunks"][number],
): SparseVoxelGridSnapshot["chunks"][number] {
  return {
    ...chunk,
    buffer: chunk.buffer.slice(),
    backBuffer: chunk.backBuffer.slice(),
  };
}

function diffGridFloatBuffers(before: Float32Array, after: Float32Array): SparseVoxelGridArrayDelta {
  if (!(before instanceof Float32Array) || !(after instanceof Float32Array) ||
      before.length !== after.length) {
    throw new Error("Cannot diff sparse-grid buffers with incompatible shapes");
  }
  let changed = 0;
  for (let i = 0; i < before.length; i++) {
    if (!Object.is(before[i], after[i])) changed++;
  }
  const indices = new Uint32Array(changed);
  const beforeValues = new Float32Array(changed);
  const afterValues = new Float32Array(changed);
  let cursor = 0;
  for (let i = 0; i < before.length; i++) {
    if (!Object.is(before[i], after[i])) {
      indices[cursor] = i;
      beforeValues[cursor] = before[i];
      afterValues[cursor] = after[i];
      cursor++;
    }
  }
  return { indices, before: beforeValues, after: afterValues };
}

function hasGridArrayChanges(delta: SparseVoxelGridArrayDelta): boolean {
  return delta.indices.length > 0;
}

export function createSparseVoxelGridDelta(
  before: SparseVoxelGridSnapshot,
  after: SparseVoxelGridSnapshot,
): SparseVoxelGridDelta {
  if (!before || !after ||
      before.width !== after.width ||
      before.height !== after.height ||
      before.depth !== after.depth) {
    throw new Error("Cannot create sparse-grid delta across incompatible dimensions");
  }

  // Normalize legacy snapshots before diffing. New deltas are always emitted
  // as v2, even when their source snapshots came from the historical v1 shape.
  const beforeState = upgradeSparseVoxelGridSnapshotIdentity(before) as unknown as SparseVoxelGridSnapshot;
  const afterState = upgradeSparseVoxelGridSnapshotIdentity(after) as unknown as SparseVoxelGridSnapshot;
  const beforeChunks = new Map(beforeState.chunks.map(chunk => [chunk.key, chunk] as const));
  const afterChunks = new Map(afterState.chunks.map(chunk => [chunk.key, chunk] as const));
  const keys = new Set([...beforeChunks.keys(), ...afterChunks.keys()]);
  const chunks: SparseVoxelGridChunkDelta[] = [];

  for (const key of keys) {
    const previous = beforeChunks.get(key);
    const next = afterChunks.get(key);
    if (!previous && next) {
      chunks.push({
        key, cx: next.cx, cy: next.cy, cz: next.cz,
        level: next.level, scale: next.scale,
        beforeExists: false, afterExists: true,
        afterFull: cloneGridChunkSnapshot(next),
      });
      continue;
    }
    if (previous && !next) {
      chunks.push({
        key, cx: previous.cx, cy: previous.cy, cz: previous.cz,
        level: previous.level, scale: previous.scale,
        beforeExists: true, afterExists: false,
        beforeFull: cloneGridChunkSnapshot(previous),
      });
      continue;
    }
    if (!previous || !next) continue;

    const front = diffGridFloatBuffers(previous.buffer, next.buffer);
    const back = diffGridFloatBuffers(previous.backBuffer, next.backBuffer);
    const metadataChanged = previous.active !== next.active ||
      previous.lastAccessed !== next.lastAccessed;
    if (!hasGridArrayChanges(front) && !hasGridArrayChanges(back) && !metadataChanged) continue;

    chunks.push({
      key, cx: previous.cx, cy: previous.cy, cz: previous.cz,
      level: previous.level, scale: previous.scale,
      beforeExists: true, afterExists: true,
      beforeActive: previous.active,
      afterActive: next.active,
      beforeLastAccessed: previous.lastAccessed,
      afterLastAccessed: next.lastAccessed,
      front: hasGridArrayChanges(front) ? front : undefined,
      back: hasGridArrayChanges(back) ? back : undefined,
    });
  }

  return {
    schemaVersion: 2,
    width: beforeState.width,
    height: beforeState.height,
    depth: beforeState.depth,
    buffer: diffGridFloatBuffers(beforeState.buffer, afterState.buffer),
    backBuffer: diffGridFloatBuffers(beforeState.backBuffer, afterState.backBuffer),
    beforeDenseOrigin: { ...beforeState.denseOrigin },
    afterDenseOrigin: { ...afterState.denseOrigin },
    beforeActiveChunkRange: { ...beforeState.activeChunkRange },
    afterActiveChunkRange: { ...afterState.activeChunkRange },
    beforeDirtyChunks: [...beforeState.dirtyChunks],
    afterDirtyChunks: [...afterState.dirtyChunks],
    beforeChunkOwners: beforeState.chunkOwners.map(entry => [...entry] as [string, string]),
    afterChunkOwners: afterState.chunkOwners.map(entry => [...entry] as [string, string]),
    chunks,
  };
}

export function applySparseVoxelGridDelta(
  current: SparseVoxelGridSnapshot,
  delta: SparseVoxelGridDelta,
  direction: "before" | "after",
): SparseVoxelGridSnapshot {
  if (direction !== "before" && direction !== "after") {
    throw new Error("Sparse-grid delta direction must be before or after");
  }
  if (!current || !delta) {
    throw new Error("Sparse-grid delta requires a current snapshot and delta");
  }

  // The schema helpers validate identities before this function clones or
  // changes any state. Legacy inputs are upgraded in detached objects.
  const currentState = upgradeSparseVoxelGridSnapshotIdentity(current) as unknown as SparseVoxelGridSnapshot;
  const versionedDelta = upgradeSparseVoxelGridDeltaIdentity(delta) as unknown as SparseVoxelGridDelta;
  if (currentState.width !== versionedDelta.width ||
      currentState.height !== versionedDelta.height ||
      currentState.depth !== versionedDelta.depth) {
    throw new Error("Sparse-grid delta does not match the current grid dimensions");
  }
  if (!(currentState.buffer instanceof Float32Array) ||
      currentState.buffer.length !== currentState.width * currentState.height * currentState.depth * CELL_FIELDS ||
      !(currentState.backBuffer instanceof Float32Array) ||
      currentState.backBuffer.length !== currentState.buffer.length ||
      !Array.isArray(currentState.chunks) ||
      !Array.isArray(versionedDelta.chunks)) {
    throw new Error("Sparse-grid delta current snapshot is malformed");
  }

  const sourceChunks = new Map(currentState.chunks.map(chunk => [chunk.key, chunk] as const));
  for (const change of versionedDelta.chunks) {
    const shouldExist = direction === "after" ? change.beforeExists : change.afterExists;
    const source = sourceChunks.get(change.key);
    if (shouldExist !== !!source) {
      throw new Error(`Sparse-grid delta topology precondition failed for chunk ${change.key}`);
    }
    if (source && (source.cx !== change.cx || source.cy !== change.cy ||
        source.cz !== change.cz || source.level !== change.level || source.scale !== change.scale)) {
      throw new Error(`Sparse-grid delta physical identity precondition failed for chunk ${change.key}`);
    }
  }

  const result: SparseVoxelGridSnapshot = {
    ...currentState,
    schemaVersion: 2,
    buffer: currentState.buffer.slice(),
    backBuffer: currentState.backBuffer.slice(),
    denseOrigin: { ...currentState.denseOrigin },
    activeChunkRange: { ...currentState.activeChunkRange },
    chunks: currentState.chunks.map(cloneGridChunkSnapshot),
    dirtyChunks: [...currentState.dirtyChunks],
    chunkOwners: currentState.chunkOwners.map(entry => [...entry] as [string, string]),
  };

  const applyArray = (target: Float32Array, change: SparseVoxelGridArrayDelta | undefined) => {
    if (!change) return;
    if (!(change.indices instanceof Uint32Array) ||
        !(change.before instanceof Float32Array) ||
        !(change.after instanceof Float32Array) ||
        change.indices.length !== change.before.length ||
        change.indices.length !== change.after.length) {
      throw new Error("Invalid sparse-grid delta buffer");
    }
    const values = direction === "before" ? change.before : change.after;
    let previousIndex = -1;
    for (let i = 0; i < change.indices.length; i++) {
      const index = change.indices[i];
      if (index >= target.length || index <= previousIndex || !Number.isFinite(values[i])) {
        throw new Error("Sparse-grid delta buffer index or value is invalid");
      }
      target[index] = values[i];
      previousIndex = index;
    }
  };

  applyArray(result.buffer, versionedDelta.buffer);
  applyArray(result.backBuffer, versionedDelta.backBuffer);

  const chunks = new Map(result.chunks.map(chunk => [chunk.key, chunk] as const));
  for (const change of versionedDelta.chunks) {
    const exists = direction === "before" ? change.beforeExists : change.afterExists;
    const full = direction === "before" ? change.beforeFull : change.afterFull;
    if (!exists) {
      chunks.delete(change.key);
      continue;
    }
    if (full) {
      chunks.set(change.key, cloneGridChunkSnapshot(full as SparseVoxelGridSnapshot["chunks"][number]));
      continue;
    }

    const chunk = chunks.get(change.key);
    if (!chunk) throw new Error(`Sparse-grid delta is missing chunk ${change.key}`);
    applyArray(chunk.buffer, change.front);
    applyArray(chunk.backBuffer, change.back);
    chunk.active = direction === "before" ? !!change.beforeActive : !!change.afterActive;
    chunk.lastAccessed = direction === "before"
      ? change.beforeLastAccessed!
      : change.afterLastAccessed!;
  }

  result.chunks = [...chunks.values()];
  result.denseOrigin = { ...(direction === "before" ? versionedDelta.beforeDenseOrigin : versionedDelta.afterDenseOrigin) };
  result.activeChunkRange = { ...(direction === "before" ? versionedDelta.beforeActiveChunkRange : versionedDelta.afterActiveChunkRange) };
  result.dirtyChunks = [...(direction === "before" ? versionedDelta.beforeDirtyChunks : versionedDelta.afterDirtyChunks)];
  result.chunkOwners = (direction === "before" ? versionedDelta.beforeChunkOwners : versionedDelta.afterChunkOwners)
    .map(entry => [...entry] as [string, string]);

  // Validate the complete resulting topology, not only each delta entry.
  // Individually valid level-aware keys can still overlap unchanged chunks
  // when combined into the destination snapshot.
  upgradeSparseVoxelGridSnapshotIdentity(result);
  return result;
}

export class SparseVoxelGrid {
  readonly chunkSize = CHUNK_SIZE;
  readonly W: number;
  readonly H: number;
  readonly D: number;
  readonly size: number;
  readonly chunks: Map<string, Chunk>;
  readonly dirtyChunks: Set<string>;
  readonly chunkOwners: Map<string, string>;
  #physicalTopologyCache: SparseVoxelGridPhysicalTopology | undefined;
  #_activeChunkRange = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };

  /**
   * Immutable physical-addressing snapshot of the current authoritative map.
   * The current production map remains level-zero-only; this index is rebuilt
   * after every map mutation and does not enable mixed-LOD storage or execution.
   */
  get physicalTopology(): SparseVoxelGridPhysicalTopology {
    if (!this.#physicalTopologyCache) {
      this.#physicalTopologyCache = compileSparseVoxelGridPhysicalTopology([...this.chunks.keys()]);
    }
    return this.#physicalTopologyCache;
  }

  /** Resolve a base-space cell to its physical chunk and local stored-cell address. */
  resolvePhysicalCellAddress(x: number, y: number, z: number): SparseVoxelGridPhysicalCellAddress | null {
    return resolveSparseVoxelGridPhysicalCell(this.physicalTopology, x, y, z);
  }

  /** Return a detached range so nested writes cannot bypass revision tracking. */
  get activeChunkRange() {
    return { ...this.#_activeChunkRange };
  }

  /** Replace the range atomically; invalid ranges are rejected and valid changes tracked. */
  set activeChunkRange(range: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }) {
    if (!range ||
        !Object.values(range).every(Number.isSafeInteger) ||
        range.minX > range.maxX ||
        range.minY > range.maxY ||
        range.minZ > range.maxZ) {
      throw new Error("Invalid active chunk range");
    }
    const next = { ...range };
    const topologyRange = this.#chunkRangeFor(this.chunks.values());
    if (topologyRange.minX !== next.minX || topologyRange.maxX !== next.maxX ||
        topologyRange.minY !== next.minY || topologyRange.maxY !== next.maxY ||
        topologyRange.minZ !== next.minZ || topologyRange.maxZ !== next.maxZ) {
      throw new Error("Active chunk range must match current chunk topology");
    }
    const previous = this.#_activeChunkRange;
    if (previous.minX === next.minX && previous.maxX === next.maxX &&
        previous.minY === next.minY && previous.maxY === next.maxY &&
        previous.minZ === next.minZ && previous.maxZ === next.maxZ) return;
    this.#_activeChunkRange = next;
    this.#markMutation();
  }

  #_sparseDenseBuffer: Float32Array;
  #_sparseDenseBackBuffer: Float32Array;
  #_sparseDenseBufferView: Float32Array;
  #_sparseDenseBackBufferView: Float32Array;
  #sparseMutationDepth = 0;
  #sparseMutationPending = false;
  #_sparseMutationRevision = 0;
  #_denseOrigin: Readonly<{ x: number; y: number; z: number }> =
    Object.freeze({ x: 0, y: 0, z: 0 });

  /** Internal origin coordinates are immutable when read and revisioned when replaced. */
  get #denseOrigin(): Readonly<{ x: number; y: number; z: number }> {
    return this.#_denseOrigin;
  }

  #setDenseOrigin(origin: { x: number; y: number; z: number }): void {
    if (!origin ||
        ![origin.x, origin.y, origin.z].every(Number.isSafeInteger)) {
      throw new Error("Invalid dense origin");
    }
    const previous = this.#_denseOrigin;
    if (previous.x === origin.x && previous.y === origin.y && previous.z === origin.z) return;
    this.#_denseOrigin = Object.freeze({ x: origin.x, y: origin.y, z: origin.z });
    this.#markMutation();
  }

  /** Detached, immutable origin view for spatial callers and diagnostics. */
  get denseOrigin(): Readonly<{ x: number; y: number; z: number }> {
    return Object.freeze({ ...this.#denseOrigin });
  }

  /** Validated public origin update; authoritative coordinates remain runtime-private. */
  set denseOrigin(origin: { x: number; y: number; z: number }) {
    this.#setDenseOrigin(origin);
  }

  constructor(W = 64, H = 64, D = 32) {
    const size = validateGridDimensions(W, H, D, "SparseVoxelGrid");
    this.W = W;
    this.H = H;
    this.D = D;
    this.size = size;
    // TypeScript readonly is erased at runtime. Keep grid geometry immutable
    // because it is the layout contract for every dense/sparse buffer and index.
    Object.defineProperties(this, {
      chunkSize: { writable: false, configurable: false },
      W: { writable: false, configurable: false },
      H: { writable: false, configurable: false },
      D: { writable: false, configurable: false },
      size: { writable: false, configurable: false },
    });
    this.dirtyChunks = guardNativeCollection(new MutationTrackedSet(
      () => this.#markMutation(),
      key => {
        if (!this.#isValidChunkKey(key)) throw new Error(`Invalid dirty chunk key: ${String(key)}`);
      },
    ));
    this.chunkOwners = guardNativeCollection(new MutationTrackedMap(
      () => this.#markMutation(),
      (key, ownerId) => {
        if (!this.#isValidChunkKey(key)) throw new Error(`Invalid chunk owner key: ${String(key)}`);
        if (typeof ownerId !== "string") throw new Error("Chunk owner ID must be a string");
      },
    ));
    this.#_sparseDenseBuffer = new Float32Array(this.size * CELL_FIELDS);
    this.#_sparseDenseBackBuffer = new Float32Array(this.size * CELL_FIELDS);
    this.#_sparseDenseBufferView = createTrackedFloat32Array(this.#_sparseDenseBuffer, () => this.#markMutation());
    this.#_sparseDenseBackBufferView = createTrackedFloat32Array(this.#_sparseDenseBackBuffer, () => this.#markMutation());
    this.chunks = guardNativeCollection(new MutationTrackedChunkMap(
      () => this.#onChunkMapMutation(),
      () => this.#markMutation(),
    ));
    Object.defineProperties(this, {
      chunks: { writable: false, configurable: false },
      dirtyChunks: { writable: false, configurable: false },
      chunkOwners: { writable: false, configurable: false },
      beginMutation: { value: this.beginMutation.bind(this), writable: false, configurable: false },
    });
    lockInternalMutableBufferOwner(this);
    this.#seedDenseWindowChunks();
  }

  get buffer(): Float32Array { return this.#_sparseDenseBufferView; }
  set buffer(value: Float32Array) { this.#assertSparseBuffer(value); this.#_sparseDenseBuffer.set(value); this.#markMutation(); }
  get backBuffer(): Float32Array { return this.#_sparseDenseBackBufferView; }
  set backBuffer(value: Float32Array) { this.#assertSparseBuffer(value); this.#_sparseDenseBackBuffer.set(value); this.#markMutation(); }
  get mutationRevision(): number { return this.#_sparseMutationRevision; }

  /**
   * Detect writes made through a previously acquired raw internal alias while
   * asynchronous GPU readback is pending. Snapshots must be detached copies.
   * This method reads private backing arrays directly to avoid per-element
   * Proxy overhead on the public revision-tracked views.
   */
  buffersMatchSnapshots(frontSnapshot: Float32Array, backSnapshot: Float32Array): boolean {
    const front = this.#_sparseDenseBuffer;
    const back = this.#_sparseDenseBackBuffer;
    if (!(frontSnapshot instanceof Float32Array) || !(backSnapshot instanceof Float32Array) ||
        frontSnapshot.length !== front.length || backSnapshot.length !== back.length) {
      return false;
    }
    for (let i = 0; i < front.length; i++) {
      if (!Object.is(front[i], frontSnapshot[i]) || !Object.is(back[i], backSnapshot[i])) return false;
    }
    return true;
  }

  /**
   * Raw typed-array aliases are an internal escape hatch. Only chunks intersecting
   * the active dense window can be overwritten by a dense GPU readback commit, so
   * snapshot escaped aliases only in that bounded region rather than copying every
   * sparse chunk on every frame.
   */
  captureDenseWindowRawChunkSnapshots(): DenseWindowRawChunkSnapshot[] {
    const minCX = Math.floor(this.#denseOrigin.x / CHUNK_SIZE);
    const maxCX = Math.floor((this.#denseOrigin.x + this.W - 1) / CHUNK_SIZE);
    const minCY = Math.floor(this.#denseOrigin.y / CHUNK_SIZE);
    const maxCY = Math.floor((this.#denseOrigin.y + this.H - 1) / CHUNK_SIZE);
    const minCZ = Math.floor(this.#denseOrigin.z / CHUNK_SIZE);
    const maxCZ = Math.floor((this.#denseOrigin.z + this.D - 1) / CHUNK_SIZE);
    const snapshots: DenseWindowRawChunkSnapshot[] = [];
    for (let cz = minCZ; cz <= maxCZ; cz++)
    for (let cy = minCY; cy <= maxCY; cy++)
    for (let cx = minCX; cx <= maxCX; cx++) {
      const key = this.getChunkKey(cx, cy, cz);
      const chunk = this.chunks.get(key);
      if (!chunk) continue;
      const snapshot = chunk.captureRawBufferSnapshot();
      if (snapshot) snapshots.push({ key, chunk, snapshot });
    }
    return snapshots;
  }

  denseWindowRawChunksMatchSnapshots(snapshots: DenseWindowRawChunkSnapshot[]): boolean {
    if (!Array.isArray(snapshots)) return false;
    for (const entry of snapshots) {
      if (!entry || this.chunks.get(entry.key) !== entry.chunk ||
          !entry.chunk.rawBuffersMatchSnapshot(entry.snapshot)) return false;
    }
    return true;
  }

  beginMutation(): () => void {
    this.#sparseMutationDepth++;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.#sparseMutationDepth--;
      if (this.#sparseMutationDepth === 0 && this.#sparseMutationPending) {
        this.#sparseMutationPending = false;
        this.#_sparseMutationRevision++;
      }
    };
  }
  markMutation(): void { this.#markMutation(); }

  #markMutation(): void {
    if (this.#sparseMutationDepth > 0) { this.#sparseMutationPending = true; return; }
    this.#_sparseMutationRevision++;
  }
  [INTERNAL_MUTABLE_BUFFER](side: MutableBufferSide = "front"): Float32Array {
    this.#markMutation();
    return side === "back" ? this.#_sparseDenseBackBuffer : this.#_sparseDenseBuffer;
  }
  #assertSparseBuffer(value: Float32Array): void {
    if (!(value instanceof Float32Array) || value.length !== this.size * CELL_FIELDS) {
      throw new Error("SparseVoxelGrid buffer length does not match the grid dimensions");
    }
  }

  assignChunkOwner(chunkKey: string, ownerId: string) {
    this.chunkOwners.set(chunkKey, ownerId);
  }

  getOwnedChunks(ownerId?: string): string[] {
    if (!ownerId) return [...this.chunkOwners.keys()];
    return [...this.chunkOwners.entries()].filter(([, v]) => v === ownerId).map(([k]) => k);
  }

  getChunkBoundary(chunkKey: string): { neighbors: string[] } {
    if (!this.#isValidChunkKey(chunkKey)) return { neighbors: [] };
    const parts = chunkKey.split(',').map(n => Number(n));
    const [cx, cy, cz] = parts;
    const neigh: string[] = [];
    for (const dz of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) {
      if (dx === 0 && dy === 0 && dz === 0) continue;
      neigh.push(this.getChunkKey(cx + dx, cy + dy, cz + dz));
    }
    return { neighbors: neigh };
  }

  getChunkKey(cx: number, cy: number, cz: number): string {
    return `${cx},${cy},${cz}`;
  }

  #isValidChunkKey(key: unknown): key is string {
    if (typeof key !== "string") return false;
    const parts = key.split(",");
    if (parts.length !== 3) return false;
    const coords = parts.map(part => Number(part));
    return coords.every(Number.isSafeInteger) &&
      this.getChunkKey(coords[0], coords[1], coords[2]) === key;
  }

  getOrCreateChunk(cx: number, cy: number, cz: number): Chunk {
    const key = this.getChunkKey(cx, cy, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cy, cz);
      this.chunks.set(key, chunk);
    }
    chunk.active = true;
    chunk.lastAccessed = Date.now();
    return chunk;
  }

  markChunksDirty(chunks: Array<Chunk | string>): void {
    for (const chunk of chunks) {
      const key = typeof chunk === 'string' ? chunk : this.getChunkKey(chunk.cx, chunk.cy, chunk.cz);
      this.dirtyChunks.add(key);
      const existing = this.chunks.get(key);
      if (existing) {
        existing.active = true;
        existing.lastAccessed = Date.now();
      }
    }
  }

  clearDirtyChunks(): void {
    this.dirtyChunks.clear();
  }

  getCell(gx: number, gy: number, gz: number): CellState | null {
    const [cx, lx] = this.#globalToChunk(gx);
    const [cy, ly] = this.#globalToChunk(gy);
    const [cz, lz] = this.#globalToChunk(gz);
    const chunk = this.chunks.get(this.getChunkKey(cx, cy, cz));
    if (!chunk) return null;
    return chunk.getCell(lx, ly, lz);
  }

  cell(x: number, y: number, z: number): CellState {
    this.#assertDenseCoordinates(x, y, z, "cell");
    this.#getOrCreateChunkForGlobal(x, y, z);
    return new CellState(this.#_sparseDenseBuffer, this.idx(x, y, z), () => this.#markMutation());
  }

  cellAt(linearIdx: number): CellState {
    if (!Number.isSafeInteger(linearIdx) || linearIdx < 0 || linearIdx >= this.size) {
      throw new RangeError(`cellAt index out of bounds: ${linearIdx}`);
    }
    return new CellState(this.#_sparseDenseBuffer, linearIdx * CELL_FIELDS, () => this.#markMutation());
  }

  cellBack(x: number, y: number, z: number): CellState {
    this.#assertDenseCoordinates(x, y, z, "cellBack");
    return new CellState(this.#_sparseDenseBackBuffer, this.idx(x, y, z), () => this.#markMutation());
  }

  idx(x: number, y: number, z: number): number {
    return (z * this.H * this.W + y * this.W + x) * CELL_FIELDS;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.W && y >= 0 && y < this.H && z >= 0 && z < this.D;
  }

  captureState(): SparseVoxelGridSnapshot {
    return {
      schemaVersion: 2,
      width: this.W,
      height: this.H,
      depth: this.D,
      buffer: new Float32Array(this.#_sparseDenseBuffer),
      backBuffer: new Float32Array(this.#_sparseDenseBackBuffer),
      denseOrigin: { ...this.#denseOrigin },
      activeChunkRange: { ...this.activeChunkRange },
      chunks: [...this.chunks.entries()].map(([key, chunk]) => ({
        key,
        cx: chunk.cx,
        cy: chunk.cy,
        cz: chunk.cz,
        level: 0,
        scale: 1,
        active: chunk.active,
        lastAccessed: chunk.lastAccessed,
        buffer: new Float32Array(chunk.buffer),
        backBuffer: new Float32Array(chunk.backBuffer),
      })),
      dirtyChunks: [...this.dirtyChunks],
      chunkOwners: [...this.chunkOwners.entries()],
    };
  }

  restoreState(snapshot: SparseVoxelGridSnapshot): void {
    // Normalize legacy v1 snapshots before opening the mutation boundary.
    // The live SparseVoxelGrid implementation remains strictly level zero.
    snapshot = upgradeSparseVoxelGridSnapshotIdentity(snapshot) as unknown as SparseVoxelGridSnapshot;
    const endMutation = this.beginMutation();
    try {
    const validRange = (range: SparseVoxelGridSnapshot["activeChunkRange"]) =>
      !!range &&
      Object.values(range).every(Number.isSafeInteger) &&
      range.minX <= range.maxX &&
      range.minY <= range.maxY &&
      range.minZ <= range.maxZ;
    if (!snapshot ||
        snapshot.width !== this.W || snapshot.height !== this.H || snapshot.depth !== this.D ||
        !(snapshot.buffer instanceof Float32Array) || snapshot.buffer.length !== this.size * CELL_FIELDS ||
        !snapshot.buffer.every(Number.isFinite) ||
        !(snapshot.backBuffer instanceof Float32Array) || snapshot.backBuffer.length !== this.size * CELL_FIELDS ||
        !snapshot.backBuffer.every(Number.isFinite) ||
        !snapshot.denseOrigin || ![snapshot.denseOrigin.x, snapshot.denseOrigin.y, snapshot.denseOrigin.z].every(Number.isSafeInteger) ||
        !validRange(snapshot.activeChunkRange) ||
        !Array.isArray(snapshot.chunks) || !Array.isArray(snapshot.dirtyChunks) ||
        !Array.isArray(snapshot.chunkOwners)) {
      throw new Error("Invalid SparseVoxelGrid snapshot");
    }

    const restoredChunks = new Map<string, Chunk>();
    for (const data of snapshot.chunks) {
      if (!data || typeof data.key !== "string" || !Number.isSafeInteger(data.cx) ||
          !Number.isSafeInteger(data.cy) || !Number.isSafeInteger(data.cz) ||
          data.level !== 0 || data.scale !== 1 ||
          typeof data.active !== "boolean" || !Number.isFinite(data.lastAccessed) ||
          !(data.buffer instanceof Float32Array) ||
          data.buffer.length !== CHUNK_VOLUME * CELL_FIELDS ||
          !data.buffer.every(Number.isFinite) ||
          !(data.backBuffer instanceof Float32Array) ||
          data.backBuffer.length !== CHUNK_VOLUME * CELL_FIELDS ||
          !data.backBuffer.every(Number.isFinite)) {
        throw new Error("Invalid SparseVoxelGrid snapshot chunk");
      }
      const expectedKey = this.getChunkKey(data.cx, data.cy, data.cz);
      if (data.key !== expectedKey || restoredChunks.has(data.key)) {
        throw new Error("Invalid SparseVoxelGrid snapshot chunk");
      }
      const chunk = new Chunk(data.cx, data.cy, data.cz);
      chunk.buffer.set(data.buffer);
      chunk.backBuffer.set(data.backBuffer);
      chunk.active = data.active;
      chunk.lastAccessed = data.lastAccessed;
      restoredChunks.set(data.key, chunk);
    }

    const restoredRange = this.#chunkRangeFor(restoredChunks.values());
    if (restoredRange.minX !== snapshot.activeChunkRange.minX ||
        restoredRange.maxX !== snapshot.activeChunkRange.maxX ||
        restoredRange.minY !== snapshot.activeChunkRange.minY ||
        restoredRange.maxY !== snapshot.activeChunkRange.maxY ||
        restoredRange.minZ !== snapshot.activeChunkRange.minZ ||
        restoredRange.maxZ !== snapshot.activeChunkRange.maxZ) {
      throw new Error("Invalid SparseVoxelGrid snapshot active chunk range");
    }

    const isValidChunkKey = (key: unknown): key is string => this.#isValidChunkKey(key);
    const owners = new Map<string, string>();
    for (const entry of snapshot.chunkOwners) {
      if (!Array.isArray(entry) || entry.length !== 2 ||
          !isValidChunkKey(entry[0]) || typeof entry[1] !== "string" || owners.has(entry[0])) {
        throw new Error("Invalid SparseVoxelGrid snapshot ownership entry");
      }
      owners.set(entry[0], entry[1]);
    }
    if (!snapshot.dirtyChunks.every(isValidChunkKey) ||
        new Set(snapshot.dirtyChunks).size !== snapshot.dirtyChunks.length) {
      throw new Error("Invalid SparseVoxelGrid snapshot dirty-chunk list");
    }

    this.#_sparseDenseBuffer.set(snapshot.buffer);
    this.#_sparseDenseBackBuffer.set(snapshot.backBuffer);
    this.#setDenseOrigin(snapshot.denseOrigin);
    this.chunks.clear();
    for (const [key, chunk] of restoredChunks) this.chunks.set(key, chunk);
    // The range is derived from the fully restored chunk topology, so install it
    // only after the new chunk map has been published.
    this.activeChunkRange = { ...snapshot.activeChunkRange };
    this.dirtyChunks.clear();
    for (const key of snapshot.dirtyChunks) this.dirtyChunks.add(key);
    this.chunkOwners.clear();
    for (const [key, owner] of owners) this.chunkOwners.set(key, owner);
    this.#markMutation();
    } finally {
      endMutation();
    }
  }

  /**
   * Reject dense-window entity ownership that disagrees with chunk storage.
   * This check does not establish whole-world coverage.
   */
  assertDenseEntityOwnershipSynchronized(): void {
    for (let z = 0; z < this.D; z++) {
      for (let y = 0; y < this.H; y++) {
        for (let x = 0; x < this.W; x++) {
          const gx = x + this.#denseOrigin.x;
          const gy = y + this.#denseOrigin.y;
          const gz = z + this.#denseOrigin.z;
          const denseId = this.#_sparseDenseBuffer[this.idx(x, y, z) + F.ENTITY_ID];
          const chunkId = this.getCell(gx, gy, gz)?.entityId ?? 0;
          if (denseId !== chunkId) {
            throw new Error(
              `Dense/chunk entity ownership mismatch at (${gx}, ${gy}, ${gz}): dense=${denseId}, chunk=${chunkId}`,
            );
          }
        }
      }
    }
  }

  /**
   * Publish entity IDs from the dense simulation window without copying every
   * field. EntityLayer may run more than once inside a frame (nSteps > 1), so
   * chunk ownership must stay aligned between substeps even though the full
   * dense-to-chunk synchronization is deferred until the frame ends.
   */
  syncDenseEntityOwnershipToChunks(): void {
    const endMutation = this.beginMutation();
    try {
      this.#seedDenseWindowChunks();
      for (let z = 0; z < this.D; z++) {
        for (let y = 0; y < this.H; y++) {
          let x = 0;
          while (x < this.W) {
            const gx = x + this.#denseOrigin.x;
            const gy = y + this.#denseOrigin.y;
            const gz = z + this.#denseOrigin.z;
            const chunk = this.#getOrCreateChunkForGlobal(gx, gy, gz);
            const [, lx] = this.#globalToChunk(gx);
            const [, ly] = this.#globalToChunk(gy);
            const [, lz] = this.#globalToChunk(gz);
            const cellCount = Math.min(this.W - x, CHUNK_SIZE - lx);
            chunk.writeFrontFieldRangeFrom(
              this.#_sparseDenseBuffer,
              this.idx(x, y, z),
              chunk.localIdx(lx, ly, lz),
              cellCount,
              F.ENTITY_ID,
            );
            x += cellCount;
          }
        }
      }
      this.#markMutation();
    } finally {
      endMutation();
    }
  }

  /**
   * Detect entity-relevant cells that exist in sparse chunk storage but are
   * outside the dense window scanned by EntityLayer. A dense-window flood fill
   * cannot authorize world-wide merge/extinction while any such cell is active.
   */
  hasUnverifiedEntityDomainOutsideDenseWindow(bioThreshold: number): boolean {
    if (!Number.isFinite(bioThreshold) || bioThreshold < 0) {
      throw new RangeError("Entity-domain visibility threshold must be finite and non-negative");
    }

    const denseMaxX = this.#denseOrigin.x + this.W;
    const denseMaxY = this.#denseOrigin.y + this.H;
    const denseMaxZ = this.#denseOrigin.z + this.D;

    for (const chunk of this.chunks.values()) {
      const chunkMinX = chunk.cx * CHUNK_SIZE;
      const chunkMinY = chunk.cy * CHUNK_SIZE;
      const chunkMinZ = chunk.cz * CHUNK_SIZE;
      const chunkMaxX = chunkMinX + CHUNK_SIZE;
      const chunkMaxY = chunkMinY + CHUNK_SIZE;
      const chunkMaxZ = chunkMinZ + CHUNK_SIZE;
      const fullyInsideDenseWindow =
        chunkMinX >= this.#denseOrigin.x && chunkMaxX <= denseMaxX &&
        chunkMinY >= this.#denseOrigin.y && chunkMaxY <= denseMaxY &&
        chunkMinZ >= this.#denseOrigin.z && chunkMaxZ <= denseMaxZ;
      if (fullyInsideDenseWindow) continue;

      const overlapsDenseWindow =
        chunkMinX < denseMaxX && chunkMaxX > this.#denseOrigin.x &&
        chunkMinY < denseMaxY && chunkMaxY > this.#denseOrigin.y &&
        chunkMinZ < denseMaxZ && chunkMaxZ > this.#denseOrigin.z;
      // A wholly external sparse chunk is outside the authority of this
      // dense-window scan. Treat its domain as unverified without scanning every
      // off-window cell on every simulation tick.
      if (!overlapsDenseWindow) return true;

      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const gz = chunkMinZ + lz;
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
          const gy = chunkMinY + ly;
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const gx = chunkMinX + lx;
            if (
              gx >= this.#denseOrigin.x && gx < denseMaxX &&
              gy >= this.#denseOrigin.y && gy < denseMaxY &&
              gz >= this.#denseOrigin.z && gz < denseMaxZ
            ) continue;

            const base = chunk.localIdx(lx, ly, lz);
            const chunkBuffer = chunk.buffer;
            const bio = chunkBuffer[base + F.BIO_POTENTIAL];
            const entityId = chunkBuffer[base + F.ENTITY_ID];
            if (!Number.isFinite(bio) || bio >= bioThreshold || entityId !== 0) return true;
          }
        }
      }
    }
    return false;
  }

  snapshot(): void {
    const endMutation = this.beginMutation();
    try {
      this.#_sparseDenseBackBuffer.set(this.#_sparseDenseBuffer);
      for (const chunk of this.chunks.values()) chunk.snapshot();
      this.#markMutation();
    } finally { endMutation(); }
  }

  swapBuffers(): void {
    const endMutation = this.beginMutation();
    try {
      const raw = this.#_sparseDenseBuffer; this.#_sparseDenseBuffer = this.#_sparseDenseBackBuffer; this.#_sparseDenseBackBuffer = raw;
      const view = this.#_sparseDenseBufferView; this.#_sparseDenseBufferView = this.#_sparseDenseBackBufferView; this.#_sparseDenseBackBufferView = view;
      for (const chunk of this.chunks.values()) chunk.swapBuffers();
      this.#markMutation();
    } finally { endMutation(); }
  }

  neighbors6(x: number, y: number, z: number): Array<[number, number, number]> {
    const result: Array<[number, number, number]> = [];
    const dirs: Array<[number, number, number]> = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]];
    for (const [dx, dy, dz] of dirs) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (this.inBounds(nx, ny, nz)) result.push([nx, ny, nz]);
    }
    return result;
  }

  clear(): void {
    const endMutation = this.beginMutation();
    try {
      this.#_sparseDenseBuffer.fill(0);
      this.#_sparseDenseBackBuffer.fill(0);
      this.chunks.clear();
      this.dirtyChunks.clear();
      this.#seedDenseWindowChunks();
      this.#markMutation();
    } finally { endMutation(); }
  }

  totalField(fieldOffset: number): number {
    this.#assertFieldOffset(fieldOffset);
    let sum = 0;
    for (let i = fieldOffset; i < this.#_sparseDenseBuffer.length; i += CELL_FIELDS) sum += this.#_sparseDenseBuffer[i];
    return sum;
  }

  /**
   * Sum selected cell fields in one backing-buffer pass without exposing a raw
   * mutable alias or paying public Proxy access overhead in read-only hot paths.
   */
  sumFields(fieldOffsets: readonly number[]): number[] {
    if (!Array.isArray(fieldOffsets) || fieldOffsets.some(offset =>
      !Number.isSafeInteger(offset) || offset < 0 || offset >= CELL_FIELDS)) {
      throw new RangeError("SparseVoxelGrid field offsets must be valid cell-field indices");
    }
    const sums = fieldOffsets.map(() => 0);
    const buffer = this.#_sparseDenseBuffer;
    for (let base = 0; base < buffer.length; base += CELL_FIELDS) {
      for (let index = 0; index < fieldOffsets.length; index++) {
        sums[index] += buffer[base + fieldOffsets[index]];
      }
    }
    return sums;
  }

  #assertFieldOffset(fieldOffset: number): void {
    if (!Number.isSafeInteger(fieldOffset) || fieldOffset < 0 || fieldOffset >= CELL_FIELDS) {
      throw new RangeError("SparseVoxelGrid field offset must be a valid cell-field index");
    }
  }

  syncDenseToChunks(): void {
    const endMutation = this.beginMutation();
    try {
      this.#seedDenseWindowChunks();

      // A segment is one contiguous x-run within a physical chunk. Planning at
      // segment granularity avoids per-cell index arrays and a second coordinate
      // traversal, while preserving a preflight-before-publish transaction.
      const segments: Array<{
        chunk: Chunk;
        sourceOffset: number;
        targetOffset: number;
        fieldCount: number;
      }> = [];
      const chunks: Chunk[] = [];
      const seenChunks = new Set<Chunk>();
      for (let z = 0; z < this.D; z++)
      for (let y = 0; y < this.H; y++) {
        let x = 0;
        while (x < this.W) {
          const gx = x + this.#denseOrigin.x;
          const gy = y + this.#denseOrigin.y;
          const gz = z + this.#denseOrigin.z;
          const chunk = this.#getOrCreateChunkForGlobal(gx, gy, gz);
          const [, lx] = this.#globalToChunk(gx);
          const [, ly] = this.#globalToChunk(gy);
          const [, lz] = this.#globalToChunk(gz);
          const cellCount = Math.min(this.W - x, CHUNK_SIZE - lx);
          const fieldCount = cellCount * CELL_FIELDS;
          const sourceOffset = this.idx(x, y, z);
          const targetOffset = chunk.localIdx(lx, ly, lz);
          if (!Number.isSafeInteger(targetOffset) || targetOffset < 0 ||
              !Number.isSafeInteger(fieldCount) || fieldCount <= 0 ||
              targetOffset + fieldCount > CHUNK_VOLUME * CELL_FIELDS ||
              sourceOffset < 0 || sourceOffset + fieldCount > this.#_sparseDenseBuffer.length) {
            throw new Error("Dense-to-chunk synchronization produced an invalid segment");
          }
          segments.push({ chunk, sourceOffset, targetOffset, fieldCount });
          if (!seenChunks.has(chunk)) {
            seenChunks.add(chunk);
            chunks.push(chunk);
          }
          x += cellCount;
        }
      }

      // Validate every source and destination span before publishing the first
      // chunk write. Chunk performs the copy internally and never returns an alias.
      if (chunks.length !== seenChunks.size) {
        throw new Error("Dense-to-chunk synchronization lost a planned chunk");
      }
      for (const segment of segments) {
        if (!seenChunks.has(segment.chunk) ||
            segment.sourceOffset + segment.fieldCount > this.#_sparseDenseBuffer.length ||
            segment.targetOffset + segment.fieldCount > CHUNK_VOLUME * CELL_FIELDS) {
          throw new Error("Dense-to-chunk synchronization lost a preflighted chunk");
        }
      }

      for (const segment of segments) {
        segment.chunk.writeFrontRangeFrom(
          this.#_sparseDenseBuffer,
          segment.sourceOffset,
          segment.targetOffset,
          segment.fieldCount,
        );
      }
      this.#markMutation();
    } finally {
      endMutation();
    }
  }

  syncChunksToDense(): void {
    const endMutation = this.beginMutation();
    try {
      this.#_sparseDenseBuffer.fill(0);
      for (let z = 0; z < this.D; z++)
      for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        const gx = x + this.#denseOrigin.x;
        const gy = y + this.#denseOrigin.y;
        const gz = z + this.#denseOrigin.z;
        // Resolve the physical chunk directly from coordinates. Copy out the
        // needed fields through a non-aliasing API; this is a read, not mutation.
        const [cx, lx] = this.#globalToChunk(gx);
        const [cy, ly] = this.#globalToChunk(gy);
        const [cz, lz] = this.#globalToChunk(gz);
        const sourceChunk = this.chunks.get(this.getChunkKey(cx, cy, cz));
        if (!sourceChunk) continue;
        sourceChunk.lastAccessed = Date.now();
        const sourceStart = sourceChunk.localIdx(lx, ly, lz);
        sourceChunk.copyFrontRangeTo(
          this.#_sparseDenseBuffer,
          sourceStart,
          this.idx(x, y, z),
          CELL_FIELDS,
        );
      }
      this.#markMutation();
    } finally {
      endMutation();
    }
  }

  cullInactive(maxAgeMs = 300_000): void {
    const endMutation = this.beginMutation();
    try {
      for (const [key, chunk] of this.chunks) {
        if (!chunk.active && Date.now() - chunk.lastAccessed > maxAgeMs && chunk.isEmpty()) {
          this.chunks.delete(key);
        }
      }
      this.#updateActiveRange();
    } finally {
      endMutation();
    }
  }

  markEmptyChunksInactive(threshold = 0.0001): void {
    for (const chunk of this.chunks.values()) {
      if (chunk.isEmpty(threshold)) chunk.active = false;
    }
  }

  get activeChunkCount(): number {
    let count = 0;
    for (const chunk of this.chunks.values()) if (chunk.active) count++;
    return count;
  }

  get memoryBytes(): number {
    let total = this.#_sparseDenseBuffer.byteLength + this.#_sparseDenseBackBuffer.byteLength;
    for (const chunk of this.chunks.values()) total += chunk.memoryBytes();
    return total;
  }

  serializeChunks(includeEmpty = false): SerializedChunk[] {
    const chunks: SerializedChunk[] = [];
    for (const [key, chunk] of this.chunks) {
      // World saves must preserve every non-zero field, not just energy and
      // not merely values above the runtime inactivity threshold.
      if (!includeEmpty && chunk.isEmpty(0)) continue;
      const copy = new Float32Array(chunk.buffer.length);
      copy.set(chunk.buffer);
      chunks.push({
        key,
        cx: chunk.cx,
        cy: chunk.cy,
        cz: chunk.cz,
        level: 0,
        scale: 1,
        active: chunk.active,
        buffer: copy.buffer,
      });
    }
    return chunks;
  }

  /**
   * Restore serialized physical chunks. The optional version is supplied by
   * WorldSnapshot.chunks; callers using the historical bare-array API remain
   * compatible. Complete level/scale fields on every record also identify a
   * v2 array for direct serializeChunks() -> loadChunks() round-trips.
   */
  loadChunks(
    chunks: SerializedChunk[],
    schemaVersion?: SparseVoxelGridPersistenceSchemaVersion,
  ): void {
    if (!Array.isArray(chunks)) throw new Error("Invalid serialized chunk list");

    const carriesCompleteV2Identity = chunks.length > 0 && chunks.every(data =>
      !!data && typeof data === "object" &&
      Number.isSafeInteger(data.level) &&
      Number.isSafeInteger(data.scale),
    );
    const persistedDocument: unknown = schemaVersion !== undefined
      ? { schemaVersion, chunks }
      : carriesCompleteV2Identity
        ? { schemaVersion: 2, chunks }
        : chunks;
    const upgraded = upgradeSparseVoxelGridPersistenceDocument(persistedDocument);

    // Validate and construct all replacement chunks while detached from live
    // state. This is intentionally level-zero-only until the physical grid,
    // dense addressing, ownership and GPU paths support mixed-level chunks.
    const restored = new Map<string, Chunk>();
    const expectedBytes = CHUNK_VOLUME * CELL_FIELDS * Float32Array.BYTES_PER_ELEMENT;
    for (const candidate of upgraded.chunks) {
      const data = candidate as unknown as SerializedChunk;
      if (!data ||
          typeof data.key !== "string" ||
          !Number.isSafeInteger(data.cx) || !Number.isSafeInteger(data.cy) || !Number.isSafeInteger(data.cz) ||
          data.level !== 0 || data.scale !== 1 ||
          typeof data.active !== "boolean" ||
          !(data.buffer instanceof ArrayBuffer) || data.buffer.byteLength !== expectedBytes) {
        throw new Error("Invalid serialized chunk record or unsupported physical LOD");
      }
      const expectedKey = this.getChunkKey(data.cx, data.cy, data.cz);
      if (data.key !== expectedKey || restored.has(data.key)) {
        throw new Error("Invalid serialized chunk identity");
      }
      const source = new Float32Array(data.buffer);
      if (!source.every(Number.isFinite)) throw new Error("Serialized chunk contains non-finite fields");
      const chunk = new Chunk(data.cx, data.cy, data.cz);
      chunk.buffer.set(source);
      chunk.backBuffer.set(source);
      chunk.active = data.active;
      restored.set(expectedKey, chunk);
    }

    // Publish only after every record has passed identity, topology, LOD and
    // payload validation. Retain a detached rollback snapshot for failures
    // during live publication or dense/back-buffer synchronization.
    const endMutation = this.beginMutation();
    try {
      const previous = this.captureState();
      try {
        this.chunks.clear();
        for (const [key, chunk] of restored) this.chunks.set(key, chunk);
        this.dirtyChunks.clear();
        this.chunkOwners.clear();
        this.#updateActiveRange();
        this.syncChunksToDense();
        this.syncBackBuffersFromFront();
        this.#markMutation();
      } catch (error) {
        try {
          this.restoreState(previous);
        } catch (rollbackError) {
          const originalMessage = error instanceof Error ? error.message : String(error);
          const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          throw new AggregateError(
            [error, rollbackError],
            `SparseVoxelGrid chunk load failed (${originalMessage}) and rollback failed (${rollbackMessage})`,
          );
        }
        throw error;
      }
    } finally {
      endMutation();
    }
  }

  /** Keep front/back buffers consistent after replacing a world's authoritative state. */
  syncBackBuffersFromFront(): void {
    const endMutation = this.beginMutation();
    try {
      this.#_sparseDenseBackBuffer.set(this.#_sparseDenseBuffer);
      for (const chunk of this.chunks.values()) {
        chunk.copyFrontToBackBuffer();
      }
      this.#markMutation();
    } finally { endMutation(); }
  }

  #seedDenseWindowChunks(): void {
    // Batch topology changes and recompute the derived range once after seeding.
    const endMutation = this.beginMutation();
    try {
      const maxCx = Math.ceil((this.#denseOrigin.x + this.W) / CHUNK_SIZE) - 1;
      const maxCy = Math.ceil((this.#denseOrigin.y + this.H) / CHUNK_SIZE) - 1;
      const maxCz = Math.ceil((this.#denseOrigin.z + this.D) / CHUNK_SIZE) - 1;
      const [minCx] = this.#globalToChunk(this.#denseOrigin.x);
      const [minCy] = this.#globalToChunk(this.#denseOrigin.y);
      const [minCz] = this.#globalToChunk(this.#denseOrigin.z);
      for (let cz = minCz; cz <= maxCz; cz++)
      for (let cy = minCy; cy <= maxCy; cy++)
      for (let cx = minCx; cx <= maxCx; cx++) this.getOrCreateChunk(cx, cy, cz);
      this.#updateActiveRange();
    } finally {
      endMutation();
    }
  }

  #assertDenseCoordinates(x: number, y: number, z: number, method: string): void {
    if (
      !Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !Number.isSafeInteger(z) ||
      !this.inBounds(x, y, z)
    ) {
      throw new RangeError(`${method} coordinates out of bounds: (${x}, ${y}, ${z})`);
    }
  }

  #getOrCreateChunkForGlobal(gx: number, gy: number, gz: number): Chunk {
    const [cx] = this.#globalToChunk(gx);
    const [cy] = this.#globalToChunk(gy);
    const [cz] = this.#globalToChunk(gz);
    return this.getOrCreateChunk(cx, cy, cz);
  }

  #globalToChunk(g: number): [number, number] {
    const c = Math.floor(g / CHUNK_SIZE);
    const l = ((g % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return [c, l];
  }

  #onChunkMapMutation(): void {
    // Invalidate before either the batched or direct-mutation path. A caller
    // holding an older topology snapshot keeps a valid immutable snapshot,
    // while the next grid lookup compiles the current authoritative key set.
    this.#physicalTopologyCache = undefined;
    // Internal bulk operations call beginMutation() and update the derived range
    // once after their batch; direct public Map writes must keep it synchronized.
    if (this.#sparseMutationDepth > 0) {
      this.#markMutation();
      return;
    }
    const previous = this.#_activeChunkRange;
    this.#updateActiveRange();
    const current = this.#_activeChunkRange;
    if (previous.minX === current.minX && previous.maxX === current.maxX &&
        previous.minY === current.minY && previous.maxY === current.maxY &&
        previous.minZ === current.minZ && previous.maxZ === current.maxZ) {
      // Topology changed within the existing bounds, so the range setter did not
      // register the mutation; advance the revision for the map change itself.
      this.#markMutation();
    }
  }

  #chunkRangeFor(chunks: Iterable<Chunk>): {
    minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
  } {
    let hasChunks = false;
    let minX = 0, maxX = 0, minY = 0, maxY = 0, minZ = 0, maxZ = 0;
    for (const chunk of chunks) {
      if (!hasChunks) {
        minX = maxX = chunk.cx;
        minY = maxY = chunk.cy;
        minZ = maxZ = chunk.cz;
        hasChunks = true;
      } else {
        minX = Math.min(minX, chunk.cx);
        maxX = Math.max(maxX, chunk.cx);
        minY = Math.min(minY, chunk.cy);
        maxY = Math.max(maxY, chunk.cy);
        minZ = Math.min(minZ, chunk.cz);
        maxZ = Math.max(maxZ, chunk.cz);
      }
    }
    return { minX, maxX, minY, maxY, minZ, maxZ };
  }

  #updateActiveRange(): void {
    this.activeChunkRange = this.#chunkRangeFor(this.chunks.values());
  }
}

export { CHUNK_SIZE, CHUNK_VOLUME };


/**
 * Expose tracked Map/Set instances through a Proxy so native prototype calls
 * cannot bypass their validated overrides (for example Map.prototype.set.call).
 * Ordinary collection methods are bound to the real instance because native
 * Map/Set methods require their internal slots on the receiver.
 */
function guardNativeCollection<T extends Map<unknown, unknown> | Set<unknown>>(collection: T): T {
  const boundMethods = new Map<PropertyKey, Function>();
  return new Proxy(collection, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function" || property === "constructor") return value;
      const cached = boundMethods.get(property);
      if (cached) return cached;
      const bound = value.bind(target) as Function;
      boundMethods.set(property, bound);
      return bound;
    },
  });
}

class MutationTrackedSet<T> extends Set<T> {
  #onMutation: () => void;
  #validateValue?: (value: T) => void;
  constructor(onMutation: () => void, validateValue?: (value: T) => void) {
    super(); this.#onMutation = onMutation; this.#validateValue = validateValue;
    Object.defineProperties(this, {
      add: { value: this.add.bind(this), writable: false, configurable: false },
      delete: { value: this.delete.bind(this), writable: false, configurable: false },
      clear: { value: this.clear.bind(this), writable: false, configurable: false },
    });
  }

  override add(value: T): this {
    this.#validateValue?.(value);
    const existed = this.has(value);
    super.add(value);
    if (!existed) this.#onMutation();
    return this;
  }

  override delete(value: T): boolean {
    const deleted = super.delete(value);
    if (deleted) this.#onMutation();
    return deleted;
  }

  override clear(): void {
    if (this.size === 0) return;
    super.clear();
    this.#onMutation();
  }
}

class MutationTrackedMap<K, V> extends Map<K, V> {
  #onMutation: () => void;
  #validateEntry?: (key: K, value: V) => void;
  constructor(onMutation: () => void, validateEntry?: (key: K, value: V) => void) {
    super(); this.#onMutation = onMutation; this.#validateEntry = validateEntry;
    Object.defineProperties(this, {
      set: { value: this.set.bind(this), writable: false, configurable: false },
      delete: { value: this.delete.bind(this), writable: false, configurable: false },
      clear: { value: this.clear.bind(this), writable: false, configurable: false },
    });
  }

  override set(key: K, value: V): this {
    this.#validateEntry?.(key, value);
    const existed = this.has(key);
    const previous = this.get(key);
    super.set(key, value);
    if (!existed || previous !== value) this.#onMutation();
    return this;
  }

  override delete(key: K): boolean {
    const deleted = super.delete(key);
    if (deleted) this.#onMutation();
    return deleted;
  }

  override clear(): void {
    if (this.size === 0) return;
    super.clear();
    this.#onMutation();
  }
}

class MutationTrackedChunkMap extends Map<string, Chunk> {
  readonly #registrations = new Map<Chunk, { listener: () => void; references: number }>();
  #onMutation: () => void;
  #onChunkContentMutation: () => void;
  constructor(onMutation: () => void, onChunkContentMutation: () => void) {
    super();
    this.#onMutation = onMutation;
    this.#onChunkContentMutation = onChunkContentMutation;
    Object.defineProperties(this, {
      set: { value: this.set.bind(this), writable: false, configurable: false },
      delete: { value: this.delete.bind(this), writable: false, configurable: false },
      clear: { value: this.clear.bind(this), writable: false, configurable: false },
    });
  }

  #attach(chunk: Chunk): void {
    const existing = this.#registrations.get(chunk);
    if (existing) {
      existing.references++;
      return;
    }
    // Cell-buffer changes advance the grid revision but do not change the
    // physical topology or active chunk range. Keep them off the map-change
    // path so cached physical addressing is not rebuilt for every cell write.
    const listener = () => this.#onChunkContentMutation();
    this.#registrations.set(chunk, { listener, references: 1 });
    chunk.addMutationListener(listener);
  }

  #detach(chunk: Chunk): void {
    const registration = this.#registrations.get(chunk);
    if (!registration) return;
    registration.references--;
    if (registration.references > 0) return;
    chunk.removeMutationListener(registration.listener);
    this.#registrations.delete(chunk);
  }

  override set(key: string, chunk: Chunk): this {
    if (!(chunk instanceof Chunk) ||
        ![chunk.cx, chunk.cy, chunk.cz].every(Number.isSafeInteger)) {
      throw new TypeError("SparseVoxelGrid chunk map requires a Chunk with integer coordinates");
    }
    const expectedKey = `${chunk.cx},${chunk.cy},${chunk.cz}`;
    if (key !== expectedKey) {
      throw new Error(`Chunk map key must match chunk coordinates: expected ${expectedKey}, received ${key}`);
    }

    // A physical-identity chunk must never be smuggled into the legacy
    // level-zero map under its coordinate-only key. The old map key check
    // alone is insufficient because a coarse chunk still carries integer
    // cx/cy/cz coordinates. Keep ordinary Chunk instances compatible while
    // requiring every LOD-aware record to prove the exact level-zero identity.
    const physical = chunk as Chunk & {
      key?: unknown;
      level?: unknown;
      scale?: unknown;
    };
    if (("key" in chunk || "level" in chunk || "scale" in chunk) &&
        (physical.key !== expectedKey || physical.level !== 0 || physical.scale !== 1)) {
      throw new Error(
        `SparseVoxelGrid level-zero map rejects non-level-zero physical chunk identity: ${String(physical.key)}`,
      );
    }

    const existed = this.has(key);
    const previous = this.get(key);
    if (existed && previous === chunk) return this;

    super.set(key, chunk);
    if (existed && previous) this.#detach(previous);
    this.#attach(chunk);
    this.#onMutation();
    return this;
  }

  override delete(key: string): boolean {
    if (!this.has(key)) return false;
    const previous = this.get(key);
    const deleted = super.delete(key);
    if (deleted && previous) {
      this.#detach(previous);
      this.#onMutation();
    }
    return deleted;
  }

  override clear(): void {
    if (this.size === 0) return;
    const chunks = [...this.values()];
    super.clear();
    for (const chunk of chunks) this.#detach(chunk);
    this.#onMutation();
  }
}
