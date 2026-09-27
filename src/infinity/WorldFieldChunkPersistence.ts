import type { WorldFieldChunkCoord } from './WorldFieldChunkStore'

export type WorldFieldChunkSnapshot = {
  schemaVersion: 1 | 2
  key: string
  coord: WorldFieldChunkCoord
  seed: string
  providerVersion: number
  values: number[]
  workerChunks?: { key: number; data: number[] }[]
  workerView?: { center: { x: number; y: number; z: number }; sliceY: number; seed: string }
  fieldLayout?: { fieldsPerCell: number; cellCount: number }
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

  saveWorkerChunks(coord: WorldFieldChunkCoord, seed: string, workerChunks: { key: number; data: number[] }[], workerView: { center: { x: number; y: number; z: number }; sliceY: number; seed: string }, providerVersion = 2): WorldFieldChunkSnapshot {
    const flat = workerChunks.flatMap(chunk => [chunk.key, ...chunk.data])
    const snapshot: WorldFieldChunkSnapshot = {
      schemaVersion: 2,
      key: `${coord.cx},${coord.cy},${coord.cz}`,
      coord: { ...coord }, seed, providerVersion, values: flat,
      workerChunks: workerChunks.map(chunk => ({ key: chunk.key, data: [...chunk.data] })),
      workerView: { center: { ...workerView.center }, sliceY: workerView.sliceY, seed: workerView.seed },
      checksum: checksum(flat), savedAt: Date.now(),
    }
    this.snapshots.set(snapshot.key, snapshot)
    return snapshot
  }

  save(coord: WorldFieldChunkCoord, seed: string, values: number[], providerVersion = 1, fieldLayout?: { fieldsPerCell: number; cellCount: number }): WorldFieldChunkSnapshot {
    const snapshot: WorldFieldChunkSnapshot = {
      schemaVersion: 1,
      key: `${coord.cx},${coord.cy},${coord.cz}`,
      coord: { ...coord },
      seed,
      providerVersion,
      values: [...values],
      fieldLayout,
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
    if (snapshot.schemaVersion === 1) return checksum(snapshot.values) === snapshot.checksum
    if (snapshot.schemaVersion === 2) return Array.isArray(snapshot.workerChunks) && checksum(snapshot.values) === snapshot.checksum && snapshot.workerChunks.every(chunk => chunk.data.length > 0)
    return false
  }

  remove(coord: WorldFieldChunkCoord): boolean {
    return this.snapshots.delete(`${coord.cx},${coord.cy},${coord.cz}`)
  }

  clear(): void { this.snapshots.clear() }
  size(): number { return this.snapshots.size }
}

export const worldFieldChunkPersistence = new WorldFieldChunkPersistence()
