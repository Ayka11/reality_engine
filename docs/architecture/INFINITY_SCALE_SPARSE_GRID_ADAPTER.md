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
