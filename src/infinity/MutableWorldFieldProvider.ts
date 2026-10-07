import type { ScientificFieldProvider } from './ScientificFieldProvider'
import type { ScientificFieldSample } from './FieldSampler'

export type WorldFieldMutation = {
  id: number
  kind: 'brush' | 'preset' | 'law' | 'composer'
  x?: number
  y?: number
  z?: number
  radius?: number
  delta?: Partial<ScientificFieldSample>
  scale?: Partial<Record<keyof ScientificFieldSample, number>>
  metadata?: Record<string, unknown>
}

export type WorldFieldOverlay = {
  scale: Partial<Record<keyof ScientificFieldSample, number>>
  delta: Partial<ScientificFieldSample>
  metadata?: Record<string, unknown>
}

export type WorldFieldStateSnapshot = {
  schemaVersion: 'world-field-state-v1'
  providerId: string
  providerVersion: string
  version: number
  nextId: number
  mutations: WorldFieldMutation[]
  globalOverlays: Partial<Record<'preset' | 'law' | 'composer', WorldFieldOverlay>>
}

const FIELDS: (keyof ScientificFieldSample)[] = [
  'energy', 'density', 'information', 'entropy', 'temperature', 'biology', 'material',
]

function clampField(name: keyof ScientificFieldSample, value: number): number {
  if (name === 'density' || name === 'entropy' || name === 'biology') return Math.max(0, Math.min(1, value))
  if (name === 'material') return Math.max(0, value)
  return Math.max(0, value)
}

/**
 * Authoritative mutable overlay for the infinite scientific field.
 *
 * The deterministic generator remains the immutable base. Mutations are sparse,
 * deterministic overlays so 2D, volumetric 3D and Infinite World all consume
 * the same state without copying the entire infinite field.
 */
export class MutableWorldFieldProvider implements ScientificFieldProvider {
  readonly id = 'authoritative-world-field'
  readonly version = 'world-field-mutation-v1'

  private nextId = 1
  private versionCounter = 0
  private mutations: WorldFieldMutation[] = []
  private globalOverlays = new Map<'preset' | 'law' | 'composer', {
    scale: Partial<Record<keyof ScientificFieldSample, number>>
    delta: Partial<ScientificFieldSample>
    metadata?: Record<string, unknown>
  }>()

  constructor(private base: ScientificFieldProvider) {}

  setBase(base: ScientificFieldProvider) {
    this.base = base
    this.versionCounter++
  }

  sample(x: number, y: number, z: number): ScientificFieldSample {
    const base = this.base.sample(x, y, z)
    const out = { ...base }

    for (const overlay of this.globalOverlays.values()) {
      for (const field of FIELDS) {
        const scale = overlay.scale[field]
        if (scale !== undefined) out[field] *= scale
        const delta = overlay.delta[field]
        if (delta !== undefined) out[field] += delta
      }
    }

    for (const mutation of this.mutations) {
      if (mutation.x === undefined || mutation.y === undefined || mutation.z === undefined) continue
      const radius = Math.max(0.001, mutation.radius ?? 0)
      const distance = Math.hypot(x - mutation.x, y - mutation.y, z - mutation.z)
      if (distance > radius) continue
      const falloff = radius === 0 ? 1 : Math.max(0, 1 - distance / radius)
      for (const field of FIELDS) {
        const delta = mutation.delta?.[field]
        if (delta !== undefined) out[field] += delta * falloff
        const scale = mutation.scale?.[field]
        if (scale !== undefined) out[field] *= 1 + (scale - 1) * falloff
      }
    }

    for (const field of FIELDS) out[field] = clampField(field, out[field])
    return out
  }

  apply(mutation: Omit<WorldFieldMutation, 'id'>): WorldFieldMutation {
    const committed: WorldFieldMutation = { ...mutation, id: this.nextId++ }
    this.mutations.push(committed)
    this.versionCounter++
    if (this.mutations.length > 4096) this.mutations.splice(0, this.mutations.length - 4096)
    return committed
  }

