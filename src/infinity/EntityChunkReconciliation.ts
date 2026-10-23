import { assertEntityDomainRevision, type EntityDomainInventory } from "./EntityDomainInventory";
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
  mixedLodTopologyResolved: boolean;
  ambiguousMixedLodComponents: number[];
  /** Captured authoritative scope/revision, present only for revision-bound plans. */
  sourceInventory?: EntityDomainInventory;
}

/**
 * Pure planning stage for entity identity reconciliation.
 *
 * It deliberately does not mutate EntityLayer. Components that touch a
 * read-only boundary are excluded from identity changes because their full
 * connected component is not known in the current execution workset.
 */
export class EntityChunkReconciliation {
  /**
   * Plan against an immutable inventory snapshot. This binds the result to the
   * exact domain revision; commitRecords requires the current snapshot again.
   */
  planAtInventory(
    components: EntityChunkComponent[],
    entities: Entity[],
    inventory: EntityDomainInventory,
    connectivity?: EntityChunkConnectivityResult,
  ): EntityReconciliationPlan {
    const plan = this.plan(components, entities, connectivity);
    return { ...plan, sourceInventory: inventory };
  }

  plan(
    components: EntityChunkComponent[],
    entities: Entity[],
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
      // Mixed-LOD reconciliation fails closed unless connectivity explicitly
      // proves complete face coverage. Zero or one observed source ID is not
      // evidence of complete topology when boundary reads may be missing.
      const mixedTopologyAmbiguous =
        component.touchesMixedLODBoundary &&
        (!connectivity?.mixedLodCoverageComplete || mixedSourceIds.length > 1);
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

      // The first deterministically matched component keeps the source
      // identity; only additional components from that same source are split
      // children and require a newly allocated identity.
      const continuity = mergeSource
        ? "merge"
        : splitSource && !best
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
        // No authoritative, revision-bound domain-coverage proof exists yet.
        // Never commit merges based on caller-supplied completeness claims.
        safeToCommit: continuity !== "merge",
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
    // Extinction stays disabled until an authoritative domain inventory can
    // produce revision-bound coverage evidence. Boundary-read completeness
    // alone cannot prove that an entity is absent from the global domain.
    // Keep matchedIds above for future evidence-backed reconciliation, but
    // deliberately do not infer extinction in this planner baseline.
    void matchedIds;
    const extinctEntityIds: number[] = [];

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
    currentInventory?: EntityDomainInventory,
  ): EntityReconciliationCommitRecord[] | null {
    // Revision-bound plans require a fresh snapshot immediately before staged
    // records are emitted; absence of the current authority snapshot fails closed.
    if (plan.sourceInventory) {
      if (!currentInventory) {
        throw new Error("Revision-bound entity plan requires current inventory before commit staging");
      }
      assertEntityDomainRevision(plan.sourceInventory, currentInventory);
    }
    // Enforce the aggregate plan gate here too; callers must not be able to
    // bypass commitReady by requesting only individually safe proposals.
    if (!plan.commitReady) return null;
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

  /**
   * Synchronous transaction boundary for revision-bound reconciliation.
   *
   * stage() must only prepare data and capture the rollback snapshot; it must
   * not mutate authoritative state. apply() performs the mutation. The source
   * revision is checked after staging and again after apply, with rollback on
   * any apply/postcondition failure. Keep this path synchronous: an await
   * between the final revision check and apply would reopen the stale-plan race.
   */
  commitAtomically<T>(
    plan: EntityReconciliationPlan,
    components: EntityChunkComponent[],
    getCurrentInventory: () => EntityDomainInventory,
    stage: (records: EntityReconciliationCommitRecord[]) => T,
    apply: (staged: T, records: EntityReconciliationCommitRecord[]) => void,
    rollback: (staged: T) => void,
  ): EntityReconciliationCommitRecord[] | null {
    if (!plan.sourceInventory) {
      throw new Error("Atomic entity reconciliation requires a revision-bound plan");
    }

    const initialInventory = getCurrentInventory();
    const records = this.commitRecords(plan, components, initialInventory);
    if (!records) return null;

    // Contract: stage is side-effect-free; it may capture snapshots and validate
    // all mutations before the authoritative apply callback is entered.
    const staged = stage(records);

    try {
      assertEntityDomainRevision(plan.sourceInventory, getCurrentInventory());
      // apply() is the synchronous critical section. It may legitimately publish
      // the resulting domain under a newer revision, so do not compare the post-apply
      // snapshot with the source revision. No await may occur between this check and apply.
      apply(staged, records);
    } catch (error) {
      try {
        rollback(staged);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Entity reconciliation failed and rollback also failed",
        );
      }
      throw error;
    }

    return records;
  }

  buildCommit(
    plan: EntityReconciliationPlan,
    currentInventory?: EntityDomainInventory,
  ): EntityReconciliationCommit | null {
    // Do not let callers bypass the revision gate through the summary API.
    if (plan.sourceInventory) {
      if (!currentInventory) {
        throw new Error("Revision-bound entity plan requires current inventory before building commit");
      }
      assertEntityDomainRevision(plan.sourceInventory, currentInventory);
    }
    if (!plan.commitReady) return null;

    return {
      retainedEntityIds: plan.proposals
        .map(p => p.existingEntityId)
        .filter((id): id is number => id !== null),
      newComponentIds: plan.proposals
        .filter(p => p.existingEntityId === null)
        .map(p => p.componentId),
      extinctEntityIds: [...plan.extinctEntityIds],
      mixedLodTopologyResolved: plan.mixedLodTopologyResolved,
      ambiguousMixedLodComponents: [...plan.ambiguousMixedLodComponents],
    };
  }
}
