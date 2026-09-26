import type { CivilizationType } from './CivilizationRuntime'
import type { WorldTimelineEvent } from './ProductionInfrastructureRuntime'

export type ConsequenceAction =
  | { type: 'growth-modifier'; multiplier: number; durationTicks: number; reason: string }
  | { type: 'stability-shift'; delta: number; reason: string }
  | { type: 'infrastructure-capacity'; amount: number; reason: string }
  | { type: 'production-profile'; civilization: CivilizationType; enabledNodes: string[]; reason: string }
  | { type: 'visual-transition'; civilization?: CivilizationType; tier?: string; visualKinds: string[]; reason: string }

export type CausalEvent = WorldTimelineEvent & { parentEventId?: string; depth?: number }

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
  derive(event: WorldTimelineEvent): EventConsequence {
    const actions: ConsequenceAction[] = []

    if (event.type === 'resource-crisis') {
      actions.push(
        { type: 'growth-modifier', multiplier: 0.65, durationTicks: 3, reason: 'resource crisis reduces settlement growth' },
        { type: 'stability-shift', delta: -0.08, reason: 'resource shortage reduces stability' },
      )
    }

    if (event.type === 'growth') {
      actions.push({ type: 'growth-modifier', multiplier: 0.8, durationTicks: 2, reason: 'growth decline propagates through the causal chain' })
    }

    if (event.type === 'migration') {
      actions.push({ type: 'stability-shift', delta: -0.05, reason: 'migration temporarily reduces settlement stability' })
    }

    if (event.type === 'infrastructure-failure') {
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
    const queue = [...events]
    const result: CausalEvent[] = []
    const seen = new Set<string>()
    while (queue.length) {
      const event = queue.shift()!
      const depth = event.depth ?? 0
      if (seen.has(event.id) || depth > maxDepth) continue
      seen.add(event.id)
      result.push(event)
      if (event.type === 'resource-crisis' && depth < maxDepth) {
        queue.push({ id: event.id + ':growth-decline', year: event.year, type: 'growth', settlementId: event.settlementId, parentEventId: event.id, depth: depth + 1, details: 'Growth decline caused by resource crisis' })
      } else if (event.type === 'growth' && depth < maxDepth) {
        queue.push({ id: event.id + ':pressure', year: event.year, type: 'infrastructure-expansion', settlementId: event.settlementId, parentEventId: event.id, depth: depth + 1, details: 'Population pressure requires infrastructure response' })
        queue.push({ id: event.id + ':failure-risk', year: event.year, type: 'infrastructure-failure', settlementId: event.settlementId, parentEventId: event.id, depth: depth + 1, details: 'Persistent growth pressure creates infrastructure failure risk' })
      } else if (event.type === 'infrastructure-expansion' && depth < maxDepth) {
        queue.push({ id: event.id + ':civic-change', year: event.year, type: 'civilization-change', settlementId: event.settlementId, parentEventId: event.id, depth: depth + 1, from: 'agricultural', to: 'industrial', details: 'Infrastructure change alters civilization organization' })
      } else if (event.type === 'infrastructure-failure' && depth < maxDepth) {
        queue.push({ id: event.id + ':migration', year: event.year, type: 'migration', settlementId: event.settlementId, parentEventId: event.id, depth: depth + 1, details: 'Population migration follows infrastructure failure' })
      } else if (event.type === 'migration' && depth < maxDepth) {
        queue.push({ id: event.id + ':civic-change', year: event.year, type: 'civilization-change', settlementId: event.settlementId, parentEventId: event.id, depth: depth + 1, from: 'agricultural', to: 'industrial', details: 'Migration changes civilization organization' })
      }
    }
    return result
  }
}

export const eventConsequenceEngine = new EventConsequenceEngine()
