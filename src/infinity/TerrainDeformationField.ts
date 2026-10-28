export type TerrainBrushMode = 'raise' | 'lower'

export type TerrainDeformationSnapshot = {
  version: 1
  seed: string
  deltas: Array<[key: string, delta: number]>
}

type TerrainTransaction = {
  before: Map<string, number>
  after: Map<string, number>
}

function keyOf(x: number, z: number): string {
  return `${x},${z}`
}

function parseKey(key: string): { x: number; z: number } | null {
  const parts = key.split(',')
  if (parts.length !== 2) return null
  const x = Number(parts[0])
  const z = Number(parts[1])
  return Number.isSafeInteger(x) && Number.isSafeInteger(z) ? { x, z } : null
}

/**
 * Sparse, seed-scoped terrain deformation overlay. The procedural generator remains
 * the immutable baseline; this layer stores only user-authored height offsets.
 */
export class TerrainDeformationField {
  private deltas = new Map<string, number>()
  private undoStack: TerrainTransaction[] = []
  private redoStack: TerrainTransaction[] = []

  constructor(readonly seed: string, private readonly maxHistory = 50) {
    if (!seed || !Number.isInteger(maxHistory) || maxHistory < 1) {
      throw new Error('Terrain deformation field requires a seed and positive history limit')
    }
  }

  sampleDelta(x: number, z: number): number {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return 0
    const x0 = Math.floor(x)
    const z0 = Math.floor(z)
    const tx = x - x0
    const tz = z - z0
    const at = (sx: number, sz: number) => this.deltas.get(keyOf(sx, sz)) ?? 0
    const a = at(x0, z0) * (1 - tx) + at(x0 + 1, z0) * tx
    const b = at(x0, z0 + 1) * (1 - tx) + at(x0 + 1, z0 + 1) * tx
    return a * (1 - tz) + b * tz
  }

  applyBrush(x: number, z: number, radius: number, strength: number, mode: TerrainBrushMode): number {
    if (![x, z, radius, strength].every(Number.isFinite) ||
        radius <= 0 || radius > 64 || strength <= 0 || strength > 8 ||
        Math.abs(x) > Number.MAX_SAFE_INTEGER - 64 || Math.abs(z) > Number.MAX_SAFE_INTEGER - 64) {
      throw new RangeError('Terrain brush coordinates must be safe and radius/strength must be within supported limits')
    }
    if (mode !== 'raise' && mode !== 'lower') throw new TypeError('Unsupported terrain brush mode')
    const before = new Map(this.deltas)
    const sign = mode === 'raise' ? 1 : -1
    const minX = Math.floor(x - radius)
    const maxX = Math.ceil(x + radius)
    const minZ = Math.floor(z - radius)
    const maxZ = Math.ceil(z + radius)
    let changed = 0
    for (let gz = minZ; gz <= maxZ; gz++) {
      for (let gx = minX; gx <= maxX; gx++) {
        const distance = Math.hypot(gx - x, gz - z)
        if (distance > radius) continue
        const falloff = 1 - distance / radius
        const next = (this.deltas.get(keyOf(gx, gz)) ?? 0) + sign * strength * falloff * falloff
        if (!Number.isFinite(next)) throw new Error('Terrain brush produced a non-finite height delta')
        if (Math.abs(next) < 1e-6) this.deltas.delete(keyOf(gx, gz))
        else this.deltas.set(keyOf(gx, gz), next)
        changed++
      }
    }
    if (changed > 0) {
      this.undoStack.push({ before, after: new Map(this.deltas) })
      if (this.undoStack.length > this.maxHistory) this.undoStack.shift()
      this.redoStack = []
    }
    return changed
  }

  undo(): boolean {
    const transaction = this.undoStack.pop()
    if (!transaction) return false
    if (!this.mapsEqual(this.deltas, transaction.after)) {
      this.undoStack.push(transaction)
      return false
    }
    this.deltas = new Map(transaction.before)
    this.redoStack.push(transaction)
    return true
  }

  redo(): boolean {
    const transaction = this.redoStack.pop()
    if (!transaction) return false
    if (!this.mapsEqual(this.deltas, transaction.before)) {
      this.redoStack.push(transaction)
      return false
    }
    this.deltas = new Map(transaction.after)
    this.undoStack.push(transaction)
    return true
  }

  serialize(): TerrainDeformationSnapshot {
    return {
      version: 1,
      seed: this.seed,
      deltas: [...this.deltas.entries()].sort(([a], [b]) => a.localeCompare(b)),
    }
  }

  restore(snapshot: TerrainDeformationSnapshot): void {
    if (!snapshot || snapshot.version !== 1 || snapshot.seed !== this.seed || !Array.isArray(snapshot.deltas)) {
      throw new TypeError('Terrain deformation snapshot has an unsupported schema or seed')
    }
    const next = new Map<string, number>()
    const seenKeys = new Set<string>()
    for (const entry of snapshot.deltas) {
      const parsedKey = Array.isArray(entry) && typeof entry[0] === 'string'
        ? parseKey(entry[0])
        : null
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' ||
          !parsedKey || entry[0] !== keyOf(parsedKey.x, parsedKey.z) ||
          seenKeys.has(entry[0]) || !Number.isFinite(entry[1]) || Math.abs(entry[1]) > 1e6) {
        throw new TypeError('Terrain deformation snapshot contains an invalid delta')
      }
      seenKeys.add(entry[0])
      if (Math.abs(entry[1]) >= 1e-6) next.set(entry[0], entry[1])
    }
    this.deltas = next
    this.undoStack = []
    this.redoStack = []
  }

  clear(): void {
    this.deltas.clear()
    this.undoStack = []
    this.redoStack = []
  }

  get size(): number { return this.deltas.size }
  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }

  private mapsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
    if (a.size !== b.size) return false
    for (const [key, value] of a) if (b.get(key) !== value) return false
    return true
  }
}
