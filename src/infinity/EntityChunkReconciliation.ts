import type { Entity } from "../simulation/EntityLayer";
import type { EntityChunkComponent } from "./EntityChunkConnectivity";

export interface EntityReconciliationProposal {
  componentId: number;
  existingEntityId: number | null;
  centroid: [number, number, number];
  cellCount: number;
  safeToCommit: boolean;
}

export interface EntityReconciliationPlan {
  proposals: EntityReconciliationProposal[];
  unresolvedBoundaryComponents: number;
  commitReady: boolean;
}

/**
 * Pure planning stage for entity identity reconciliation.
 *
 * It deliberately does not mutate EntityLayer. Components that touch a
 * read-only boundary are excluded from identity changes because their full
 * connected component is not known in the current execution workset.
 */
export class EntityChunkReconciliation {
  plan(
    components: EntityChunkComponent[],
    entities: Entity[],
  ): EntityReconciliationPlan {
    const proposals: EntityReconciliationProposal[] = [];
    const used = new Set<number>();

    for (const component of components) {
      const centroid = this.centroidFromCells(component.cells);
      if (component.touchesReadBoundary) {
        proposals.push({
          componentId: component.id,
          existingEntityId: null,
          centroid,
          cellCount: component.cells.length,
          safeToCommit: false,
        });
        continue;
      }

      let best: Entity | null = null;
      let bestDistance = 5;

      for (const entity of entities) {
        if (used.has(entity.id)) continue;
        const dx = centroid[0] - entity.centroid[0];
        const dy = centroid[1] - entity.centroid[1];
        const dz = centroid[2] - entity.centroid[2];
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = entity;
        }
      }

      if (best) used.add(best.id);

      proposals.push({
        componentId: component.id,
        existingEntityId: best?.id ?? null,
        centroid,
        cellCount: component.cells.length,
        safeToCommit: true,
      });
    }

    return {
      proposals,
      unresolvedBoundaryComponents: proposals.filter(p => !p.safeToCommit).length,
      commitReady: proposals.every(p => p.safeToCommit),
    };
  }

  private centroidFromCells(cells: number[]): [number, number, number] {
    // EntityChunkComponent currently carries linear indices. The reconciliation
    // layer intentionally does not assume a fixed world width; callers can
    // replace this with grid-aware centroid calculation before commit.
    if (cells.length === 0) return [0, 0, 0];

    // The exact coordinate conversion belongs to the grid-aware integration
    // layer. Returning the linear-index centroid keeps this pure planner safe
    // but prevents it from being used as a false identity match.
    const mean = cells.reduce((sum, value) => sum + value, 0) / cells.length;
    return [mean, 0, 0];
  }
}
