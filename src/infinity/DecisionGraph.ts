import type { DecisionRecord } from './DecisionRecord'

export type DecisionEdgeType =
  | 'supports'
  | 'derived-from'
  | 'created'
  | 'selected'
  | 'route-to'

export type DecisionGraphNode = {
  id: string
  kind: 'decision' | 'world-object' | 'analysis'
  label: string
  data?: Record<string, unknown>
}

export type DecisionGraphEdge = {
  from: string
  to: string
  type: DecisionEdgeType
}

export class DecisionGraph {
  private nodes = new Map<string, DecisionGraphNode>()
  private edges: DecisionGraphEdge[] = []

  addNode(node: DecisionGraphNode) {
    this.nodes.set(node.id, node)
    return node
  }

  addDecision<TInput extends Record<string, unknown>, TOutput extends Record<string, unknown>>(
    record: DecisionRecord<TInput, TOutput>,
    label = record.type,
  ) {
    return this.addNode({
      id: record.id,
      kind: 'decision',
      label,
      data: record as unknown as Record<string, unknown>,
    })
  }

  addEdge(from: string, to: string, type: DecisionEdgeType) {
    const edge = { from, to, type }
    this.edges.push(edge)
    return edge
  }

  getNode(id: string) {
    return this.nodes.get(id)
  }

  getNodes() {
    return [...this.nodes.values()]
  }

  getEdges() {
    return [...this.edges]
  }

  relatedTo(id: string) {
    const linked = new Set<string>()
    for (const edge of this.edges) {
      if (edge.from === id) linked.add(edge.to)
      if (edge.to === id) linked.add(edge.from)
    }
    return [...linked].map((nodeId) => this.nodes.get(nodeId)).filter(Boolean) as DecisionGraphNode[]
  }

  clear() {
    this.nodes.clear()
    this.edges = []
  }

  snapshot() {
    return {
      nodes: this.getNodes(),
      edges: this.getEdges(),
    }
  }
}
