import { chunkKey, worldToChunk } from './WorldCoordinate'
import type { WorldObject } from './WorldObject'

type StoredChunk = { version: 1; seed: string; objects: WorldObject[] }

export class WorldPersistence {
  private readonly prefix: string
  private readonly manifestKey: string
  private readonly fieldStateKey: string
  private readonly fieldCheckpointKey: string
  private readonly terrainDeformationKey: string
  private readonly terrainDeformationCheckpointKey: string
  private readonly loaded = new Set<string>()
  private readonly cache = new Map<string, WorldObject[]>()

  constructor(private readonly seed: string) {
    this.prefix = `reality-engine-world:${seed}:chunk:`
    this.manifestKey = `reality-engine-world:${seed}:manifest`
    this.fieldStateKey = `reality-engine-world:${seed}:field-state`
    this.fieldCheckpointKey = `reality-engine-world:${seed}:field-checkpoint`
    this.terrainDeformationKey = `reality-engine-world:${seed}:terrain-deformation`
    this.terrainDeformationCheckpointKey = `reality-engine-world:${seed}:terrain-deformation-checkpoint`
  }

  private key(cx: number, cy: number, cz: number) {
    return this.prefix + chunkKey(cx, cy, cz)
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

  saveTerrainDeformationState(state: unknown): boolean {
    try {
      localStorage.setItem(this.terrainDeformationKey, JSON.stringify({ version: 1, seed: this.seed, state }))
      return true
    } catch {
      return false
    }
  }

  loadTerrainDeformationState<T = unknown>(): T | null {
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

  saveChunk(cx: number, cy: number, cz: number, objects: WorldObject[]) {
    const payload: StoredChunk = { version: 1, seed: this.seed, objects }
    const key = chunkKey(cx, cy, cz)
    try {
      localStorage.setItem(this.key(cx, cy, cz), JSON.stringify(payload))
    } catch {
      // Keep the live chunk usable when durable browser storage is unavailable.
    }
    this.cache.set(key, objects)
    this.loaded.add(key)
    this.updateManifest()
    return objects.length
  }

  loadChunk(cx: number, cy: number, cz: number): WorldObject[] {
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

  deleteChunk(cx: number, cy: number, cz: number) {
    const key = chunkKey(cx, cy, cz)
    try {
      localStorage.removeItem(this.key(cx, cy, cz))
    } catch {
      // Remove the in-memory copy even when browser storage is unavailable.
    }
    this.loaded.delete(key)
    this.cache.delete(key)
    this.updateManifest(key)
  }

  clear() {
    let raw: string | null = null
    try {
      raw = localStorage.getItem(this.manifestKey)
    } catch {
      // Storage may be disabled; still clear the in-memory cache below.
    }
    if (raw) {
      try {
        const keys = JSON.parse(raw) as unknown
        if (Array.isArray(keys)) {
          for (const key of keys) {
            if (typeof key !== 'string' || key.split(',').length !== 3 || !key.split(',').every(part => Number.isSafeInteger(Number(part)))) continue
            try { localStorage.removeItem(this.prefix + key) } catch {}
          }
        }
      } catch {}
    }
    for (const key of [
      this.manifestKey,
      this.fieldStateKey,
      this.fieldCheckpointKey,
      this.terrainDeformationKey,
      this.terrainDeformationCheckpointKey,
    ]) {
      try { localStorage.removeItem(key) } catch {}
    }
    this.loaded.clear()
    this.cache.clear()
  }

  chunkForObject(object: WorldObject) {
    return worldToChunk(object.x, object.y, object.z).chunk
  }

  isLoaded(cx: number, cy: number, cz: number) { return this.loaded.has(chunkKey(cx, cy, cz)) }

  loadedChunks(): string[] { return [...this.loaded] }

  knownChunks(): string[] {
    let raw: string | null
    try {
      raw = localStorage.getItem(this.manifestKey)
    } catch {
      return []
    }
    if (!raw) return []
    try {
      const keys = JSON.parse(raw)
      return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : []
    } catch {
      return []
    }
  }

  private updateManifest(removeKey?: string) {
    let raw: string | null
    try {
      raw = localStorage.getItem(this.manifestKey)
    } catch {
      return
    }
    let keys: string[] = []
    try {
      const parsed = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) keys = parsed.filter((k): k is string => typeof k === 'string')
    } catch {}
    const present = new Set(keys)
    for (const key of this.loaded) present.add(key)
    if (removeKey) present.delete(removeKey)
    try {
      localStorage.setItem(this.manifestKey, JSON.stringify([...present]))
    } catch {
      // The manifest is an index only; in-memory state remains usable.
    }
  }
}
