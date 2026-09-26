import { settlementGrowthModel, SettlementGrowthState, SettlementTier } from './SettlementGrowthModel'
import { worldResourceEconomy } from './WorldResourceEconomy'
import { worldRuleGraph } from './registry'

export type CivilizationType = 'agricultural' | 'industrial' | 'post-scarcity'

export type CivilizationState = {
  id: string
  type: CivilizationType
  settlement: SettlementGrowthState
  score: number
  capabilities: Record<CivilizationType, number>
  blockedBy: string[]
  specialization: string[]
}

const TYPE_REQUIREMENTS: Record<CivilizationType, Record<string, number>> = {
  agricultural: { 'resource.water': 12, 'resource.wood': 10 },
  industrial: { 'resource.stone': 30, 'resource.iron': 20 },
  'post-scarcity': { 'resource.crystal': 12, 'resource.iron': 30, 'resource.water': 40 },
}

const TYPE_RULE_IDS: Record<CivilizationType, string> = {
  agricultural: 'civilization.agricultural',
  industrial: 'civilization.industrial',
  'post-scarcity': 'civilization.post-scarcity',
}

function capabilityScore(requirements: Record<string, number>) {
  const values = Object.entries(requirements).map(([id, amount]) =>
    worldResourceEconomy.capability(id, amount).score,
  )
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
}

export class CivilizationRuntime {
  evaluate(id: string, tier: SettlementTier): CivilizationState {
    const settlement = settlementGrowthModel.evaluate(id, tier)
    const capabilities = {
      agricultural: capabilityScore(TYPE_REQUIREMENTS.agricultural),
      industrial: capabilityScore(TYPE_REQUIREMENTS.industrial),
      'post-scarcity': capabilityScore(TYPE_REQUIREMENTS['post-scarcity']),
    } satisfies Record<CivilizationType, number>

    const type: CivilizationType = (
      capabilities['post-scarcity'] >= 0.75 ? 'post-scarcity'
        : capabilities.industrial >= capabilities.agricultural ? 'industrial'
        : 'agricultural'
    )

    const blockedBy = Object.entries(TYPE_REQUIREMENTS[type])
      .filter(([resource, amount]) => !worldResourceEconomy.capability(resource, amount).available)
      .map(([resource]) => resource)

    const ruleContext = worldRuleGraph.incoming(TYPE_RULE_IDS[type], 'enables')
    const specialization = ruleContext.map((rule) => rule.from)

    return {
      id,
      type,
      settlement,
      score: capabilities[type],
      capabilities,
      blockedBy,
      specialization,
    }
  }

  tick(state: CivilizationState, delta = 1) {
    const settlementTick = settlementGrowthModel.tick(state.settlement, delta)
    const next = this.evaluate(state.id, settlementTick.state.tier)
    next.settlement = settlementTick.state
    next.blockedBy = [...new Set([...next.blockedBy, ...settlementTick.shortages])]
    return {
      state: next,
      settlementTick,
      changed: settlementTick.changed || next.type !== state.type,
    }
  }
}

export const civilizationRuntime = new CivilizationRuntime()
