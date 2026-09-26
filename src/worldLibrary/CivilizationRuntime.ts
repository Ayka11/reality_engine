import { settlementGrowthModel, SettlementGrowthState, SettlementTier } from './SettlementGrowthModel'
import { worldResourceEconomy } from './WorldResourceEconomy'
import { worldRuleGraph } from './registry'

export type CivilizationType = 'agricultural' | 'industrial' | 'post-scarcity'

export type CivilizationMemory = {
  ticks: number
  crises: number
  migrations: number
  adaptations: number
  transitions: number
  cumulativeStability: number
  lastType: CivilizationType
  trajectory: Array<{ tick: number; type: CivilizationType; score: number; stability: number; evolutionPressure: number }>
  resilience: number
  adaptationSuccess: number
  branchId: string
  divergence: number
}

export type CivilizationState = {
  id: string
  type: CivilizationType
  settlement: SettlementGrowthState
  score: number
  capabilities: Record<CivilizationType, number>
  blockedBy: string[]
  specialization: string[]
  evolutionPressure: number
  transitionReason: string
  memory: CivilizationMemory
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

    const tierIndex = ['village', 'town', 'city', 'megacity'].indexOf(tier)
    const gatedCapabilities = {
      agricultural: capabilities.agricultural,
      industrial: tierIndex >= 1 ? capabilities.industrial : 0,
      'post-scarcity': tierIndex >= 2 ? capabilities['post-scarcity'] : 0,
    } satisfies Record<CivilizationType, number>
    const type: CivilizationType = (
      gatedCapabilities['post-scarcity'] >= 0.75 ? 'post-scarcity'
        : gatedCapabilities.industrial >= gatedCapabilities.agricultural + 0.08 ? 'industrial'
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
      evolutionPressure: Math.max(0, Math.min(1, Math.max(gatedCapabilities.industrial - gatedCapabilities.agricultural, gatedCapabilities['post-scarcity'] - gatedCapabilities.industrial) * (0.7 + (settlement.stability * 0.2)))),
      transitionReason: type === 'post-scarcity' ? 'advanced resource capability' : type === 'industrial' ? 'industrial capability exceeded agricultural capability' : 'agricultural capability remains dominant',
      memory: { ticks: 0, crises: 0, migrations: 0, adaptations: 0, transitions: 0, cumulativeStability: settlement.stability, lastType: type, trajectory: [], resilience: 0.5, adaptationSuccess: 0, branchId: 'origin', divergence: 0 },
    }
  }

  tick(state: CivilizationState, delta = 1) {
    const settlementTick = settlementGrowthModel.tick(state.settlement, delta)
    const next = this.evaluate(state.id, settlementTick.state.tier)
    next.settlement = settlementTick.state
    if (next.type !== state.type && Math.abs(next.score - state.score) < 0.08 && settlementTick.state.stability > 0.45) {
      next.type = state.type
      next.transitionReason = 'transition hysteresis preserved the current civilization state'
      next.score = next.capabilities[state.type]
    }
    next.blockedBy = [...new Set([...next.blockedBy, ...settlementTick.shortages])]
    const previousMemory = state.memory ?? { ticks: 0, crises: 0, migrations: 0, adaptations: 0, transitions: 0, cumulativeStability: state.settlement.stability, lastType: state.type, trajectory: [] }
    const previousResilience = previousMemory.resilience ?? 0.5
    const adaptationSuccess = next.settlement.stability >= state.settlement.stability && next.type === state.type ? Math.min(1, (previousMemory.adaptationSuccess ?? 0) + 0.04 * delta) : Math.max(0, (previousMemory.adaptationSuccess ?? 0) - 0.02 * delta)
    const crisisLoad = Math.min(1, (previousMemory.crises + settlementTick.shortages.length) / 12)
    const resilience = Math.max(0.1, Math.min(0.95, previousResilience + adaptationSuccess * 0.03 - crisisLoad * 0.015))
    const divergence = Math.max(0, Math.min(1, (previousMemory.divergence ?? 0) + Math.abs(settlementTick.state.stability - state.settlement.stability) * 0.5 + (next.type !== state.type ? 0.18 : 0)))
    const branchId = divergence >= 0.35 ? `${previousMemory.branchId}-b${memory.ticks + delta}` : previousMemory.branchId
    const memory: CivilizationMemory = {
      ...previousMemory,
      ticks: previousMemory.ticks + delta,
      crises: previousMemory.crises + settlementTick.shortages.length,
      transitions: previousMemory.transitions + (next.type !== state.type ? 1 : 0),
      cumulativeStability: previousMemory.cumulativeStability + settlementTick.state.stability * delta,
      lastType: next.type,
      resilience,
      adaptationSuccess,
      branchId,
      divergence,
      trajectory: [...previousMemory.trajectory, { tick: previousMemory.ticks + delta, type: next.type, score: next.score, stability: settlementTick.state.stability, evolutionPressure: next.evolutionPressure }].slice(-120),
    }
    next.memory = memory
    return {
      state: next,
      settlementTick,
      changed: settlementTick.changed || next.type !== state.type,
    }
  }
}

export const civilizationRuntime = new CivilizationRuntime()
