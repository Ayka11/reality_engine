# SparseVoxelGrid-backed adaptive LOD: integration contract

## Status

Design checkpoint for Issue #50. This document does not enable adaptive topology changes. The current production gate in `InfinityScaleAdaptiveLODTransactionBridge` must remain fail-closed.

## Verified current storage contracts

- `SparseVoxelGrid` is the production grid and owns `Map<string, Chunk>`, dense front/back buffers, sparse chunk front/back buffers, dirty-chunk metadata, chunk-owner metadata, and a monotonic `mutationRevision`.
- `Chunk` is fixed at `CHUNK_SIZE = 32`, stores exactly `32^3 * CELL_FIELDS` values in each of its front/back buffers, and has immutable integer `cx/cy/cz` coordinates. It has no LOD level or scale.
- Sparse chunk keys are currently `cx,cy,cz`; global base-cell coordinates are resolved by floor division by 32.
- `SparseVoxelGrid.captureState()/restoreState()` snapshot and restore both dense buffers, every sparse chunk's front/back buffers, active/access metadata, dense origin, active chunk range, dirty keys, and chunk-owner map. Restore validates the complete candidate before publishing and batches mutation revision changes.
- `InfinityScaleLODState` is a separate hierarchical store. Its `level:x,y,z` chunks each hold `32^3 * 24` Float32 values. Level N represents a chunk extent of `32 * 2^N` base cells per axis.
- `InfinityScaleSpatialChunkMapping` proves geometric coverage between one hierarchical chunk and the complete set of level-zero SparseVoxelGrid chunk keys. It is a pure mapping operation; it does not move cell data or mutate topology.
- The current adaptive transaction bridge validates source ownership, target geometry, dependency graph, and target collisions, then intentionally rejects every changed-LOD topology request before publication.

## Architectural consequence

A direct adapter that only reads eight level-zero chunks and writes an `InfinityScaleLODState` chunk would create a second representation, not a physical SparseVoxelGrid topology change. A reverse adapter that expands coarse values back into level-zero chunks would destroy fine detail and still leave the physical chunk topology unchanged. Neither is an acceptable implementation of Issue #50.

The physical store must understand level-aware chunk identity and scale before a transfer adapter can be authoritative. The logical LOD state may remain a planner/cache/projection, but it must not independently claim ownership of physical cell data.

## Required implementation sequence

1. **Level-aware physical chunk model**
   - Add an explicit non-negative LOD level to physical chunk identity and immutable chunk metadata.
   - Define base-space bounds as `origin = chunkCoord * CHUNK_SIZE * 2^level` and `extent = CHUNK_SIZE * 2^level`.
   - Preserve the existing level-zero key and indexing contract for callers that do not opt into AMR, or provide a fully audited migration path.
   - Reject overlapping physical chunk footprints and duplicate spatial coverage, including negative coordinates.
   - Keep chunk front/back buffers, dirty state, ownership metadata, serialization, deltas, and recovery snapshots level-aware.

2. **Grid access and execution compatibility**
   - Define deterministic base-coordinate lookup against a mixed-level, non-overlapping physical topology.
   - Audit every dense-window, GPU readback, worker, renderer, entity-ownership, boundary, and serialization path that assumes fixed level-zero chunks.
   - Until the dense CPU/GPU execution path supports coarse chunks, reject AMR mutations whose physical footprint intersects an execution window that cannot consume that level. Do not silently mirror coarse values into level-zero buffers.

3. **Sparse-grid transfer adapter**
   - Read source cells from the authoritative SparseVoxelGrid snapshot, not from caller-provided arrays or a detached LOD cache.
   - Stage the complete destination chunk set and all 24 fields before publication.
   - Apply field-specific restriction/prolongation rules; retain strict Float32 validation and the existing transfer allocation cap, or replace it only with an explicitly bounded whole-transaction budget.
   - Reject unsupported non-zero fields and ambiguous entity/agent identity. Entity IDs must be reconciled through the authoritative entity registry, not majority-voted.
   - Verify exact source/target base-space coverage and no overlap with unaffected physical chunks.

4. **Atomic publication**
   - Validate the captured grid mutation revision and LOD/frame revision immediately before commit.
   - Publish destination chunk buffers, source chunk removal/replacement, topology metadata, dirty keys, chunk ownership, and region ownership as one transaction.
   - On any injected failure, restore the exact SparseVoxelGrid snapshot and LOD snapshot; advance revisions so stale transactions cannot become valid again.
   - Never restore over a newer external mutation.

5. **Acceptance**
   - Exercise real SparseVoxelGrid instances with level-zero data, not only synthetic Float32 arrays.
   - Verify every field, front/back buffer behavior, negative and positive coordinates, chunk keys/levels/scales, entity identity, conservation residuals, dirty/owner metadata, and dense-window refusal.
   - Run refine -> verify -> coarsen -> compare and failure-injection rollback tests.
   - Run exact-head CI, release validation, and browser acceptance. Only then consider removing the changed-LOD rejection gate.

## Non-goals

