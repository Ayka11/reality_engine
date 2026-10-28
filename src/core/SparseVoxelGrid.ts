import { CellState, CELL_FIELDS, F, validateGridDimensions } from "./CellState";
import { Chunk, CHUNK_SIZE, CHUNK_VOLUME } from "./Chunk";
import { createTrackedFloat32Array, getMutableBuffer, INTERNAL_MUTABLE_BUFFER, type MutableBufferSide } from "./TrackedFloat32Array";

export interface SerializedChunk {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  active: boolean;
  buffer: ArrayBuffer;
}

export interface SparseVoxelGridSnapshot {
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
    active: boolean;
    lastAccessed: number;
    buffer: Float32Array;
    backBuffer: Float32Array;
  }>;
  dirtyChunks: string[];
  chunkOwners: Array<[string, string]>;
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
  private _activeChunkRange = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };

  /** Return a detached range so nested writes cannot bypass revision tracking. */
  get activeChunkRange() {
    return { ...this._activeChunkRange };
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
    const previous = this._activeChunkRange;
    if (previous.minX === next.minX && previous.maxX === next.maxX &&
        previous.minY === next.minY && previous.maxY === next.maxY &&
        previous.minZ === next.minZ && previous.maxZ === next.maxZ) return;
    this._activeChunkRange = next;
    this.markMutation();
  }

  private _sparseDenseBuffer: Float32Array;
  private _sparseDenseBackBuffer: Float32Array;
  private _sparseDenseBufferView: Float32Array;
  private _sparseDenseBackBufferView: Float32Array;
  private sparseMutationDepth = 0;
  private sparseMutationPending = false;
  private _sparseMutationRevision = 0;
  private _denseOrigin: Readonly<{ x: number; y: number; z: number }> =
    Object.freeze({ x: 0, y: 0, z: 0 });

  /** Internal origin coordinates are immutable when read and revisioned when replaced. */
  private get denseOrigin(): Readonly<{ x: number; y: number; z: number }> {
    return this._denseOrigin;
  }

  private set denseOrigin(origin: { x: number; y: number; z: number }) {
    if (!origin ||
        ![origin.x, origin.y, origin.z].every(Number.isSafeInteger)) {
      throw new Error("Invalid dense origin");
    }
    const previous = this._denseOrigin;
    if (previous.x === origin.x && previous.y === origin.y && previous.z === origin.z) return;
    this._denseOrigin = Object.freeze({ x: origin.x, y: origin.y, z: origin.z });
    this.markMutation();
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
    this.dirtyChunks = new MutationTrackedSet(
      () => this.markMutation(),
      key => {
        if (!this.isValidChunkKey(key)) throw new Error(`Invalid dirty chunk key: ${String(key)}`);
      },
    );
    this.chunkOwners = new MutationTrackedMap(
      () => this.markMutation(),
      (key, ownerId) => {
        if (!this.isValidChunkKey(key)) throw new Error(`Invalid chunk owner key: ${String(key)}`);
        if (typeof ownerId !== "string") throw new Error("Chunk owner ID must be a string");
      },
    );
    this._sparseDenseBuffer = new Float32Array(this.size * CELL_FIELDS);
    this._sparseDenseBackBuffer = new Float32Array(this.size * CELL_FIELDS);
    this._sparseDenseBufferView = createTrackedFloat32Array(this._sparseDenseBuffer, () => this.markMutation());
    this._sparseDenseBackBufferView = createTrackedFloat32Array(this._sparseDenseBackBuffer, () => this.markMutation());
    this.chunks = new MutationTrackedChunkMap(() => this.onChunkMapMutation());
    this.seedDenseWindowChunks();
  }

  get buffer(): Float32Array { return this._sparseDenseBufferView; }
  set buffer(value: Float32Array) { this.assertSparseBuffer(value); this._sparseDenseBuffer.set(value); this.markMutation(); }
  get backBuffer(): Float32Array { return this._sparseDenseBackBufferView; }
  set backBuffer(value: Float32Array) { this.assertSparseBuffer(value); this._sparseDenseBackBuffer.set(value); this.markMutation(); }
  get mutationRevision(): number { return this._sparseMutationRevision; }

  beginMutation(): () => void {
    this.sparseMutationDepth++;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.sparseMutationDepth--;
      if (this.sparseMutationDepth === 0 && this.sparseMutationPending) {
        this.sparseMutationPending = false;
        this._sparseMutationRevision++;
      }
    };
  }
  markMutation(): void {
    if (this.sparseMutationDepth > 0) { this.sparseMutationPending = true; return; }
    this._sparseMutationRevision++;
  }
  [INTERNAL_MUTABLE_BUFFER](side: MutableBufferSide = "front"): Float32Array {
    this.markMutation();
    return side === "back" ? this._sparseDenseBackBuffer : this._sparseDenseBuffer;
  }
  private assertSparseBuffer(value: Float32Array): void {
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
    if (!this.isValidChunkKey(chunkKey)) return { neighbors: [] };
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

  private isValidChunkKey(key: unknown): key is string {
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
    const [cx, lx] = this.globalToChunk(gx);
    const [cy, ly] = this.globalToChunk(gy);
    const [cz, lz] = this.globalToChunk(gz);
    const chunk = this.chunks.get(this.getChunkKey(cx, cy, cz));
    if (!chunk) return null;
    return chunk.getCell(lx, ly, lz);
  }

  cell(x: number, y: number, z: number): CellState {
    this.assertDenseCoordinates(x, y, z, "cell");
    this.getOrCreateChunkForGlobal(x, y, z);
    return new CellState(this._sparseDenseBuffer, this.idx(x, y, z), () => this.markMutation());
  }

  cellAt(linearIdx: number): CellState {
    if (!Number.isSafeInteger(linearIdx) || linearIdx < 0 || linearIdx >= this.size) {
      throw new RangeError(`cellAt index out of bounds: ${linearIdx}`);
    }
    return new CellState(this._sparseDenseBuffer, linearIdx * CELL_FIELDS, () => this.markMutation());
  }

  cellBack(x: number, y: number, z: number): CellState {
    this.assertDenseCoordinates(x, y, z, "cellBack");
    return new CellState(this._sparseDenseBackBuffer, this.idx(x, y, z), () => this.markMutation());
  }

  idx(x: number, y: number, z: number): number {
    return (z * this.H * this.W + y * this.W + x) * CELL_FIELDS;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.W && y >= 0 && y < this.H && z >= 0 && z < this.D;
  }

  captureState(): SparseVoxelGridSnapshot {
    return {
      width: this.W,
      height: this.H,
      depth: this.D,
      buffer: new Float32Array(this._sparseDenseBuffer),
      backBuffer: new Float32Array(this._sparseDenseBackBuffer),
      denseOrigin: { ...this.denseOrigin },
      activeChunkRange: { ...this.activeChunkRange },
      chunks: [...this.chunks.entries()].map(([key, chunk]) => ({
        key,
        cx: chunk.cx,
        cy: chunk.cy,
        cz: chunk.cz,
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

    const restoredRange = this.chunkRangeFor(restoredChunks.values());
    if (restoredRange.minX !== snapshot.activeChunkRange.minX ||
        restoredRange.maxX !== snapshot.activeChunkRange.maxX ||
        restoredRange.minY !== snapshot.activeChunkRange.minY ||
        restoredRange.maxY !== snapshot.activeChunkRange.maxY ||
        restoredRange.minZ !== snapshot.activeChunkRange.minZ ||
        restoredRange.maxZ !== snapshot.activeChunkRange.maxZ) {
      throw new Error("Invalid SparseVoxelGrid snapshot active chunk range");
    }

    const isValidChunkKey = (key: unknown): key is string => this.isValidChunkKey(key);
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

    this._sparseDenseBuffer.set(snapshot.buffer);
    this._sparseDenseBackBuffer.set(snapshot.backBuffer);
    this.denseOrigin = { ...snapshot.denseOrigin };
    this.activeChunkRange = { ...snapshot.activeChunkRange };
    this.chunks.clear();
    for (const [key, chunk] of restoredChunks) this.chunks.set(key, chunk);
    this.dirtyChunks.clear();
    for (const key of snapshot.dirtyChunks) this.dirtyChunks.add(key);
    this.chunkOwners.clear();
    for (const [key, owner] of owners) this.chunkOwners.set(key, owner);
    this.markMutation();
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
          const gx = x + this.denseOrigin.x;
          const gy = y + this.denseOrigin.y;
          const gz = z + this.denseOrigin.z;
          const denseId = this._sparseDenseBuffer[this.idx(x, y, z) + F.ENTITY_ID];
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
      this.seedDenseWindowChunks();
      const rawBuffers = new Map<Chunk, Float32Array>();
      for (let z = 0; z < this.D; z++) {
        for (let y = 0; y < this.H; y++) {
          for (let x = 0; x < this.W; x++) {
            const gx = x + this.denseOrigin.x;
            const gy = y + this.denseOrigin.y;
            const gz = z + this.denseOrigin.z;
            const chunk = this.getOrCreateChunkForGlobal(gx, gy, gz);
            const [, lx] = this.globalToChunk(gx);
            const [, ly] = this.globalToChunk(gy);
            const [, lz] = this.globalToChunk(gz);
            let chunkBuffer = rawBuffers.get(chunk);
            if (!chunkBuffer) {
              chunkBuffer = getMutableBuffer(chunk);
              rawBuffers.set(chunk, chunkBuffer);
            }
            chunkBuffer[chunk.localIdx(lx, ly, lz) + F.ENTITY_ID] =
              this._sparseDenseBuffer[this.idx(x, y, z) + F.ENTITY_ID];
          }
        }
      }
      this.markMutation();
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

    const denseMaxX = this.denseOrigin.x + this.W;
    const denseMaxY = this.denseOrigin.y + this.H;
    const denseMaxZ = this.denseOrigin.z + this.D;

    for (const chunk of this.chunks.values()) {
      const chunkMinX = chunk.cx * CHUNK_SIZE;
      const chunkMinY = chunk.cy * CHUNK_SIZE;
      const chunkMinZ = chunk.cz * CHUNK_SIZE;
      const chunkMaxX = chunkMinX + CHUNK_SIZE;
      const chunkMaxY = chunkMinY + CHUNK_SIZE;
      const chunkMaxZ = chunkMinZ + CHUNK_SIZE;
      const fullyInsideDenseWindow =
        chunkMinX >= this.denseOrigin.x && chunkMaxX <= denseMaxX &&
        chunkMinY >= this.denseOrigin.y && chunkMaxY <= denseMaxY &&
        chunkMinZ >= this.denseOrigin.z && chunkMaxZ <= denseMaxZ;
      if (fullyInsideDenseWindow) continue;

      const overlapsDenseWindow =
        chunkMinX < denseMaxX && chunkMaxX > this.denseOrigin.x &&
        chunkMinY < denseMaxY && chunkMaxY > this.denseOrigin.y &&
        chunkMinZ < denseMaxZ && chunkMaxZ > this.denseOrigin.z;
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
              gx >= this.denseOrigin.x && gx < denseMaxX &&
              gy >= this.denseOrigin.y && gy < denseMaxY &&
              gz >= this.denseOrigin.z && gz < denseMaxZ
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
      this._sparseDenseBackBuffer.set(this._sparseDenseBuffer);
      for (const chunk of this.chunks.values()) chunk.snapshot();
      this.markMutation();
    } finally { endMutation(); }
  }

  swapBuffers(): void {
    const endMutation = this.beginMutation();
    try {
      const raw = this._sparseDenseBuffer; this._sparseDenseBuffer = this._sparseDenseBackBuffer; this._sparseDenseBackBuffer = raw;
      const view = this._sparseDenseBufferView; this._sparseDenseBufferView = this._sparseDenseBackBufferView; this._sparseDenseBackBufferView = view;
      for (const chunk of this.chunks.values()) chunk.swapBuffers();
      this.markMutation();
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
      this._sparseDenseBuffer.fill(0);
      this._sparseDenseBackBuffer.fill(0);
      this.chunks.clear();
      this.dirtyChunks.clear();
      this.seedDenseWindowChunks();
      this.markMutation();
    } finally { endMutation(); }
  }

  totalField(fieldOffset: number): number {
    this.assertFieldOffset(fieldOffset);
    let sum = 0;
    for (let i = fieldOffset; i < this._sparseDenseBuffer.length; i += CELL_FIELDS) sum += this._sparseDenseBuffer[i];
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
    const buffer = this._sparseDenseBuffer;
    for (let base = 0; base < buffer.length; base += CELL_FIELDS) {
      for (let index = 0; index < fieldOffsets.length; index++) {
        sums[index] += buffer[base + fieldOffsets[index]];
      }
    }
    return sums;
  }

  private assertFieldOffset(fieldOffset: number): void {
    if (!Number.isSafeInteger(fieldOffset) || fieldOffset < 0 || fieldOffset >= CELL_FIELDS) {
      throw new RangeError("SparseVoxelGrid field offset must be a valid cell-field index");
    }
  }

  syncDenseToChunks(): void {
    const endMutation = this.beginMutation();
    try {
      this.seedDenseWindowChunks();

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
          const gx = x + this.denseOrigin.x;
          const gy = y + this.denseOrigin.y;
          const gz = z + this.denseOrigin.z;
          const chunk = this.getOrCreateChunkForGlobal(gx, gy, gz);
          const [, lx] = this.globalToChunk(gx);
          const [, ly] = this.globalToChunk(gy);
          const [, lz] = this.globalToChunk(gz);
          const cellCount = Math.min(this.W - x, CHUNK_SIZE - lx);
          const fieldCount = cellCount * CELL_FIELDS;
          const sourceOffset = this.idx(x, y, z);
          const targetOffset = chunk.localIdx(lx, ly, lz);
          if (!Number.isSafeInteger(targetOffset) || targetOffset < 0 ||
              !Number.isSafeInteger(fieldCount) || fieldCount <= 0 ||
              targetOffset + fieldCount > CHUNK_VOLUME * CELL_FIELDS ||
              sourceOffset < 0 || sourceOffset + fieldCount > this._sparseDenseBuffer.length) {
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

      const rawBuffers = new Map<Chunk, Float32Array>();
      for (const chunk of chunks) {
        const buf = getMutableBuffer(chunk);
        if (buf.length !== CHUNK_VOLUME * CELL_FIELDS) {
          throw new Error("Dense-to-chunk synchronization found an invalid chunk buffer");
        }
        rawBuffers.set(chunk, buf);
      }

      // All destination/source spans are validated before the first write.
      for (const segment of segments) {
        const buf = rawBuffers.get(segment.chunk);
        if (!buf) throw new Error("Dense-to-chunk synchronization lost a preflighted chunk");
        buf.set(
          this._sparseDenseBuffer.subarray(
            segment.sourceOffset,
            segment.sourceOffset + segment.fieldCount,
          ),
          segment.targetOffset,
        );
      }
      this.markMutation();
    } finally {
      endMutation();
    }
  }

  syncChunksToDense(): void {
    const endMutation = this.beginMutation();
    try {
      this._sparseDenseBuffer.fill(0);
      const rawBuffers = new Map<Chunk, Float32Array>();
      for (let z = 0; z < this.D; z++)
      for (let y = 0; y < this.H; y++)
      for (let x = 0; x < this.W; x++) {
        const gx = x + this.denseOrigin.x;
        const gy = y + this.denseOrigin.y;
        const gz = z + this.denseOrigin.z;
        // Resolve the physical chunk directly from coordinates; avoid exposing raw buffers through public views.
        const [cx, lx] = this.globalToChunk(gx);
        const [cy, ly] = this.globalToChunk(gy);
        const [cz, lz] = this.globalToChunk(gz);
        const sourceChunk = this.chunks.get(this.getChunkKey(cx, cy, cz));
        if (!sourceChunk) continue;
        sourceChunk.lastAccessed = Date.now();
        let sourceBuffer = rawBuffers.get(sourceChunk);
        if (!sourceBuffer) {
          sourceBuffer = getMutableBuffer(sourceChunk);
          rawBuffers.set(sourceChunk, sourceBuffer);
        }
        const sourceStart = sourceChunk.localIdx(lx, ly, lz);
        this._sparseDenseBuffer.set(sourceBuffer.subarray(sourceStart, sourceStart + CELL_FIELDS), this.idx(x, y, z));
      }
      this.markMutation();
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
      this.updateActiveRange();
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
    let total = this._sparseDenseBuffer.byteLength + this._sparseDenseBackBuffer.byteLength;
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
      chunks.push({ key, cx: chunk.cx, cy: chunk.cy, cz: chunk.cz, active: chunk.active, buffer: copy.buffer });
    }
    return chunks;
  }

  loadChunks(chunks: SerializedChunk[]): void {
    const endMutation = this.beginMutation();
    try {
    if (!Array.isArray(chunks)) throw new Error("Invalid serialized chunk list");
    const restored = new Map<string, Chunk>();
    const expectedBytes = CHUNK_VOLUME * CELL_FIELDS * Float32Array.BYTES_PER_ELEMENT;
    for (const data of chunks) {
      if (!data ||
          !Number.isSafeInteger(data.cx) || !Number.isSafeInteger(data.cy) || !Number.isSafeInteger(data.cz) ||
          typeof data.active !== "boolean" ||
          !(data.buffer instanceof ArrayBuffer) || data.buffer.byteLength !== expectedBytes) {
        throw new Error("Invalid serialized chunk record");
      }
      const expectedKey = this.getChunkKey(data.cx, data.cy, data.cz);
      if (data.key !== expectedKey || restored.has(data.key)) {
        throw new Error("Invalid serialized chunk identity");
      }
      const source = new Float32Array(data.buffer);
      if (!source.every(Number.isFinite)) throw new Error("Serialized chunk contains non-finite fields");
      const chunk = new Chunk(data.cx, data.cy, data.cz);
      getMutableBuffer(chunk).set(source);
      getMutableBuffer(chunk, "back").set(source);
      chunk.active = data.active;
      restored.set(expectedKey, chunk);
    }

    // Validate all records and construct detached chunks before touching live
    // state. Keep a detached rollback snapshot for failures during publication
    // or dense/back-buffer synchronization.
    const previous = this.captureState();
    try {
      this.chunks.clear();
      for (const [key, chunk] of restored) this.chunks.set(key, chunk);
      this.dirtyChunks.clear();
      this.chunkOwners.clear();
      this.updateActiveRange();
      this.syncChunksToDense();
      this.syncBackBuffersFromFront();
      this.markMutation();
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
    } finally { endMutation(); }
  }

  /** Keep front/back buffers consistent after replacing a world's authoritative state. */
  syncBackBuffersFromFront(): void {
    const endMutation = this.beginMutation();
    try {
      this._sparseDenseBackBuffer.set(this._sparseDenseBuffer);
      for (const chunk of this.chunks.values()) {
        getMutableBuffer(chunk, "back").set(getMutableBuffer(chunk));
      }
      this.markMutation();
    } finally { endMutation(); }
  }

  private seedDenseWindowChunks(): void {
    // Batch topology changes and recompute the derived range once after seeding.
    const endMutation = this.beginMutation();
    try {
      const maxCx = Math.ceil((this.denseOrigin.x + this.W) / CHUNK_SIZE) - 1;
      const maxCy = Math.ceil((this.denseOrigin.y + this.H) / CHUNK_SIZE) - 1;
      const maxCz = Math.ceil((this.denseOrigin.z + this.D) / CHUNK_SIZE) - 1;
      const [minCx] = this.globalToChunk(this.denseOrigin.x);
      const [minCy] = this.globalToChunk(this.denseOrigin.y);
      const [minCz] = this.globalToChunk(this.denseOrigin.z);
      for (let cz = minCz; cz <= maxCz; cz++)
      for (let cy = minCy; cy <= maxCy; cy++)
      for (let cx = minCx; cx <= maxCx; cx++) this.getOrCreateChunk(cx, cy, cz);
      this.updateActiveRange();
    } finally {
      endMutation();
    }
  }

  private assertDenseCoordinates(x: number, y: number, z: number, method: string): void {
    if (
      !Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !Number.isSafeInteger(z) ||
      !this.inBounds(x, y, z)
    ) {
      throw new RangeError(`${method} coordinates out of bounds: (${x}, ${y}, ${z})`);
    }
  }

  private getOrCreateChunkForGlobal(gx: number, gy: number, gz: number): Chunk {
    const [cx] = this.globalToChunk(gx);
    const [cy] = this.globalToChunk(gy);
    const [cz] = this.globalToChunk(gz);
    return this.getOrCreateChunk(cx, cy, cz);
  }

  private globalToChunk(g: number): [number, number] {
    const c = Math.floor(g / CHUNK_SIZE);
    const l = ((g % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return [c, l];
  }

  private onChunkMapMutation(): void {
    // Internal bulk operations call beginMutation() and update the derived range
    // once after their batch; direct public Map writes must keep it synchronized.
    if (this.sparseMutationDepth > 0) {
      this.markMutation();
      return;
    }
    const previous = this._activeChunkRange;
    this.updateActiveRange();
    const current = this._activeChunkRange;
    if (previous.minX === current.minX && previous.maxX === current.maxX &&
        previous.minY === current.minY && previous.maxY === current.maxY &&
        previous.minZ === current.minZ && previous.maxZ === current.maxZ) {
      // Topology changed within the existing bounds, so the range setter did not
      // register the mutation; advance the revision for the map change itself.
      this.markMutation();
    }
  }

  private chunkRangeFor(chunks: Iterable<Chunk>): {
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

  private updateActiveRange(): void {
    this.activeChunkRange = this.chunkRangeFor(this.chunks.values());
  }
}

export { CHUNK_SIZE, CHUNK_VOLUME };


class MutationTrackedSet<T> extends Set<T> {
  constructor(
    private readonly onMutation: () => void,
    private readonly validateValue?: (value: T) => void,
  ) { super(); }

  override add(value: T): this {
    this.validateValue?.(value);
    const existed = this.has(value);
    super.add(value);
    if (!existed) this.onMutation();
    return this;
  }

  override delete(value: T): boolean {
    const deleted = super.delete(value);
    if (deleted) this.onMutation();
    return deleted;
  }

  override clear(): void {
    if (this.size === 0) return;
    super.clear();
    this.onMutation();
  }
}

class MutationTrackedMap<K, V> extends Map<K, V> {
  constructor(
    private readonly onMutation: () => void,
    private readonly validateEntry?: (key: K, value: V) => void,
  ) { super(); }

  override set(key: K, value: V): this {
    this.validateEntry?.(key, value);
    const existed = this.has(key);
    const previous = this.get(key);
    super.set(key, value);
    if (!existed || previous !== value) this.onMutation();
    return this;
  }

  override delete(key: K): boolean {
    const deleted = super.delete(key);
    if (deleted) this.onMutation();
    return deleted;
  }

  override clear(): void {
    if (this.size === 0) return;
    super.clear();
    this.onMutation();
  }
}

class MutationTrackedChunkMap extends Map<string, Chunk> {
  private readonly registrations = new Map<Chunk, { listener: () => void; references: number }>();

  constructor(private readonly onMutation: () => void) { super(); }

  private attach(chunk: Chunk): void {
    const existing = this.registrations.get(chunk);
    if (existing) {
      existing.references++;
      return;
    }
    const listener = () => this.onMutation();
    this.registrations.set(chunk, { listener, references: 1 });
    chunk.addMutationListener(listener);
  }

  private detach(chunk: Chunk): void {
    const registration = this.registrations.get(chunk);
    if (!registration) return;
    registration.references--;
    if (registration.references > 0) return;
    chunk.removeMutationListener(registration.listener);
    this.registrations.delete(chunk);
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

    const existed = this.has(key);
    const previous = this.get(key);
    if (existed && previous === chunk) return this;

    super.set(key, chunk);
    if (existed && previous) this.detach(previous);
    this.attach(chunk);
    this.onMutation();
    return this;
  }

  override delete(key: string): boolean {
    if (!this.has(key)) return false;
    const previous = this.get(key);
    const deleted = super.delete(key);
    if (deleted && previous) {
      this.detach(previous);
      this.onMutation();
    }
    return deleted;
  }

  override clear(): void {
    if (this.size === 0) return;
    const chunks = [...this.values()];
    super.clear();
    for (const chunk of chunks) this.detach(chunk);
    this.onMutation();
  }
}
