import type { DecisionRecord } from './DecisionRecord'

function cloneNode(node: DecisionGraphNode): DecisionGraphNode {
  return structuredClone(node)
}

function cloneEdge(edge: DecisionGraphEdge): DecisionGraphEdge {
  return { ...edge }
}

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
    const committed = cloneNode(node)
    this.nodes.set(committed.id, committed)
    return cloneNode(committed)
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
    return cloneEdge(edge)
  }

  getNode(id: string) {
    const node = this.nodes.get(id)
    return node ? cloneNode(node) : undefined
  }

  getNodes() {
    return [...this.nodes.values()].map(cloneNode)
  }

  getEdges() {
    return this.edges.map(cloneEdge)
  }

  relatedTo(id: string) {
    const linked = new Set<string>()
    for (const edge of this.edges) {
      if (edge.from === id) linked.add(edge.to)
      if (edge.to === id) linked.add(edge.from)
    }
    return [...linked]
      .map((nodeId) => this.nodes.get(nodeId))
      .filter((node): node is DecisionGraphNode => Boolean(node))
      .map(cloneNode)
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
