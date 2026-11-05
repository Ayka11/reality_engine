import { chunkKey, worldToChunk } from './WorldCoordinate'
import type { WorldObject } from './WorldObject'

type StoredChunk = { version: 1; seed: string; objects: WorldObject[] }

export const ACTIVE_WORLD_SEED_STORAGE_KEY = 'reality-engine-active-world-seed'
const MAX_ACTIVE_WORLD_SEED_LENGTH = 512

function isValidActiveWorldSeed(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ACTIVE_WORLD_SEED_LENGTH &&
    value.trim() === value
}

/** Read the seed that selects the world-specific localStorage namespace at startup. */
export function loadActiveWorldSeed(fallback: string): string {
  const safeFallback = isValidActiveWorldSeed(fallback) ? fallback : 'reality-seed-1'
  try {
    const saved = localStorage.getItem(ACTIVE_WORLD_SEED_STORAGE_KEY)
    if (isValidActiveWorldSeed(saved)) return saved
    if (saved !== null) localStorage.removeItem(ACTIVE_WORLD_SEED_STORAGE_KEY)
  } catch {
    // Startup remains available when browser storage is disabled or inaccessible.
  }
  return safeFallback
}

/** Persist the namespace selector independently from the seed-scoped world payloads. */
export function saveActiveWorldSeed(seed: string): boolean {
  if (!isValidActiveWorldSeed(seed)) return false
  try {
    localStorage.setItem(ACTIVE_WORLD_SEED_STORAGE_KEY, seed)
    return true
  } catch {
    return false
  }
}

export class WorldPersistence {
  private readonly prefix: string
  private readonly manifestKey: string
  private readonly fieldStateKey: string
  private readonly fieldCheckpointKey: string
  private readonly surfaceProviderKey: string
  private readonly assetManifestKey: string
  private readonly assetPlacementsKey: string
  private readonly provenanceKey: string
  private readonly terrainDeformationKey: string
  private readonly terrainDeformationCheckpointKey: string
  private readonly saveTransactionKey: string
  private saveTransactionDepth = 0
  private saveTransactionFailed = false
  private readonly loaded = new Set<string>()
  private readonly cache = new Map<string, WorldObject[]>()

  constructor(private readonly seed: string) {
    this.prefix = `reality-engine-world:${seed}:chunk:`
    this.manifestKey = `reality-engine-world:${seed}:manifest`
    this.fieldStateKey = `reality-engine-world:${seed}:field-state`
    this.fieldCheckpointKey = `reality-engine-world:${seed}:field-checkpoint`
    this.surfaceProviderKey = `reality-engine-world:${seed}:surface-provider`
    this.assetManifestKey = `reality-engine-world:${seed}:asset-manifest`
    this.assetPlacementsKey = `reality-engine-world:${seed}:asset-placements`
    this.provenanceKey = `reality-engine-world:${seed}:provenance`
    this.terrainDeformationKey = `reality-engine-world:${seed}:terrain-deformation`
    this.terrainDeformationCheckpointKey = `reality-engine-world:${seed}:terrain-deformation-checkpoint`
    this.saveTransactionKey = `reality-engine-world:${seed}:save-transaction`
  }

  private key(cx: number, cy: number, cz: number) {
    return this.prefix + chunkKey(cx, cy, cz)
  }

  /** True when a prior multi-key world save did not reach its commit point. */
  hasIncompleteSaveTransaction(): boolean {
    if (this.saveTransactionDepth > 0) return false
    try {
      return localStorage.getItem(this.saveTransactionKey) !== null
    } catch {
      // If the marker cannot be inspected, restoration must fail closed.
      return true
    }
  }

  /**
   * Open a crash-recovery barrier around a multi-key world mutation.
   * An interrupted transaction blocks later restores until an explicit full
   * import or clear operation repairs the namespace.
   */
  beginSaveTransaction(options: { recoverIncomplete?: boolean } = {}): boolean {
    if (this.saveTransactionDepth > 0) {
      this.saveTransactionDepth += 1
      return true
    }
    try {
      const existing = localStorage.getItem(this.saveTransactionKey)
      if (existing !== null && !options.recoverIncomplete) return false
      localStorage.setItem(this.saveTransactionKey, JSON.stringify({
        version: 1,
        seed: this.seed,
        startedAt: Date.now(),
      }))
      this.saveTransactionDepth = 1
      this.saveTransactionFailed = false
      return true
    } catch {
      return false
    }
  }

