import type { CivilizationExperimentScenario, CounterfactualOverride } from '../worldLibrary/CivilizationRuntime'
import type { CivilizationBatchScenario } from './CivilizationExperimentAdapter'

export type CivilizationIntervention = {
  id: string
  override: CounterfactualOverride
  label?: string
}

export type CivilizationExperimentMatrix = {
  sourceBranches: string[]
  interventions: CivilizationIntervention[]
  includeBaseline?: boolean
  ticks?: number
  delta?: number
  metadata?: Record<string, string | number | boolean>
  maxPlans?: number
}

export type CivilizationExperimentPlan = CivilizationBatchScenario & {
  index: number
}

function baselineScenario(sourceBranch: string): CivilizationExperimentScenario {
  return {
    id: 'baseline',
    sourceBranch,
    baseline: true,
    override: { reason: 'baseline counterfactual' },
  }
}

export function buildCivilizationExperimentMatrix(
  matrix: CivilizationExperimentMatrix,
): CivilizationExperimentPlan[] {
  const branches = matrix.sourceBranches.length ? matrix.sourceBranches : ['main']
  const interventions = matrix.interventions
  const includeBaseline = matrix.includeBaseline !== false

  if (interventions.length === 0 && !includeBaseline) {
    throw new Error('Civilization experiment matrix requires at least one intervention or a baseline')
  }

  const maxPlans = Math.max(1, Math.floor(matrix.maxPlans ?? 1000))
  if (branches.length > maxPlans) {
    throw new Error(`Civilization matrix contains ${branches.length} plans; maxPlans is ${maxPlans}`)
  }

  return branches.map((sourceBranch, index) => {
    const scenarios: CivilizationExperimentScenario[] = []
    if (includeBaseline) scenarios.push(baselineScenario(sourceBranch))

    for (const intervention of interventions) {
      scenarios.push({
        id: intervention.id,
        sourceBranch,
        override: intervention.override,
      })
    }

    return {
      index,
      experimentId: `civ-exp-${String(index + 1).padStart(4, '0')}`,
      sourceBranch,
      scenarios,
      ticks: matrix.ticks,
      delta: matrix.delta,
      metadata: {
        ...matrix.metadata,
        matrixIndex: index,
        interventionCount: interventions.length,
      },
    }
  })
}
