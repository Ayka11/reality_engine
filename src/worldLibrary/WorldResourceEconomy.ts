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
  private readonly resources = new Map<string, ResourceState>()

  seedFromBiome(biomeId: string, multiplier = 1): ResourceState[] {
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
      this.resources.set(state.semanticEntryId, state)
      states.push(state)
    }
    return states
  }

  set(state: ResourceState) { this.resources.set(state.semanticEntryId, state); return state }
  get(id: string) { return this.resources.get(id) }
  all() { return [...this.resources.values()] }

  capability(id: string, requiredAmount: number): ResourceCapability {
    const resource = this.resources.get(id)
    const effective = resource ? resource.amount * resource.quality * resource.accessibility : 0
    const score = requiredAmount <= 0 ? 1 : Math.max(0, Math.min(1, effective / requiredAmount))
    return { semanticEntryId: id, requiredAmount, available: score >= 1, score }
  }

  canSupport(targetId: string, requirements: Record<string, number>) {
    const capabilities = Object.entries(requirements).map(([id, amount]) => this.capability(id, amount))
    const ruleRequirements = worldRuleGraph.incoming(targetId, 'requires').map((rule) => this.capability(rule.to, 1))
    const all = [...capabilities, ...ruleRequirements]
    return {
      targetId,
      available: all.every((item) => item.available),
      score: all.length ? all.reduce((sum, item) => sum + item.score, 0) / all.length : 1,
      capabilities: all,
    }
  }

  consume(id: string, amount: number) {
    const resource = this.resources.get(id)
    if (!resource || resource.amount < amount) return false
    resource.amount -= amount
    return true
  }

  tick(delta = 1) {
    for (const resource of this.resources.values()) {
      resource.amount = Math.min(resource.capacity, resource.amount + resource.regeneration * delta)
    }
  }

  stats() {
    return {
      total: this.resources.size,
      totalAmount: this.all().reduce((sum, resource) => sum + resource.amount, 0),
      resources: this.all(),
    }
  }
}

export const worldResourceEconomy = new WorldResourceEconomy()
