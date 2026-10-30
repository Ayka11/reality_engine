import { hash3 } from './WorldSeed'
import { cloneWorldObject, objectId, type ObjectPlacement, type WorldObject, type WorldObjectKind } from './WorldObject'
import { WorldObjectSpatialIndex } from './WorldObjectSpatialIndex'

export type ObjectQuery = {
  minX?: number; maxX?: number; minY?: number; maxY?: number
  minZ?: number; maxZ?: number; kind?: WorldObjectKind
}

export type WorldObjectTransform = Partial<Pick<WorldObject, 'x' | 'y' | 'z' | 'rotationY' | 'scale'>>
export type WorldObjectUpdate = Partial<Pick<WorldObject, 'x' | 'y' | 'z' | 'rotationY' | 'scale' | 'seed' | 'properties'>>

/**
 * Owns authoritative world-object values. Public reads and write results are
 * detached snapshots; spatial membership is updated only through this manager.
 */
export class WorldObjectManager {
  private objects = new Map<string, WorldObject>()
  get size(): number { return this.objects.size }

  constructor(private readonly spatialIndex?: WorldObjectSpatialIndex) {}

  /**
   * New placements get collision-safe IDs. Re-inserting an object after delete
   * (history undo/redo, chunk restore, or a transform rollback) preserves its
   * stable identity instead of deriving a new ID from its changed coordinates.
   */
  add(placement: ObjectPlacement | WorldObject): WorldObject {
    let id: string
    if ('id' in placement && typeof placement.id === 'string' && placement.id.length > 0) {
      id = placement.id
      if (this.objects.has(id)) {
        throw new Error(`World object ID collision: ${id}`)
      }
    } else {
      const baseId = objectId(placement.kind, placement.x, placement.y, placement.z)
      id = baseId
      let suffix = 1
      while (this.objects.has(id)) {
        id = `${baseId}#${suffix}`
        suffix++
      }
    }

    const object = cloneWorldObject({ ...placement, id } as WorldObject)
    this.assertValidObject(object)
    this.objects.set(id, object)
    this.spatialIndex?.upsert(object)
    return cloneWorldObject(object)
  }

  remove(id: string): boolean {
    const removed = this.objects.delete(id)
    if (removed) this.spatialIndex?.remove(id)
    return removed
  }

  /** Read a detached value; modifying it cannot bypass spatial-index updates. */
  get(id: string): WorldObject | undefined {
    const object = this.objects.get(id)
    return object ? cloneWorldObject(object) : undefined
  }

  /** Update object state atomically with spatial-index membership. */
  update(id: string, patch: WorldObjectUpdate): WorldObject | undefined {
    const current = this.objects.get(id)
    if (!current) return undefined
    if (patch.properties !== undefined &&
        (!patch.properties || typeof patch.properties !== 'object' || Array.isArray(patch.properties))) {
      throw new TypeError('World object properties must be a record')
    }
    const next: WorldObject = {
      ...current,
      ...patch,
      properties: { ...(patch.properties ?? current.properties) },
    }
    this.assertValidObject(next)
    this.objects.set(id, next)
    this.spatialIndex?.upsert(next)
    return cloneWorldObject(next)
  }

  /** Update only transform fields through the same authoritative commit path. */
  updateTransform(id: string, patch: WorldObjectTransform): WorldObject | undefined {
    return this.update(id, patch)
  }

  clear(): void {
    this.objects.clear()
    this.spatialIndex?.clear()
  }

  query(query: ObjectQuery = {}): WorldObject[] {
    const bounds = [query.minX, query.maxX, query.minY, query.maxY, query.minZ, query.maxZ]
    // Preserve the legacy comparison semantics for NaN/Infinity bounds; the
    // spatial grid is used whenever all supplied numeric bounds are finite.
    if (this.spatialIndex && bounds.every(value => value === undefined || Number.isFinite(value))) {
      return this.spatialIndex.queryBounds(query)
    }
    return [...this.objects.values()]
      .filter(o =>
        (query.kind === undefined || o.kind === query.kind) &&
        (query.minX === undefined || o.x >= query.minX) &&
        (query.maxX === undefined || o.x <= query.maxX) &&
        (query.minY === undefined || o.y >= query.minY) &&
        (query.maxY === undefined || o.y <= query.maxY) &&
        (query.minZ === undefined || o.z >= query.minZ) &&
        (query.maxZ === undefined || o.z <= query.maxZ))
      .map(cloneWorldObject)
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

  /** Return detached snapshots, never the manager's authoritative records. */
  values(): WorldObject[] {
    return [...this.objects.values()].map(cloneWorldObject)
  }

  private assertValidObject(object: WorldObject): void {
    if (typeof object.id !== 'string' || !object.id.trim() ||
        typeof object.kind !== 'string' ||
        ![object.x, object.y, object.z, object.rotationY, object.scale, object.seed].every(Number.isFinite) ||
        object.scale <= 0 ||
        !object.properties || typeof object.properties !== 'object' || Array.isArray(object.properties)) {
      throw new TypeError('World object requires a stable ID, finite transform, positive scale, and properties record')
    }
    for (const value of Object.values(object.properties)) {
      if (!(typeof value === 'string' || typeof value === 'boolean' ||
          (typeof value === 'number' && Number.isFinite(value)))) {
        throw new TypeError('World object properties must contain only strings, finite numbers, or booleans')
      }
    }
  }
}
