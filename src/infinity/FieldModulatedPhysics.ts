import type { ScientificFieldSample } from './FieldSampler'

export type PhysicsFieldParameters = {
  gravity: number
  entropyDamping: number
  quantumLift: number
  forcePush: number
  metaLawOrbit: number
}

export const DEFAULT_PHYSICS_PARAMETERS: Readonly<PhysicsFieldParameters> = Object.freeze({
  gravity: 48,
  entropyDamping: 0.82,
  quantumLift: 35,
  forcePush: 40,
  metaLawOrbit: 22,
})

/**
 * Converts local scientific state into bounded interaction multipliers.
 * These are simulation parameters, not experimentally validated physical laws.
 */
export class FieldModulatedPhysics {
  readonly version = 'field-physics-v1'

  readonly parameters: Readonly<PhysicsFieldParameters>

  constructor(parameters: Readonly<PhysicsFieldParameters> = DEFAULT_PHYSICS_PARAMETERS) {
    // Detach and freeze configuration so caller-held references cannot change
    // the physics model during an active simulation frame.
    this.parameters = Object.freeze({ ...parameters })
  }

  modulation(field: ScientificFieldSample) {
    return {
      gravity: this.parameters.gravity * this.clamp(0.65 + field.energy * 0.35),
      entropyDamping: this.clamp(this.parameters.entropyDamping + field.entropy * 0.18),
      quantumLift: this.parameters.quantumLift * this.clamp(0.75 + field.information / 100),
      forcePush: this.parameters.forcePush * this.clamp(0.75 + field.density * 0.25),
      metaLawOrbit: this.parameters.metaLawOrbit * this.clamp(0.75 + field.information / 100),
    }
  }

  private clamp(value: number) {
    return Math.max(0.35, Math.min(1.65, value))
  }
}
