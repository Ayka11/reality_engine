import { CellState, CELL_FIELDS } from './CellState';
import { Chunk, CHUNK_SIZE, CHUNK_VOLUME } from './Chunk';

export interface SerializedChunk {
  key: string;
  cx: number;
  cy: number;
  cz: number;
  active: boolean;
  buffer: ArrayBuffer;
}

export class SparseVoxelGrid {
  readonly chunkSize = CHUNK_SIZE;
  readonly W: number;
  readonly H: number;
  readonly D: number;
  readonly size: number;
  readonly chunks = new Map<string, Chunk>();
  readonly dirtyChunks = new Set<string>();
  // optional ownership mapping for distributed simulation
  readonly chunkOwners = new Map<string, string>();
  activeChunkRange = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };

  buffer: Float32Array;
  backBuffer: Float32Array;
  private denseOrigin = { x: 0, y: 0, z: 0 };

  constructor(W = 64, H = 64, D = 32) {
    this.W = W;
    this.H = H;
    this.D = D;
    this.size = W * H * D;
    this.buffer = new Float32Array(this.size * CELL_FIELDS);
    this.backBuffer = new Float32Array(this.size * CELL_FIELDS);
    this.seedDenseWindowChunks();
  }

  assignChunkOwner(chunkKey: string, ownerId: string) {
    this.chunkOwners.set(chunkKey, ownerId);
  }

  getOwnedChunks(ownerId?: string): string[] {
    if (!ownerId) return [...this.chunkOwners.keys()];
    return [...this.chunkOwners.entries()].filter(([, v]) => v === ownerId).map(([k]) => k);
  }

  getChunkBoundary(chunkKey: string): { neighbors: string[] } {
    const parts = chunkKey.split(',').map(n => Number(n));
    if (parts.length !== 3) return { neighbors: [] };
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

  getOrCreateChunk(cx: number, cy: number, cz: number): Chunk {
    const key = this.getChunkKey(cx, cy, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cy, cz);
      this.chunks.set(key, chunk);
      this.updateActiveRange();
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
    this.getOrCreateChunkForGlobal(x, y, z);
    return new CellState(this.buffer, this.idx(x, y, z));
  }

  cellAt(linearIdx: number): CellState {
    return new CellState(this.buffer, linearIdx * CELL_FIELDS);
  }

  cellBack(x: number, y: number, z: number): CellState {
    return new CellState(this.backBuffer, this.idx(x, y, z));
  }

  idx(x: number, y: number, z: number): number {
    return (z * this.H * this.W + y * this.W + x) * CELL_FIELDS;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.W && y >= 0 && y < this.H && z >= 0 && z < this.D;
  }

  snapshot(): void {
    this.backBuffer.set(this.buffer);
    for (const chunk of this.chunks.values()) chunk.snapshot();
  }

  swapBuffers(): void {
    const tmp = this.buffer;
    this.buffer = this.backBuffer;
    this.backBuffer = tmp;
    for (const chunk of this.chunks.values()) chunk.swapBuffers();
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
    this.buffer.fill(0);
    this.backBuffer.fill(0);
    this.chunks.clear();
    this.dirtyChunks.clear();
    this.seedDenseWindowChunks();
  }

  totalField(fieldOffset: number): number {
    let sum = 0;
    for (let i = fieldOffset; i < this.buffer.length; i += CELL_FIELDS) sum += this.buffer[i];
    return sum;
  }

  syncDenseToChunks(): void {
    this.seedDenseWindowChunks();
    for (let z = 0; z < this.D; z++)
    for (let y = 0; y < this.H; y++)
    for (let x = 0; x < this.W; x++) {
      const gx = x + this.denseOrigin.x;
      const gy = y + this.denseOrigin.y;
      const gz = z + this.denseOrigin.z;
      const chunk = this.getOrCreateChunkForGlobal(gx, gy, gz);
      const [, lx] = this.globalToChunk(gx);
      const [, ly] = this.globalToChunk(gy);
      const [, lz] = this.globalToChunk(gz);
      chunk.buffer.set(this.buffer.subarray(this.idx(x, y, z), this.idx(x, y, z) + CELL_FIELDS), chunk.localIdx(lx, ly, lz));
    }
  }

  syncChunksToDense(): void {
    this.buffer.fill(0);
    for (let z = 0; z < this.D; z++)
    for (let y = 0; y < this.H; y++)
    for (let x = 0; x < this.W; x++) {
      const gx = x + this.denseOrigin.x;
      const gy = y + this.denseOrigin.y;
      const gz = z + this.denseOrigin.z;
      const cell = this.getCell(gx, gy, gz);
      if (!cell) continue;
      const [cx, lx] = this.globalToChunk(gx);
      const [cy, ly] = this.globalToChunk(gy);
      const [cz, lz] = this.globalToChunk(gz);
      const chunk = this.chunks.get(this.getChunkKey(cx, cy, cz));
      if (!chunk) continue;
      this.buffer.set(chunk.buffer.subarray(chunk.localIdx(lx, ly, lz), chunk.localIdx(lx, ly, lz) + CELL_FIELDS), this.idx(x, y, z));
    }
  }

  cullInactive(maxAgeMs = 300_000): void {
    for (const [key, chunk] of this.chunks) {
      if (!chunk.active && Date.now() - chunk.lastAccessed > maxAgeMs && chunk.isEmpty()) {
        this.chunks.delete(key);
      }
    }
    this.updateActiveRange();
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
    let total = this.buffer.byteLength + this.backBuffer.byteLength;
    for (const chunk of this.chunks.values()) total += chunk.memoryBytes();
    return total;
  }

  serializeChunks(includeEmpty = false): SerializedChunk[] {
    const chunks: SerializedChunk[] = [];
    for (const [key, chunk] of this.chunks) {
      if (!includeEmpty && chunk.isEmpty()) continue;
      const copy = new Float32Array(chunk.buffer.length);
      copy.set(chunk.buffer);
      chunks.push({ key, cx: chunk.cx, cy: chunk.cy, cz: chunk.cz, active: chunk.active, buffer: copy.buffer });
    }
    return chunks;
  }

  loadChunks(chunks: SerializedChunk[]): void {
    this.chunks.clear();
    for (const data of chunks) {
      const chunk = new Chunk(data.cx, data.cy, data.cz);
      chunk.buffer.set(new Float32Array(data.buffer));
      chunk.active = data.active;
      this.chunks.set(data.key, chunk);
    }
    this.updateActiveRange();
    this.syncChunksToDense();
  }

  private seedDenseWindowChunks(): void {
    const maxCx = Math.ceil((this.denseOrigin.x + this.W) / CHUNK_SIZE) - 1;
    const maxCy = Math.ceil((this.denseOrigin.y + this.H) / CHUNK_SIZE) - 1;
    const maxCz = Math.ceil((this.denseOrigin.z + this.D) / CHUNK_SIZE) - 1;
    const [minCx] = this.globalToChunk(this.denseOrigin.x);
    const [minCy] = this.globalToChunk(this.denseOrigin.y);
    const [minCz] = this.globalToChunk(this.denseOrigin.z);
    for (let cz = minCz; cz <= maxCz; cz++)
    for (let cy = minCy; cy <= maxCy; cy++)
    for (let cx = minCx; cx <= maxCx; cx++) this.getOrCreateChunk(cx, cy, cz);
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

  private updateActiveRange(): void {
    const chunks = [...this.chunks.values()];
    if (!chunks.length) {
      this.activeChunkRange = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
      return;
    }
    this.activeChunkRange = {
      minX: Math.min(...chunks.map(chunk => chunk.cx)),
      maxX: Math.max(...chunks.map(chunk => chunk.cx)),
      minY: Math.min(...chunks.map(chunk => chunk.cy)),
      maxY: Math.max(...chunks.map(chunk => chunk.cy)),
      minZ: Math.min(...chunks.map(chunk => chunk.cz)),
      maxZ: Math.max(...chunks.map(chunk => chunk.cz)),
    };
  }
}

export { CHUNK_SIZE, CHUNK_VOLUME };
