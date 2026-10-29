import { worldResourceEconomy } from './WorldResourceEconomy'
import { worldRuleGraph } from './registry'

export type SettlementTier = 'village' | 'town' | 'city' | 'megacity'

export type SettlementGrowthState = {
  id: string
  tier: SettlementTier
  population: number
  stability: number
  infrastructureScore: number
  resourceScore: number
  growthRate: number
  blockedBy: string[]
  consumption: Record<string, number>
  density: number
  landUse: number
  infrastructureCapacity: number
  growthModifier: number
  growthModifierTicks: number
}

export type SettlementTickResult = {
  state: SettlementGrowthState
  consumed: Record<string, number>
  shortages: string[]
  changed: boolean
  nextTier: SettlementTier | null
}

const TIER_ORDER: SettlementTier[] = ['village', 'town', 'city', 'megacity']

const REQUIREMENTS: Record<SettlementTier, Record<string, number>> = {
  village: { 'resource.water': 10, 'resource.wood': 8 },
  town: { 'resource.water': 25, 'resource.wood': 20, 'resource.stone': 15 },
  city: { 'resource.water': 60, 'resource.stone': 45, 'resource.iron': 25 },
  megacity: { 'resource.water': 140, 'resource.stone': 100, 'resource.iron': 80, 'resource.crystal': 20 },
}

const CONSUMPTION: Record<SettlementTier, Record<string, number>> = {
  village: { 'resource.water': 1.2, 'resource.wood': 0.7 },
  town: { 'resource.water': 4, 'resource.wood': 2.2, 'resource.stone': 0.5 },
  city: { 'resource.water': 12, 'resource.stone': 3, 'resource.iron': 1.4 },
  megacity: { 'resource.water': 45, 'resource.stone': 10, 'resource.iron': 6, 'resource.crystal': 0.8 },
}

const BASE_POPULATION: Record<SettlementTier, number> = {
  village: 80,
  town: 800,
  city: 12000,
  megacity: 1000000,
}

export class SettlementGrowthModel {
  evaluate(id: string, tier: SettlementTier, population = BASE_POPULATION[tier]): SettlementGrowthState {
    const requirements = REQUIREMENTS[tier]
    const capabilities = Object.entries(requirements).map(([resource, amount]) =>
      worldResourceEconomy.capability(resource, amount),
    )
    const resourceScore = capabilities.length
      ? capabilities.reduce((sum, capability) => sum + capability.score, 0) / capabilities.length
      : 1
    const blockedBy = capabilities.filter((item) => !item.available).map((item) => item.semanticEntryId)
    const infrastructureScore = tier === 'village' ? 0.6 : tier === 'town' ? 0.72 : tier === 'city' ? 0.86 : 0.95
    const density = tier === 'village' ? 0.12 : tier === 'town' ? 0.28 : tier === 'city' ? 0.58 : 0.82
    const infrastructureCapacity = tier === 'village' ? 120 : tier === 'town' ? 900 : tier === 'city' ? 18000 : 1400000
    const landUse = Math.min(1, population / Math.max(1, infrastructureCapacity))
    const stability = Math.max(0, Math.min(1, resourceScore * 0.7 + infrastructureScore * 0.3))
    return {
      id,
      tier,
      population,
      stability,
      infrastructureScore,
      resourceScore,
      growthRate: (stability - 0.55) * 0.08,
      blockedBy,
      consumption: CONSUMPTION[tier],
      density,
      landUse,
      infrastructureCapacity,
      growthModifier: 1,
      growthModifierTicks: 0,
    }
  }

  canGrow(state: SettlementGrowthState): boolean {
    const nextIndex = TIER_ORDER.indexOf(state.tier) + 1
    if (nextIndex >= TIER_ORDER.length) return false
    return this.evaluate(state.id, TIER_ORDER[nextIndex], state.population).blockedBy.length === 0
  }

  nextTier(state: SettlementGrowthState): SettlementTier | null {
    const nextIndex = TIER_ORDER.indexOf(state.tier) + 1
    if (nextIndex >= TIER_ORDER.length) return null
    const nextTier = TIER_ORDER[nextIndex]
    return this.canGrow(state) ? nextTier : null
  }

  tick(state: SettlementGrowthState, delta = 1): SettlementTickResult {
    const consumed: Record<string, number> = {}
    const shortages: string[] = []
    for (const [resource, rate] of Object.entries(state.consumption)) {
      const amount = rate * delta
      if (worldResourceEconomy.consume(resource, amount)) consumed[resource] = amount
      else shortages.push(resource)
    }

    const shortagePenalty = Math.min(0.45, shortages.length * 0.18)
    const pressure = Math.min(1.5, state.population / Math.max(1, state.infrastructureCapacity))
    const pressurePenalty = Math.max(0, pressure - 0.72) * 0.22
    const capacityRelief = Math.max(0, state.infrastructureCapacity - state.population) / Math.max(1, state.infrastructureCapacity) * 0.02
    const nextStability = Math.max(0, Math.min(1, state.stability - shortagePenalty - pressurePenalty + (shortages.length ? 0 : capacityRelief * delta)))
    const growthModifier = state.growthModifierTicks > 0 ? state.growthModifier : 1
    const nextPopulation = Math.max(1, Math.round(state.population * (1 + ((nextStability - 0.55) * 0.01) * growthModifier * delta)))
    const nextState = this.evaluate(state.id, state.tier, nextPopulation)
    nextState.stability = nextStability
    nextState.resourceScore = Math.max(0, nextState.resourceScore - shortagePenalty)
    nextState.growthRate = Math.max(-0.08, Math.min(0.08, (nextStability - 0.55) * 0.08 * growthModifier - pressurePenalty * 0.08))
    nextState.growthModifier = growthModifier
    nextState.growthModifierTicks = Math.max(0, state.growthModifierTicks - delta)
    nextState.blockedBy = [...new Set([...nextState.blockedBy, ...shortages])]
    const nextTier = this.nextTier(nextState)
    return {
      state: nextState,
      consumed,
      shortages,
      changed: nextPopulation !== state.population || nextStability !== state.stability,
      nextTier,
    }
  }

  growthPath(state: SettlementGrowthState): SettlementTier[] {
    const path: SettlementTier[] = [state.tier]
    let current = state
    while (this.canGrow(current)) {
      const next = this.nextTier(current)
      if (!next) break
      path.push(next)
      current = this.evaluate(state.id, next, state.population)
    }
    return path
  }

  ruleContext(tier: SettlementTier) {
    return {
      tier,
      outgoing: worldRuleGraph.outgoing('settlement.' + tier),
      incoming: worldRuleGraph.incoming('settlement.' + tier),
    }
  }
}

export const settlementGrowthModel = new SettlementGrowthModel()
