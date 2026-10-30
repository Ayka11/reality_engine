import { cloneWorldObject, type WorldObject } from './WorldObject'
import { chunkKey, worldToChunk, WORLD_CHUNK_SIZE, WORLD_CHUNK_HEIGHT } from './WorldCoordinate'

export type WorldObjectSpatialQuery = {
  minX?: number; maxX?: number; minY?: number; maxY?: number
  minZ?: number; maxZ?: number; kind?: WorldObject['kind']
}

/**
 * Sparse spatial index for world objects.
 * Queries only chunks intersecting the requested radius.
 */
export class WorldObjectSpatialIndex {
  private buckets = new Map<string, Set<string>>()
  private objects = new Map<string, WorldObject>()
  private objectChunks = new Map<string, string>()

  clear() {
    this.buckets.clear()
    this.objects.clear()
    this.objectChunks.clear()
  }

  private chunkFor(x: number, y: number, z: number) {
    const { chunk } = worldToChunk(x, y, z)
    return chunkKey(chunk.cx, chunk.cy, chunk.cz)
  }

  upsert(object: WorldObject) {
    const nextChunk = this.chunkFor(object.x, object.y, object.z)
    const previousChunk = this.objectChunks.get(object.id)
    if (previousChunk && previousChunk !== nextChunk) {
      const previousBucket = this.buckets.get(previousChunk)
      previousBucket?.delete(object.id)
      if (previousBucket?.size === 0) this.buckets.delete(previousChunk)
    }

    let bucket = this.buckets.get(nextChunk)
    if (!bucket) {
      bucket = new Set<string>()
      this.buckets.set(nextChunk, bucket)
    }
    bucket.add(object.id)
    this.objects.set(object.id, cloneWorldObject(object))
    this.objectChunks.set(object.id, nextChunk)
  }

  remove(id: string) {
    const key = this.objectChunks.get(id)
    if (key) {
      const bucket = this.buckets.get(key)
      bucket?.delete(id)
      if (bucket?.size === 0) this.buckets.delete(key)
    }
    this.objectChunks.delete(id)
    this.objects.delete(id)
  }

  /** Query only occupied spatial buckets intersecting an axis-aligned world-space box. */
  queryBounds(query: WorldObjectSpatialQuery = {}) {
    const bounds = [query.minX, query.maxX, query.minY, query.maxY, query.minZ, query.maxZ]
    if (bounds.some(value => value !== undefined && !Number.isFinite(value))) {
      throw new TypeError('World object query bounds must be finite numbers')
    }
    if ((query.minX !== undefined && query.maxX !== undefined && query.minX > query.maxX) ||
        (query.minY !== undefined && query.maxY !== undefined && query.minY > query.maxY) ||
        (query.minZ !== undefined && query.maxZ !== undefined && query.minZ > query.maxZ)) {
      return []
    }

    // Use floor-based world chunk coordinates so negative positions and exact
    // chunk edges follow the same partitioning rules as object insertion.
    const minCx = query.minX === undefined ? undefined : Math.floor(query.minX / WORLD_CHUNK_SIZE)
    const maxCx = query.maxX === undefined ? undefined : Math.floor(query.maxX / WORLD_CHUNK_SIZE)
    const minCy = query.minY === undefined ? undefined : Math.floor(query.minY / WORLD_CHUNK_HEIGHT)
    const maxCy = query.maxY === undefined ? undefined : Math.floor(query.maxY / WORLD_CHUNK_HEIGHT)
    const minCz = query.minZ === undefined ? undefined : Math.floor(query.minZ / WORLD_CHUNK_SIZE)
    const maxCz = query.maxZ === undefined ? undefined : Math.floor(query.maxZ / WORLD_CHUNK_SIZE)
    const result: WorldObject[] = []

    for (const [key, bucket] of this.buckets) {
      const [cx, cy, cz] = key.split(',').map(Number)
      if ((minCx !== undefined && cx < minCx) || (maxCx !== undefined && cx > maxCx) ||
          (minCy !== undefined && cy < minCy) || (maxCy !== undefined && cy > maxCy) ||
          (minCz !== undefined && cz < minCz) || (maxCz !== undefined && cz > maxCz)) continue

      for (const id of bucket) {
        const object = this.objects.get(id)
        if (!object || (query.kind !== undefined && object.kind !== query.kind) ||
            (query.minX !== undefined && object.x < query.minX) ||
            (query.maxX !== undefined && object.x > query.maxX) ||
            (query.minY !== undefined && object.y < query.minY) ||
            (query.maxY !== undefined && object.y > query.maxY) ||
            (query.minZ !== undefined && object.z < query.minZ) ||
            (query.maxZ !== undefined && object.z > query.maxZ)) continue
        result.push(cloneWorldObject(object))
      }
    }
    return result
  }

  queryRadius(x: number, y: number, z: number, radius: number, kinds?: Set<WorldObject['kind']>) {
    const result: WorldObject[] = []
    const r = Math.max(0, radius)
    const min = worldToChunk(Math.floor(x - r), Math.floor(y - r), Math.floor(z - r)).chunk
    const max = worldToChunk(Math.floor(x + r), Math.floor(y + r), Math.floor(z + r)).chunk
    const r2 = r * r

    for (let cx = min.cx; cx <= max.cx; cx++) {
      for (let cy = min.cy; cy <= max.cy; cy++) {
        for (let cz = min.cz; cz <= max.cz; cz++) {
          const bucket = this.buckets.get(chunkKey(cx, cy, cz))
          if (!bucket) continue
          for (const id of bucket) {
            const object = this.objects.get(id)
            if (!object || (kinds && !kinds.has(object.kind))) continue
            const dx = object.x - x
            const dy = object.y - y
            const dz = object.z - z
            if (dx * dx + dy * dy + dz * dz <= r2) result.push(cloneWorldObject(object))
          }
        }
      }
    }
    return result
  }

  rebuild(objects: Iterable<WorldObject>) {
    this.clear()
    for (const object of objects) this.upsert(object)
  }

  get size() {
    return this.objects.size
  }
}
