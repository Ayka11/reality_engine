import type { ExperimentSnapshot } from './ExperimentRunner'
import type { ReplicationStudySummary } from './ReplicationStudy'
import type { EvidenceClaimGraphSnapshot } from './EvidenceClaimGraph'

export type EvidenceValidationStatus =
  | 'supported'
  | 'partially_supported'
  | 'insufficient_evidence'

export type EvidenceValidationRequirement = {
  id: string
  passed: boolean
  description: string
}

export type EvidenceValidationResult = {
  claimId: string
  status: EvidenceValidationStatus
  requirements: EvidenceValidationRequirement[]
  completedExperiments: number
  replicationCount: number
  metricCount: number
}

export type EvidenceValidationOptions = {
  minCompletedExperiments?: number
  minReplications?: number
  requireStatistics?: boolean
  requireSameConfiguration?: boolean
}

export function validateClaimEvidence(
  claimId: string,
  graph: EvidenceClaimGraphSnapshot,
  experiments: ExperimentSnapshot[],
  replications: ReplicationStudySummary[],
  options: EvidenceValidationOptions = {},
): EvidenceValidationResult {
  const minCompletedExperiments = options.minCompletedExperiments ?? 1
  const minReplications = options.minReplications ?? 2
  const requireStatistics = options.requireStatistics ?? true
  const requireSameConfiguration = options.requireSameConfiguration ?? true

  const normalizedClaimId = claimId.startsWith('claim:') ? claimId : `claim:${claimId}`
  const claimExists = graph.nodes.some(node => node.id === normalizedClaimId)

  const relatedEdges = graph.edges.filter(
    edge => edge.from === normalizedClaimId || edge.to === normalizedClaimId,
  )

  const evidenceIds = new Set(
    relatedEdges
      .filter(edge => edge.type === 'supported-by')
      .map(edge => edge.to),
  )

  const completedExperiments = experiments.filter(
    experiment =>
      experiment.status === 'completed' &&
      [...evidenceIds].some(id => id === `experiment:${experiment.protocol.experimentId}`),
  )

  const relevantReplications = replications.filter(
    replication =>
      [...evidenceIds].some(id => id === `replication:${replication.protocol.experimentId}`),
  )

  const metricCount = relevantReplications.reduce(
    (count, replication) => count + Object.keys(replication.metricSummary).length,
    0,
  )

  const requirements: EvidenceValidationRequirement[] = [
    {
      id: 'claim-exists',
      passed: claimExists,
      description: 'Claim is registered in the evidence graph.',
    },
    {
      id: 'completed-experiments',
      passed: completedExperiments.length >= minCompletedExperiments,
      description: `At least ${minCompletedExperiments} completed experiment(s) are linked to the claim.`,
    },
    {
      id: 'replications',
      passed: relevantReplications.some(
        replication => replication.repetitionsCompleted >= minReplications,
      ),
      description: `At least one linked replication study contains ${minReplications} completed repetitions.`,
    },
    {
      id: 'statistics',
      passed: !requireStatistics || metricCount > 0,
      description: 'Linked replication evidence contains quantitative metric summaries.',
    },
    {
      id: 'configuration',
      passed:
        !requireSameConfiguration ||
        relevantReplications.every(replication => {
          const completed = replication.snapshots.filter(
            snapshot => snapshot.status === 'completed',
          )
          if (completed.length < 2) return false
          const fingerprint = JSON.stringify(completed[0].protocol)
          return completed.every(snapshot => JSON.stringify(snapshot.protocol) === fingerprint)
        }),
      description: 'Repeated runs use the same declared protocol configuration.',
    },
  ]

  const passed = requirements.filter(requirement => requirement.passed).length
  const required = requirements.length

  const status: EvidenceValidationStatus =
    passed === required
      ? 'supported'
      : passed >= Math.ceil(required / 2)
        ? 'partially_supported'
        : 'insufficient_evidence'

  return {
    claimId: normalizedClaimId,
    status,
    requirements,
    completedExperiments: completedExperiments.length,
    replicationCount: relevantReplications.reduce(
      (sum, replication) => sum + replication.repetitionsCompleted,
      0,
    ),
    metricCount,
  }
}