  /** Finish one nesting level; only the outer successful commit clears the marker. */
  finishSaveTransaction(success: boolean): boolean {
    if (this.saveTransactionDepth <= 0) return false
    if (!success) this.saveTransactionFailed = true
    this.saveTransactionDepth -= 1
    if (this.saveTransactionDepth > 0) {
      return success && !this.saveTransactionFailed
    }

    const committed = !this.saveTransactionFailed
    this.saveTransactionFailed = false
    if (!committed) return false

    try {
      localStorage.removeItem(this.saveTransactionKey)
      return localStorage.getItem(this.saveTransactionKey) === null
    } catch {
      return false
    }
  }

  /**
   * Persist the authoritative field without allowing browser storage failures
   * (quota/security/private-mode restrictions) to escape into the runtime.
   * false means the in-memory field changed but durable persistence failed.
   */
  saveFieldState(state: unknown): boolean {
    try {
      const payload = { version: 1, seed: this.seed, state }
      localStorage.setItem(this.fieldStateKey, JSON.stringify(payload))
      return true
    } catch {
      return false
    }
  }

  loadFieldState<T = unknown>(): T | null {
    if (this.hasIncompleteSaveTransaction()) return null

    try {
      const raw = localStorage.getItem(this.fieldStateKey)
      if (!raw) return null
      const payload = JSON.parse(raw) as {version:number;seed:string;state:T}
      if (payload.version !== 1 || payload.seed !== this.seed) return null
      return payload.state
    } catch {
      return null
    }
  }

  saveFieldCheckpoint(state: unknown): boolean {
    try {
      const payload = { version: 1, seed: this.seed, state }
      localStorage.setItem(this.fieldCheckpointKey, JSON.stringify(payload))
      return true
    } catch {
      return false
    }
  }

  loadFieldCheckpoint<T = unknown>(): T | null {
    if (this.hasIncompleteSaveTransaction()) return null

    try {
      const raw = localStorage.getItem(this.fieldCheckpointKey)
      if (!raw) return null
      const payload = JSON.parse(raw) as { version: number; seed: string; state: T }
      if (payload.version !== 1 || payload.seed !== this.seed) return null
      return payload.state
    } catch {
      return null
    }
  }

  deleteFieldCheckpoint(): boolean {
    try {
      localStorage.removeItem(this.fieldCheckpointKey)
      return true
    } catch {
      return false
    }
  }

  deleteFieldState(): boolean {
    try {
      localStorage.removeItem(this.fieldStateKey)
      return true
    } catch {
      return false
    }
  }

  /** Persist a versioned, serializable world-surface provider snapshot. */
  saveSurfaceProviderState(state: unknown): boolean {
    try {
      localStorage.setItem(this.surfaceProviderKey, JSON.stringify({
        version: 1,
        seed: this.seed,
        state,
      }))
      return true
    } catch {
      return false
    }
  }

  loadSurfaceProviderState<T = unknown>(): T | null {
    if (this.hasIncompleteSaveTransaction()) return null

    let raw: string | null
    try {
      raw = localStorage.getItem(this.surfaceProviderKey)
    } catch {
      return null
    }
    if (!raw) return null
    try {
      const payload = JSON.parse(raw) as { version: number; seed: string; state: T }
      if (payload.version !== 1 || payload.seed !== this.seed ||
          !payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) {
        localStorage.removeItem(this.surfaceProviderKey)
        return null
      }
      return payload.state
    } catch {
      try { localStorage.removeItem(this.surfaceProviderKey) } catch {}
      return null
    }
  }

  deleteSurfaceProviderState(): boolean {
    try {
      localStorage.removeItem(this.surfaceProviderKey)
      return true
    } catch {
      return false
    }
  }

