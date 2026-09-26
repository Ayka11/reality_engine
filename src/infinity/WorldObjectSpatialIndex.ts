import type { WorldObject } from './WorldObject'
import { chunkKey, worldToChunk } from './WorldCoordinate'

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
      this.buckets.get(previousChunk)?.delete(object.id)
    }

    let bucket = this.buckets.get(nextChunk)
    if (!bucket) {
      bucket = new Set<string>()
      this.buckets.set(nextChunk, bucket)
    }
    bucket.add(object.id)
    this.objects.set(object.id, object)
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
            if (dx * dx + dy * dy + dz * dz <= r2) result.push(object)
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
