import { chunkKey, worldToChunk } from './WorldCoordinate'
import type { WorldObject } from './WorldObject'

type StoredChunk = { version: 1; seed: string; objects: WorldObject[] }

export class WorldPersistence {
  private readonly prefix: string
  private readonly manifestKey: string
  private readonly fieldStateKey: string
  private readonly fieldCheckpointKey: string
  private readonly loaded = new Set<string>()
  private readonly cache = new Map<string, WorldObject[]>()

  constructor(private readonly seed: string) {
    this.prefix = `reality-engine-world:${seed}:chunk:`
    this.manifestKey = `reality-engine-world:${seed}:manifest`
    this.fieldStateKey = `reality-engine-world:${seed}:field-state`
    this.fieldCheckpointKey = `reality-engine-world:${seed}:field-checkpoint`
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

  saveChunk(cx: number, cy: number, cz: number, objects: WorldObject[]) {
    const payload: StoredChunk = { version: 1, seed: this.seed, objects }
    const key = chunkKey(cx, cy, cz)
    localStorage.setItem(this.key(cx, cy, cz), JSON.stringify(payload))
    this.cache.set(key, objects)
    this.loaded.add(key)
    this.updateManifest()
    return objects.length
  }

  loadChunk(cx: number, cy: number, cz: number): WorldObject[] {
    const key = chunkKey(cx, cy, cz)
    const cached = this.cache.get(key)
    if (cached) return cached
    const raw = localStorage.getItem(this.key(cx, cy, cz))
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
    localStorage.removeItem(this.key(cx, cy, cz))
    this.loaded.delete(key)
    this.cache.delete(key)
    this.updateManifest()
  }

  clear() {
    const raw = localStorage.getItem(this.manifestKey)
    if (raw) {
      try {
        const keys = JSON.parse(raw) as string[]
        for (const key of keys) localStorage.removeItem(this.prefix + key)
      } catch {}
    }
    localStorage.removeItem(this.manifestKey)
    localStorage.removeItem(this.fieldStateKey)
    localStorage.removeItem(this.fieldCheckpointKey)
    this.loaded.clear()
    this.cache.clear()
  }

  chunkForObject(object: WorldObject) {
    return worldToChunk(object.x, object.y, object.z).chunk
  }

  isLoaded(cx: number, cy: number, cz: number) { return this.loaded.has(chunkKey(cx, cy, cz)) }

  loadedChunks(): string[] { return [...this.loaded] }

  knownChunks(): string[] {
    const raw = localStorage.getItem(this.manifestKey)
    if (!raw) return []
    try {
      const keys = JSON.parse(raw)
      return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : []
    } catch {
      return []
    }
  }

  private updateManifest() {
    const raw = localStorage.getItem(this.manifestKey)
    let keys: string[] = []
    try {
      const parsed = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) keys = parsed.filter((k): k is string => typeof k === 'string')
    } catch {}
    const present = new Set(keys)
    for (const key of this.loaded) present.add(key)
    localStorage.setItem(this.manifestKey, JSON.stringify([...present]))
  }
}