  /** Persist asset source/licensing metadata without downloading external resources. */
  saveAssetManifestState(state: unknown): boolean {
    try {
      localStorage.setItem(this.assetManifestKey, JSON.stringify({
        version: 1,
        seed: this.seed,
        state,
      }))
      return true
    } catch {
      return false
    }
  }

  loadAssetManifestState<T = unknown>(): T | null {
    if (this.hasIncompleteSaveTransaction()) return null

    let raw: string | null
    try {
      raw = localStorage.getItem(this.assetManifestKey)
    } catch {
      return null
    }
    if (!raw) return null
    try {
      const payload = JSON.parse(raw) as { version: number; seed: string; state: T }
      if (payload.version !== 1 || payload.seed !== this.seed ||
          !payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) {
        localStorage.removeItem(this.assetManifestKey)
        return null
      }
      return payload.state
    } catch {
      try { localStorage.removeItem(this.assetManifestKey) } catch {}
      return null
    }
  }

  deleteAssetManifestState(): boolean {
    try {
      localStorage.removeItem(this.assetManifestKey)
      return true
    } catch {
      return false
    }
  }

  /** Persist external asset placement intent without storing or fetching GLTF binaries. */
  saveAssetPlacementsState(state: unknown): boolean {
    try {
      localStorage.setItem(this.assetPlacementsKey, JSON.stringify({
        version: 1,
        seed: this.seed,
        state,
      }))
      return true
    } catch {
      return false
    }
  }

  loadAssetPlacementsState<T = unknown>(): T | null {
    if (this.hasIncompleteSaveTransaction()) return null

    let raw: string | null
    try {
      raw = localStorage.getItem(this.assetPlacementsKey)
    } catch {
      return null
    }
    if (!raw) return null
    try {
      const payload = JSON.parse(raw) as { version: number; seed: string; state: T }
      if (payload.version !== 1 || payload.seed !== this.seed ||
          !Array.isArray(payload.state)) {
        localStorage.removeItem(this.assetPlacementsKey)
        return null
      }
      return payload.state
    } catch {
      try { localStorage.removeItem(this.assetPlacementsKey) } catch {}
      return null
    }
  }

  deleteAssetPlacementsState(): boolean {
    try {
      localStorage.removeItem(this.assetPlacementsKey)
      return true
    } catch {
      return false
    }
  }

  /** Persist the causal provenance trace for this world seed. */
  saveProvenanceState(state: unknown): boolean {
    try {
      localStorage.setItem(this.provenanceKey, JSON.stringify({
        version: 1,
        seed: this.seed,
        state,
      }))
      return true
    } catch {
      return false
    }
  }

  loadProvenanceState<T = unknown>(): T | null {
    if (this.hasIncompleteSaveTransaction()) return null

    let raw: string | null
    try {
      raw = localStorage.getItem(this.provenanceKey)
    } catch {
      return null
    }
    if (!raw) return null
    try {
      const payload = JSON.parse(raw) as { version: number; seed: string; state: T }
      if (payload.version !== 1 || payload.seed !== this.seed ||
          !payload.state || typeof payload.state !== 'object' || Array.isArray(payload.state)) {
        localStorage.removeItem(this.provenanceKey)
        return null
      }
      return payload.state
    } catch {
      try { localStorage.removeItem(this.provenanceKey) } catch {}
      return null
    }
  }

  deleteProvenanceState(): boolean {
    try {
      localStorage.removeItem(this.provenanceKey)
      return true
    } catch {
      return false
    }
  }

  saveTerrainDeformationState(state: unknown): boolean {
    try {
      localStorage.setItem(this.terrainDeformationKey, JSON.stringify({ version: 1, seed: this.seed, state }))
      return true
    } catch {
      return false
    }
  }

  loadTerrainDeformationState<T = unknown>(): T | null {
    if (this.hasIncompleteSaveTransaction()) return null

    try {
      const raw = localStorage.getItem(this.terrainDeformationKey)
      if (!raw) return null
      const payload = JSON.parse(raw) as { version: number; seed: string; state: T }
      if (payload.version !== 1 || payload.seed !== this.seed) return null
      return payload.state
    } catch {
      return null
    }
  }

