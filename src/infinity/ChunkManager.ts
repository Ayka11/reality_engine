import { ChunkCoord, chunkKey } from './WorldCoordinate'
import { WorldChunk, WorldGenerator } from './WorldGenerator'

export type ChunkManagerOptions = {
  radius?: number
  verticalRadius?: number
  maxLoaded?: number
}

export class InfiniteChunkManager {
  readonly generator: WorldGenerator
  readonly radius: number
  readonly verticalRadius: number
  readonly maxLoaded: number
  private loaded = new Map<string, WorldChunk>()

  constructor(generator = new WorldGenerator(), options: ChunkManagerOptions = {}) {
    this.generator = generator
    this.radius = options.radius ?? 4
    this.verticalRadius = options.verticalRadius ?? 0
    this.maxLoaded = options.maxLoaded ?? 96
  }

  get size(): number { return this.loaded.size }

  get(cx: number, cy: number, cz: number): WorldChunk | undefined {
    return this.loaded.get(chunkKey(cx, cy, cz))
  }

  update(center: ChunkCoord): { loaded: WorldChunk[]; unloaded: string[] } {
    const wanted: { key: string; cx: number; cy: number; cz: number; d: number }[] = []
    for (let dz = -this.radius; dz <= this.radius; dz++) {
      for (let dx = -this.radius; dx <= this.radius; dx++) {
        for (let dy = -this.verticalRadius; dy <= this.verticalRadius; dy++) {
          const d = dx * dx + dz * dz + dy * dy * 4
          if (d > this.radius * this.radius) continue
          const cx = center.cx + dx, cy = center.cy + dy, cz = center.cz + dz
          wanted.push({ key: chunkKey(cx, cy, cz), cx, cy, cz, d })
        }
      }
    }
    wanted.sort((a, b) => a.d - b.d)
    const target = wanted.slice(0, this.maxLoaded)
    const targetKeys = new Set(target.map(v => v.key))
    const newlyLoaded: WorldChunk[] = []

    for (const item of target) {
      if (!this.loaded.has(item.key)) {
        const chunk = this.generator.generateChunk(item.cx, item.cy, item.cz)
        this.loaded.set(item.key, chunk)
        newlyLoaded.push(chunk)
      }
    }

    const unloaded: string[] = []
    for (const [key] of this.loaded) {
      if (!targetKeys.has(key)) {
        this.loaded.delete(key)
        unloaded.push(key)
      }
    }

    return { loaded: newlyLoaded, unloaded }
  }
}
