# SparseVoxelGrid-backed adaptive LOD: integration contract

## Status

Design checkpoint for Issue #50. Persistence identity schema v2 is implemented for snapshots, deltas, serialized chunks, and WorldSnapshot chunk payloads. This is an identity and migration contract only: the production `Chunk`/ `SparseVoxelGrid` runtime remains level-zero-only, coarse chunks are rejected before live publication, and the current production gate in `InfinityScaleAdaptiveLODTransactionBridge` must remain fail-closed.

## Verified current storage contracts

- `SparseVoxelGrid` is the production grid and owns `Map<string, Chunk>`, dense front/back buffers, sparse chunk front/back buffers, dirty-chunk metadata, chunk-owner metadata, and a monotonic `mutationRevision`.
- `Chunk` is fixed at `CHUNK_SIZE = 32`, stores exactly `32^3 * CELL_FIELDS` values in each of its front/back buffers, and has immutable integer `cx/cy/cz` coordinates. It has no LOD level or scale.
- Sparse chunk keys are currently `cx,cy,cz`; global base-cell coordinates are resolved by floor division by 32.
- `SparseVoxelGrid.captureState()` emits schema v2 snapshots with `level` and `scale` on every chunk entry. `restoreState()` upgrades schema-less/v1 legacy snapshots as level zero, validates the candidate topology and payloads, rejects coarse physical chunks in the current runtime, and only then publishes state.
- `SparseVoxelGrid.serializeChunks()` emits level-zero records with explicit `level: 0` and `scale: 1`. `loadChunks()` accepts historical bare arrays, explicit v1/v2 versions, and directly serialized v2 arrays; it validates identities and buffers and rejects non-zero LOD before live publication.
- `createSparseVoxelGridDelta()` emits schema v2 with complete chunk identities. `applySparseVoxelGridDelta()` checks source-topology preconditions and compiles the complete resulting snapshot topology so a new chunk cannot overlap an unchanged chunk.
- `WorldSaveSystem` writes `chunks.schemaVersion: 2`, preserves the level/scale fields in the serialized records, and forwards the persisted version to `loadChunks()`. Reality-package conversion retains the nested chunk payload.
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

The physical storage audit also confirms that persistence identity v2 is not equivalent to physical AMR support:

- Existing dense-window indexing and front/back synchronization remain level-zero assumptions.
- The current `Chunk` runtime object still stores only immutable `cx/cy/cz`; it has no LOD level or scale.
- Snapshot, delta, and serialized-chunk payloads now retain v2 identity metadata, but this does not create level-aware `Chunk` instances or move any field data.
- `restoreState()` and `loadChunks()` deliberately reject coarse chunks before publication; worker, GPU readback, renderer, entity ownership, and boundary paths remain level-zero-only or fail-closed.
- `InfinityScaleLODState` remains a separate hierarchical store; it is not the authoritative physical chunk map.
- `InfinityScaleSpatialChunkMapping` proves geometric coverage only; it does not transfer data or publish physical topology.
- Region ownership and current execution planning still rely on the existing level-zero physical coverage and single-level region constraints.

The adaptive transaction bridge remains fail-closed for changed-LOD physical topology. Passing the topology preflight, LOD transfer regressions, or boundary coverage checks is not sufficient to remove that gate.

## Base-cell to stored-cell addressing (implemented; pure utility)

`resolveSparseVoxelGridPhysicalCell(topology, x, y, z)` now resolves an integer base-resolution coordinate to a complete physical cell address: canonical chunk descriptor, local `x/y/z`, cell index, and Float32 field-buffer offset. For a level-`N` chunk, each stored cell covers `2^N` base cells on every axis, so local coordinates are computed as `floor((baseCoordinate - minBound) / scale)`. This uses the chunk's half-open base-space bounds and preserves correct behavior for negative coordinates and adjacent mixed-level chunks.

The helper is tested at positive and negative coordinates, across a level-2/level-0 boundary, and for the final local cell and field-buffer stride. It remains a pure addressing function: it does not read or mutate chunk buffers, does not change `SparseVoxelGrid.getCell()`, and does not enable physical refine/coarsen or mixed-LOD execution. The next step is a level-aware physical chunk runtime record with independent front/back storage and mutation/recovery ownership.