  applyRadial(kind: WorldFieldMutation['kind'], x: number, y: number, z: number, radius: number, delta: Partial<ScientificFieldSample>, metadata?: Record<string, unknown>) {
    return this.apply({ kind, x, y, z, radius, delta, metadata })
  }

  setGlobal(kind: 'preset' | 'law' | 'composer', scale: Partial<Record<keyof ScientificFieldSample, number>> = {}, delta: Partial<ScientificFieldSample> = {}, metadata?: Record<string, unknown>) {
    this.globalOverlays.set(kind, { scale: { ...scale }, delta: { ...delta }, metadata })
    this.versionCounter++
    const committed: WorldFieldMutation = { id: this.nextId++, kind, metadata: { ...metadata, globalScale: scale, globalDelta: delta, replacesPrevious: true } }
    this.mutations.push(committed)
    if (this.mutations.length > 4096) this.mutations.splice(0, this.mutations.length - 4096)
    return committed
  }

  clearGlobal(kind: 'preset' | 'law' | 'composer') {
    if (!this.globalOverlays.delete(kind)) return false
    this.versionCounter++
    return true
  }

  clear() {
    this.mutations = []
    this.globalOverlays.clear()
    this.nextId = 1
    this.versionCounter++
  }

  serialize(): WorldFieldStateSnapshot {
    const globalOverlays: WorldFieldStateSnapshot['globalOverlays'] = {}
    for (const kind of ['preset', 'law', 'composer'] as const) {
      const overlay = this.globalOverlays.get(kind)
      if (overlay) {
        globalOverlays[kind] = {
          scale: { ...overlay.scale },
          delta: { ...overlay.delta },
          metadata: overlay.metadata ? { ...overlay.metadata } : undefined,
        }
      }
    }
    return {
      schemaVersion: 'world-field-state-v1',
      providerId: this.id,
      providerVersion: this.version,
      version: this.versionCounter,
      nextId: this.nextId,
      mutations: this.mutations.map((mutation) => ({
        ...mutation,
        delta: mutation.delta ? { ...mutation.delta } : undefined,
        scale: mutation.scale ? { ...mutation.scale } : undefined,
        metadata: mutation.metadata ? { ...mutation.metadata } : undefined,
      })),
      globalOverlays,
    }
  }

  restore(snapshot: WorldFieldStateSnapshot) {
    if (snapshot.schemaVersion !== 'world-field-state-v1' || snapshot.providerId !== this.id) return false
    if (!Array.isArray(snapshot.mutations) || typeof snapshot.version !== 'number') return false

    this.mutations = snapshot.mutations.map((mutation) => ({
      ...mutation,
      delta: mutation.delta ? { ...mutation.delta } : undefined,
      scale: mutation.scale ? { ...mutation.scale } : undefined,
      metadata: mutation.metadata ? { ...mutation.metadata } : undefined,
    }))
    this.globalOverlays.clear()
    for (const kind of ['preset', 'law', 'composer'] as const) {
      const overlay = snapshot.globalOverlays?.[kind]
      if (overlay) {
        this.globalOverlays.set(kind, {
          scale: { ...overlay.scale },
          delta: { ...overlay.delta },
          metadata: overlay.metadata ? { ...overlay.metadata } : undefined,
        })
      }
    }
    const maxId = this.mutations.reduce((max, mutation) => Math.max(max, mutation.id), 0)
    this.nextId = Math.max(maxId + 1, Number.isFinite(snapshot.nextId) ? snapshot.nextId : 1)
    this.versionCounter = Math.max(0, snapshot.version)
    return true
  }

  getVersion() {
    return this.versionCounter
  }

  getMutationCount() {
    return this.mutations.length
  }

  getState() {
    return {
      schemaVersion: 'world-field-state-v1',
      providerId: this.id,
      providerVersion: this.version,
      version: this.versionCounter,
      mutationCount: this.mutations.length,
      lastMutation: this.mutations[this.mutations.length - 1] ?? null,
    }
  }
}
