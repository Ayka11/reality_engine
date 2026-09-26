import { eventConsequenceEngine, type CausalEvent } from './EventConsequenceEngine'
import { worldResourceEconomy, type ResourceState } from './WorldResourceEconomy'
import { settlementGrowthModel, SettlementGrowthState, SettlementTier } from './SettlementGrowthModel'
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
  baseline?: boolean
}

export type CivilizationClaimStatus = 'supported' | 'contradicted' | 'unresolved'

export type CivilizationClaimNode = {
  id: string
  claim: string
  status: CivilizationClaimStatus
  confidence: number
  branchId: string
  tick: number
}

export type CivilizationGraphEdge = {
  from: string
  to: string
  relation: 'supported-by' | 'contradicted-by' | 'derived-from' | 'caused-by'
}

export type CivilizationClaimGraph = {
  claims: CivilizationClaimNode[]
  evidence: CivilizationEvidenceLink[]
  causalEvents: CausalEvent[]
  edges: CivilizationGraphEdge[]
}

export type CivilizationEvidenceLink = {
  branchId: string
  tick: number
  snapshot: CivilizationBranchSnapshot
  eventTypes: string[]
  claim: string
}

export type CivilizationCausalAttribution = {
  factor: string
  weight: number
  eventTypes: string[]
  mechanism: string
}

