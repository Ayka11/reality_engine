import type { DecisionWeights } from './WorldDecisionLayer'
import type { PhysicsFieldParameters } from './FieldModulatedPhysics'

export type ExperimentProtocol = {
  protocolVersion: string
  experimentId: string
  timestamp: number
  world: {
    seed: string
    generatorVersion: string
  }
  field: {
    providerId: string
    providerVersion: string
  }
  decision: {
    version: string
    weights: DecisionWeights
  }
  physics: {
    version: string
    parameters: PhysicsFieldParameters
  }
  runtime?: Record<string, number>
  metadata?: Record<string, string | number | boolean>
}

export function createExperimentProtocol(input: Omit<ExperimentProtocol, 'protocolVersion' | 'timestamp'>): ExperimentProtocol {
  return {
    protocolVersion: 'experiment-protocol-v1',
    timestamp: Date.now(),
    ...input,
  }
}
