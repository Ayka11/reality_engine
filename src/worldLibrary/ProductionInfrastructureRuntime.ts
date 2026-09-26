import { civilizationRuntime, CivilizationState } from './CivilizationRuntime'
import { worldResourceEconomy } from './WorldResourceEconomy'
import { eventConsequenceEngine, type EventConsequence } from './EventConsequenceEngine'

export type ProductionKind = 'agriculture' | 'industry' | 'research'

export type ProductionNode = {
  id: string
  kind: ProductionKind
  output: string
  rate: number
  input?: string
  inputRate?: number
  efficiency: number
}

export type InfrastructureState = {
  roads: number
  capacity: number
  utilization: number
  resilience: number
  populationCapacity: number
  pressure: number
}

export type WorldTimeScale = 'minute' | 'year' | 'decade' | 'century'

export type WorldTimelineEvent = {
  id: string
  year: number
  type: 'founding' | 'growth' | 'tier-transition' | 'resource-crisis' | 'infrastructure-expansion' | 'civilization-change'
  settlementId: string
  from?: string
  to?: string
  details: string
}

export type CivilizationProductionState = {
  civilization: CivilizationState
  nodes: ProductionNode[]
  infrastructure: InfrastructureState
  produced: Record<string, number>
  consumed: Record<string, number>
  shortages: string[]
  worldTime: { year: number; scale: WorldTimeScale; elapsed: number }
  history: Array<{ year: number; population: number; pressure: number; roads: number; capacity: number; shortages: string[] }>
  timeline: WorldTimelineEvent[]
  consequences: EventConsequence[]
  causalChain: WorldTimelineEvent[]
}

const OUTPUTS: Record<ProductionKind, { output: string; rate: number; input?: string; inputRate?: number }> = {
  agriculture: { output: 'resource.water', rate: 1.8, input: 'resource.wood', inputRate: 0.25 },
  industry: { output: 'resource.iron', rate: 1.2, input: 'resource.stone', inputRate: 0.7 },
  research: { output: 'resource.crystal', rate: 0.55, input: 'resource.iron', inputRate: 0.35 },
}

export class ProductionInfrastructureRuntime {
  private infrastructureExpansion(state: CivilizationProductionState, delta: number) {
    const pressure = state.infrastructure.pressure
    if (pressure < 0.62) return { addedRoads: 0, addedCapacity: 0 }
    const addedRoads = Math.max(0, Math.floor((pressure - 0.62) * 12 * delta))
    const addedCapacity = addedRoads * 25 + Math.max(0, pressure - 0.8) * 500 * delta
    return { addedRoads, addedCapacity }
  }

  private readonly states = new Map<string, CivilizationProductionState>()

  evaluate(civilization: CivilizationState): CivilizationProductionState {
    const type = civilization.type
    const kinds: ProductionKind[] =
      type === 'agricultural' ? ['agriculture']
        : type === 'industrial' ? ['agriculture', 'industry']
        : ['agriculture', 'industry', 'research']

    const nodes = kinds.map((kind, index) => ({
      id: civilization.id + ':production:' + kind,
      kind,
      ...OUTPUTS[kind],
      efficiency: Math.max(0.1, civilization.score * (1 - index * 0.08)),
    }))

    const baselineRoads = civilization.settlement.tier === 'village' ? 4
      : civilization.settlement.tier === 'town' ? 12
      : civilization.settlement.tier === 'city' ? 40
      : 120
    const baselineCapacity = baselineRoads * 25 + civilization.settlement.population * 0.02
    const previous = this.states.get(civilization.id)
    const roads = Math.max(baselineRoads, previous?.infrastructure.roads ?? 0)
    const capacity = Math.max(baselineCapacity, previous?.infrastructure.capacity ?? 0)
    const utilization = Math.min(1, civilization.settlement.population / Math.max(1, capacity))
    const infrastructure: InfrastructureState = {
      roads,
      capacity,
      utilization,
      resilience: Math.max(0, Math.min(1, civilization.settlement.stability * 0.7 + (1 - utilization) * 0.3)),
      populationCapacity: civilization.settlement.infrastructureCapacity,
      pressure: Math.min(1, civilization.settlement.population / Math.max(1, civilization.settlement.infrastructureCapacity)),
    }

    const state = { civilization, nodes, infrastructure, produced: {}, consumed: {}, shortages: [], worldTime: { year: 0, scale: 'year' as WorldTimeScale, elapsed: 0 }, history: [], timeline: [{ id: civilization.id + ':founding', year: 0, type: 'founding', settlementId: civilization.id, to: civilization.settlement.tier, details: 'Civilization runtime initialized' }], consequences: [], causalChain: [] }
    this.states.set(civilization.id, state)
    return state
  }

