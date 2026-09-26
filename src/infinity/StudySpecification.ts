import type { ExperimentMatrix } from './ExperimentMatrix'
import type { GeneralizationDimension } from './ExperimentGeneralization'

export type StudyVariable = {
  id: string
  name: string
  role: 'independent' | 'dependent' | 'control' | 'derived'
  unit?: string
  description?: string
}

export type StudyHypothesis = {
  id: string
  statement: string
  variables: string[]
  expectedDirection?: 'positive' | 'negative' | 'none' | 'exploratory'
}

export type StudySpecification = {
  schemaVersion: 'study-specification-v1'
  studyId: string
  researchQuestion: string
  hypotheses: StudyHypothesis[]
  variables: StudyVariable[]
  matrix: ExperimentMatrix
  replicationCount: number
  tolerance: number
  generalizationDimensions: GeneralizationDimension[]
  analysisPlan: {
    descriptiveStatistics: boolean
    effectSize: boolean
    replication: boolean
    generalization: boolean
  }
  acceptanceCriteria: {
    requireCompletedRuns: boolean
    requireReplication: boolean
    requireGeneralization: boolean
  }
  metadata?: Record<string, string | number | boolean>
}

export function validateStudySpecification(
  specification: StudySpecification,
): string[] {
  const issues: string[] = []

  if (!specification.studyId.trim()) issues.push('studyId is required')
  if (!specification.researchQuestion.trim()) issues.push('researchQuestion is required')
  if (!specification.hypotheses.length) issues.push('At least one hypothesis is required')
  if (!specification.variables.length) issues.push('At least one study variable is required')
  if (!Number.isInteger(specification.replicationCount) || specification.replicationCount < 1) {
    issues.push('replicationCount must be a positive integer')
  }
  if (!Number.isFinite(specification.tolerance) || specification.tolerance < 0) {
    issues.push('tolerance must be a non-negative finite number')
  }
  if (!specification.generalizationDimensions.length) {
    issues.push('At least one generalization dimension is required')
  }

  const variableIds = new Set(specification.variables.map(variable => variable.id))

  for (const hypothesis of specification.hypotheses) {
    if (!hypothesis.id.trim()) issues.push('Each hypothesis requires an id')
    for (const variableId of hypothesis.variables) {
      if (!variableIds.has(variableId)) {
        issues.push(`Hypothesis ${hypothesis.id} references unknown variable ${variableId}`)
      }
    }
  }

  return issues
}