  saveTerrainDeformationCheckpoint(state: unknown): boolean {
    try {
      localStorage.setItem(this.terrainDeformationCheckpointKey, JSON.stringify({ version: 1, seed: this.seed, state }))
      return true
    } catch {
      return false
    }
  }

  loadTerrainDeformationCheckpoint<T = unknown>(): T | null {
    if (this.hasIncompleteSaveTransaction()) return null

    try {
      const raw = localStorage.getItem(this.terrainDeformationCheckpointKey)
      if (!raw) return null
      const payload = JSON.parse(raw) as { version: number; seed: string; state: T }
      if (payload.version !== 1 || payload.seed !== this.seed) return null
      return payload.state
    } catch {
      return null
    }
  }

  deleteTerrainDeformationState(): boolean {
    try {
      localStorage.removeItem(this.terrainDeformationKey)
      return true
    } catch {
      return false
    }
  }

  /**
   * Cache the live chunk even if browser storage is unavailable, but report
   * whether both the chunk payload and its manifest entry became durable.
   */
  saveChunk(cx: number, cy: number, cz: number, objects: WorldObject[]): boolean {
    const payload: StoredChunk = { version: 1, seed: this.seed, objects }
    const key = chunkKey(cx, cy, cz)
    let chunkSaved = false
    try {
      localStorage.setItem(this.key(cx, cy, cz), JSON.stringify(payload))
      chunkSaved = true
    } catch {
      // The cache remains usable, but callers must be told persistence failed.
    }
    this.cache.set(key, objects)
    this.loaded.add(key)
    if (!chunkSaved) return false
    return this.updateManifest()
  }

  loadChunk(cx: number, cy: number, cz: number): WorldObject[] {
    if (this.hasIncompleteSaveTransaction()) return []

    const key = chunkKey(cx, cy, cz)
    const cached = this.cache.get(key)
    if (cached) return cached
    let raw: string | null
    try {
      raw = localStorage.getItem(this.key(cx, cy, cz))
    } catch {
      this.loaded.add(key)
      return []
    }
    this.loaded.add(key)
    if (!raw) return []
    try {
      const payload = JSON.parse(raw) as StoredChunk
      if (payload.version !== 1 || payload.seed !== this.seed || !Array.isArray(payload.objects)) return []
      this.cache.set(key, payload.objects)
      return payload.objects
    } catch {
      return []
    }
  }

  unloadChunk(cx: number, cy: number, cz: number) {
    const key = chunkKey(cx, cy, cz)
    this.loaded.delete(key)
    this.cache.delete(key)
  }

  /**
   * Only forget a chunk in memory after its stored payload was actually
   * removed. A failed remove must remain visible to callers and retain cache.
   */
  deleteChunk(cx: number, cy: number, cz: number): boolean {
    const key = chunkKey(cx, cy, cz)
    try {
      localStorage.removeItem(this.key(cx, cy, cz))
    } catch {
      return false
    }
    this.loaded.delete(key)
    this.cache.delete(key)
    return this.updateManifest(key)
  }

