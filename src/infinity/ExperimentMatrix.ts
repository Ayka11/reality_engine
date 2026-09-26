import type { DecisionWeights } from './WorldDecisionLayer'
import type { PhysicsFieldParameters } from './FieldModulatedPhysics'
import { createExperimentProtocol, type ExperimentProtocol } from './ExperimentProtocol'

export type ExperimentMatrix = {
  seeds: string[]
  fields: Array<{ id: string; version: string }>
  decisionWeights?: DecisionWeights[]
  physicsParameters?: PhysicsFieldParameters[]
  metadata?: Record<string, string | number | boolean>
  maxPlans?: number
}

export type ExperimentPlan = {
  index: number
  protocol: ExperimentProtocol
}

export function buildExperimentMatrix(matrix: ExperimentMatrix): ExperimentPlan[] {
  const seeds = matrix.seeds.length ? matrix.seeds : ['default']
  const fields = matrix.fields.length ? matrix.fields : [{ id: 'world-generator', version: 'world-generator-v1' }]
  const decisions = matrix.decisionWeights?.length ? matrix.decisionWeights : [undefined]
  const physics = matrix.physicsParameters?.length ? matrix.physicsParameters : [undefined]

  const total = seeds.length * fields.length * decisions.length * physics.length
  const maxPlans = Math.max(1, Math.floor(matrix.maxPlans ?? 1000))
  if (total > maxPlans) {
    throw new Error(`Experiment matrix contains ${total} plans; maxPlans is ${maxPlans}`)
  }

  const plans: ExperimentPlan[] = []
  let index = 0

  for (const seed of seeds) {
    for (const field of fields) {
      for (const weights of decisions) {
        for (const parameters of physics) {
          const experimentId = `exp-${String(index + 1).padStart(4, '0')}`
          plans.push({
            index,
            protocol: createExperimentProtocol({
              experimentId,
              world: {
                seed,
                generatorVersion: 'world-generator-v1',
              },
              field: {
                providerId: field.id,
                providerVersion: field.version,
              },
              decision: {
                version: 'world-decision-v1',
                weights: weights ?? {
                  slope: 0.30,
                  water: 0.25,
                  elevation: 0.15,
                  entropy: 0.08,
                  density: 0.05,
                  biology: 0.05,
                  information: 0.04,
                  distance: 0.08,
                },
              },
              physics: {
                version: 'field-physics-v1',
                parameters: parameters ?? {
                  gravity: 48,
                  entropyDamping: 0.82,
                  quantumLift: 35,
                  forcePush: 40,
                  metaLawOrbit: 22,
                },
              },
              metadata: matrix.metadata,
            }),
          })
          index++
        }
      }
    }
  }

  return plans
}
