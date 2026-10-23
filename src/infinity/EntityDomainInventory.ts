/**
 * Revision-bound inventory contract for entity reconciliation.
 *
 * The inventory producer must advance the revision whenever the authoritative
 * entity/cell domain changes. A consumer must compare the captured revision to
 * the producer's current revision immediately before applying a plan.
 *
 * This contract intentionally distinguishes a complete domain from a partial
 * workset: partial inventories are never evidence for global merge/extinction.
 */
export type EntityDomainCompleteness = "complete" | "partial";

export interface EntityDomainInventoryInput {
  scopeId: string;
  revision: number;
  completeness: EntityDomainCompleteness;
  entityIds: readonly number[];
  occupiedCells: readonly number[];
}

export interface EntityDomainInventory {
  readonly scopeId: string;
  readonly revision: number;
  readonly completeness: EntityDomainCompleteness;
  readonly entityIds: readonly number[];
  readonly occupiedCells: readonly number[];
}

export function captureEntityDomainInventory(
  input: EntityDomainInventoryInput,
): EntityDomainInventory {
  if (!input.scopeId.trim()) {
    throw new Error("Entity domain inventory requires a non-empty scopeId");
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
    throw new Error("Entity domain inventory revision must be a non-negative safe integer");
  }
  if (input.completeness !== "complete" && input.completeness !== "partial") {
    throw new Error("Entity domain inventory completeness must be complete or partial");
  }

  const entityIds = [...input.entityIds].sort((a, b) => a - b);
  const occupiedCells = [...input.occupiedCells].sort((a, b) => a - b);

  if (entityIds.some(id => !Number.isSafeInteger(id) || id < 1)) {
    throw new Error("Entity domain inventory IDs must be positive safe integers");
  }
  if (new Set(entityIds).size !== entityIds.length) {
    throw new Error("Entity domain inventory contains duplicate entity IDs");
  }
  if (occupiedCells.some(cell => !Number.isSafeInteger(cell) || cell < 0)) {
    throw new Error("Entity domain inventory cell indices must be non-negative safe integers");
  }
  if (new Set(occupiedCells).size !== occupiedCells.length) {
    throw new Error("Entity domain inventory contains duplicate occupied cells");
  }

  return Object.freeze({
    scopeId: input.scopeId,
    revision: input.revision,
    completeness: input.completeness,
    entityIds: Object.freeze(entityIds),
    occupiedCells: Object.freeze(occupiedCells),
  });
}

/** Rejects stale plans and scope mismatches immediately before mutation. */
export function assertEntityDomainRevision(
  captured: EntityDomainInventory,
  current: EntityDomainInventory,
): void {
  if (captured.scopeId !== current.scopeId) {
    throw new Error(
      `Entity domain scope mismatch: captured ${captured.scopeId}, current ${current.scopeId}`,
    );
  }
  if (captured.revision !== current.revision) {
    throw new Error(
      `Stale entity reconciliation plan: captured revision ${captured.revision}, current revision ${current.revision}`,
    );
  }
  // Revision numbers are meaningful only within the trusted authority that
  // owns them. Also compare canonical contents so a forged/reconstructed
  // snapshot cannot reuse the same revision while describing a different domain.
  if (
    captured.completeness !== current.completeness ||
    !sameNumbers(captured.entityIds, current.entityIds) ||
    !sameNumbers(captured.occupiedCells, current.occupiedCells)
  ) {
    throw new Error(
      `Entity domain inventory content mismatch at revision ${captured.revision}`,
    );
  }
}

/** Only a complete inventory may authorize global merge/extinction decisions. */
export function assertCompleteEntityDomain(
  inventory: EntityDomainInventory,
  operation: "merge" | "extinction",
): void {
  if (inventory.completeness !== "complete") {
    throw new Error(
      `Cannot authorize entity ${operation} from partial domain inventory`,
    );
  }
}


/**
 * Owns the revision counter for one inventory scope. Call update whenever the
 * authoritative producer observes a domain change; consumers read snapshot()
 * and compare its revision again immediately before commit.
 *
 * Completeness remains a trusted producer assertion, not something inferred
 * from a chunk's read coverage. A partial inventory can never authorize global
 * merge/extinction even when its revision is current.
 */
export class EntityDomainInventoryAuthority {
  private current: EntityDomainInventory;

  constructor(scopeId: string) {
    this.current = captureEntityDomainInventory({
      scopeId,
      revision: 0,
      completeness: "partial",
      entityIds: [],
      occupiedCells: [],
    });
  }

  snapshot(): EntityDomainInventory {
    return this.current;
  }

  update(input: Omit<EntityDomainInventoryInput, "scopeId" | "revision">): EntityDomainInventory {
    const candidate = captureEntityDomainInventory({
      scopeId: this.current.scopeId,
      revision: this.current.revision,
      completeness: input.completeness,
      entityIds: input.entityIds,
      occupiedCells: input.occupiedCells,
    });

    const unchanged =
      candidate.completeness === this.current.completeness &&
      sameNumbers(candidate.entityIds, this.current.entityIds) &&
      sameNumbers(candidate.occupiedCells, this.current.occupiedCells);
    if (unchanged) return this.current;

    if (this.current.revision >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Entity domain inventory revision exhausted safe integer range");
    }

    this.current = captureEntityDomainInventory({
      scopeId: this.current.scopeId,
      revision: this.current.revision + 1,
      completeness: input.completeness,
      entityIds: input.entityIds,
      occupiedCells: input.occupiedCells,
    });
    return this.current;
  }
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
