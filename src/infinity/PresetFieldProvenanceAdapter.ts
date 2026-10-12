import type { MutableWorldFieldProvider, WorldFieldMutation } from './MutableWorldFieldProvider'
import type { RuntimeProvenance } from './RuntimeProvenance'

export type PresetFieldCommit = {
  preset: string
  execution: 'worker' | 'voxel'
  tick?: number
  fieldMutationId: number
  provenanceEventId: string
}

/**
 * Commits an already-authorized preset execution into the authoritative field
 * and provenance layers. It never invents physical field values from worker
 * statistics: an optional explicit delta is required to mutate field values.
 */
export class PresetFieldProvenanceAdapter {
  constructor(
    private readonly field: MutableWorldFieldProvider,
    private readonly provenance: RuntimeProvenance,
  ) {}

  commit(input: {
    preset: string
    execution: 'worker' | 'voxel'
    tick?: number
    delta?: Parameters<MutableWorldFieldProvider['apply']>[0]['delta']
    region?: { x: number; y: number; z: number; radius: number }
    metadata?: Record<string, unknown>
  }): PresetFieldCommit {
    if (typeof input.preset !== 'string' || input.preset.trim().length === 0) {
      throw new Error('Preset name must be a non-empty string')
    }
    if (input.execution !== 'worker' && input.execution !== 'voxel') {
      throw new Error('Unsupported preset execution mode')
    }
    if (input.delta && !input.region) {
      throw new Error('Preset field delta requires an explicit spatial region')
    }
    if (input.delta && Object.keys(input.delta).length === 0) {
      throw new Error('Preset field delta must contain at least one field')
    }
    if (input.delta && !Object.values(input.delta).every(Number.isFinite)) {
      throw new Error('Preset field delta values must be finite')
    }
    const supportedFields = new Set(['energy', 'density', 'information', 'entropy', 'temperature', 'biology', 'material'])
    if (input.delta && Object.keys(input.delta).some(field => !supportedFields.has(field))) {
      throw new Error('Preset field delta contains an unsupported field')
    }
    if (input.region && (![input.region.x, input.region.y, input.region.z, input.region.radius].every(Number.isFinite) || input.region.radius <= 0)) {
      throw new Error('Preset field region must have finite coordinates and a positive radius')
    }
    const event = this.provenance.record('preset', {
      ...(input.metadata ?? {}),
      preset: input.preset,
      execution: input.execution,
      tick: input.tick,
      region: input.region,
    })
    const mutation: Omit<WorldFieldMutation, 'id'> = {
      kind: 'preset',
      ...(input.region ?? {}),
      delta: input.delta,
      metadata: { ...(input.metadata ?? {}), provenanceEventId: event.id, preset: input.preset, execution: input.execution, region: input.region },
    }
    const committed = this.field.apply(mutation)
    return { preset: input.preset, execution: input.execution, tick: input.tick, fieldMutationId: committed.id, provenanceEventId: event.id }
  }
}
