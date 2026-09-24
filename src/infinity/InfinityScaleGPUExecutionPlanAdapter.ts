import { InfinityScaleAdaptiveExecutionGraph } from "./InfinityScaleAdaptiveExecutionGraphCompiler";

export interface InfinityScaleGPUExecutionBudget {
  maxDispatches: number;
  maxWorkgroups: number;
  maxDescriptors: number;
}

export interface InfinityScaleGPUDispatchUnit {
  batchId: string;
  nodeId: string;
  executionClass: InfinityScaleGPUExecutionClass;
  workgroups: number;
  descriptors: number;
  dependencyBatchIds: string[];
  priorityScore: number;
}

export type InfinityScaleGPUExecutionClass =
  | "DEADLINE_CLASS_0"
  | "DEADLINE_CLASS_1"
  | "DEADLINE_CLASS_2";

export interface InfinityScaleGPUExecutionPlan {
  dispatches: InfinityScaleGPUDispatchUnit[];
  deferredNodeIds: string[];
  usedDispatches: number;
  usedWorkgroups: number;
  usedDescriptors: number;
  planHash: string;
  valid: boolean;
}

export interface InfinityScaleGPUDispatchCandidate {
  nodeId: string;
  priorityScore?: number;
  executionClass?: InfinityScaleGPUExecutionClass;
  workgroups?: number;
  descriptors?: number;
}

export class InfinityScaleGPUExecutionPlanAdapter {
  compile(
    graph: InfinityScaleAdaptiveExecutionGraph,
    budget: InfinityScaleGPUExecutionBudget,
    candidates: InfinityScaleGPUDispatchCandidate[] = [],
  ): InfinityScaleGPUExecutionPlan {
    if (!graph.valid || budget.maxDispatches < 0 || budget.maxWorkgroups < 0 || budget.maxDescriptors < 0) {
      return this.empty(false);
    }

    const candidateMap = new Map(candidates.map(candidate => [candidate.nodeId, candidate]));
    const executable = graph.nodes
      .filter(node => node.type === "TOPOLOGY_TRANSFER" || node.type === "GPU_EXECUTION")
      .map(node => ({
        node,
        candidate: candidateMap.get(node.nodeId),
      }))
      .sort((a, b) =>
        (b.candidate?.priorityScore ?? 0) - (a.candidate?.priorityScore ?? 0) ||
        a.node.nodeId.localeCompare(b.node.nodeId),
      );

    const dispatches: InfinityScaleGPUDispatchUnit[] = [];
    const deferredNodeIds: string[] = [];
    const nodeToBatch = new Map<string, string>();
    let usedDispatches = 0;
    let usedWorkgroups = 0;
    let usedDescriptors = 0;

    for (const item of executable) {
      const workgroups = item.candidate?.workgroups ?? 1;
      const descriptors = item.candidate?.descriptors ?? (item.node.type === "TOPOLOGY_TRANSFER" ? 1 : 0);
      const fits = usedDispatches + 1 <= budget.maxDispatches &&
        usedWorkgroups + workgroups <= budget.maxWorkgroups &&
        usedDescriptors + descriptors <= budget.maxDescriptors;

      if (!fits) {
        deferredNodeIds.push(item.node.nodeId);
        continue;
      }

      const dependencyBatchIds = item.node.dependencyIds
        .map(dependency => nodeToBatch.get(dependency))
        .filter((value): value is string => value !== undefined);

      const batchId = `batch:${dispatches.length}:${item.node.nodeId}`;
      dispatches.push({
        batchId,
        nodeId: item.node.nodeId,
        executionClass: item.candidate?.executionClass ?? (item.node.type === "TOPOLOGY_TRANSFER" ? "DEADLINE_CLASS_0" : "DEADLINE_CLASS_1"),
        workgroups,
        descriptors,
        dependencyBatchIds,
        priorityScore: item.candidate?.priorityScore ?? 0,
      });
      nodeToBatch.set(item.node.nodeId, batchId);
      usedDispatches++;
      usedWorkgroups += workgroups;
      usedDescriptors += descriptors;
    }

    const valid = validateDispatchPlan(graph, dispatches, deferredNodeIds);
    const planHash = stableHash(JSON.stringify({ dispatches, deferredNodeIds, usedDispatches, usedWorkgroups, usedDescriptors }));
    return { dispatches, deferredNodeIds, usedDispatches, usedWorkgroups, usedDescriptors, planHash, valid };
  }

  private empty(valid: boolean): InfinityScaleGPUExecutionPlan {
    return { dispatches: [], deferredNodeIds: [], usedDispatches: 0, usedWorkgroups: 0, usedDescriptors: 0, planHash: stableHash(valid ? "empty" : "invalid"), valid };
  }
}

function validateDispatchPlan(
  graph: InfinityScaleAdaptiveExecutionGraph,
  dispatches: InfinityScaleGPUDispatchUnit[],
  deferredNodeIds: string[],
): boolean {
  const dispatched = new Set(dispatches.map(d => d.nodeId));
  const deferred = new Set(deferredNodeIds);
  for (const dispatch of dispatches) {
    if (dispatch.dependencyBatchIds.some(id => !dispatches.some(candidate => candidate.batchId === id))) return false;
  }
  for (const node of graph.nodes) {
    if (node.type === "TOPOLOGY_TRANSFER" && !dispatched.has(node.nodeId) && !deferred.has(node.nodeId)) return false;
  }
  return true;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
