import type { WorldFieldChunkCoord } from './WorldFieldChunkStore'

export type WorldFieldChunkSnapshot = {
  schemaVersion: 1
  key: string
  coord: WorldFieldChunkCoord
  seed: string
  providerVersion: number
  values: number[]
  checksum: string
  savedAt: number
}

function checksum(values: number[]): string {
  let h = 2166136261 >>> 0
  for (const value of values) {
    const scaled = Math.round(value * 1000000)
    h ^= scaled >>> 0
    h = Math.imul(h, 16777619) >>> 0
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export class WorldFieldChunkPersistence {
  private readonly snapshots = new Map<string, WorldFieldChunkSnapshot>()

  save(coord: WorldFieldChunkCoord, seed: string, values: number[], providerVersion = 1): WorldFieldChunkSnapshot {
    const snapshot: WorldFieldChunkSnapshot = {
      schemaVersion: 1,
      key: `${coord.cx},${coord.cy},${coord.cz}`,
      coord: { ...coord },
      seed,
      providerVersion,
      values: [...values],
      checksum: checksum(values),
      savedAt: Date.now(),
    }
    this.snapshots.set(snapshot.key, snapshot)
    return snapshot
  }

  load(coord: WorldFieldChunkCoord): WorldFieldChunkSnapshot | null {
    return this.snapshots.get(`${coord.cx},${coord.cy},${coord.cz}`) ?? null
  }

  loadValid(coord: WorldFieldChunkCoord): WorldFieldChunkSnapshot | null {
    const snapshot = this.load(coord)
    return snapshot && this.validate(snapshot) ? snapshot : null
  }

  validate(snapshot: WorldFieldChunkSnapshot): boolean {
    return snapshot.schemaVersion === 1 && checksum(snapshot.values) === snapshot.checksum
  }

  remove(coord: WorldFieldChunkCoord): boolean {
    return this.snapshots.delete(`${coord.cx},${coord.cy},${coord.cz}`)
  }

  clear(): void { this.snapshots.clear() }
  size(): number { return this.snapshots.size }
}

export const worldFieldChunkPersistence = new WorldFieldChunkPersistence()
