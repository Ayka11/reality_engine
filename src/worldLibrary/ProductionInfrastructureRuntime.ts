import { civilizationRuntime, CivilizationState } from './CivilizationRuntime'
import { worldResourceEconomy } from './WorldResourceEconomy'

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

export type CivilizationProductionState = {
  civilization: CivilizationState
  nodes: ProductionNode[]
  infrastructure: InfrastructureState
  produced: Record<string, number>
  consumed: Record<string, number>
  shortages: string[]
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

    const roads = civilization.settlement.tier === 'village' ? 4
      : civilization.settlement.tier === 'town' ? 12
      : civilization.settlement.tier === 'city' ? 40
      : 120
    const capacity = roads * 25 + civilization.settlement.population * 0.02
    const utilization = Math.min(1, civilization.settlement.population / Math.max(1, capacity))
    const infrastructure: InfrastructureState = {
      roads,
      capacity,
      utilization,
      resilience: Math.max(0, Math.min(1, civilization.settlement.stability * 0.7 + (1 - utilization) * 0.3)),
      populationCapacity: civilization.settlement.infrastructureCapacity,
      pressure: Math.min(1, civilization.settlement.population / Math.max(1, civilization.settlement.infrastructureCapacity)),
    }

    const state = { civilization, nodes, infrastructure, produced: {}, consumed: {}, shortages: [] }
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
    next.produced = produced
    next.consumed = consumed
    next.shortages = [...new Set([...shortages, ...civTick.settlementTick.shortages])]
    this.states.set(id, next)
    return next
  }

  get(id: string) { return this.states.get(id) }
  all() { return [...this.states.values()] }
}

export const productionInfrastructureRuntime = new ProductionInfrastructureRuntime()
