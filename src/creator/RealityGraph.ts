import { GraphCompiler } from './GraphCompiler';
import type { NodeId, PortId, RealityEdge, RealityGraph as RealityGraphData, RealityNode } from './types';

function edgeId(source: NodeId, sourcePort: PortId, target: NodeId, targetPort: PortId): string {
  return `edge_${source}_${sourcePort}_${target}_${targetPort}`;
}

export class RealityGraph implements RealityGraphData {
  nodes: RealityNode[] = [];
  edges: RealityEdge[] = [];
  metadata = {
    name: 'Creator Graph',
    version: '1.0.0',
    author: 'Reality Engine',
    timestamp: Date.now(),
  };

  private compiler = new GraphCompiler();

  addNode(node: RealityNode): RealityNode {
    this.nodes = [...this.nodes.filter(existing => existing.id !== node.id), node];
    this.metadata.timestamp = Date.now();
    return node;
  }

  updateNode(id: NodeId, patch: Partial<RealityNode>): RealityNode | null {
    const index = this.nodes.findIndex(node => node.id === id);
    if (index < 0) return null;
    const updated = { ...this.nodes[index], ...patch };
    this.nodes[index] = updated;
    this.metadata.timestamp = Date.now();
    return updated;
  }

  removeNode(id: NodeId): void {
    this.nodes = this.nodes.filter(node => node.id !== id);
    this.edges = this.edges.filter(edge => edge.source !== id && edge.target !== id);
    this.metadata.timestamp = Date.now();
  }

  connect(sourceId: NodeId, targetId: NodeId, sourcePort: PortId, targetPort: PortId): RealityEdge {
    const source = this.nodes.find(node => node.id === sourceId);
    const target = this.nodes.find(node => node.id === targetId);
    if (!source || !target) throw new Error('Cannot connect missing nodes.');

    const edge: RealityEdge = {
      id: edgeId(sourceId, sourcePort, targetId, targetPort),
      source: sourceId,
      sourcePort,
      target: targetId,
      targetPort,
    };
    this.edges = [...this.edges.filter(existing => existing.id !== edge.id), edge];
    this.metadata.timestamp = Date.now();
    return edge;
  }

  compileToPipeline() {
    return this.compiler.compile(this);
  }

  toJSON(): RealityGraphData {
    return {
      nodes: this.nodes,
      edges: this.edges,
      metadata: this.metadata,
    };
  }

  load(data: RealityGraphData): void {
    this.nodes = structuredClone(data.nodes);
    this.edges = structuredClone(data.edges);
    this.metadata = { ...data.metadata, timestamp: Date.now() };
  }
}
