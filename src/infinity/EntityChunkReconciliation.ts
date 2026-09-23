import type { Entity } from "../simulation/EntityLayer";
import type { EntityChunkComponent } from "./EntityChunkConnectivity";

export interface EntityReconciliationProposal {
  componentId: number;
  existingEntityId: number | null;
  centroid: [number, number, number];
  cellCount: number;
  safeToCommit: boolean;
}

export interface EntityReconciliationCommit {
  retainedEntityIds: number[];
  newComponentIds: number[];
  extinctEntityIds: number[];
}

export interface EntityReconciliationCommitRecord {
  componentId: number;
  entityId: number | null;
  centroid: [number, number, number];
  cells: number[];
}

export interface EntityReconciliationPlan {
  proposals: EntityReconciliationProposal[];
  unresolvedBoundaryComponents: number;
  commitReady: boolean;
  closedComponentCount: number;
  unmatchedClosedComponentCount: number;
  extinctEntityIds: number[];
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
    fullDomainCovered = false,
  ): EntityReconciliationPlan {
    const proposals: EntityReconciliationProposal[] = [];
    const used = new Set<number>();

    for (const component of components) {
      const centroid = component.centroid;
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

    const unresolvedBoundaryComponents = proposals.filter(p => !p.safeToCommit).length;
    const closed = proposals.filter(p => p.safeToCommit);
    const matchedIds = new Set(
      closed
        .map(p => p.existingEntityId)
        .filter((id): id is number => id !== null),
    );
    const extinctEntityIds = fullDomainCovered
      ? entities
          .filter(entity => !matchedIds.has(entity.id))
          .map(entity => entity.id)
      : [];

    return {
      proposals,
      unresolvedBoundaryComponents,
      commitReady: unresolvedBoundaryComponents === 0,
      closedComponentCount: closed.length,
      unmatchedClosedComponentCount: closed.filter(p => p.existingEntityId === null).length,
      extinctEntityIds,
    };
  }

  commitRecords(
    plan: EntityReconciliationPlan,
    components: EntityChunkComponent[],
  ): EntityReconciliationCommitRecord[] | null {
    const byId = new Map(components.map(component => [component.id, component]));
    return plan.proposals
      .filter(proposal => proposal.safeToCommit)
      .map(proposal => {
      const component = byId.get(proposal.componentId);
      if (!component) throw new Error(
        `Missing component ${proposal.componentId} during reconciliation commit`,
      );

      return {
        componentId: proposal.componentId,
        entityId: proposal.existingEntityId,
        centroid: component.centroid,
        cells: [...component.cells],
      };
    });
  }

  buildCommit(plan: EntityReconciliationPlan): EntityReconciliationCommit | null {
    if (!plan.commitReady) return null;

    return {
      retainedEntityIds: plan.proposals
        .map(p => p.existingEntityId)
        .filter((id): id is number => id !== null),
      newComponentIds: plan.proposals
        .filter(p => p.existingEntityId === null)
        .map(p => p.componentId),
      extinctEntityIds: [...plan.extinctEntityIds],
    };
  }
}
