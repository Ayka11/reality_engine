import { chunkKey, worldToChunk } from './WorldCoordinate'
import type { WorldObject } from './WorldObject'

type StoredChunk = { version: 1; seed: string; objects: WorldObject[] }

export type WorldChunkReadResult =
  | { status: 'ok'; objects: WorldObject[] }
  | { status: 'missing'; objects: []; reason: string }
  | { status: 'unavailable'; objects: []; reason: string }
  | { status: 'corrupt'; objects: []; reason: string }

export type WorldStateReadResult<T> =
  | { status: 'ok'; state: T }
  | { status: 'missing'; reason: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'corrupt'; reason: string }

function isStoredWorldObject(value: unknown): value is WorldObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const object = value as Partial<WorldObject>
  if (typeof object.id !== 'string' || !object.id.trim() ||
      typeof object.kind !== 'string' ||
      ![object.x, object.y, object.z, object.rotationY, object.scale, object.seed].every(Number.isFinite) ||
      (object.scale as number) <= 0 ||
      !object.properties || typeof object.properties !== 'object' || Array.isArray(object.properties)) {
    return false
  }
  return Object.values(object.properties).every(entry =>
    typeof entry === 'string' || typeof entry === 'boolean' ||
    (typeof entry === 'number' && Number.isFinite(entry)))
}

export const ACTIVE_WORLD_SEED_STORAGE_KEY = 'reality-engine-active-world-seed'
const MAX_ACTIVE_WORLD_SEED_LENGTH = 512

function isValidActiveWorldSeed(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ACTIVE_WORLD_SEED_LENGTH &&
    value.trim() === value
}

export type ActiveWorldSeedReadResult =
  | { status: 'ok'; seed: string }
  | { status: 'missing'; seed: string }
  | { status: 'corrupt'; seed: string; reason: string }
  | { status: 'unavailable'; seed: string; reason: string }

/** Read the namespace selector without confusing storage failure with an absent selector. */
export function readActiveWorldSeed(fallback: string): ActiveWorldSeedReadResult {
  const safeFallback = isValidActiveWorldSeed(fallback) ? fallback : 'reality-seed-1'
  let saved: string | null
  try {
    saved = localStorage.getItem(ACTIVE_WORLD_SEED_STORAGE_KEY)
  } catch {
    return { status: 'unavailable', seed: safeFallback, reason: 'storage-read-failed' }
  }
  if (saved === null) return { status: 'missing', seed: safeFallback }
  if (isValidActiveWorldSeed(saved)) return { status: 'ok', seed: saved }
  try {
    localStorage.removeItem(ACTIVE_WORLD_SEED_STORAGE_KEY)
  } catch {
    return { status: 'unavailable', seed: safeFallback, reason: 'invalid-selector-could-not-be-cleared' }
  }
  return { status: 'corrupt', seed: safeFallback, reason: 'invalid-active-world-seed' }
}

