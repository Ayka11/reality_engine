export interface InfinityScaleSpatialConstraintNode {
  regionId: string;
  currentLOD: number;
  proposedLOD: number;
  neighbors: string[];
}

export interface InfinityScaleSpatialConstraintClosureResult {
  proposedLOD: Map<string, number>;
  changedRegionIds: string[];
  iterations: number;
  valid: boolean;
}

export class InfinityScaleSpatialConstraintClosure {
  constructor(private readonly maxLOD = 4) {
    if (!Number.isInteger(maxLOD) || maxLOD < 0) throw new Error("maxLOD must be a non-negative integer");
  }

  close(nodes: InfinityScaleSpatialConstraintNode[]): InfinityScaleSpatialConstraintClosureResult {
    const graph = new Map(nodes.map(node => [node.regionId, node]));
    const levels = new Map(nodes.map(node => [node.regionId, clampLOD(node.proposedLOD, this.maxLOD)]));
    const changed = new Set<string>();
    let iterations = 0;
    let didChange = true;

    while (didChange) {
      didChange = false;
      iterations++;
      if (iterations > Math.max(1, nodes.length * (this.maxLOD + 1))) {
        throw new Error("Spatial constraint closure did not converge");
      }

      for (const node of nodes) {
        const level = levels.get(node.regionId)!;
        for (const neighborId of node.neighbors) {
          const neighbor = graph.get(neighborId);
          if (!neighbor) continue;
          const neighborLevel = levels.get(neighborId)!;
          if (Math.abs(level - neighborLevel) <= 1) continue;

          if (level > neighborLevel) {
            const next = Math.max(0, level - 1);
            if (next !== level) {
              levels.set(node.regionId, next);
              changed.add(node.regionId);
              didChange = true;
            }
          } else {
            const next = Math.min(this.maxLOD, neighborLevel - 1);
            if (next !== neighborLevel) {
              levels.set(neighborId, next);
              changed.add(neighborId);
              didChange = true;
            }
          }
        }
      }
    }

    return {
      proposedLOD: levels,
      changedRegionIds: [...changed].sort(),
      iterations,
      valid: this.isValid(nodes, levels),
    };
  }

  isValid(nodes: InfinityScaleSpatialConstraintNode[], levels = new Map(nodes.map(n => [n.regionId, n.proposedLOD]))): boolean {
    for (const node of nodes) {
      const level = levels.get(node.regionId);
      if (level === undefined) return false;
      for (const neighborId of node.neighbors) {
        const neighborLevel = levels.get(neighborId);
        if (neighborLevel === undefined) continue;
        if (Math.abs(level - neighborLevel) > 1) return false;
      }
    }
    return true;
  }
}

function clampLOD(level: number, maxLOD: number): number {
  if (!Number.isInteger(level)) throw new Error("LOD must be an integer");
  return Math.max(0, Math.min(maxLOD, level));
}
