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
  private globalScale: Partial<Record<keyof ScientificFieldSample, number>> = {}
  private globalDelta: Partial<ScientificFieldSample> = {}

  constructor(private base: ScientificFieldProvider) {}

  setBase(base: ScientificFieldProvider) {
    this.base = base
    this.versionCounter++
  }

  sample(x: number, y: number, z: number): ScientificFieldSample {
    const base = this.base.sample(x, y, z)
    const out = { ...base }

    for (const field of FIELDS) {
      const scale = this.globalScale[field]
      if (scale !== undefined) out[field] *= scale
      const delta = this.globalDelta[field]
      if (delta !== undefined) out[field] += delta
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
    for (const field of FIELDS) {
      if (scale[field] !== undefined) this.globalScale[field] = scale[field]
      if (delta[field] !== undefined) this.globalDelta[field] = delta[field]
    }
    this.versionCounter++
    const committed: WorldFieldMutation = { id: this.nextId++, kind, metadata: { ...metadata, globalScale: scale, globalDelta: delta } }
    this.mutations.push(committed)
    this.versionCounter++
    if (this.mutations.length > 4096) this.mutations.splice(0, this.mutations.length - 4096)
    return committed
  }

  clear() {
    this.mutations = []
    this.globalScale = {}
    this.globalDelta = {}
    this.versionCounter++
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
