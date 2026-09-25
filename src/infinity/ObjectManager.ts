import { hash3 } from './WorldSeed'
import { objectId, type ObjectPlacement, type WorldObject, type WorldObjectKind } from './WorldObject'

export type ObjectQuery = {
  minX?: number; maxX?: number; minY?: number; maxY?: number
  minZ?: number; maxZ?: number; kind?: WorldObjectKind
}

export class WorldObjectManager {
  private objects = new Map<string, WorldObject>()
  get size(): number { return this.objects.size }

  add(placement: ObjectPlacement): WorldObject {
    const id = objectId(placement.kind, placement.x, placement.y, placement.z)
    const object: WorldObject = { ...placement, id }
    this.objects.set(id, object)
    return object
  }

  remove(id: string): boolean { return this.objects.delete(id) }
  get(id: string): WorldObject | undefined { return this.objects.get(id) }
  clear(): void { this.objects.clear() }

  query(query: ObjectQuery = {}): WorldObject[] {
    return [...this.objects.values()].filter(o =>
      (query.kind === undefined || o.kind === query.kind) &&
      (query.minX === undefined || o.x >= query.minX) &&
      (query.maxX === undefined || o.x <= query.maxX) &&
      (query.minY === undefined || o.y >= query.minY) &&
      (query.maxY === undefined || o.y <= query.maxY) &&
      (query.minZ === undefined || o.z >= query.minZ) &&
      (query.maxZ === undefined || o.z <= query.maxZ))
  }

  scatter(seed: string | number, kind: WorldObjectKind, x0: number, z0: number, x1: number, z1: number, spacing = 32, density = 0.15): WorldObject[] {
    const added: WorldObject[] = []
    const step = Math.max(1, Math.round(spacing))
    for (let z = Math.floor(z0 / step) * step; z <= z1; z += step) {
      for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
        if (hash3(seed, x, 0, z) > density) continue
        const sx = x + Math.floor(hash3(seed, x + 11, 1, z) * step)
        const sz = z + Math.floor(hash3(seed, x + 17, 2, z) * step)
        added.push(this.add({
          kind, x: sx, y: 0, z: sz,
          rotationY: hash3(seed, sx, 3, sz) * Math.PI * 2,
          scale: 0.7 + hash3(seed, sx, 4, sz) * 0.7,
          seed: Math.floor(hash3(seed, sx, 5, sz) * 0xffffffff),
          properties: {},
        }))
      }
    }
    return added
  }

  values(): WorldObject[] { return [...this.objects.values()] }
}
