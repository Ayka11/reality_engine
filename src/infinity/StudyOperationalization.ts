import type { StudySpecification } from './StudySpecification'

export type OperationalizedHypothesis = {
  hypothesisId: string
  independentVariables: string[]
  dependentVariables: string[]
  controlVariables: string[]
  primaryMetrics: string[]
  secondaryMetrics: string[]
  expectedDirection: 'positive' | 'negative' | 'none' | 'exploratory'
  comparison: 'difference' | 'ratio' | 'association' | 'distribution' | 'descriptive'
  tolerance?: number
}

export type StudyOperationalization = {
  schemaVersion: 'study-operationalization-v1'
  hypotheses: OperationalizedHypothesis[]
}

export function validateOperationalization(
  specification: StudySpecification,
  operationalization: StudyOperationalization,
): string[] {
  const issues: string[] = []
  const variables = new Map(specification.variables.map(variable => [variable.id, variable]))
  const hypotheses = new Map(specification.hypotheses.map(hypothesis => [hypothesis.id, hypothesis]))

  for (const mapping of operationalization.hypotheses) {
    if (!hypotheses.has(mapping.hypothesisId)) {
      issues.push(`Unknown hypothesis: ${mapping.hypothesisId}`)
      continue
    }

    const allVariables = [
      ...mapping.independentVariables,
      ...mapping.dependentVariables,
      ...mapping.controlVariables,
    ]

    for (const variableId of allVariables) {
      if (!variables.has(variableId)) {
        issues.push(`Hypothesis ${mapping.hypothesisId} references unknown variable: ${variableId}`)
      }
    }

    if (!mapping.dependentVariables.length) {
      issues.push(`Hypothesis ${mapping.hypothesisId} has no dependent variable.`)
    }

    if (!mapping.primaryMetrics.length) {
      issues.push(`Hypothesis ${mapping.hypothesisId} has no primary metric.`)
    }

    if (
      mapping.comparison === 'difference' ||
      mapping.comparison === 'ratio' ||
      mapping.comparison === 'association'
    ) {
      if (!mapping.independentVariables.length) {
        issues.push(`Hypothesis ${mapping.hypothesisId} requires an independent variable for its selected comparison.`)
      }
    }

    if (mapping.tolerance !== undefined && (!Number.isFinite(mapping.tolerance) || mapping.tolerance < 0)) {
      issues.push(`Hypothesis ${mapping.hypothesisId} has an invalid tolerance.`)
    }
  }

  const mappedIds = new Set(operationalization.hypotheses.map(mapping => mapping.hypothesisId))
  for (const hypothesis of specification.hypotheses) {
    if (!mappedIds.has(hypothesis.id)) {
      issues.push(`Hypothesis ${hypothesis.id} has no operationalization mapping.`)
    }
  }

  return issues
}

export function createDefaultOperationalization(
  specification: StudySpecification,
): StudyOperationalization {
  return {
    schemaVersion: 'study-operationalization-v1',
    hypotheses: specification.hypotheses.map(hypothesis => ({
      hypothesisId: hypothesis.id,
      independentVariables: specification.variables
        .filter(variable => hypothesis.variables.includes(variable.id) && variable.role === 'independent')
        .map(variable => variable.id),
      dependentVariables: specification.variables
        .filter(variable => hypothesis.variables.includes(variable.id) && variable.role === 'dependent')
        .map(variable => variable.id),
      controlVariables: specification.variables
        .filter(variable => hypothesis.variables.includes(variable.id) && variable.role === 'control')
        .map(variable => variable.id),
      primaryMetrics: [],
      secondaryMetrics: [],
      expectedDirection: hypothesis.expectedDirection ?? 'exploratory',
      comparison: 'descriptive',
    })),
  }
}
