export type NodeId = string;
export type PortId = string;

export type PortType = 'field' | 'process' | 'law' | 'event' | 'number' | 'boolean';
export type NodeCategory = 'Field' | 'Process' | 'Law' | 'Entity' | 'Temporal' | 'Causal' | 'World';

export interface Port {
  id: PortId;
  name: string;
  type: PortType;
  direction: 'input' | 'output';
  defaultValue?: unknown;
}

export interface RealityNode {
  id: NodeId;
  type: string;
  category: NodeCategory;
  label: string;
  position: { x: number; y: number };
  parameters: Record<string, unknown>;
  inputs: Port[];
  outputs: Port[];
  enabled: boolean;
  metadata: {
    description: string;
    color: string;
    icon?: string;
    gpuCost?: number;
  };
}

export interface RealityEdge {
  id: string;
  source: NodeId;
  sourcePort: PortId;
  target: NodeId;
  targetPort: PortId;
}

export interface RealityGraph {
  nodes: RealityNode[];
  edges: RealityEdge[];
  metadata: {
    name: string;
    version: string;
    author: string;
    timestamp: number;
  };
}

export interface ExecutionStep {
  nodeId: NodeId;
  type: string;
  category: NodeCategory;
  label: string;
  processId?: number;
  lawId?: string;
  parameters: Record<string, unknown>;
}

export interface GpuPassStub {
  id: string;
  label: string;
  wgsl?: string;
  workgroups?: number;
}

export interface GraphCompileIssue {
  level: 'error' | 'warning';
  message: string;
  edgeId?: string;
  nodeId?: NodeId;
}

export interface GraphExecutionPlan {
  executionOrder: ExecutionStep[];
  boundParameters: Map<NodeId, Record<string, unknown>>;
  gpuPasses: GpuPassStub[];
  activeProcessIds: number[];
  issues: GraphCompileIssue[];
}
