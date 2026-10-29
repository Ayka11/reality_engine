import type {
  GraphCompileIssue,
  GraphExecutionPlan,
  Port,
  RealityEdge,
  RealityGraph,
  RealityNode,
} from './types';

function portFor(node: RealityNode, portId: string, direction: Port['direction']): Port | undefined {
  const ports = direction === 'input' ? node.inputs : node.outputs;
  return ports.find(port => port.id === portId);
}

export class GraphCompiler {
  compile(graph: RealityGraph): GraphExecutionPlan {
    const issues: GraphCompileIssue[] = [];
    const enabledNodes = graph.nodes.filter(node => node.enabled);
    const nodeById = new Map(enabledNodes.map(node => [node.id, node]));
    const adjacency = new Map<string, string[]>();
    const indegree = new Map<string, number>();
    const validEdges: RealityEdge[] = [];

    for (const node of enabledNodes) {
      adjacency.set(node.id, []);
      indegree.set(node.id, 0);
    }

    for (const edge of graph.edges) {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) {
        issues.push({ level: 'warning', message: 'Edge references a disabled or missing node.', edgeId: edge.id });
        continue;
      }

      const sourcePort = portFor(source, edge.sourcePort, 'output');
      const targetPort = portFor(target, edge.targetPort, 'input');
      if (!sourcePort || !targetPort) {
        issues.push({ level: 'error', message: 'Edge references a missing port.', edgeId: edge.id });
        continue;
      }

      if (sourcePort.type !== targetPort.type) {
        issues.push({
          level: 'error',
          message: `Port type mismatch: ${source.label}.${sourcePort.name} is ${sourcePort.type}, ${target.label}.${targetPort.name} expects ${targetPort.type}.`,
          edgeId: edge.id,
        });
        continue;
      }

      validEdges.push(edge);
      adjacency.get(source.id)!.push(target.id);
      indegree.set(target.id, (indegree.get(target.id) ?? 0) + 1);
    }

    const queue = enabledNodes
      .filter(node => (indegree.get(node.id) ?? 0) === 0)
      .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
    const ordered: RealityNode[] = [];

    while (queue.length > 0) {
      const node = queue.shift()!;
      ordered.push(node);
      for (const nextId of adjacency.get(node.id) ?? []) {
        const nextDegree = (indegree.get(nextId) ?? 0) - 1;
        indegree.set(nextId, nextDegree);
        if (nextDegree === 0) {
          const nextNode = nodeById.get(nextId);
          if (nextNode) queue.push(nextNode);
        }
      }
      queue.sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
    }

    if (ordered.length !== enabledNodes.length) {
      issues.push({ level: 'error', message: 'Graph contains a cycle; execution order is partial.' });
    }

    const boundParameters = new Map<string, Record<string, unknown>>();
    for (const node of ordered) {
      boundParameters.set(node.id, { ...node.parameters });
    }

    const executionOrder = ordered.map(node => ({
      nodeId: node.id,
      type: node.type,
      category: node.category,
      label: node.label,
      processId: typeof node.parameters.processId === 'number' ? node.parameters.processId : undefined,
      lawId: typeof node.parameters.lawId === 'string' ? node.parameters.lawId : undefined,
      parameters: { ...node.parameters },
    }));

    const activeProcessIds = [...new Set(executionOrder
      .map(step => step.processId)
      .filter((processId): processId is number => typeof processId === 'number'))];

    return {
      executionOrder,
      boundParameters,
      gpuPasses: validEdges.length > 0 ? [{ id: 'future-wgsl-pipeline', label: 'WGSL shader generation stub' }] : [],
      activeProcessIds,
      issues,
    };
  }
}