## Additional storage-boundary audit: range, identity, and persistence

The remaining source audit confirms three important boundaries that must be explicit in the physical AMR design.

### activeChunkRange is not a mixed-level physical bounds descriptor

SparseVoxelGrid.activeChunkRange is the min/max envelope of the current chunk-coordinate topology. Its current semantics are valid only while all physical chunks share the level-zero coordinate system. It is not a base-space AABB for a mixed-level topology: comparing a level-2 chunk coordinate with a level-0 chunk coordinate does not compare their physical extents.

A future mixed-level store must expose a separate, unambiguous base-space bounds contract (preferably half-open bounds: minimum inclusive, maximum exclusive), derived from each chunk's origin = coord * CHUNK_SIZE * 2^level and extent = CHUNK_SIZE * 2^level. Keep activeChunkRange legacy-compatible for level-zero callers until every consumer has been migrated; do not silently reinterpret its existing values.

### Complete physical identity must travel through snapshots and deltas

The current `Chunk` runtime identity still consists only of immutable `cx/cy/cz`; the live map, dirty-key set, and owner map therefore remain level-zero runtime structures. Persistence records now carry the separate, complete v2 physical identity tuple `(level, cx, cy, cz)` with the invariant `scale = 2^level`:

- Snapshot chunk entries and chunk-delta entries include `level` and `scale`; newly captured snapshots and generated deltas declare schema v2.
- Serialized chunk records include `level` and `scale`; the containing `WorldSnapshot.chunks` object declares `schemaVersion: 2`.
- Historical snapshots without a version and historical bare chunk arrays are interpreted as v1 level-zero records only when the canonical legacy key agrees with all three coordinates. Mixed or contradictory version/LOD declarations are rejected.
- Delta application validates the physical identity of each entry and its full before/after chunk snapshots, checks source-topology preconditions, and validates the complete resulting topology after applying changes. This catches overlap between a new delta chunk and unchanged resident chunks.
- The current live `SparseVoxelGrid.restoreState()` and `loadChunks()` paths accept level zero only. They reject coarse records before publishing state. Dirty and owner metadata remain level-zero string keys until their owning runtime structures are migrated.

This is a persistence and validation migration, not an AMR storage implementation. No level-N chunk buffers are instantiated, no fine/coarse data transfer occurs, and no production changed-LOD transaction is authorized.

### Do not conflate the separate grid implementations

The repository contains distinct storage/execution contracts that are not interchangeable:

- SparseVoxelGrid is the physical sparse chunk store discussed by Issue #50; it uses 32³ chunks and string spatial keys.
- ChunkGrid is a separate worker simulation grid with 8³ chunks and numeric chunk keys, its own snapshot/restore contract, and a separate field layout.
- SparseGrid is a separate cell-level sparse structure.
- VoxelGrid is a dense grid implementation.

The latter three must not be mechanically migrated as if they were alternate views of SparseVoxelGrid. Any future cross-grid adapter needs its own explicit data, ownership, snapshot, and execution contract.

### Safe next implementation boundary

The identity and topology-preflight utilities, v2 persistence migration, and snapshot/delta overlap checks are now implemented. The next implementation boundary is the physical runtime model, not another key-format helper.

Before enabling mixed-level chunks, define and test a level-aware physical chunk record/runtime with safe half-open base-space bounds, deterministic base-cell lookup, and explicit mutation/revision ownership. Then audit and migrate the current level-zero assumptions in `activeChunkRange`, dense-window synchronization, entity ownership, dirty/owner metadata, worker/GPU readback, renderer, and boundary exchange. Preserve the existing `Chunk` and level-zero APIs until every affected consumer has an explicit compatibility path.

Only after that runtime contract exists should the 24-field restriction/prolongation transfer rules and atomic refine/coarsen transaction be implemented. The current persistence v2 metadata must not be treated as evidence that those operations are available, and the production changed-LOD rejection gate must remain in place until the real-grid conservation, failure-injection rollback, and exact-head CI acceptance suite passes.
