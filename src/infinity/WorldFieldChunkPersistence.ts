import { CHUNK_FLOATS } from '../core/ChunkGrid'
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
    const canonical = workerChunks
      .map(chunk => ({ key: chunk.key, data: [...chunk.data] }))
      .sort((a, b) => a.key - b.key)
    const flat = canonical.flatMap(chunk => [chunk.key, ...chunk.data])
    const snapshot: WorldFieldChunkSnapshot = {
      schemaVersion: 2,
      key: `${coord.cx},${coord.cy},${coord.cz}`,
      coord: { ...coord }, seed, providerVersion, values: flat,
      workerChunks: canonical,
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
    if (!snapshot || !Array.isArray(snapshot.values) || !snapshot.values.every(Number.isFinite)) return false
    if (typeof snapshot.key !== 'string' || typeof snapshot.seed !== 'string') return false
    if (!snapshot.coord || !Number.isInteger(snapshot.coord.cx) || !Number.isInteger(snapshot.coord.cy) || !Number.isInteger(snapshot.coord.cz)) return false
    if (snapshot.key !== snapshot.coord.cx + ',' + snapshot.coord.cy + ',' + snapshot.coord.cz) return false
    if (!Number.isFinite(snapshot.providerVersion) || !Number.isFinite(snapshot.savedAt)) return false
    if (typeof snapshot.checksum !== 'string' || snapshot.checksum.length !== 8) return false
    if (snapshot.schemaVersion === 1) return checksum(snapshot.values) === snapshot.checksum
    if (snapshot.schemaVersion === 2) {
      if (!Array.isArray(snapshot.workerChunks) || snapshot.workerChunks.length === 0) return false
      const keys = new Set<number>()
      for (const chunk of snapshot.workerChunks) {
        if (!Number.isInteger(chunk.key) || keys.has(chunk.key)) return false
        if (!Array.isArray(chunk.data) || chunk.data.length !== CHUNK_FLOATS) return false
        if (!chunk.data.every(Number.isFinite)) return false
        keys.add(chunk.key)
      }
      if (!snapshot.workerView || typeof snapshot.workerView.seed !== 'string') return false
      const center = snapshot.workerView.center
      if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y) || !Number.isFinite(center.z) || !Number.isFinite(snapshot.workerView.sliceY)) return false
      const canonical = snapshot.workerChunks
        .map(chunk => ({ key: chunk.key, data: [...chunk.data] }))
        .sort((a, b) => a.key - b.key)
      const flat = canonical.flatMap(chunk => [chunk.key, ...chunk.data])
      return checksum(flat) === snapshot.checksum && checksum(snapshot.values) === snapshot.checksum
    }
    return false
  }

  remove(coord: WorldFieldChunkCoord): boolean {
    return this.snapshots.delete(`${coord.cx},${coord.cy},${coord.cz}`)
  }

  clear(): void { this.snapshots.clear() }
  size(): number { return this.snapshots.size }
}

export const worldFieldChunkPersistence = new WorldFieldChunkPersistence()
