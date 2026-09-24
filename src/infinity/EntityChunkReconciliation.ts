import type { Entity } from "../simulation/EntityLayer";
import type { EntityChunkComponent, EntityBoundaryTopologySample, EntityChunkConnectivityResult } from "./EntityChunkConnectivity";

export interface EntityReconciliationProposal {
  componentId: number;
  existingEntityId: number | null;
  sourceEntityIds: number[];
  centroid: [number, number, number];
  cellCount: number;
  safeToCommit: boolean;
  continuity: "new" | "retained" | "pending" | "split" | "merge";
}

export interface EntityReconciliationCommit {
  retainedEntityIds: number[];
  newComponentIds: number[];
  extinctEntityIds: number[];
  mixedLodTopologyResolved: boolean;
  ambiguousMixedLodComponents: number[];
}

export interface EntityReconciliationCommitRecord {
  componentId: number;
  entityId: number | null;
  centroid: [number, number, number];
  cells: number[];
  continuity: "new" | "retained" | "split" | "merge";
  sourceEntityIds: number[];
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
    connectivity?: EntityChunkConnectivityResult,
  ): EntityReconciliationPlan {
    const componentSourceIds = new Map<number, number[]>();
    const sourceComponentCounts = new Map<number, number>();

    for (const component of components) {
      const sourceIds: number[] = [];
      for (const entity of entities) {
        if (entity.cells.some(index => component.cells.includes(index))) {
          sourceIds.push(entity.id);
        }
      }
      componentSourceIds.set(component.id, sourceIds);
      for (const id of sourceIds) {
        sourceComponentCounts.set(id, (sourceComponentCounts.get(id) ?? 0) + 1);
      }
    }

    const topologyByComponent = new Map<number, EntityBoundaryTopologySample[]>();
    for (const sample of connectivity?.mixedLodTopology ?? []) {
      const component = connectivity?.components.find(c => c.cells.includes(sample.localCell));
      if (!component) continue;
      const list = topologyByComponent.get(component.id) ?? [];
      list.push(sample);
      topologyByComponent.set(component.id, list);
    }

    const proposals: EntityReconciliationProposal[] = [];
    const ambiguousMixedLodComponents: number[] = [];
    const used = new Set<number>();

    for (const component of components) {
      const centroid = component.centroid;
      const sourceEntityIds = componentSourceIds.get(component.id) ?? [];
      const mixedSamples = topologyByComponent.get(component.id) ?? [];
      const mixedSourceIds = [...new Set(
        mixedSamples.filter(sample => sample.occupied).map(sample => sample.sourceEntityId),
      )];
      const mixedTopologyAmbiguous =
        component.touchesMixedLODBoundary &&
        mixedSourceIds.length > 1;
      if (mixedTopologyAmbiguous) ambiguousMixedLodComponents.push(component.id);

      if (component.touchesReadBoundary || mixedTopologyAmbiguous) {
        proposals.push({
          componentId: component.id,
          existingEntityId: null,
          sourceEntityIds,
          centroid,
          cellCount: component.cells.length,
          safeToCommit: false,
          continuity: "pending",
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

      const overlapping = sourceEntityIds
        .map(id => entities.find(entity => entity.id === id))
        .filter((entity): entity is Entity => !!entity);

      // Prefer an overlapping entity for continuity. If the source entity is
      // already retained by another component, this component becomes a
      // split child and must receive a new identity at commit time.
      if (overlapping.length > 0) {
        const preferred = overlapping.find(entity => !used.has(entity.id));
        if (preferred) best = preferred;
        else best = null;
      }

      if (best) used.add(best.id);

      const splitSource =
        sourceEntityIds.length === 1 &&
        (sourceComponentCounts.get(sourceEntityIds[0]) ?? 0) > 1;
      const mergeSource = sourceEntityIds.length > 1;

      const continuity = mergeSource
        ? "merge"
        : splitSource
          ? "split"
          : best
            ? "retained"
            : "new";
      proposals.push({
        componentId: component.id,
        existingEntityId: best?.id ?? null,
        sourceEntityIds,
        centroid,
        cellCount: component.cells.length,
        // A merge changes more than one entity identity. Until the whole
        // domain is covered, defer it rather than extinguishing a source
        // entity whose other cells may be outside this workset.
        safeToCommit: continuity !== "merge" || fullDomainCovered,
        continuity,
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
      commitReady: unresolvedBoundaryComponents === 0 &&
        ambiguousMixedLodComponents.length === 0,
      mixedLodTopologyResolved: ambiguousMixedLodComponents.length === 0,
      ambiguousMixedLodComponents,
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
        continuity: proposal.continuity as "new" | "retained" | "split" | "merge",
        sourceEntityIds: [...proposal.sourceEntityIds],
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
