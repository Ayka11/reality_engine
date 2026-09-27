import type { ScientificFieldProvider } from './ScientificFieldProvider'
import type { ScientificFieldSample } from './FieldSampler'

export type WorldFieldChunkCoord = { cx: number; cy: number; cz: number }

export type WorldFieldChunk = {
  key: string
  coord: WorldFieldChunkCoord
  seed: string
  version: number
  provider: ScientificFieldProvider
  lastAccess: number
}

export type WorldFieldChunkStoreStats = {
  loaded: number
  capacity: number
  evictions: number
  keys: string[]
}

/**
 * Spatial registry for streamed scientific field chunks.
 *
 * The store deliberately does not prescribe a simulation integrator: a chunk
 * provider may be backed by deterministic generation, worker state, or a
 * persisted simulation snapshot. This keeps streaming concerns separate from
 * field physics while guaranteeing one canonical world-coordinate address.
 */
export type WorldFieldChunkEvictionHandler = (chunk: WorldFieldChunk) => void

export class WorldFieldChunkStore {
  private readonly chunks = new Map<string, WorldFieldChunk>()
  private tick = 0
  private evictions = 0

  constructor(private readonly capacity = 128, private readonly onEvict?: WorldFieldChunkEvictionHandler) {}

  static key(coord: WorldFieldChunkCoord): string {
    return `${coord.cx},${coord.cy},${coord.cz}`
  }

  static coord(key: string): WorldFieldChunkCoord | null {
    const values = key.split(',').map(Number)
    if (values.length !== 3 || values.some((v) => !Number.isInteger(v))) return null
    return { cx: values[0], cy: values[1], cz: values[2] }
  }

  get(coord: WorldFieldChunkCoord): WorldFieldChunk | null {
    const key = WorldFieldChunkStore.key(coord)
    const chunk = this.chunks.get(key)
    if (!chunk) return null
    chunk.lastAccess = ++this.tick
    return chunk
  }

  set(coord: WorldFieldChunkCoord, seed: string, provider: ScientificFieldProvider, version = 1): WorldFieldChunk {
    const key = WorldFieldChunkStore.key(coord)
    const chunk: WorldFieldChunk = { key, coord: { ...coord }, seed, version, provider, lastAccess: ++this.tick }
    this.chunks.set(key, chunk)
    this.evictIfNeeded(key)
    return chunk
  }

  delete(coord: WorldFieldChunkCoord): boolean {
    return this.chunks.delete(WorldFieldChunkStore.key(coord))
  }

  clear(): void {
    this.chunks.clear()
  }

  sample(coord: WorldFieldChunkCoord, x: number, y: number, z: number): ScientificFieldSample | null {
    return this.get(coord)?.provider.sample(x, y, z) ?? null
  }

  stats(): WorldFieldChunkStoreStats {
    return {
      loaded: this.chunks.size,
      capacity: this.capacity,
      evictions: this.evictions,
      keys: [...this.chunks.keys()],
    }
  }

  private evictIfNeeded(protectedKey: string) {
    while (this.chunks.size > Math.max(1, this.capacity)) {
      let candidate: WorldFieldChunk | null = null
      for (const chunk of this.chunks.values()) {
        if (chunk.key === protectedKey) continue
        if (!candidate || chunk.lastAccess < candidate.lastAccess) candidate = chunk
      }
      if (!candidate) break
      this.chunks.delete(candidate.key)
      this.onEvict?.(candidate)
      this.evictions++
    }
  }
}

export const WORLD_FIELD_CHUNK_SIZE = 32

export function worldFieldChunkCoord(x: number, y: number, z: number): WorldFieldChunkCoord {
  return {
    cx: Math.floor(x / WORLD_FIELD_CHUNK_SIZE),
    cy: Math.floor(y / WORLD_FIELD_CHUNK_SIZE),
    cz: Math.floor(z / WORLD_FIELD_CHUNK_SIZE),
  }
}

export function worldFieldChunkOrigin(coord: WorldFieldChunkCoord) {
  return {
    x: coord.cx * WORLD_FIELD_CHUNK_SIZE,
    y: coord.cy * WORLD_FIELD_CHUNK_SIZE,
    z: coord.cz * WORLD_FIELD_CHUNK_SIZE,
  }
}