- Do not port the legacy dense `VoxelGrid` transaction as a shortcut.
- Do not treat boundary-cell synchronization or synthetic telemetry as physical topology evidence.
- Do not enable production refine/coarsen merely because a planner or isolated transfer regression passes.

## Physical topology preflight (implemented; not physical AMR)

`SparseVoxelGridPhysicalTopology` is now implemented as a pure candidate-topology compiler and base-cell resolver. Its regression suite covers canonical mixed-level keys, positive and negative coordinates, dyadic bounds, overlap and duplicate rejection, immutable compiler-owned topology, and deterministic base-cell lookup.

This preflight establishes that a proposed set of level-aware chunk footprints is structurally valid before a future physical transaction is designed. It does **not** allocate or replace `Chunk` instances, move any of the 24 fields, mutate `SparseVoxelGrid`, publish ownership/dirty metadata, or make dense/GPU execution LOD-aware. It must therefore remain a validation primitive only.

The physical storage audit also confirms that migration scope extends beyond the chunk map:

- Existing dense-window indexing and front/back synchronization are level-zero assumptions.
- Chunk serialization and load paths do not yet persist a physical LOD level or scale.
- Snapshot/restore and mutation tracking must preserve level-aware identities and exact topology.
- Worker, GPU readback, renderer, entity ownership, deltas, and boundary paths must either support coarse chunks explicitly or reject affected work before execution.
- `InfinityScaleLODState` remains a separate hierarchical store; it is not the authoritative physical chunk map.
- `InfinityScaleSpatialChunkMapping` proves geometric coverage only; it does not transfer data or publish physical topology.
- Region ownership and current execution planning still rely on the existing level-zero physical coverage and single-level region constraints.

The adaptive transaction bridge remains fail-closed for changed-LOD physical topology. Passing the topology preflight, LOD transfer regressions, or boundary coverage checks is not sufficient to remove that gate.

## Additional storage-boundary audit: range, identity, and persistence

The remaining source audit confirms three important boundaries that must be explicit in the physical AMR design.

### activeChunkRange is not a mixed-level physical bounds descriptor

SparseVoxelGrid.activeChunkRange is the min/max envelope of the current chunk-coordinate topology. Its current semantics are valid only while all physical chunks share the level-zero coordinate system. It is not a base-space AABB for a mixed-level topology: comparing a level-2 chunk coordinate with a level-0 chunk coordinate does not compare their physical extents.

A future mixed-level store must expose a separate, unambiguous base-space bounds contract (preferably half-open bounds: minimum inclusive, maximum exclusive), derived from each chunk's origin = coord * CHUNK_SIZE * 2^level and extent = CHUNK_SIZE * 2^level. Keep activeChunkRange legacy-compatible for level-zero callers until every consumer has been migrated; do not silently reinterpret its existing values.

### Complete physical identity must travel through snapshots and deltas

The current Chunk runtime identity consists only of immutable cx/cy/cz. SparseVoxelGrid snapshots, serialized chunks, chunk deltas, dirty keys, and owner keys also use the legacy cx,cy,cz key and do not carry a physical level or scale. Delta application currently matches chunks by key and applies buffer changes after that key match.

This is insufficient for AMR. The future physical identity must be the tuple (level, cx, cy, cz) with the invariant scale = 2^level. Every serialized chunk, snapshot entry, delta before/after entry, dirty key, and owner key must agree on that full identity. Validate key, coordinates, level, and scale together before applying a delta or publishing a restored snapshot. A delta must not be allowed to reinterpret a same-string key as a different physical chunk.

Persistence migration must be versioned. A legacy record without level/scale may be interpreted as level zero only when its legacy key is canonical and agrees with all three coordinates. New records must include the schema version and explicit level/scale. Reject mixed or contradictory legacy/new declarations rather than guessing. Snapshot restore and delta application must validate the complete candidate topology (including duplicate identities and overlapping base-space footprints) before publishing any state.

### Do not conflate the separate grid implementations

The repository contains distinct storage/execution contracts that are not interchangeable:

- SparseVoxelGrid is the physical sparse chunk store discussed by Issue #50; it uses 32³ chunks and string spatial keys.
- ChunkGrid is a separate worker simulation grid with 8³ chunks and numeric chunk keys, its own snapshot/restore contract, and a separate field layout.
- SparseGrid is a separate cell-level sparse structure.
- VoxelGrid is a dense grid implementation.

The latter three must not be mechanically migrated as if they were alternate views of SparseVoxelGrid. Any future cross-grid adapter needs its own explicit data, ownership, snapshot, and execution contract.

### Safe next implementation boundary

The next code increment should be an isolated physical identity/bounds utility and regression suite. It may define canonical level-aware identity, scale derivation, safe half-open base-space bounds, and conversion of validated legacy level-zero keys. It must not yet change Chunk, SparseVoxelGrid, snapshots, deltas, dense synchronization, or the production adaptive transaction gate. That isolates arithmetic and identity validation before introducing a storage migration with a much larger rollback surface.
