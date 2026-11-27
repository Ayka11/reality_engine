# Authoritative mixed-LOD integration plan for SparseVoxelGrid

**Status:** design/implementation gate; production mixed-LOD storage remains disabled.  
**Baseline:** `main` at the time this plan was prepared (2026-11-27).  
**Related work:** PRs #79–#84; issue #50.

## Executive decision

Do not enable mixed-LOD chunks by relaxing `SparseVoxelGrid.#isValidChunkKey` or by inserting `SparseVoxelGridPhysicalChunk` instances into the existing map. The current grid is a coordinated level-zero runtime, not merely a map of interchangeable chunk buffers. Its dense window, chunk coordinate math, entity ownership, dirty tracking, active range, snapshot/delta format, recovery, GPU readback, workers and persistence all encode level-zero assumptions.

The safe next step is a single authoritative topology owner inside `SparseVoxelGrid`, with an optimistic transaction that stages a complete replacement and publishes topology plus all derived metadata at one synchronous commit point. The adapter and `InfinityScaleLODState` work in PRs #79–#84 are useful primitives, but they remain independently-owned stores and must not be described as one authoritative world.

## Verified current boundaries

- `SparseVoxelGrid.chunks` is keyed by canonical legacy coordinates `cx,cy,cz`; `#isValidChunkKey` accepts exactly three canonical integer components.
- `getCell()`, `getOrCreateChunk()`, `getChunkBoundary()`, `#globalToChunk()` and dense-window synchronization use level-zero chunk arithmetic.
- `physicalTopology` is a cached immutable index derived from the authoritative map. Its compiler understands hierarchical keys, but the production map validator and storage lifecycle remain level-zero-only.
- `getPhysicalCellAtBase()` is an LOD-aware lookup seam; it does not install coarse chunks in the live grid.
- `captureState()` emits explicit `level: 0, scale: 1`; `restoreState()` rejects non-zero levels.
- `SparseVoxelGridPhysicalAddressAdapter.replaceTopology()` atomically replaces only the opt-in adapter's private map. It does not mutate `SparseVoxelGrid.chunks`.
- `InfinityScaleLODState.writePhysicalCellBatchForTransaction()` atomically updates existing hierarchical cells, but does not create/delete chunks or change spatial ownership.
- Adapter revision, grid mutation revision, dense-source revision and LOD-state revision are separate counters. Checking two of them is not a global transaction.

## Required ownership model

Introduce one grid-owned physical topology state. It must own, or atomically derive from one canonical candidate:

1. Canonical physical chunk descriptors (key, level, scale, integer base-space bounds).
2. The actual chunk instances and their front/back buffers.
3. A unique region/footprint ownership map. No two live chunks may own overlapping base-space volume.
4. A monotonically increasing topology revision, separate from cell-content revision if useful, but committed together with a grid-wide mutation revision.
5. Derived indexes (coordinate lookup, neighbor/boundary relationships, active range) rebuilt from the candidate before publication.

The topology descriptor and live map must never be independently published. A topology cache is disposable derived data, not a second authority.

## Transaction contract

Add a grid-owned API only after the ownership model above is implemented. The public shape may resemble:

```ts
replacePhysicalTopology(
  expectedRevision: number,
  candidate: ReadonlyArray<PhysicalChunkCandidate>,
  transferEvidence: ReadonlyArray<PhysicalTransferEvidence>,
): number
```

This is a design sketch, not an existing API.

### Preflight — no live mutation

- Verify the expected topology/grid revision before doing expensive work and again immediately before publication.
- Bound candidate count, total resident bytes, total cell count and all intermediate allocations before loops or typed-array allocation.
- Validate canonical keys, supported LOD range, integer safe bounds, chunk buffer shape, finite front/back values, unique keys and non-overlapping footprints.
- Validate every ownership entry and ensure the candidate covers exactly the intended region set (no gaps or accidental expansion).
- Require complete, unique transfer evidence for every destination physical cell. Reject missing, duplicate, multiply-owned or out-of-footprint source evidence.
- Apply field-specific transfer semantics. Intensive values may average; identity/discrete fields require explicit policies; conserved quantities need conservation-aware restriction/prolongation rather than generic component averaging.
- Prepare detached destination chunks and all indexes/metadata without touching live chunks.

### Publication — one synchronous boundary

- Recheck the expected revision.
- Swap the authoritative chunk map, canonical topology descriptor, ownership map, derived indexes and topology revision in one synchronous, non-awaiting critical section.
- Advance the externally observable grid mutation revision exactly once for a non-empty topology commit.
- Do not invoke user callbacks, worker messages, GPU calls, persistence I/O or awaitable code inside the publication boundary.
- Ensure existing `CellState` handles cannot silently mutate retired chunks as if they were live. Either make retired handles explicitly detached/read-only or document and enforce a generation check.
- If any operation can still throw after the first live assignment, retain a complete rollback snapshot and prove rollback through injected failures. Prefer reducing publication to non-throwing reference assignments.

### After publication

- Invalidate or replace every derived cache from the committed candidate.
- Publish one immutable commit receipt with before/after revisions and exact changed physical identities.
- Notify GPU/worker/persistence consumers only after the authoritative commit; consumers must acknowledge the same topology revision before executing against it.
- Failed preflight or stale revision must leave chunks, buffers, ownership, dirty state, active range and all revisions unchanged.

## Consumer migration inventory

Mixed-LOD storage is not production-safe until each consumer is explicitly migrated or deliberately isolated behind a level-zero-only guard.

