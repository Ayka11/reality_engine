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
}

const TIER_ORDER: SettlementTier[] = ['village', 'town', 'city', 'megacity']

const REQUIREMENTS: Record<SettlementTier, Record<string, number>> = {
  village: { 'resource.water': 10, 'resource.wood': 8 },
  town: { 'resource.water': 25, 'resource.wood': 20, 'resource.stone': 15 },
  city: { 'resource.water': 60, 'resource.stone': 45, 'resource.iron': 25 },
  megacity: { 'resource.water': 140, 'resource.stone': 100, 'resource.iron': 80, 'resource.crystal': 20 },
}

export class SettlementGrowthModel {
  evaluate(id: string, tier: SettlementTier): SettlementGrowthState {
    const requirements = REQUIREMENTS[tier]
    const capabilities = Object.entries(requirements).map(([resource, amount]) =>
      worldResourceEconomy.capability(resource, amount),
    )
    const resourceScore = capabilities.length
      ? capabilities.reduce((sum, capability) => sum + capability.score, 0) / capabilities.length
      : 1
    const blockedBy = capabilities.filter((item) => !item.available).map((item) => item.semanticEntryId)
    const infrastructureScore = tier === 'village' ? 0.6 : tier === 'town' ? 0.72 : tier === 'city' ? 0.86 : 0.95
    const stability = Math.max(0, Math.min(1, resourceScore * 0.7 + infrastructureScore * 0.3))
    return {
      id,
      tier,
      population: tier === 'village' ? 80 : tier === 'town' ? 800 : tier === 'city' ? 12000 : 1000000,
      stability,
      infrastructureScore,
      resourceScore,
      growthRate: (stability - 0.55) * 0.08,
      blockedBy,
    }
  }

  canGrow(state: SettlementGrowthState): boolean {
    const nextIndex = TIER_ORDER.indexOf(state.tier) + 1
    if (nextIndex >= TIER_ORDER.length) return false
    const nextTier = TIER_ORDER[nextIndex]
    return this.evaluate(state.id, nextTier).blockedBy.length === 0
  }

  nextTier(state: SettlementGrowthState): SettlementTier | null {
    const nextIndex = TIER_ORDER.indexOf(state.tier) + 1
    if (nextIndex >= TIER_ORDER.length) return null
    const nextTier = TIER_ORDER[nextIndex]
    return this.canGrow(state) ? nextTier : null
  }

  growthPath(state: SettlementGrowthState): SettlementTier[] {
    const path: SettlementTier[] = [state.tier]
    let current = state
    while (this.canGrow(current)) {
      const next = this.nextTier(current)
      if (!next) break
      path.push(next)
      current = this.evaluate(state.id, next)
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
