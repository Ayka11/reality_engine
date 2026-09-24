import {
  InfinityScaleAdaptiveCompiledPlan,
  InfinityScaleCompiledTransfer,
} from "./InfinityScaleAdaptiveTransferCompiler";

export type InfinityScaleExecutionNodeType =
  | "TOPOLOGY_TRANSFER"
  | "CONSERVATION_VALIDATION"
  | "GPU_EXECUTION"
  | "COMMIT_BARRIER";

export interface InfinityScaleExecutionNode {
  nodeId: string;
  type: InfinityScaleExecutionNodeType;
  regionId?: string;
  transferId?: string;
  dependencyIds: string[];
  order: number;
}

export interface InfinityScaleAdaptiveExecutionGraph {
  nodes: InfinityScaleExecutionNode[];
  roots: string[];
  terminalNodeId?: string;
  graphHash: string;
  valid: boolean;
}

export class InfinityScaleAdaptiveExecutionGraphCompiler {
  compile(plan: InfinityScaleAdaptiveCompiledPlan): InfinityScaleAdaptiveExecutionGraph {
    const nodes: InfinityScaleExecutionNode[] = [];
    const transferNodes = new Map<string, string>();

    const transfers = [...plan.transfers].sort((a, b) =>
      a.transferId.localeCompare(b.transferId),
    );

    for (const transfer of transfers) {
      const nodeId = `transfer:${transfer.transferId}`;
      transferNodes.set(transfer.transferId, nodeId);
      nodes.push({
        nodeId,
        type: "TOPOLOGY_TRANSFER",
        regionId: transfer.regionId,
        transferId: transfer.transferId,
        dependencyIds: transfer.dependencyIds.map(
          (id) => transferNodes.get(id) ?? `transfer:${id}`,
        ),
        order: nodes.length,
      });
    }

    const transferNodeIds = transfers.map((transfer) => transferNodes.get(transfer.transferId)!);
    const conservationNodeId = "conservation:validate";
    nodes.push({
      nodeId: conservationNodeId,
      type: "CONSERVATION_VALIDATION",
      dependencyIds: transferNodeIds,
      order: nodes.length,
    });

    const gpuNodeId = "gpu:execute";
    nodes.push({
      nodeId: gpuNodeId,
      type: "GPU_EXECUTION",
      dependencyIds: [conservationNodeId],
      order: nodes.length,
    });

    const commitNodeId = "commit:barrier";
    nodes.push({
      nodeId: commitNodeId,
      type: "COMMIT_BARRIER",
      dependencyIds: [gpuNodeId],
      order: nodes.length,
    });

    const roots = nodes
      .filter((node) => node.dependencyIds.length === 0)
      .map((node) => node.nodeId);

    const graphHash = stableHash(
      JSON.stringify(
        nodes.map(({ nodeId, type, regionId, transferId, dependencyIds }) => ({
          nodeId,
          type,
          regionId,
          transferId,
          dependencyIds,
        })),
      ),
    );

    return {
      nodes,
      roots,
      terminalNodeId: commitNodeId,
      graphHash,
      valid: validateGraph(nodes, commitNodeId),
    };
  }
}

function validateGraph(nodes: InfinityScaleExecutionNode[], terminalNodeId: string): boolean {
  const ids = new Set(nodes.map((node) => node.nodeId));
  if (!ids.has(terminalNodeId)) return false;

  for (const node of nodes) {
    if (node.dependencyIds.includes(node.nodeId)) return false;
    for (const dependency of node.dependencyIds) {
      if (!ids.has(dependency)) return false;
    }
  }

  const state = new Map<string, number>();
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));

  const visit = (id: string): boolean => {
    const current = state.get(id) ?? 0;
    if (current === 1) return false;
    if (current === 2) return true;
    state.set(id, 1);
    for (const dependency of byId.get(id)!.dependencyIds) {
      if (!visit(dependency)) return false;
    }
    state.set(id, 2);
    return true;
  };

  if (!visit(terminalNodeId)) return false;
  return true;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
