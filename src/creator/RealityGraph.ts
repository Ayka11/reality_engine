import { GraphCompiler } from './GraphCompiler';
import type { NodeId, PortId, RealityEdge, RealityGraph as RealityGraphData, RealityNode, Port } from './types';

function edgeId(source: NodeId, sourcePort: PortId, target: NodeId, targetPort: PortId): string {
  return `edge_${source}_${sourcePort}_${target}_${targetPort}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid reality graph: ${path} must be a non-empty string`);
  }
}

function validatePort(value: unknown, path: string, expectedDirection: Port['direction']): asserts value is Port {
  if (!isRecord(value)) throw new Error(`Invalid reality graph: ${path} must be an object`);
  requireString(value.id, `${path}.id`);
  requireString(value.name, `${path}.name`);
  requireString(value.type, `${path}.type`);
  if (value.direction !== expectedDirection) {
    throw new Error(`Invalid reality graph: ${path}.direction must be ${expectedDirection}`);
  }
}

function validateNode(value: unknown, index: number): asserts value is RealityNode {
  const path = `nodes[${index}]`;
  if (!isRecord(value)) throw new Error(`Invalid reality graph: ${path} must be an object`);
  requireString(value.id, `${path}.id`);
  requireString(value.type, `${path}.type`);
  requireString(value.category, `${path}.category`);
  requireString(value.label, `${path}.label`);
  if (!isRecord(value.position) ||
      typeof value.position.x !== 'number' || !Number.isFinite(value.position.x) ||
      typeof value.position.y !== 'number' || !Number.isFinite(value.position.y)) {
    throw new Error(`Invalid reality graph: ${path}.position must contain finite x/y coordinates`);
  }
  if (!isRecord(value.parameters)) {
    throw new Error(`Invalid reality graph: ${path}.parameters must be an object`);
  }
  if (!Array.isArray(value.inputs) || !Array.isArray(value.outputs)) {
    throw new Error(`Invalid reality graph: ${path}.inputs and outputs must be arrays`);
  }
  if (typeof value.enabled !== 'boolean') {
    throw new Error(`Invalid reality graph: ${path}.enabled must be a boolean`);
  }
  if (!isRecord(value.metadata)) {
    throw new Error(`Invalid reality graph: ${path}.metadata must be an object`);
  }
  requireString(value.metadata.description, `${path}.metadata.description`);
  requireString(value.metadata.color, `${path}.metadata.color`);
  if (value.metadata.icon !== undefined && typeof value.metadata.icon !== 'string') {
    throw new Error(`Invalid reality graph: ${path}.metadata.icon must be a string`);
  }
  if (value.metadata.gpuCost !== undefined &&
      (typeof value.metadata.gpuCost !== 'number' || !Number.isFinite(value.metadata.gpuCost) || value.metadata.gpuCost < 0)) {
    throw new Error(`Invalid reality graph: ${path}.metadata.gpuCost must be a finite non-negative number`);
  }

  for (const [direction, ports] of [['input', value.inputs], ['output', value.outputs]] as const) {
    const ids = new Set<string>();
    ports.forEach((port, portIndex) => {
      validatePort(port, `${path}.${direction}s[${portIndex}]`, direction);
      if (ids.has(port.id)) {
        throw new Error(`Invalid reality graph: duplicate ${direction} port ID "${port.id}" on node "${value.id}"`);
      }
      ids.add(port.id);
    });
  }
}

/**
 * Validate the persisted graph envelope and detach it before publishing it.
 * Referential and type compatibility issues are deliberately left to GraphCompiler
 * so older or partially-authored graphs remain inspectable and diagnosable.
 */
export function cloneValidatedRealityGraph(data: unknown): RealityGraphData {
  if (!isRecord(data) || !Array.isArray(data.nodes) || !Array.isArray(data.edges) || !isRecord(data.metadata)) {
    throw new Error('Invalid reality graph: expected nodes, edges and metadata');
  }

  requireString(data.metadata.name, 'metadata.name');
  requireString(data.metadata.version, 'metadata.version');
  requireString(data.metadata.author, 'metadata.author');
  if (typeof data.metadata.timestamp !== 'number' || !Number.isFinite(data.metadata.timestamp)) {
    throw new Error('Invalid reality graph: metadata.timestamp must be finite');
  }

  const nodeIds = new Set<string>();
  data.nodes.forEach((node, index) => {
    validateNode(node, index);
    if (nodeIds.has(node.id)) {
      throw new Error(`Invalid reality graph: duplicate node ID "${node.id}"`);
    }
    nodeIds.add(node.id);
  });

  const edgeIds = new Set<string>();
  data.edges.forEach((edge, index) => {
    const path = `edges[${index}]`;
    if (!isRecord(edge)) throw new Error(`Invalid reality graph: ${path} must be an object`);
    requireString(edge.id, `${path}.id`);
    requireString(edge.source, `${path}.source`);
    requireString(edge.sourcePort, `${path}.sourcePort`);
    requireString(edge.target, `${path}.target`);
    requireString(edge.targetPort, `${path}.targetPort`);
    if (edgeIds.has(edge.id)) throw new Error(`Invalid reality graph: duplicate edge ID "${edge.id}"`);
    edgeIds.add(edge.id);
  });

  return structuredClone(data) as unknown as RealityGraphData;
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
    const candidate = cloneValidatedRealityGraph(data);
    this.nodes = candidate.nodes;
    this.edges = candidate.edges;
    this.metadata = { ...candidate.metadata, timestamp: Date.now() };
  }
}
