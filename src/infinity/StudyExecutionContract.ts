import type { StudySpecification } from './StudySpecification'
import { validateStudySpecification } from './StudySpecification'
import { buildExperimentMatrix, type ExperimentPlan } from './ExperimentMatrix'

export type StudyExecutionContract = {
  contractVersion: 'study-execution-contract-v1'
  studyId: string
  specificationFingerprint: string
  plans: ExperimentPlan[]
  replicationCount: number
  tolerance: number
}

export type StudyPreflightResult = {
  executable: boolean
  errors: string[]
  warnings: string[]
  contract?: StudyExecutionContract
}

function fingerprintSpecification(specification: StudySpecification): string {
  const serialized = JSON.stringify(specification)
  let hash = 2166136261
  for (let i = 0; i < serialized.length; i++) {
    hash ^= serialized.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function createStudyExecutionContract(
  specification: StudySpecification,
): StudyPreflightResult {
  const errors = validateStudySpecification(specification)
  const warnings: string[] = []

  if (!specification.analysisPlan.descriptiveStatistics) {
    warnings.push('Descriptive statistics are disabled.')
  }

  if (!specification.analysisPlan.replication) {
    warnings.push('Replication analysis is disabled.')
  }

  if (!specification.analysisPlan.generalization) {
    warnings.push('Generalization analysis is disabled.')
  }

  if (specification.acceptanceCriteria.requireReplication && specification.replicationCount < 2) {
    errors.push('Replication is required but replicationCount is less than 2.')
  }

  if (
    specification.acceptanceCriteria.requireGeneralization &&
    specification.generalizationDimensions.length === 0
  ) {
    errors.push('Generalization is required but no generalization dimension is configured.')
  }

  if (errors.length) {
    return {
      executable: false,
      errors,
      warnings,
    }
  }

  let plans: ExperimentPlan[]

  try {
    plans = buildExperimentMatrix(specification.matrix)
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
    return {
      executable: false,
      errors,
      warnings,
    }
  }

  if (!plans.length) {
    errors.push('Experiment matrix produced no execution plans.')
    return {
      executable: false,
      errors,
      warnings,
    }
  }

  return {
    executable: true,
    errors: [],
    warnings,
    contract: {
      contractVersion: 'study-execution-contract-v1',
      studyId: specification.studyId,
      specificationFingerprint: fingerprintSpecification(specification),
      plans,
      replicationCount: specification.replicationCount,
      tolerance: specification.tolerance,
    },
  }
}
