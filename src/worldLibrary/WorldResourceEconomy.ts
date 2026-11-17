import { worldRuleGraph } from './registry'

export type ResourceState = {
  semanticEntryId: string
  amount: number
  capacity: number
  regeneration: number
  quality: number
  accessibility: number
}

export type ResourceCapability = {
  semanticEntryId: string
  requiredAmount: number
  available: boolean
  score: number
}

export class WorldResourceEconomy {
  #resources = new Map<string, ResourceState>()

  constructor() {
    Object.freeze(this)
  }

  private canonicalId(id: string) {
    if (id === 'resource.iron' && this.#resources.has('resource.metal')) return 'resource.metal'
    if (id === 'resource.metal' && this.#resources.has('resource.iron')) return 'resource.iron'
    return id
  }

  seedFromBiome(biomeId: string, multiplier = 1): ResourceState[] {
    if (typeof biomeId !== 'string' || !biomeId.trim() || !Number.isFinite(multiplier) || multiplier < 0) {
      throw new TypeError('Biome seeding requires a stable biome ID and a finite non-negative multiplier')
    }
    const produced = worldRuleGraph.query({ from: biomeId, relation: 'produces' })
    const states: ResourceState[] = []
    for (const rule of produced) {
      const state: ResourceState = {
        semanticEntryId: rule.to,
        amount: Math.max(1, (rule.weight ?? 1) * 100 * multiplier),
        capacity: Math.max(1, (rule.weight ?? 1) * 140 * multiplier),
        regeneration: rule.to === 'resource.wood' ? 2 : rule.to === 'resource.water' ? 3 : 0.25,
        quality: Math.max(0.25, Math.min(1, 0.55 + (rule.weight ?? 1) * 0.12)),
        accessibility: Math.max(0.2, Math.min(1, 0.5 + (rule.weight ?? 1) * 0.1)),
      }
      this.#resources.set(state.semanticEntryId, { ...state })
      states.push({ ...state })
    }
    return states
  }

  /** Store a detached resource record and return a detached write result. */
  set(state: ResourceState): ResourceState {
    this.assertValidState(state)
    const stored = { ...state }
    this.#resources.set(stored.semanticEntryId, stored)
    return { ...stored }
  }

  /** Read a detached resource record; callers cannot mutate live economy state. */
  get(id: string): ResourceState | undefined {
    const resource = this.#resources.get(this.canonicalId(id))
    return resource ? { ...resource } : undefined
  }

  /** Return detached records rather than references into the authoritative map. */
  all(): ResourceState[] {
    return [...this.#resources.values()].map(resource => ({ ...resource }))
  }

  snapshot(): ResourceState[] {
    return this.all().map((resource) => ({ ...resource }))
  }

  restore(snapshot: ResourceState[]) {
    if (!Array.isArray(snapshot)) {
      throw new TypeError('World resource restore requires an array snapshot')
    }
    const next = new Map<string, ResourceState>()
    for (const resource of snapshot) {
      this.assertValidState(resource)
      if (next.has(resource.semanticEntryId)) {
        throw new Error(`Duplicate world resource ID: ${resource.semanticEntryId}`)
      }
      next.set(resource.semanticEntryId, { ...resource })
    }
    // Publish only after the entire candidate inventory has been validated.
    this.#resources = next
    return this.snapshot()
  }


  capability(id: string, requiredAmount: number): ResourceCapability {
    const resource = this.#resources.get(this.canonicalId(id))
    const effective = resource ? resource.amount * resource.quality * resource.accessibility : 0
    const score = requiredAmount <= 0 ? 1 : Math.max(0, Math.min(1, effective / requiredAmount))
    return { semanticEntryId: id, requiredAmount, available: score >= 1, score }
  }

  canSupport(targetId: string, requirements: Record<string, number>) {
    const capabilities = Object.entries(requirements).map(([id, amount]) => this.capability(id, amount))
    const ruleRequirements = worldRuleGraph.outgoing(targetId, 'requires')
      .filter((rule) => rule.to.startsWith('resource.'))
      .map((rule) => this.capability(rule.to, 1))
    const all = [...capabilities, ...ruleRequirements]
    return {
      targetId,
      available: all.every((item) => item.available),
      score: all.length ? all.reduce((sum, item) => sum + item.score, 0) / all.length : 1,
      capabilities: all,
    }
  }

  consume(id: string, amount: number): boolean {
    if (typeof id !== 'string' || !id.trim() || !Number.isFinite(amount) || amount <= 0) return false
    const resource = this.#resources.get(this.canonicalId(id))
    if (!resource || resource.amount < amount) return false
    resource.amount -= amount
    return true
  }

  /** Add produced stock without exposing or replacing the authoritative record. */
  produce(id: string, amount: number): boolean {
    if (typeof id !== 'string' || !id.trim() || !Number.isFinite(amount) || amount <= 0) return false
    const resource = this.#resources.get(this.canonicalId(id))
    if (!resource) return false
    resource.amount = Math.min(resource.capacity, resource.amount + amount)
    return true
  }

  tick(delta = 1): void {
    if (!Number.isFinite(delta) || delta < 0) {
      throw new TypeError('World resource tick delta must be finite and non-negative')
    }
    for (const resource of this.#resources.values()) {
      resource.amount = Math.min(resource.capacity, resource.amount + resource.regeneration * delta)
    }
  }

  stats() {
    return {
      total: this.#resources.size,
      totalAmount: this.all().reduce((sum, resource) => sum + resource.amount, 0),
      resources: this.all(),
    }
  }

  private assertValidState(state: ResourceState): void {
    if (!state || typeof state !== 'object' ||
        typeof state.semanticEntryId !== 'string' || !state.semanticEntryId.trim() ||
        ![
          state.amount,
          state.capacity,
          state.regeneration,
          state.quality,
          state.accessibility,
        ].every(Number.isFinite) ||
        state.amount < 0 ||
        state.capacity < 0 ||
        state.amount > state.capacity ||
        state.regeneration < 0 ||
        state.quality < 0 || state.quality > 1 ||
        state.accessibility < 0 || state.accessibility > 1) {
      throw new TypeError('World resource state requires a stable ID and valid finite resource bounds')
    }
  }
}

export const worldResourceEconomy = new WorldResourceEconomy()
