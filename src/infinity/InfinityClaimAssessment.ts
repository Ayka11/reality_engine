import type { EvidenceClaimGraphSnapshot } from './EvidenceClaimGraph'
import type { ReplicationStudySummary } from './ReplicationStudy'
import type { CrossDimensionGeneralizationResult } from './ExperimentGeneralization'
import type { ExperimentSnapshot } from './ExperimentRunner'
import { validateClaimEvidence, type EvidenceValidationOptions, type EvidenceValidationResult } from './EvidenceValidator'

export type InfinityClaimAssessment = {
  claimId: string
  validation: EvidenceValidationResult
  replicationConsistency: number | null
  generalizationConsistency: number | null
  status: 'supported' | 'partially_supported' | 'insufficient_evidence'
  rationale: string[]
}

export function assessInfinityClaim(
  claimId: string,
  graph: EvidenceClaimGraphSnapshot,
  experiments: ExperimentSnapshot[],
  replications: ReplicationStudySummary[],
  generalization?: CrossDimensionGeneralizationResult,
  options: EvidenceValidationOptions = {},
): InfinityClaimAssessment {
  const validation = validateClaimEvidence(claimId, graph, experiments, replications, options)
  const replicationValues = replications
    .flatMap(item => Object.values(item.metricSummary).map(metric => metric.withinToleranceRate))
    .filter((value): value is number => value !== null)
  const replicationConsistency = replicationValues.length
    ? replicationValues.reduce((sum, value) => sum + value, 0) / replicationValues.length
    : null
  const generalizationConsistency = generalization?.overallDirectionConsistency ?? null

  const rationale = validation.requirements
    .filter(requirement => requirement.passed)
    .map(requirement => requirement.description)

  if (replicationConsistency !== null) rationale.push(`Mean replication tolerance consistency: ${replicationConsistency.toFixed(3)}.`)
  if (generalizationConsistency !== null) rationale.push(`Cross-dimension direction consistency: ${generalizationConsistency.toFixed(3)}.`)

  return {
    claimId: validation.claimId,
    validation,
    replicationConsistency,
    generalizationConsistency,
    status: validation.status,
    rationale,
  }
}
