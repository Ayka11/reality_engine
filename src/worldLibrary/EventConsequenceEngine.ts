import type { CivilizationType } from './CivilizationRuntime'
import type { WorldTimelineEvent } from './ProductionInfrastructureRuntime'

export type ConsequenceAction =
  | { type: 'growth-modifier'; multiplier: number; durationTicks: number; reason: string }
  | { type: 'stability-shift'; delta: number; reason: string }
  | { type: 'infrastructure-capacity'; amount: number; reason: string }
  | { type: 'production-profile'; civilization: CivilizationType; enabledNodes: string[]; reason: string }
  | { type: 'visual-transition'; civilization?: CivilizationType; tier?: string; visualKinds: string[]; reason: string }

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
}

export const eventConsequenceEngine = new EventConsequenceEngine()
