import { InfinityScaleSpatialConstraintClosure, type InfinityScaleSpatialConstraintNode } from "./InfinityScaleSpatialConstraintClosure";
import type { InfinityScaleAdaptiveMutation } from "./InfinityScaleAdaptiveTransferCompiler";
import type { InfinityScaleAdaptiveMutationPlan } from "./InfinityScaleAdaptiveMutationPlanBuilder";

export interface InfinityScaleClosedLoopExecutablePlan {
  epoch: number;
  mutations: InfinityScaleAdaptiveMutation[];
  deferredRegionIds: string[];
  closure: {
    proposedLOD: Record<string, number>;
    changedRegionIds: string[];
    iterations: number;
    valid: boolean;
  };
  deterministicHash: string;
}

export class InfinityScaleClosedLoopExecutablePlanner {
  constructor(private readonly closure = new InfinityScaleSpatialConstraintClosure()) {}

  compile(
    plan: InfinityScaleAdaptiveMutationPlan,
    topology: InfinityScaleSpatialConstraintNode[],
  ): InfinityScaleClosedLoopExecutablePlan {
    const mutationByRegion = new Map(plan.mutations.map(m => [m.regionId, m]));
    const nodes = topology.map(node => {
      const mutation = mutationByRegion.get(node.regionId);
      return {
        ...node,
        proposedLOD: mutation?.toLOD ?? node.currentLOD,
      };
    });

    const closed = this.closure.close(nodes);
    if (!closed.valid) throw new Error("Adaptive mutation plan failed spatial constraint closure");

    const mutations: InfinityScaleAdaptiveMutation[] = [];
    for (const node of nodes) {
      const target = closed.proposedLOD.get(node.regionId);
      if (target === undefined || target === node.currentLOD) continue;
      mutations.push({
        regionId: node.regionId,
        fromLOD: node.currentLOD,
        toLOD: target,
      });
    }
    mutations.sort((a, b) => a.regionId.localeCompare(b.regionId));

    const proposedLOD: Record<string, number> = {};
    for (const [regionId, lod] of [...closed.proposedLOD.entries()].sort()) proposedLOD[regionId] = lod;

    return {
      epoch: plan.epoch,
      mutations,
      deferredRegionIds: [...plan.deferredRegionIds].sort(),
      closure: {
        proposedLOD,
        changedRegionIds: closed.changedRegionIds,
        iterations: closed.iterations,
        valid: closed.valid,
      },
      deterministicHash: stableHash(JSON.stringify({
        epoch: plan.epoch,
        mutations,
        deferredRegionIds: [...plan.deferredRegionIds].sort(),
        closure: { proposedLOD, changedRegionIds: closed.changedRegionIds, iterations: closed.iterations, valid: closed.valid },
      })),
    };
  }
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
