import type { ExperimentSnapshot } from './ExperimentRunner'
import type { ReplicationStudySummary } from './ReplicationStudy'
import { experimentConfigurationFingerprint } from './ExperimentFingerprint'

export type EvidenceNodeKind = 'claim' | 'experiment' | 'replication' | 'statistic' | 'protocol'

export type EvidenceNode = {
  id: string
  kind: EvidenceNodeKind
  label: string
  payload: Record<string, unknown>
}

export type EvidenceEdgeType =
  | 'supported-by'
  | 'replicated-by'
  | 'derived-from'
  | 'uses-protocol'

export type EvidenceEdge = {
  from: string
  to: string
  type: EvidenceEdgeType
}

export type EvidenceClaimGraphSnapshot = {
  nodes: EvidenceNode[]
  edges: EvidenceEdge[]
}

export class EvidenceClaimGraph {
  private readonly nodes = new Map<string, EvidenceNode>()
  private readonly edges: EvidenceEdge[] = []

  addNode(node: EvidenceNode) {
    this.nodes.set(node.id, node)
    return node
  }

  addEdge(edge: EvidenceEdge) {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      throw new Error('Evidence graph edge references an unknown node')
    }
    if (!this.edges.some(e => e.from === edge.from && e.to === edge.to && e.type === edge.type)) {
      this.edges.push(edge)
    }
    return edge
  }

  addExperiment(snapshot: ExperimentSnapshot) {
    const experimentId = `experiment:${snapshot.protocol.experimentId}`
    const configurationFingerprint = experimentConfigurationFingerprint(snapshot.protocol)
    const protocolId = `protocol:${configurationFingerprint}`

    this.addNode({
      id: experimentId,
      kind: 'experiment',
      label: snapshot.protocol.experimentId,
      payload: {
        fingerprint: snapshot.fingerprint,
        configurationFingerprint,
        status: snapshot.status,
        results: snapshot.results,
      },
    })

    this.addNode({
      id: protocolId,
      kind: 'protocol',
      label: `protocol ${configurationFingerprint}`,
      payload: snapshot.protocol as unknown as Record<string, unknown>,
    })

    this.addEdge({ from: experimentId, to: protocolId, type: 'uses-protocol' })
    return experimentId
  }

  addReplicationStudy(study: ReplicationStudySummary) {
    const id = `replication:${study.protocol.experimentId}`
    this.addNode({
      id,
      kind: 'replication',
      label: study.protocol.experimentId,
      payload: {
        repetitionsRequested: study.repetitionsRequested,
        repetitionsCompleted: study.repetitionsCompleted,
        repetitionsFailed: study.repetitionsFailed,
        tolerance: study.tolerance,
        metricSummary: study.metricSummary,
      },
    })

    for (const snapshot of study.snapshots) {
      const experimentId = this.addExperiment(snapshot)
      this.addEdge({ from: id, to: experimentId, type: 'replicated-by' })
    }
    return id
  }

  addClaim(claimId: string, label: string, payload: Record<string, unknown> = {}) {
    return this.addNode({
      id: claimId.startsWith('claim:') ? claimId : `claim:${claimId}`,
      kind: 'claim',
      label,
      payload,
    })
  }

  addStatistic(id: string, label: string, payload: Record<string, unknown>) {
    return this.addNode({
      id: id.startsWith('statistic:') ? id : `statistic:${id}`,
      kind: 'statistic',
      label,
      payload,
    })
  }

  linkClaimToEvidence(claimId: string, evidenceNodeId: string, statisticId?: string) {
    const claimNodeId = claimId.startsWith('claim:') ? claimId : `claim:${claimId}`
    this.addEdge({ from: claimNodeId, to: evidenceNodeId, type: 'supported-by' })
    if (statisticId) {
      this.addEdge({
        from: evidenceNodeId,
        to: statisticId.startsWith('statistic:') ? statisticId : `statistic:${statisticId}`,
        type: 'derived-from',
      })
    }
  }

  getNode(id: string) {
    return this.nodes.get(id)
  }

  getRelated(id: string) {
    return this.edges.filter(edge => edge.from === id || edge.to === id)
  }

  snapshot(): EvidenceClaimGraphSnapshot {
    return {
      nodes: [...this.nodes.values()].map(node => ({ ...node, payload: { ...node.payload } })),
      edges: [...this.edges],
    }
  }

  clear() {
    this.nodes.clear()
    this.edges.length = 0
  }
}
