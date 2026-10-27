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

function chunkCoordKey(coord: WorldFieldChunkCoord): string {
  if (!coord || !Number.isSafeInteger(coord.cx) || !Number.isSafeInteger(coord.cy) || !Number.isSafeInteger(coord.cz)) {
    throw new RangeError('Chunk coordinates must be safe integers')
  }
  return `${coord.cx},${coord.cy},${coord.cz}`
}

function cloneSnapshot(snapshot: WorldFieldChunkSnapshot): WorldFieldChunkSnapshot {
  return {
    ...snapshot,
    coord: { ...snapshot.coord },
    values: [...snapshot.values],
    workerChunks: snapshot.workerChunks?.map((chunk) => ({ key: chunk.key, data: [...chunk.data] })),
    workerView: snapshot.workerView
      ? { ...snapshot.workerView, center: { ...snapshot.workerView.center } }
      : undefined,
    fieldLayout: snapshot.fieldLayout ? { ...snapshot.fieldLayout } : undefined,
  }
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

const DATABASE_NAME = 'reality-engine-world-field-chunks'
const DATABASE_VERSION = 1
const OBJECT_STORE = 'snapshots'

export class WorldFieldChunkPersistence {
  private readonly snapshots = new Map<string, WorldFieldChunkSnapshot>()
  private databasePromise: Promise<IDBDatabase | null> | null = null
  private writeQueue: Promise<void> = Promise.resolve()
  private lastDurabilityError: string | null = null
  private readonly durabilityFailures = new Map<string, string>()
  private globalDurabilityError: string | null = null

  private openDatabase(): Promise<IDBDatabase | null> {
    if (this.databasePromise) return this.databasePromise
    if (typeof indexedDB === 'undefined') return Promise.resolve(null)

    const opening = new Promise<IDBDatabase | null>((resolve) => {
      let settled = false
      try {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(OBJECT_STORE)) db.createObjectStore(OBJECT_STORE, { keyPath: 'key' })
        }
        request.onsuccess = () => {
          const db = request.result
          // A blocked request may later succeed after we already returned null.
          // Do not leak a connection that the settled promise can no longer return.
          if (settled) {
            db.close()
            return
          }
          settled = true
          resolve(db)
        }
        request.onerror = () => {
          if (settled) return
          settled = true
          this.globalDurabilityError = request.error?.message ?? 'IndexedDB open failed'
          this.lastDurabilityError = this.globalDurabilityError
          resolve(null)
        }
        request.onblocked = () => {
          if (settled) return
          settled = true
          this.globalDurabilityError = 'IndexedDB upgrade blocked by another open tab'
          this.lastDurabilityError = this.globalDurabilityError
          resolve(null)
        }
      } catch (error) {
        if (settled) return
        settled = true
        this.globalDurabilityError = error instanceof Error ? error.message : String(error)
        this.lastDurabilityError = this.globalDurabilityError
        resolve(null)
      }
    })

    // Clear only the failed cached attempt so transient failures can be retried.
    let cachedPromise: Promise<IDBDatabase | null>
    cachedPromise = opening.then((db) => {
      if (db === null && this.databasePromise === cachedPromise) this.databasePromise = null
      return db
    })
    this.databasePromise = cachedPromise
    return cachedPromise
  }

  private enqueueWrite(
    key: string | null,
    operation: (store: IDBObjectStore) => IDBRequest,
  ): void {
    this.writeQueue = this.writeQueue.then(async () => {
      const db = await this.openDatabase()
      if (!db) {
        this.globalDurabilityError ??= this.lastDurabilityError ?? 'IndexedDB unavailable'
        this.lastDurabilityError = this.globalDurabilityError
        return
      }
      await new Promise<void>((resolve, reject) => {
        try {
          const transaction = db.transaction(OBJECT_STORE, 'readwrite')
          const request = operation(transaction.objectStore(OBJECT_STORE))
          request.onerror = () => reject(request.error ?? new Error('IndexedDB write failed'))
          transaction.oncomplete = () => {
            if (key === null) {
              this.durabilityFailures.clear()
              this.globalDurabilityError = null
            } else {
              this.durabilityFailures.delete(key)
            }
            this.lastDurabilityError = this.globalDurabilityError
              ?? this.durabilityFailures.values().next().value
              ?? null
            resolve()
          }
          transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
          transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
        } catch (error) { reject(error) }
      })
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      if (key === null) this.globalDurabilityError = message
      else this.durabilityFailures.set(key, message)
      this.lastDurabilityError = this.globalDurabilityError
        ?? this.durabilityFailures.values().next().value
        ?? message
    })
  }

  async flushDurableWrites(): Promise<{ durable: boolean; pending: boolean; error: string | null }> {
    await this.writeQueue
    const db = await this.openDatabase()
    return { durable: db !== null && this.lastDurabilityError === null, pending: false, error: this.lastDurabilityError }
  }

  async loadDurable(coord: WorldFieldChunkCoord): Promise<WorldFieldChunkSnapshot | null> {
    await this.writeQueue
    const key = chunkCoordKey(coord)
    const cached = this.snapshots.get(key)
    if (cached && this.validate(cached)) return cloneSnapshot(cached)
    const db = await this.openDatabase()
    if (!db) return null
    const snapshot = await new Promise<WorldFieldChunkSnapshot | null>((resolve) => {
      try {
        const request = db.transaction(OBJECT_STORE, 'readonly').objectStore(OBJECT_STORE).get(key)
        request.onsuccess = () => resolve((request.result as WorldFieldChunkSnapshot | undefined) ?? null)
        request.onerror = () => {
          this.lastDurabilityError = request.error?.message ?? 'IndexedDB read failed'
          resolve(null)
        }
      } catch (error) {
        this.lastDurabilityError = error instanceof Error ? error.message : String(error)
        resolve(null)
      }
    })
    if (snapshot && this.validate(snapshot)) {
      const isolated = cloneSnapshot(snapshot)
      this.snapshots.set(key, isolated)
      return cloneSnapshot(isolated)
    }
    return null
  }

  saveWorkerChunks(coord: WorldFieldChunkCoord, seed: string, workerChunks: { key: number; data: number[] }[], workerView: { center: { x: number; y: number; z: number }; sliceY: number; seed: string }, providerVersion = 2): WorldFieldChunkSnapshot {
    const canonical = workerChunks
      .map(chunk => ({ key: chunk.key, data: [...chunk.data] }))
      .sort((a, b) => a.key - b.key)
    const flat = canonical.flatMap(chunk => [chunk.key, ...chunk.data])
    const snapshot: WorldFieldChunkSnapshot = {
      schemaVersion: 2,
      key: chunkCoordKey(coord),
      coord: { ...coord }, seed, providerVersion, values: flat,
      workerChunks: canonical,
      workerView: { center: { ...workerView.center }, sliceY: workerView.sliceY, seed: workerView.seed },
      checksum: checksum(flat), savedAt: Date.now(),
    }
    const isolated = cloneSnapshot(snapshot)
    this.snapshots.set(snapshot.key, isolated)
    this.enqueueWrite(snapshot.key, store => store.put(cloneSnapshot(isolated)))
    return cloneSnapshot(isolated)
  }

  save(coord: WorldFieldChunkCoord, seed: string, values: number[], providerVersion = 1, fieldLayout?: { fieldsPerCell: number; cellCount: number }): WorldFieldChunkSnapshot {
    const snapshot: WorldFieldChunkSnapshot = {
      schemaVersion: 1,
      key: chunkCoordKey(coord),
      coord: { ...coord },
      seed,
      providerVersion,
      values: [...values],
      fieldLayout,
      checksum: checksum(values),
      savedAt: Date.now(),
    }
    const isolated = cloneSnapshot(snapshot)
    this.snapshots.set(snapshot.key, isolated)
    this.enqueueWrite(snapshot.key, store => store.put(cloneSnapshot(isolated)))
    return cloneSnapshot(isolated)
  }

  load(coord: WorldFieldChunkCoord): WorldFieldChunkSnapshot | null {
    const snapshot = this.snapshots.get(chunkCoordKey(coord))
    return snapshot ? cloneSnapshot(snapshot) : null
  }

  loadValid(coord: WorldFieldChunkCoord): WorldFieldChunkSnapshot | null {
    const snapshot = this.load(coord)
    return snapshot && this.validate(snapshot) ? snapshot : null
  }

  validate(snapshot: WorldFieldChunkSnapshot): boolean {
    if (!snapshot || !Array.isArray(snapshot.values) || !snapshot.values.every(Number.isFinite)) return false
    if (typeof snapshot.key !== 'string' || typeof snapshot.seed !== 'string') return false
    if (!snapshot.coord || !Number.isSafeInteger(snapshot.coord.cx) || !Number.isSafeInteger(snapshot.coord.cy) || !Number.isSafeInteger(snapshot.coord.cz)) return false
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
      const valuesMatchCanonical = snapshot.values.length === flat.length
        && snapshot.values.every((value, index) => Object.is(value, flat[index]))
      return valuesMatchCanonical
        && checksum(flat) === snapshot.checksum
        && checksum(snapshot.values) === snapshot.checksum
    }
    return false
  }

  remove(coord: WorldFieldChunkCoord): boolean {
    const key = chunkCoordKey(coord)
    const removed = this.snapshots.delete(key)
    this.enqueueWrite(key, store => store.delete(key))
    return removed
  }

  clear(): void {
    this.snapshots.clear()
    this.enqueueWrite(null, store => store.clear())
  }
  size(): number { return this.snapshots.size }
}

export const worldFieldChunkPersistence = new WorldFieldChunkPersistence()