  tick(id: string, delta = 1): CivilizationProductionState | null {
    const current = this.states.get(id)
    if (!current) return null
    const produced: Record<string, number> = {}
    const consumed: Record<string, number> = {}
    const shortages: string[] = []
    const expansion = this.infrastructureExpansion(current, delta)
    if (expansion.addedCapacity > 0) {
      current.infrastructure.roads += expansion.addedRoads
      current.infrastructure.capacity += expansion.addedCapacity
    }

    for (const node of current.nodes) {
      const efficiency = node.efficiency
      const inputAmount = (node.inputRate ?? 0) * efficiency * delta
      if (node.input && inputAmount > 0 && !worldResourceEconomy.consume(node.input, inputAmount)) {
        shortages.push(node.input)
        continue
      }
      if (node.input) consumed[node.input] = (consumed[node.input] ?? 0) + inputAmount
      const amount = node.rate * efficiency * delta
      const resource = worldResourceEconomy.get(node.output)
      if (resource) {
        resource.amount = Math.min(resource.capacity, resource.amount + amount)
        produced[node.output] = (produced[node.output] ?? 0) + amount
      }
    }

    worldResourceEconomy.tick(delta)
    const civTick = civilizationRuntime.tick(current.civilization, delta)
    const next = this.evaluate(civTick.state)
    next.worldTime = { ...current.worldTime }
    next.history = [...current.history]
    next.timeline = [...current.timeline]
    next.consequences = []
    next.causalChain = [...current.causalChain]
    next.infrastructure.roads += expansion.addedRoads
    next.infrastructure.capacity += expansion.addedCapacity
    next.infrastructure.populationCapacity = Math.max(next.infrastructure.populationCapacity, current.infrastructure.populationCapacity + expansion.addedCapacity)
    next.infrastructure.pressure = Math.min(1, next.civilization.settlement.population / Math.max(1, next.infrastructure.populationCapacity))
    next.civilization.settlement.infrastructureCapacity = Math.max(next.civilization.settlement.infrastructureCapacity, next.infrastructure.populationCapacity)
    next.produced = produced
    next.consumed = consumed
    next.shortages = [...new Set([...shortages, ...civTick.settlementTick.shortages])]
    const worldTime = next.worldTime
    const previousTier = current.civilization.settlement.tier
    const nextTier = next.civilization.settlement.tier
    if (previousTier !== nextTier) {
      next.timeline.push({ id: id + ':tier:' + worldTime.year, year: worldTime.year, type: 'tier-transition', settlementId: id, from: previousTier, to: nextTier, details: 'Settlement tier changed through simulation' })
    }
    if (next.shortages.length > 0 && current.shortages.length === 0) {
      next.timeline.push({ id: id + ':crisis:' + worldTime.year, year: worldTime.year, type: 'resource-crisis', settlementId: id, details: 'Resource shortage detected: ' + next.shortages.join(', ') })
    }
    if (expansion.addedRoads > 0 || expansion.addedCapacity > 0) {
      next.timeline.push({ id: id + ':infra:' + worldTime.year, year: worldTime.year, type: 'infrastructure-expansion', settlementId: id, details: 'Infrastructure expanded by ' + expansion.addedRoads + ' roads and ' + expansion.addedCapacity.toFixed(1) + ' capacity' })
    }
    if (current.civilization.type !== next.civilization.type) {
      next.timeline.push({ id: id + ':civ:' + worldTime.year, year: worldTime.year, type: 'civilization-change', settlementId: id, from: current.civilization.type, to: next.civilization.type, details: 'Civilization specialization changed' })
    }
    const previousTimelineIds = new Set(current.timeline.map((event) => event.id))
    const newEvents = next.timeline.filter((event) => !previousTimelineIds.has(event.id))
    const causalEvents = eventConsequenceEngine.deriveCausalEvents(newEvents)
    const consequences = eventConsequenceEngine.deriveMany(causalEvents)
    next.causalChain.push(...causalEvents.filter((event) => !current.causalChain.some((existing) => existing.id === event.id)))
    for (const consequence of consequences) {
      for (const action of consequence.actions) {
        if (action.type === 'growth-modifier') {
          next.civilization.settlement.growthModifier = Math.min(next.civilization.settlement.growthModifier, action.multiplier)
          next.civilization.settlement.growthModifierTicks = Math.max(next.civilization.settlement.growthModifierTicks, action.durationTicks)
        } else if (action.type === 'stability-shift') {
          next.civilization.settlement.stability = Math.max(0, Math.min(1, next.civilization.settlement.stability + action.delta))
        } else if (action.type === 'infrastructure-capacity') {
          next.civilization.settlement.infrastructureCapacity += action.amount
        } else if (action.type === 'production-profile') {
          next.nodes = next.nodes.filter((node) => action.enabledNodes.includes(node.kind))
        }
      }
    }
    next.consequences = consequences
    worldTime.elapsed += delta
    const yearsPerTick = worldTime.scale === 'minute' ? 1 / (365 * 24 * 60) : worldTime.scale === 'decade' ? 10 : worldTime.scale === 'century' ? 100 : 1
    worldTime.year += delta * yearsPerTick
    next.history = [...next.history, { year: worldTime.year, population: next.civilization.settlement.population, pressure: next.infrastructure.pressure, roads: next.infrastructure.roads, capacity: next.infrastructure.capacity, shortages: next.shortages }].slice(-120)
    this.states.set(id, next)
    return next
  }

  get(id: string) { return this.states.get(id) }
  timeline(id: string) { return this.states.get(id)?.timeline ?? [] }
  causalChain(id: string) { return this.states.get(id)?.causalChain ?? [] }
  allTimelines() { return [...this.states.values()].flatMap((state) => state.timeline) }
  all() { return [...this.states.values()] }
}

export const productionInfrastructureRuntime = new ProductionInfrastructureRuntime()
