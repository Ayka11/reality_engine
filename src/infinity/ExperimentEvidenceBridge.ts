import type { ExperimentSnapshot } from './ExperimentRunner'
import type { ReplicationStudySummary } from './ReplicationStudy'
import { EvidenceClaimGraph } from './EvidenceClaimGraph'

export class ExperimentEvidenceBridge {
  readonly graph: EvidenceClaimGraph

  constructor(graph = new EvidenceClaimGraph()) {
    this.graph = graph
  }

  registerExperiment(snapshot: ExperimentSnapshot) {
    return this.graph.addExperiment(snapshot)
  }

  registerReplication(study: ReplicationStudySummary) {
    return this.graph.addReplicationStudy(study)
  }

  registerClaim(
    claimId: string,
    label: string,
    evidenceNodeId: string,
    statistic?: {
      id: string
      label: string
      payload: Record<string, unknown>
    },
  ) {
    const claim = this.graph.addClaim(claimId, label)
    let statisticId: string | undefined

    if (statistic) {
      const node = this.graph.addStatistic(statistic.id, statistic.label, statistic.payload)
      statisticId = node.id
    }

    this.graph.linkClaimToEvidence(claim.id, evidenceNodeId, statisticId)
    return claim
  }

  getTrace(claimId: string) {
    const id = claimId.startsWith('claim:') ? claimId : `claim:${claimId}`
    return this.graph.getRelated(id)
  }

  snapshot() {
    return this.graph.snapshot()
  }

  clear() {
    this.graph.clear()
  }
}
