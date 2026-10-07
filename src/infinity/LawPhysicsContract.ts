import type { PhysicsFieldParameters } from './FieldModulatedPhysics'

export type LawPhysicsState = {
  processes?: string[]
}

export class LawPhysicsContract {
  readonly version = 'law-physics-v1'

  constructor(
    private readonly lawProvider: () => LawPhysicsState | null | undefined,
  ) {}

  apply(base: PhysicsFieldParameters): PhysicsFieldParameters {
    const state = this.lawProvider() ?? {}
    const processes = new Set(state.processes ?? [])

    return {
      gravity: processes.has('gravity') ? base.gravity : 0,
      entropyDamping: processes.has('entropy') ? base.entropyDamping : 1,
      quantumLift: processes.has('info') ? base.quantumLift : 0,
      forcePush: processes.has('density') ? base.forcePush : 0,
      metaLawOrbit: processes.has('info') ? base.metaLawOrbit : 0,
    }
  }
}