export type CivilizationExperimentCausalAttribution = {
  eventId: string
  eventType: string
  branchId: string
  tick: number
  impact: number
  dimensions: Array<'population' | 'stability' | 'resilience' | 'score'>
  mechanism: string
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
  causalAttribution: CivilizationCausalAttribution[]
  eventAttribution?: CivilizationExperimentCausalAttribution[]
  evidence: CivilizationEvidenceLink[]
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

export type CivilizationBranchEnvironment = {
  temperature: number
  moisture: number
  radiation: number
  stability: number
  tick: number
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
  private readonly experiments = new Map<string, CivilizationExperimentResult>()
  private readonly branchResources = new Map<string, ResourceState[]>()
  private readonly branchEnvironments = new Map<string, CivilizationBranchEnvironment>()
  private readonly branchCausalEvents = new Map<string, CausalEvent[]>()

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
    const branchId = previousMemory.branchId
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
    const causalEvents = this.branchCausalEvents.get(memory.branchId) ?? []
    const tickEvents: CausalEvent[] = []
    if (settlementTick.shortages.length > 0) {
      tickEvents.push({
        id: `branch:${memory.branchId}:resource-crisis:${memory.ticks}`,
        year: memory.ticks,
        type: 'resource-crisis',
        settlementId: state.id,
        severity: Math.min(1, settlementTick.shortages.length / 3),
        trigger: 'resource-shortage',
        details: `Resource shortage: ${settlementTick.shortages.join(', ')}`,
      })
    }
    if (settlementTick.state.stability < state.settlement.stability - 0.03) {
      tickEvents.push({
        id: `branch:${memory.branchId}:growth:${memory.ticks}`,
        year: memory.ticks,
        type: 'growth',
        settlementId: state.id,
        severity: Math.min(1, Math.abs(settlementTick.state.stability - state.settlement.stability) * 4),
        trigger: 'stability-decline',
        details: 'Growth pressure reduced settlement stability',
      })
    }
    if (next.type !== state.type) {
      tickEvents.push({
        id: `branch:${memory.branchId}:civilization-change:${memory.ticks}`,
        year: memory.ticks,
        type: 'civilization-change',
        settlementId: state.id,
        from: state.type,
        to: next.type,
        severity: 0.8,
        trigger: 'civilization-transition',
        details: `Civilization changed from ${state.type} to ${next.type}`,
      })
    }
    if (tickEvents.length) {
      const derived = eventConsequenceEngine.deriveCausalEvents(tickEvents)
      this.branchCausalEvents.set(memory.branchId, [...causalEvents, ...derived].slice(-240))
    }
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
    const branchSnapshot = this.branchResources.get(branchId)
    if (branchSnapshot) worldResourceEconomy.restore(branchSnapshot)
    const environment = this.branchEnvironments.get(branchId)
    if (environment) {
      const environmentalStress = (1 - environment.moisture) * 0.04 + environment.radiation * 0.03 + (1 - environment.stability) * 0.05
      state = { ...state, settlement: { ...state.settlement, stability: Math.max(0, Math.min(1, state.settlement.stability - environmentalStress * delta)) } }
    }
    const result = this.tick(state, delta)
    this.branchResources.set(branchId, worldResourceEconomy.snapshot())
    const previousEnvironment = this.branchEnvironments.get(branchId) ?? { temperature: 0.5, moisture: 0.5, radiation: 0.2, stability: 0.8, tick: 0 }
    const environmentalLoad = Math.max(0, Math.min(1, 1 - result.state.settlement.stability))
    this.branchEnvironments.set(branchId, {
      temperature: Math.max(0, Math.min(1, previousEnvironment.temperature + environmentalLoad * 0.002 * delta)),
      moisture: Math.max(0, Math.min(1, previousEnvironment.moisture - environmentalLoad * 0.004 * delta)),
      radiation: Math.max(0, Math.min(1, previousEnvironment.radiation + (result.state.type === 'post-scarcity' ? 0.002 : 0) * delta)),
      stability: Math.max(0, Math.min(1, previousEnvironment.stability - environmentalLoad * 0.003 * delta)),
      tick: previousEnvironment.tick + delta,
    })
    this.branchStates.set(branchId, result.state)
    return result
  }

  branchState(branchId: string) { return this.branchStates.get(branchId) ?? null }
  branchEnvironment(branchId: string) { return this.branchEnvironments.get(branchId) ?? null }
  branchCausalEvents(branchId: string) { return this.branchCausalEvents.get(branchId) ?? [] }

  buildClaimGraph(outcomes: CivilizationExperimentOutcome[]): CivilizationClaimGraph {
    const claims: CivilizationClaimNode[] = []
    const evidence: CivilizationEvidenceLink[] = []
    const causalEvents: CausalEvent[] = []
    const edges: CivilizationGraphEdge[] = []
    for (const outcome of outcomes) {
      for (const item of outcome.evidence) evidence.push(item)
      for (const event of (this.branchCausalEvents.get(outcome.branchId) ?? [])) if (!causalEvents.some((existing) => existing.id === event.id)) causalEvents.push(event)
      const final = this.branchSnapshot(outcome.branchId)
      if (!final) continue
      const claimId = `claim:${outcome.scenarioId}:${final.tick}`
      const populationSupported = outcome.populationChange > 0.02
      const populationContradicted = outcome.populationChange < -0.02
      const status: CivilizationClaimStatus = outcome.civilizationChanged
        ? 'supported'
        : populationContradicted
          ? 'contradicted'
          : 'unresolved'
      const confidence = Math.max(0, Math.min(1,
        0.5 + Math.abs(outcome.divergence) * 0.5 + (populationSupported || populationContradicted ? 0.15 : 0)
      ))
      claims.push({
        id: claimId,
        claim: `${outcome.scenarioId} produced population change ${(outcome.populationChange * 100).toFixed(1)}% with final civilization ${final.type}.`,
        status,
        confidence,
        branchId: final.branchId,
        tick: final.tick
      })
      for (const item of outcome.evidence) {
        const evidenceId = `${item.branchId}:${item.tick}`
        edges.push({
          from: claimId,
          to: evidenceId,
          relation: status === 'contradicted' ? 'contradicted-by' : 'supported-by'
        })
      }
      for (const factor of outcome.causalAttribution) {
        edges.push({ from: claimId, to: `factor:${factor.factor}`, relation: 'derived-from' })
      }
      for (const event of (this.branchCausalEvents.get(outcome.branchId) ?? []).slice(-8)) {
        edges.push({ from: claimId, to: event.id, relation: 'caused-by' })
      }
      for (const attribution of outcome.eventAttribution ?? []) {
        if (attribution.impact > 0.02) edges.push({ from: claimId, to: attribution.eventId, relation: 'caused-by' })
      }
    }
    return { claims, evidence, causalEvents, edges }
  }

  buildComparativeClaimGraph(outcomes: CivilizationExperimentOutcome[]): CivilizationClaimGraph {
    const graph = this.buildClaimGraph(outcomes)
    const claims = [...graph.claims]
    const edges = [...graph.edges]
    const baselineOutcome = outcomes.find((outcome) => outcome.populationChange === 0 && outcome.stabilityChange === 0 && outcome.resilienceChange === 0 && outcome.scoreChange === 0)
    const alternatives = outcomes.filter((outcome) => !baselineOutcome || outcome.scenarioId !== baselineOutcome.scenarioId)
    const positive = alternatives.filter((outcome) => outcome.populationChange > 0.02)
    const negative = alternatives.filter((outcome) => outcome.populationChange < -0.02)
    const stable = alternatives.filter((outcome) => Math.abs(outcome.populationChange) <= 0.02)
    const comparativeStatus: CivilizationClaimStatus =
      positive.length > 0 && negative.length > 0 ? 'unresolved'
        : positive.length > 0 ? 'supported'
          : negative.length > 0 ? 'contradicted'
            : 'unresolved'
    const confidence = Math.max(0.1, Math.min(1,
      0.4
      + Math.min(0.3, Math.abs(positive.length - negative.length) * 0.1)
      + Math.min(0.3, alternatives.length * 0.05)
    ))
    const claimId = `claim:comparative:population-effect`
    claims.push({
      id: claimId,
      claim: 'Counterfactual interventions produced a consistent population effect relative to the experiment baseline.',
      status: comparativeStatus,
      confidence,
      branchId: baselineOutcome?.branchId ?? alternatives[0]?.branchId ?? 'unknown',
      tick: Math.max(0, ...outcomes.map((outcome) => this.branchSnapshot(outcome.branchId)?.tick ?? 0))
    })
    for (const outcome of positive) {
      edges.push({ from: claimId, to: `claim:${outcome.scenarioId}:${this.branchSnapshot(outcome.branchId)?.tick ?? 0}`, relation: 'supported-by' })
    }
    for (const outcome of negative) {
      edges.push({ from: claimId, to: `claim:${outcome.scenarioId}:${this.branchSnapshot(outcome.branchId)?.tick ?? 0}`, relation: 'contradicted-by' })
    }
    for (const outcome of stable) {
      edges.push({ from: claimId, to: `claim:${outcome.scenarioId}:${this.branchSnapshot(outcome.branchId)?.tick ?? 0}`, relation: 'derived-from' })
    }
    return { ...graph, claims, edges }
  }

  serializeState() {
    return {
      branches: Array.from(this.branches.entries()).map(([branchId, history]) => ({ branchId, history })),
      branchStates: Array.from(this.branchStates.entries()).map(([branchId, state]) => ({ branchId, state })),
      experiments: Array.from(this.experiments.values()),
      branchResources: Array.from(this.branchResources.entries()).map(([branchId, resources]) => ({ branchId, resources })),
      branchEnvironments: Array.from(this.branchEnvironments.entries()).map(([branchId, environment]) => ({ branchId, environment })),
      branchCausalEvents: Array.from(this.branchCausalEvents.entries()).map(([branchId, events]) => ({ branchId, events }))
    }
  }

  restoreState(snapshot: ReturnType<CivilizationRuntime['serializeState']>) {
    this.branches.clear()
    this.branchStates.clear()
    this.experiments.clear()
    this.branchResources.clear()
    this.branchEnvironments.clear()
    this.branchCausalEvents.clear()
    for (const entry of snapshot.branches ?? []) this.branches.set(entry.branchId, entry.history)
    for (const entry of snapshot.branchStates ?? []) this.branchStates.set(entry.branchId, entry.state)
    for (const experiment of snapshot.experiments ?? []) this.experiments.set(experiment.experimentId, experiment)
    for (const entry of snapshot.branchResources ?? []) this.branchResources.set(entry.branchId, entry.resources.map((resource) => ({ ...resource })))
    for (const entry of snapshot.branchEnvironments ?? []) this.branchEnvironments.set(entry.branchId, { ...entry.environment })
    for (const entry of snapshot.branchCausalEvents ?? []) this.branchCausalEvents.set(entry.branchId, entry.events.map((event) => ({ ...event })))
    return {
      branchCount: this.branches.size,
      stateCount: this.branchStates.size,
      experimentCount: this.experiments.size,
      restored: this.branches.size === this.branchStates.size
    }
  }

  validateClaimGraph(graph: CivilizationClaimGraph) {
    const claimIds = new Set(graph.claims.map((claim) => claim.id))
    const evidenceIds = new Set(graph.evidence.map((item) => `${item.branchId}:${item.tick}`))
    const causalEventIds = new Set(graph.causalEvents.map((event) => event.id))
    const orphanClaims = graph.claims.filter((claim) => !graph.edges.some((edge) => edge.from === claim.id))
    const orphanEdges = graph.edges.filter((edge) =>
      edge.relation === 'supported-by' || edge.relation === 'contradicted-by'
        ? !evidenceIds.has(edge.to)
        : edge.relation === 'caused-by'
          ? !causalEventIds.has(edge.to)
          : !edge.to.startsWith('factor:')
    )
    const invalidClaimEdges = graph.edges.filter((edge) => !claimIds.has(edge.from))
    return {
      valid: orphanClaims.length === 0 && orphanEdges.length === 0 && invalidClaimEdges.length === 0,
      claimCount: graph.claims.length,
      evidenceCount: graph.evidence.length,
      causalEventCount: graph.causalEvents.length,
      edgeCount: graph.edges.length,
      orphanClaims: orphanClaims.map((claim) => claim.id),
      orphanEdges: orphanEdges.map((edge) => `${edge.from}->${edge.to}`),
      invalidClaimEdges: invalidClaimEdges.map((edge) => `${edge.from}->${edge.to}`)
    }
  }

  runExperiment(experimentId: string, scenarios: CivilizationExperimentScenario[], ticks = 10, delta = 1): CivilizationExperimentResult {
    const branches: CivilizationExperimentResult['branches'] = []
    for (const scenario of scenarios) {
      const fork = this.forkBranch(scenario.sourceBranch, scenario.override)
      if (!fork) continue
      for (let i = 0; i < ticks; i++) this.tickBranch(fork.branchId, delta)
      branches.push({ scenarioId: scenario.id, branchId: fork.branchId, final: this.branchSnapshot(fork.branchId), history: this.branchHistory(fork.branchId) })
    }
    const baselineScenario = scenarios.find((scenario) => scenario.baseline)
    const baseline = baselineScenario ? branches.find((branch) => branch.scenarioId === baselineScenario.id)?.final ?? null : branches[0]?.final ?? null
    const outcomes: CivilizationExperimentOutcome[] = branches.map((branch) => {
      const final = branch.final
      if (!final || !baseline) return { scenarioId: branch.scenarioId, branchId: branch.branchId, populationChange: 0, stabilityChange: 0, resilienceChange: 0, scoreChange: 0, civilizationChanged: false, divergence: 0, dominantFactors: [], causalAttribution: [], evidence: [] }
      const metrics = this.compareBranches(baseline.branchId, branch.branchId)
      const baselineBranch = branches.find((item) => item.branchId === baseline.branchId)
      const baselineHistory = baselineBranch?.history ?? []
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
        causalAttribution: [
          { factor: 'population-pressure', weight: Math.min(1, Math.abs((final.population - baseline.population) / Math.max(1, baseline.population))), eventTypes: ['growth', 'migration'], mechanism: 'population trajectory changed the settlement pressure state' },
          { factor: 'stability', weight: Math.min(1, Math.abs(final.stability - baseline.stability)), eventTypes: ['resource-crisis', 'infrastructure-failure', 'growth'], mechanism: 'causal events altered settlement stability' },
          { factor: 'resilience', weight: Math.min(1, Math.abs(final.resilience - baseline.resilience)), eventTypes: ['resource-crisis', 'migration', 'civilization-change'], mechanism: 'historical adaptation and crisis load changed resilience' },
          { factor: 'civilization-transition', weight: final.type === baseline.type ? 0 : 1, eventTypes: ['civilization-change', 'tier-transition'], mechanism: 'state transition changed the civilization trajectory' },
        ].filter((item) => item.weight > 0).sort((a, b) => b.weight - a.weight),
        eventAttribution: (this.branchCausalEvents.get(branch.branchId) ?? [])
          .map((event) => {
            const historyAtTick = branch.history.find((snapshot) => snapshot.tick === event.year) ?? final
            const baselineAtTick = baselineHistory.find((snapshot) => snapshot.tick === event.year) ?? baseline
            const populationImpact = Math.abs(historyAtTick.population - baselineAtTick.population) / Math.max(1, baselineAtTick.population)
            const stabilityImpact = Math.abs(historyAtTick.stability - baselineAtTick.stability)
            const resilienceImpact = Math.abs(historyAtTick.resilience - baselineAtTick.resilience)
            const scoreImpact = Math.abs(historyAtTick.score - baselineAtTick.score)
            const impact = Math.min(1, populationImpact * 0.35 + stabilityImpact * 0.3 + resilienceImpact * 0.2 + scoreImpact * 0.15)
            return {
              eventId: event.id,
              eventType: event.type,
              branchId: branch.branchId,
              tick: event.year,
              impact,
              dimensions: [
                ...(populationImpact > 0.02 ? ['population' as const] : []),
                ...(stabilityImpact > 0.02 ? ['stability' as const] : []),
                ...(resilienceImpact > 0.02 ? ['resilience' as const] : []),
                ...(scoreImpact > 0.02 ? ['score' as const] : []),
              ],
              mechanism: event.details,
            }
          })
          .filter((item) => item.impact > 0)
          .sort((a, b) => b.impact - a.impact),
        evidence: branch.history.map((snapshot) => {
          const events = this.branchCausalEvents.get(snapshot.branchId) ?? []
          const relevantEvents = events.filter((event) => event.year <= snapshot.tick).slice(-8)
          return {
            branchId: snapshot.branchId,
            tick: snapshot.tick,
            snapshot,
            eventTypes: relevantEvents.map((event) => event.type),
            claim: `At tick ${snapshot.tick}, branch ${snapshot.branchId} had civilization ${snapshot.type}, population ${snapshot.population}, stability ${snapshot.stability.toFixed(3)}, resilience ${snapshot.resilience.toFixed(3)}.`,
          }
        }),
      }
    })
    const result = { experimentId, ticks, branches, outcomes }
    this.experiments.set(experimentId, result)
    return result
  }

  experiment(experimentId: string) { return this.experiments.get(experimentId) ?? null }
  experimentsList() { return [...this.experiments.values()].map((item) => ({ experimentId: item.experimentId, ticks: item.ticks, branchCount: item.branches.length, outcomeCount: item.outcomes.length })) }
  branchesList() { return [...this.branches.entries()].map(([branchId, history]) => ({ branchId, latest: history.at(-1) ?? null, length: history.length })) }

  forkBranch(sourceBranch: string, override: CounterfactualOverride): CivilizationBranchSnapshot | null {
    const source = this.branchSnapshot(sourceBranch)
    if (!source) return null
    const sourceResources = this.branchResources.get(sourceBranch)
    if (sourceResources) worldResourceEconomy.restore(sourceResources)
    else this.branchResources.set(sourceBranch, worldResourceEconomy.snapshot())
    const sourceEnvironment = this.branchEnvironments.get(sourceBranch) ?? { temperature: 0.5, moisture: 0.5, radiation: 0.2, stability: 0.8, tick: source.tick }
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
    this.branchResources.set(branchId, worldResourceEconomy.snapshot())
    this.branchEnvironments.set(branchId, { ...sourceEnvironment, tick: source.tick })
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
