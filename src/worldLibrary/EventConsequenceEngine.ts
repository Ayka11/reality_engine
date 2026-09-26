import type { CivilizationType } from './CivilizationRuntime'
import type { WorldTimelineEvent } from './ProductionInfrastructureRuntime'

export type ConsequenceAction =
  | { type: 'growth-modifier'; multiplier: number; durationTicks: number; reason: string }
  | { type: 'stability-shift'; delta: number; reason: string }
  | { type: 'population-shift'; deltaRatio: number; reason: string }
  | { type: 'production-efficiency'; multiplier: number; durationTicks: number; reason: string }
  | { type: 'adaptation-strategy'; strategy: 'conservation' | 'infrastructure' | 'technology' | 'migration'; effectiveness: number; durationTicks: number; reason: string }
  | { type: 'infrastructure-capacity'; amount: number; reason: string }
  | { type: 'production-profile'; civilization: CivilizationType; enabledNodes: string[]; reason: string }
  | { type: 'visual-transition'; civilization?: CivilizationType; tier?: string; visualKinds: string[]; reason: string }

export type CausalEvent = WorldTimelineEvent & { parentEventId?: string; depth?: number; severity?: number; trigger?: string }

export type CausalEventQueueItem = CausalEvent & { priority?: number; sourceEvents?: string[] }

export type CausalChainNode = {
  event: CausalEvent
  parentEventId?: string
  depth: number
  severity: number
}

export type EventConsequence = {
  eventId: string
  eventType: WorldTimelineEvent['type']
  actions: ConsequenceAction[]
}

const productionProfile = (type: CivilizationType) => type === 'agricultural'
  ? ['agriculture']
  : type === 'industrial'
    ? ['agriculture', 'industry']
    : ['agriculture', 'industry', 'research']

