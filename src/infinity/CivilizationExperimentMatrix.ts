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
  combinationMode?: 'single' | 'powerset'
  maxCombinationSize?: number
}

export type CivilizationExperimentPlan = CivilizationBatchScenario & {
  index: number
}


function combineOverrides(interventions: CivilizationIntervention[]): CounterfactualOverride {
  const civilization = interventions.map((item) => item.override.civilization).find(Boolean)
  return {
    stabilityDelta: interventions.reduce((sum, item) => sum + (item.override.stabilityDelta ?? 0), 0),
    populationRatio: interventions.reduce((ratio, item) => ratio * (item.override.populationRatio ?? 1), 1),
    resilienceDelta: interventions.reduce((sum, item) => sum + (item.override.resilienceDelta ?? 0), 0),
    civilization,
    reason: interventions.map((item) => item.override.reason).join(' + '),
  }
}

export function buildInterventionCombinations(
  interventions: CivilizationIntervention[],
  mode: CivilizationExperimentMatrix['combinationMode'] = 'single',
  maxCombinationSize = interventions.length,
): CivilizationIntervention[] {
  if (mode === 'single') return [...interventions]
  const limit = Math.max(1, Math.min(maxCombinationSize, interventions.length))
  const combinations: CivilizationIntervention[] = []
  const walk = (start: number, selected: CivilizationIntervention[]) => {
    if (selected.length >= 2) {
      combinations.push({
        id: selected.map((item) => item.id).join('+'),
        label: selected.map((item) => item.label ?? item.id).join(' + '),
        override: combineOverrides(selected),
      })
    }
    if (selected.length >= limit) return
    for (let i = start; i < interventions.length; i++) {
      walk(i + 1, [...selected, interventions[i]])
    }
  }
  walk(0, [])
  return [...interventions, ...combinations]
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
  const interventions = buildInterventionCombinations(matrix.interventions, matrix.combinationMode, matrix.maxCombinationSize)
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
        combinationMode: matrix.combinationMode ?? 'single',
      },
    }
  })
}