| Consumer | Existing assumption / risk | Required migration |
|---|---|---|
| Cell access | `getCell()` maps coordinates by fixed `CHUNK_SIZE` | Resolve through canonical physical topology; preserve explicit LOD0 compatibility |
| Chunk creation/deletion | `getOrCreateChunk()` and map mutation use comma keys | Route through topology owner; prohibit direct structural map mutation or wrap it in validated transactions |
| Dense front/back synchronization | Copies level-zero contiguous x-runs | Define dense-to-physical projection and physical-to-dense replication; use complete coverage and field-specific reduction |
| Entity ownership | Dense/entity IDs synchronized through LOD0 chunk math | Preserve unique entity identity and define coarse-cell entity policy; never average IDs |
| Dirty chunks / active range | Keys and range derive from level-zero coordinates | Make dirty identities physical and ranges base-space/LOD-aware |
| Neighbor/boundary logic | Fixed one-chunk offsets | Compute face/edge/corner adjacency from physical bounds, including mixed-level neighbors |
| GPU upload/readback | Dense layout and chunk offsets assume LOD0 | Carry topology revision and physical descriptors through staging; reject stale readback |
| Workers / execution graph | Jobs may retain chunk keys or buffer handles | Bind jobs to topology revision and chunk generation; cancel/reject stale work |
| Snapshot / restore | Capture writes LOD0 metadata; restore rejects coarse levels | Version persistence schema; validate complete topology and ownership before atomic restore |
| Delta / undo / recovery | Chunk deltas and keys can describe changes, but restore lifecycle is LOD0-bound | Include topology/ownership transitions and validate both forward and reverse atomic application |
| Rendering / meshing | Mesh patches may assume fixed chunk extent | Consume physical bounds and LOD scale; prevent cracks and duplicate surfaces at mixed-level boundaries |
| Telemetry / diagnostics | Counts may conflate logical regions, physical chunks and base-cell coverage | Report each separately, plus topology revision and coverage/completeness |

## Required implementation sequence

### Phase A — close mutation escape hatches

- Audit every public mutation path on `chunks`, `dirtyChunks`, `chunkOwners` and chunk buffers.
- Make structural map writes private or route them through a topology transaction. A caller must not be able to insert an overlapping chunk through `Map.set`.
- Define whether cell-content writes to a coarse physical chunk are legal through a base-space address and how they affect dirty/mesh revisions.
- Preserve legacy level-zero callers through explicit compatibility adapters, not by silently interpreting hierarchical keys as legacy coordinates.

### Phase B — authoritative topology and lookup

- Install physical chunk instances in the grid-owned map.
- Make `resolvePhysicalCellAddress`, `getPhysicalCellAtBase`, and the normal cell-access path share the same authoritative resolver.
- Add topology-aware neighbor enumeration and active/dirty metadata.
- Add invariants proving the topology descriptor exactly matches the live map after every supported mutation.

### Phase C — transfer and atomic refine/coarsen

- Reuse the tested transfer semantics and staged dense-window reduction primitives, but feed them a revision-bound source snapshot from the authoritative grid.
- Implement complete prolongation/restriction for all cell fields, with explicit identity, categorical and conserved-field policies.
- Require exact source coverage and destination ownership evidence.
- Commit chunk replacement, transferred cell vectors and ownership as one grid transaction.

### Phase D — all runtime consumers

- Migrate dense synchronization, entity ownership, GPU, workers, meshing, telemetry, snapshot/restore, deltas and persistence.
- Every asynchronous consumer must carry and revalidate topology revision and chunk generation.
- Keep unsupported consumers fail-closed; do not silently fall back to incorrect LOD0 math.

### Phase E — end-to-end acceptance

At minimum, automate:
- LOD1 parent to eight LOD0 children and reverse coarsening, with adjacent chunks on all sides.
- Positive and negative coordinates, exact half-open boundaries, all supported levels, and non-aligned candidate rejection.
- Exact key/level/scale/bounds and complete front/back field vectors before and after refine/coarsen.
- Conservation tests for every conserved field and policy tests for entity IDs, material IDs and other categorical fields.
- Gaps, overlaps, duplicate keys, missing transfer evidence, duplicate evidence, incomplete coverage and oversized allocations.
- Stale grid/source/topology revisions at every transaction boundary.
- Injected failures during preparation and publication; prove no partial map, buffer, ownership, dirty-state or revision changes.
- Old cell handles and stale GPU/worker completions cannot mutate or publish into the new topology.
- Snapshot → restore → delta apply/revert → restart preserves exact mixed-LOD topology and values.
- Browser acceptance for mixed-level meshing/rendering and runtime switching.
- Full CI, security/dependency audit and release acceptance on the exact resulting commit SHA.

## Explicit non-goals for the first integration

- Do not enable adaptive topology commits merely because the topology compiler or adapter replacement passes.
- Do not merge the adapter and LOD state by copying data between them every frame; that creates two authorities and a race window.
- Do not infer full-world coverage from a dense-window coverage report.
- Do not treat repeated coarse values in a dense read projection as fine-resolution source samples.
- Do not transplant legacy branch-only mixed-LOD runtime code into current mainline without proving API and ownership compatibility.

## Release gate

Issue #50 remains the production gate. Adaptive refine/coarsen stays disabled until all phases and end-to-end acceptance criteria are implemented and validated on one exact integrated mainline commit. A passing CI run for a helper, adapter or isolated state store is necessary evidence for that component, not proof of production mixed-LOD support.