/** Compatibility wrapper for callers that only need a usable seed string. */
export function loadActiveWorldSeed(fallback: string): string {
  return readActiveWorldSeed(fallback).seed
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
  private readonly missingChunks = new Set<string>()
  private readonly corruptChunks = new Map<string, string>()

  constructor(private readonly seed: string, private readonly readsBlocked = false) {
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

  private readWrappedState<T>(
    key: string,
    validateState?: (state: unknown) => boolean,
  ): WorldStateReadResult<T> {
    if (this.readsBlocked) return { status: 'unavailable', reason: 'active-world-seed-unavailable' }
    if (this.hasIncompleteSaveTransaction()) {
      return { status: 'unavailable', reason: 'incomplete-save-transaction' }
    }

    let raw: string | null
    try {
      raw = localStorage.getItem(key)
    } catch {
      return { status: 'unavailable', reason: 'storage-read-failed' }
    }
    if (raw === null) return { status: 'missing', reason: 'state-not-found' }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { status: 'corrupt', reason: 'invalid-json' }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { status: 'corrupt', reason: 'invalid-state-envelope' }
    }

    const payload = parsed as Record<string, unknown>
    if (payload.version !== 1 || payload.seed !== this.seed ||
        !Object.prototype.hasOwnProperty.call(payload, 'state')) {
      return { status: 'corrupt', reason: 'invalid-version-seed-or-state-envelope' }
    }
    if (validateState && !validateState(payload.state)) {
      return { status: 'corrupt', reason: 'invalid-state-payload' }
    }
    return { status: 'ok', state: payload.state as T }
  }

  private isRecordState(state: unknown): boolean {
    return Boolean(state && typeof state === 'object' && !Array.isArray(state))
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
    if (this.readsBlocked) return false
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
    if (this.readsBlocked) return false
    try {
      const payload = { version: 1, seed: this.seed, state }
      localStorage.setItem(this.fieldStateKey, JSON.stringify(payload))
      return true
    } catch {
      return false
    }
  }

  readFieldState<T = unknown>(): WorldStateReadResult<T> {
    return this.readWrappedState<T>(this.fieldStateKey, state => this.isRecordState(state))
  }

  loadFieldState<T = unknown>(): T | null {
    const result = this.readFieldState<T>()
    return result.status === 'ok' ? result.state : null
  }

  saveFieldCheckpoint(state: unknown): boolean {
    if (this.readsBlocked) return false
    try {
      const payload = { version: 1, seed: this.seed, state }
      localStorage.setItem(this.fieldCheckpointKey, JSON.stringify(payload))
      return true
    } catch {
      return false
    }
  }

  readFieldCheckpoint<T = unknown>(): WorldStateReadResult<T> {
    return this.readWrappedState<T>(this.fieldCheckpointKey, state => this.isRecordState(state))
  }

  loadFieldCheckpoint<T = unknown>(): T | null {
    const result = this.readFieldCheckpoint<T>()
    return result.status === 'ok' ? result.state : null
  }

  deleteFieldCheckpoint(): boolean {
    if (this.readsBlocked) return false
    try {
      localStorage.removeItem(this.fieldCheckpointKey)
      return true
    } catch {
      return false
    }
  }

  deleteFieldState(): boolean {
    if (this.readsBlocked) return false
    try {
      localStorage.removeItem(this.fieldStateKey)
      return true
    } catch {
      return false
    }
  }

  /** Persist a versioned, serializable world-surface provider snapshot. */
  saveSurfaceProviderState(state: unknown): boolean {
    if (this.readsBlocked) return false
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

  readSurfaceProviderState<T = unknown>(): WorldStateReadResult<T> {
    return this.readWrappedState<T>(this.surfaceProviderKey, state => this.isRecordState(state))
  }

  loadSurfaceProviderState<T = unknown>(): T | null {
    const result = this.readSurfaceProviderState<T>()
    return result.status === 'ok' ? result.state : null
  }

  deleteSurfaceProviderState(): boolean {
    if (this.readsBlocked) return false
    try {
      localStorage.removeItem(this.surfaceProviderKey)
      return true
    } catch {
      return false
    }
  }

  /** Persist asset source/licensing metadata without downloading external resources. */
  saveAssetManifestState(state: unknown): boolean {
    if (this.readsBlocked) return false
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

  readAssetManifestState<T = unknown>(): WorldStateReadResult<T> {
    return this.readWrappedState<T>(this.assetManifestKey, state => this.isRecordState(state))
  }

  loadAssetManifestState<T = unknown>(): T | null {
    const result = this.readAssetManifestState<T>()
    return result.status === 'ok' ? result.state : null
  }

  deleteAssetManifestState(): boolean {
    if (this.readsBlocked) return false
    try {
      localStorage.removeItem(this.assetManifestKey)
      return true
    } catch {
      return false
    }
  }

  /** Persist external asset placement intent without storing or fetching GLTF binaries. */
  saveAssetPlacementsState(state: unknown): boolean {
    if (this.readsBlocked) return false
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

  readAssetPlacementsState<T = unknown>(): WorldStateReadResult<T> {
    return this.readWrappedState<T>(this.assetPlacementsKey, state => Array.isArray(state))
  }

  loadAssetPlacementsState<T = unknown>(): T | null {
    const result = this.readAssetPlacementsState<T>()
    return result.status === 'ok' ? result.state : null
  }

  deleteAssetPlacementsState(): boolean {
    if (this.readsBlocked) return false
    try {
      localStorage.removeItem(this.assetPlacementsKey)
      return true
    } catch {
      return false
    }
  }

  /** Persist the causal provenance trace for this world seed. */
  saveProvenanceState(state: unknown): boolean {
    if (this.readsBlocked) return false
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

  readProvenanceState<T = unknown>(): WorldStateReadResult<T> {
    return this.readWrappedState<T>(this.provenanceKey, state => this.isRecordState(state))
  }

  loadProvenanceState<T = unknown>(): T | null {
    const result = this.readProvenanceState<T>()
    return result.status === 'ok' ? result.state : null
  }

  deleteProvenanceState(): boolean {
    if (this.readsBlocked) return false
    try {
      localStorage.removeItem(this.provenanceKey)
      return true
    } catch {
      return false
    }
  }

  saveTerrainDeformationState(state: unknown): boolean {
    if (this.readsBlocked) return false
    try {
      localStorage.setItem(this.terrainDeformationKey, JSON.stringify({ version: 1, seed: this.seed, state }))
      return true
    } catch {
      return false
    }
  }

  readTerrainDeformationState<T = unknown>(): WorldStateReadResult<T> {
    return this.readWrappedState<T>(this.terrainDeformationKey, state => this.isRecordState(state))
  }

  loadTerrainDeformationState<T = unknown>(): T | null {
    const result = this.readTerrainDeformationState<T>()
    return result.status === 'ok' ? result.state : null
  }

  saveTerrainDeformationCheckpoint(state: unknown): boolean {
    if (this.readsBlocked) return false
    try {
      localStorage.setItem(this.terrainDeformationCheckpointKey, JSON.stringify({ version: 1, seed: this.seed, state }))
      return true
    } catch {
      return false
    }
  }

  readTerrainDeformationCheckpoint<T = unknown>(): WorldStateReadResult<T> {
    return this.readWrappedState<T>(this.terrainDeformationCheckpointKey, state => this.isRecordState(state))
  }

  loadTerrainDeformationCheckpoint<T = unknown>(): T | null {
    const result = this.readTerrainDeformationCheckpoint<T>()
    return result.status === 'ok' ? result.state : null
  }

  deleteTerrainDeformationState(): boolean {
    if (this.readsBlocked) return false
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
    if (this.readsBlocked) return false
    // Never persist a payload that the strict restore path would reject later.
    if (!Array.isArray(objects) || !objects.every(isStoredWorldObject)) return false
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
    return this.updateManifest(key)
  }

  /**
   * Read a persisted chunk without collapsing missing, unavailable and corrupt
   * storage into the same empty-array result.
   */
  readChunk(cx: number, cy: number, cz: number): WorldChunkReadResult {
    if (this.readsBlocked) {
      return { status: 'unavailable', objects: [], reason: 'active-world-seed-unavailable' }
    }
    if (this.hasIncompleteSaveTransaction()) {
      return { status: 'unavailable', objects: [], reason: 'incomplete-save-transaction' }
    }

    const key = chunkKey(cx, cy, cz)
    if (this.cache.has(key)) {
      return { status: 'ok', objects: this.cache.get(key)! }
    }
    if (this.missingChunks.has(key)) {
      return { status: 'missing', objects: [], reason: 'chunk-payload-not-found' }
    }
    const corruptReason = this.corruptChunks.get(key)
    if (corruptReason) {
      return { status: 'corrupt', objects: [], reason: corruptReason }
    }

    let raw: string | null
    try {
      raw = localStorage.getItem(this.key(cx, cy, cz))
    } catch {
      // Do not mark inaccessible data as loaded; the next streaming pass may retry.
      return { status: 'unavailable', objects: [], reason: 'storage-read-failed' }
    }
    if (raw === null) {
      this.loaded.add(key)
      this.missingChunks.add(key)
      return { status: 'missing', objects: [], reason: 'chunk-payload-not-found' }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      const reason = 'invalid-json'
      this.loaded.add(key)
      this.corruptChunks.set(key, reason)
      return { status: 'corrupt', objects: [], reason }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const reason = 'invalid-payload-envelope'
      this.loaded.add(key)
      this.corruptChunks.set(key, reason)
      return { status: 'corrupt', objects: [], reason }
    }
    const payload = parsed as Partial<StoredChunk>
    if (payload.version !== 1 || payload.seed !== this.seed || !Array.isArray(payload.objects)) {
      const reason = 'unsupported-version-seed-or-object-list'
      this.loaded.add(key)
      this.corruptChunks.set(key, reason)
      return { status: 'corrupt', objects: [], reason }
    }
    if (!payload.objects.every(isStoredWorldObject)) {
      const reason = 'invalid-world-object-record'
      this.loaded.add(key)
      this.corruptChunks.set(key, reason)
      return { status: 'corrupt', objects: [], reason }
    }

    this.loaded.add(key)
    this.cache.set(key, payload.objects)
    return { status: 'ok', objects: payload.objects }
  }

  /** Legacy array API for streaming callers; use readChunk when status matters. */
  loadChunk(cx: number, cy: number, cz: number): WorldObject[] {
    const result = this.readChunk(cx, cy, cz)
    return result.status === 'ok' ? result.objects : []
  }

  unloadChunk(cx: number, cy: number, cz: number) {
    const key = chunkKey(cx, cy, cz)
    this.loaded.delete(key)
    this.cache.delete(key)
    this.missingChunks.delete(key)
    this.corruptChunks.delete(key)
  }

  /**
   * Only forget a chunk in memory after its stored payload was actually
   * removed. A failed remove must remain visible to callers and retain cache.
   */
  deleteChunk(cx: number, cy: number, cz: number): boolean {
    if (this.readsBlocked) return false
    const key = chunkKey(cx, cy, cz)
    try {
      localStorage.removeItem(this.key(cx, cy, cz))
    } catch {
      return false
    }
    this.loaded.delete(key)
    this.cache.delete(key)
    this.missingChunks.delete(key)
    this.corruptChunks.delete(key)
    return this.updateManifest(undefined, key)
  }

  /**
   * Remove persisted world data, including orphaned chunks omitted from a stale
   * or corrupt manifest. Returns false when storage prevented a complete clear.
   */
  clear(): boolean {
    if (this.readsBlocked) return false
    let cleared = true
    const scannedChunkKeys = this.scanStoredChunkStorageKeys()
    if (scannedChunkKeys === null) {
      // Without a complete key scan, orphaned chunks cannot be distinguished
      // from manifest entries. Leave durable records untouched, but detach the
      // renderer from cached chunks so stale objects cannot reappear in memory.
      this.loaded.clear()
      this.cache.clear()
      this.missingChunks.clear()
      this.corruptChunks.clear()
      return false
    }
    if (!this.beginSaveTransaction({ recoverIncomplete: true })) {
      // A failed durable clear must still detach the renderer from its in-memory
      // chunk cache; persisted records remain untouched and the caller gets false.
      this.loaded.clear()
      this.cache.clear()
      this.missingChunks.clear()
      this.corruptChunks.clear()
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
    this.missingChunks.clear()
    this.corruptChunks.clear()
    const committed = this.finishSaveTransaction(cleared)
    return cleared && committed
  }

  chunkForObject(object: WorldObject) {
    return worldToChunk(object.x, object.y, object.z).chunk
  }

  isLoaded(cx: number, cy: number, cz: number) { return this.loaded.has(chunkKey(cx, cy, cz)) }

  loadedChunks(): string[] { return [...this.loaded] }

  knownChunks(options: { recoverOrphans?: boolean } = {}): string[] | null {
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
    // A complete payload scan is authoritative. The manifest can contain
    // stale entries from older runtimes that indexed a negative-cache read.
    const scannedChunkKeys = this.scanStoredChunkKeys()
    if (scannedChunkKeys === null) return null
    const durableKeys = [...new Set(scannedChunkKeys)]
    // Best-effort manifest repair: callers still receive the authoritative
    // scanned set when the index itself cannot be rewritten.
    if (JSON.stringify([...new Set(keys)]) !== JSON.stringify(durableKeys)) {
      try {
        localStorage.setItem(this.manifestKey, JSON.stringify(durableKeys))
      } catch {
        // Read recovery remains valid; a later save can retry index repair.
      }
    }
    return durableKeys
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

  private scanStoredChunkKeys(): string[] | null {
    const storageKeys = this.scanStoredChunkStorageKeys()
    if (storageKeys === null) return null
    return [...new Set(storageKeys
      .map(storageKey => storageKey.slice(this.prefix.length))
      .filter((key): key is string => this.isValidChunkKey(key)))]
  }

  private updateManifest(addKey?: string, removeKey?: string): boolean {
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
    if (addKey) present.add(addKey)
    if (removeKey) present.delete(removeKey)
    try {
      localStorage.setItem(this.manifestKey, JSON.stringify([...present]))
      return true
    } catch {
      return false
    }
  }
}
