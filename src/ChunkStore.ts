export interface ChunkPayload {
  key: string;
  level: number;
  cx: number;
  cy: number;
  cz: number;
  data: ArrayBuffer;
  updatedAt: number;
}

export interface ChunkStore {
  load(key: string): Promise<ChunkPayload | null>;
  save(payload: ChunkPayload): Promise<void>;
  remove(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}

/** Simple in-memory reference store for tests and local development. */
export class MemoryChunkStore implements ChunkStore {
  private readonly map = new Map<string, ChunkPayload>();

  async load(key: string) { return this.map.get(key) ?? null; }
  async save(payload: ChunkPayload) { this.map.set(payload.key, payload); }
  async remove(key: string) { this.map.delete(key); }
  async has(key: string) { return this.map.has(key); }
}
