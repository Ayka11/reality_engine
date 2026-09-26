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

export type CounterfactualOverride = {
  stabilityDelta?: number
  populationRatio?: number
  resilienceDelta?: number
  civilization?: CivilizationType
  reason: string
}

export type CivilizationExperimentScenario = {
  id: string
  sourceBranch: string
  override: CounterfactualOverride
}

export type CivilizationExperimentOutcome = {
  scenarioId: string
  branchId: string
  populationChange: number
  stabilityChange: number
  resilienceChange: number
  scoreChange: number
  civilizationChanged: boolean
  divergence: number
  dominantFactors: string[]
}

export type CivilizationExperimentResult = {
  experimentId: string
  ticks: number
  branches: Array<{ scenarioId: string; branchId: string; final: CivilizationBranchSnapshot | null; history: CivilizationBranchSnapshot[] }>
  outcomes: CivilizationExperimentOutcome[]
}

export type CivilizationDivergenceMetrics = {
  branchA: string
  branchB: string
  populationGap: number
  stabilityGap: number
  resilienceGap: number
  scoreGap: number
  typeChanged: boolean
  divergenceGap: number
  dominantFactors: string[]
}

export type CivilizationBranchSnapshot = {
  branchId: string
  tick: number
  type: CivilizationType
  population: number
  stability: number
  resilience: number
  divergence: number
  score: number
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
  private readonly branches = new Map<string, CivilizationBranchSnapshot[]>()
  private readonly branchStates = new Map<string, CivilizationState>()

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
    const branchId = divergence >= 0.35 ? `${previousMemory.branchId}-b${previousMemory.ticks + delta}` : previousMemory.branchId
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
    const branchSnapshot: CivilizationBranchSnapshot = { branchId: memory.branchId, tick: memory.ticks, type: next.type, population: next.settlement.population, stability: next.settlement.stability, resilience: memory.resilience, divergence: memory.divergence, score: next.score }
    const history = this.branches.get(memory.branchId) ?? []
    this.branches.set(memory.branchId, [...history, branchSnapshot].slice(-120))
    return {
      state: next,
      settlementTick,
      changed: settlementTick.changed || next.type !== state.type,
    }
  }

  branchSnapshot(branchId: string) { return this.branches.get(branchId)?.at(-1) ?? null }
  branchHistory(branchId: string) { return this.branches.get(branchId) ?? [] }

  tickBranch(branchId: string, delta = 1) {
    const state = this.branchStates.get(branchId)
    if (!state) return null
    const result = this.tick(state, delta)
    this.branchStates.set(branchId, result.state)
    return result
  }

  branchState(branchId: string) { return this.branchStates.get(branchId) ?? null }

  runExperiment(experimentId: string, scenarios: CivilizationExperimentScenario[], ticks = 10, delta = 1): CivilizationExperimentResult {
    const branches: CivilizationExperimentResult['branches'] = []
    for (const scenario of scenarios) {
      const fork = this.forkBranch(scenario.sourceBranch, scenario.override)
      if (!fork) continue
      for (let i = 0; i < ticks; i++) this.tickBranch(fork.branchId, delta)
      branches.push({ scenarioId: scenario.id, branchId: fork.branchId, final: this.branchSnapshot(fork.branchId), history: this.branchHistory(fork.branchId) })
    }
    const baseline = branches[0]?.final ?? null
    const outcomes: CivilizationExperimentOutcome[] = branches.map((branch) => {
      const final = branch.final
      if (!final || !baseline) return { scenarioId: branch.scenarioId, branchId: branch.branchId, populationChange: 0, stabilityChange: 0, resilienceChange: 0, scoreChange: 0, civilizationChanged: false, divergence: 0, dominantFactors: [] }
      const metrics = this.compareBranches(baseline.branchId, branch.branchId)
      return {
        scenarioId: branch.scenarioId,
        branchId: branch.branchId,
        populationChange: (final.population - baseline.population) / Math.max(1, baseline.population),
        stabilityChange: final.stability - baseline.stability,
        resilienceChange: final.resilience - baseline.resilience,
        scoreChange: final.score - baseline.score,
        civilizationChanged: final.type !== baseline.type,
        divergence: metrics?.divergenceGap ?? Math.abs(final.divergence - baseline.divergence),
        dominantFactors: metrics?.dominantFactors ?? [],
      }
    })
    return { experimentId, ticks, branches, outcomes }
  }
  branchesList() { return [...this.branches.entries()].map(([branchId, history]) => ({ branchId, latest: history.at(-1) ?? null, length: history.length })) }

  forkBranch(sourceBranch: string, override: CounterfactualOverride): CivilizationBranchSnapshot | null {
    const source = this.branchSnapshot(sourceBranch)
    if (!source) return null
    const branchId = `${sourceBranch}-cf-${this.branches.size + 1}`
    const snapshot: CivilizationBranchSnapshot = {
      ...source,
      branchId,
      stability: Math.max(0, Math.min(1, source.stability + (override.stabilityDelta ?? 0))),
      population: Math.max(1, Math.round(source.population * (override.populationRatio ?? 1))),
      resilience: Math.max(0.1, Math.min(0.95, source.resilience + (override.resilienceDelta ?? 0))),
      type: override.civilization ?? source.type,
      divergence: Math.max(0, Math.min(1, source.divergence + 0.15)),
    }
    const state = this.evaluate(`branch:${branchId}`, source.type === 'post-scarcity' ? 'megacity' : source.type === 'industrial' ? 'city' : 'town')
    state.settlement.population = snapshot.population
    state.settlement.stability = snapshot.stability
    state.type = snapshot.type
    state.score = snapshot.score
    state.memory = { ...state.memory, branchId, divergence: snapshot.divergence, resilience: snapshot.resilience, lastType: snapshot.type }
    this.branchStates.set(branchId, state)
    this.branches.set(branchId, [snapshot])
    return snapshot
  }

  compareBranches(branchA: string, branchB: string): CivilizationDivergenceMetrics | null {
    const a = this.branchSnapshot(branchA)
    const b = this.branchSnapshot(branchB)
    if (!a || !b) return null
    const factors: Array<[string, number]> = [
      ['population-pressure', Math.abs(a.population - b.population) / Math.max(1, Math.max(a.population, b.population))],
      ['stability', Math.abs(a.stability - b.stability)],
      ['resilience', Math.abs(a.resilience - b.resilience)],
      ['capability', Math.abs(a.score - b.score)],
      ['civilization-transition', a.type === b.type ? 0 : 1],
      ['historical-divergence', Math.abs(a.divergence - b.divergence)],
    ]
    return { branchA, branchB, populationGap: factors[0][1], stabilityGap: factors[1][1], resilienceGap: factors[2][1], scoreGap: factors[3][1], typeChanged: a.type !== b.type, divergenceGap: factors[5][1], dominantFactors: factors.sort((x,y) => y[1] - x[1]).slice(0,3).map(([name]) => name) }
  }
}

export const civilizationRuntime = new CivilizationRuntime()