export class EventConsequenceEngine {
  mergeCompetingCauses(events: CausalEvent[]): CausalEvent[] {
    const merged = new Map<string, CausalEvent>()
    for (const event of events) {
      const existing = merged.get(event.id)
      if (!existing || (event.severity ?? 0) > (existing.severity ?? 0)) merged.set(event.id, event)
    }
    return [...merged.values()].sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0))
  }

  derive(event: WorldTimelineEvent | CausalEvent): EventConsequence {
    const actions: ConsequenceAction[] = []
    const severity: number = 'severity' in event ? (event.severity ?? 1) : 1

    if (event.type === 'resource-crisis') {
      actions.push({ type: 'adaptation-strategy', strategy: event.details.includes('drought') ? 'technology' : 'conservation', effectiveness: 0.5, durationTicks: 3, reason: 'resource crisis triggers adaptive resource management' })
      if (event.details.includes('drought')) actions.push({ type: 'production-efficiency', multiplier: 0.75, durationTicks: 4, reason: 'drought reduces production efficiency' })
      actions.push(
        { type: 'growth-modifier', multiplier: 0.65, durationTicks: 3, reason: 'resource crisis reduces settlement growth' },
        { type: 'stability-shift', delta: -0.08, reason: 'resource shortage reduces stability' },
      )
    }

    if (event.type === 'growth') {
      if (event.details.includes('environmental instability')) actions.push({ type: 'stability-shift', delta: -0.07, reason: 'environmental instability reduces social stability' })
      if (severity >= 0.8) actions.push({ type: 'stability-shift', delta: -0.03, reason: 'high-severity growth pressure increases social instability' })
      actions.push({ type: 'growth-modifier', multiplier: 0.8, durationTicks: 2, reason: 'growth decline propagates through the causal chain' })
    }

    if (event.type === 'migration') {
      actions.push({ type: 'adaptation-strategy', strategy: 'migration', effectiveness: 0.45, durationTicks: 3, reason: 'migration becomes an adaptive response' })
      actions.push(
        { type: 'stability-shift', delta: -0.05, reason: 'migration temporarily reduces settlement stability' },
        { type: 'population-shift', deltaRatio: -0.08 * severity, reason: 'migration reduces local population' },
      )
    }

    if (event.type === 'infrastructure-failure') {
      actions.push({ type: 'adaptation-strategy', strategy: 'infrastructure', effectiveness: 0.65, durationTicks: 4, reason: 'infrastructure failure triggers structural adaptation' })
      actions.push({ type: 'production-efficiency', multiplier: 0.7, durationTicks: 3, reason: 'infrastructure failure reduces production efficiency' })
      if (severity >= 0.7) actions.push({ type: 'stability-shift', delta: -0.1, reason: 'severe infrastructure failure increases instability' })
      actions.push({ type: 'growth-modifier', multiplier: 0.55, durationTicks: 2, reason: 'infrastructure failure suppresses growth' })
    }

    if (event.type === 'infrastructure-expansion') {
      actions.push({
        type: 'infrastructure-capacity',
        amount: 1,
        reason: 'infrastructure expansion increases settlement carrying capacity',
      })
    }

    if (event.type === 'tier-transition') {
      actions.push({
        type: 'visual-transition',
        tier: event.to,
        visualKinds: event.to === 'megacity' ? ['building', 'road', 'quantum_emitter'] : ['building', 'road'],
        reason: 'settlement tier transition materializes the new urban form',
      })
    }

    if (event.type === 'civilization-change' && event.to) {
      const civilization = event.to as CivilizationType
      actions.push(
        {
          type: 'production-profile',
          civilization,
          enabledNodes: productionProfile(civilization),
          reason: 'civilization transition changes active production profile',
        },
        {
          type: 'visual-transition',
          civilization,
          visualKinds: civilization === 'post-scarcity'
            ? ['building', 'road', 'quantum_emitter']
            : ['building', 'road'],
          reason: 'civilization transition changes the physical settlement signature',
        },
      )
    }

    return { eventId: event.id, eventType: event.type, actions }
  }

  deriveMany(events: WorldTimelineEvent[]) {
    return events.map((event) => this.derive(event))
  }

  deriveCausalEvents(events: CausalEvent[], maxDepth = 4): CausalEvent[] {
    const queue = [...this.mergeCompetingCauses(events)]
    const result: CausalEvent[] = []
    const seen = new Set<string>()
    while (queue.length) {
      const event = queue.shift()!
      const depth = event.depth ?? 0
      const severity = Math.max(0, Math.min(1, event.severity ?? 1))
      if (seen.has(event.id) || depth > maxDepth || severity < 0.2) continue
      seen.add(event.id)
      result.push({ ...event, severity })
      if (event.type === 'resource-crisis' && depth < maxDepth) {
        queue.push({ id: event.id + ':growth-decline', year: event.year, type: 'growth', settlementId: event.settlementId, parentEventId: event.id, depth: depth + 1, severity: severity * 0.85, trigger: 'resource-crisis', details: 'Growth decline caused by resource crisis' })
      } else if (event.type === 'growth' && depth < maxDepth) {
        queue.push({ id: event.id + ':pressure', year: event.year, type: 'infrastructure-expansion', settlementId: event.settlementId, parentEventId: event.id, depth: depth + 1, severity: severity * 0.9, trigger: 'population-pressure', details: 'Population pressure requires infrastructure response' })
      } else if (event.type === 'infrastructure-failure' && depth < maxDepth) {
        queue.push({ id: event.id + ':migration', year: event.year, type: 'migration', settlementId: event.settlementId, parentEventId: event.id, depth: depth + 1, severity: severity * 0.9, trigger: 'infrastructure-failure', details: 'Population migration follows infrastructure failure' })
      } else if (event.type === 'migration' && depth < maxDepth) {
        queue.push({ id: event.id + ':civic-change', year: event.year, type: 'civilization-change', settlementId: event.settlementId, parentEventId: event.id, depth: depth + 1, severity: severity * 0.8, trigger: 'migration', from: 'agricultural', to: 'industrial', details: 'Migration changes civilization organization' })
      }
    }
    return result
  }
}

export const eventConsequenceEngine = new EventConsequenceEngine()
