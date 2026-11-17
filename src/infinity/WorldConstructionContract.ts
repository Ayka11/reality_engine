import type { WorldDecisionLayer } from './WorldDecisionLayer'
import type { WorldObject, WorldObjectKind } from './WorldObject'

export type ConstructionDecision = {
  allowed: boolean
  decision: ReturnType<WorldDecisionLayer['buildZoneCost']> | null
}

export class WorldConstructionContract {
  readonly #structural = new Set<WorldObjectKind>(['building', 'road', 'bridge', 'water'])
  readonly #decisions: WorldDecisionLayer

  constructor(decisions: WorldDecisionLayer) {
    this.#decisions = decisions
    Object.freeze(this)
  }

  authorize(kind: WorldObjectKind, x: number, z: number): ConstructionDecision {
    if (!this.#structural.has(kind)) return { allowed: true, decision: null }
    const decision = this.#decisions.buildZoneCost(x, z)
    return { allowed: decision.buildability.score >= 0.2 && decision.laws.penalty < 0.25, decision }
  }

  materialize(
    kind: WorldObjectKind,
    x: number,
    z: number,
    create: (decision: ConstructionDecision) => WorldObject,
  ): WorldObject | null {
    const decision = this.authorize(kind, x, z)
    if (!decision.allowed) return null
    return create(decision)
  }
}