  /**
   * Remove persisted world data, including orphaned chunks omitted from a stale
   * or corrupt manifest. Returns false when storage prevented a complete clear.
   */
  clear(): boolean {
    let cleared = true
    const scannedChunkKeys = this.scanStoredChunkStorageKeys()
    if (scannedChunkKeys === null) {
      // Without a complete key scan, orphaned chunks cannot be distinguished
      // from manifest entries. Leave durable records untouched, but detach the
      // renderer from cached chunks so stale objects cannot reappear in memory.
      this.loaded.clear()
      this.cache.clear()
      return false
    }
    if (!this.beginSaveTransaction({ recoverIncomplete: true })) {
      // A failed durable clear must still detach the renderer from its in-memory
      // chunk cache; persisted records remain untouched and the caller gets false.
      this.loaded.clear()
      this.cache.clear()
      return false
    }
    const chunkStorageKeys = new Set(scannedChunkKeys)

    let raw: string | null = null
    try {
      raw = localStorage.getItem(this.manifestKey)
    } catch {
      cleared = false
    }
    if (raw) {
      try {
        const keys: unknown = JSON.parse(raw)
        if (Array.isArray(keys)) {
          for (const key of keys) {
            if (this.isValidChunkKey(key)) chunkStorageKeys.add(this.prefix + key)
          }
        }
      } catch {
        // The storage scan above is the recovery path for corrupt manifests.
      }
    }

    for (const key of chunkStorageKeys) {
      try {
        localStorage.removeItem(key)
      } catch {
        cleared = false
      }
    }
    for (const key of [
      this.manifestKey,
      this.fieldStateKey,
      this.fieldCheckpointKey,
      this.surfaceProviderKey,
      this.assetManifestKey,
      this.assetPlacementsKey,
      this.provenanceKey,
      this.terrainDeformationKey,
      this.terrainDeformationCheckpointKey,
    ]) {
      try {
        localStorage.removeItem(key)
      } catch {
        cleared = false
      }
    }
    this.loaded.clear()
    this.cache.clear()
    const committed = this.finishSaveTransaction(cleared)
    return cleared && committed
  }

  chunkForObject(object: WorldObject) {
    return worldToChunk(object.x, object.y, object.z).chunk
  }

  isLoaded(cx: number, cy: number, cz: number) { return this.loaded.has(chunkKey(cx, cy, cz)) }

  loadedChunks(): string[] { return [...this.loaded] }

  knownChunks(options: { recoverOrphans?: boolean } = {}): string[] {
    if (this.hasIncompleteSaveTransaction()) return []

    let raw: string | null
    try {
      raw = localStorage.getItem(this.manifestKey)
    } catch {
      return options.recoverOrphans ? this.scanStoredChunkKeys() : []
    }

    let keys: string[] = []
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          keys = parsed.filter((key): key is string => this.isValidChunkKey(key))
        } else if (!options.recoverOrphans) {
          return []
        }
      } catch {
        if (!options.recoverOrphans) return []
      }
    }

    if (!options.recoverOrphans) return [...new Set(keys)]
    // The manifest is an index, not the chunk data itself. Recover valid chunk
    // payloads that were written successfully just before a manifest write failed.
    return [...new Set([...keys, ...this.scanStoredChunkKeys()])]
  }

  private isValidChunkKey(value: unknown): value is string {
    if (typeof value !== 'string' || value.split(',').length !== 3) return false
    const [cx, cy, cz] = value.split(',').map(Number)
    return [cx, cy, cz].every(Number.isSafeInteger) && chunkKey(cx, cy, cz) === value
  }

  private scanStoredChunkStorageKeys(): string[] | null {
    const keys: string[] = []
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const storageKey = localStorage.key(index)
        if (storageKey?.startsWith(this.prefix)) keys.push(storageKey)
      }
    } catch {
      // Storage enumeration can be blocked just like reads and writes.
      return null
    }
    return [...new Set(keys)]
  }

  private scanStoredChunkKeys(): string[] {
    const storageKeys = this.scanStoredChunkStorageKeys()
    if (storageKeys === null) return []
    return [...new Set(storageKeys
      .map(storageKey => storageKey.slice(this.prefix.length))
      .filter((key): key is string => this.isValidChunkKey(key)))]
  }

  private updateManifest(removeKey?: string): boolean {
    let raw: string | null
    try {
      raw = localStorage.getItem(this.manifestKey)
    } catch {
      return false
    }
    let keys: string[]
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : []
      if (!Array.isArray(parsed)) return false
      keys = parsed.filter((key): key is string => this.isValidChunkKey(key))
    } catch {
      // Do not overwrite a corrupt manifest with a partial index.
      return false
    }
    const present = new Set(keys)
    for (const key of this.loaded) present.add(key)
    if (removeKey) present.delete(removeKey)
    try {
      localStorage.setItem(this.manifestKey, JSON.stringify([...present]))
      return true
    } catch {
      return false
    }
  }
}
