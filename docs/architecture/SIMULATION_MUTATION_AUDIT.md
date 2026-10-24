# Simulation Mutation and GPU Readback Audit

**Audit checkpoint:** 2026-10-24  
**Code head reviewed:** `aaa7f79a042d73e351dc7c62f2add624c5572cb6`  
**Validation:** Reality Engine CI Run #1246 passed, including lint, recovery/regression tests, build, both Docker builds, HF smoke/CPU checks, and browser acceptance.

## Executive finding

The engine now serializes asynchronous `step()` calls, validates step parameters, rejects GPU readback when the engine generation changed during the await, rolls back CPU-frame failures, rolls back synchronous `syncTick(n > 0)` failures, and locally rolls back a GPU frame if an exception occurs after a current readback starts mutating CPU state.

**The remaining limitation is important:** `_stateGeneration` only detects mutations that pass through an invalidation boundary. Public typed arrays, mutable cell wrappers, chunk buffers, and public subsystem state can still be changed directly. A revision increment added to only a few setters would create false confidence. The inventory and migration below must be completed before claiming that all direct writes are guarded.

This is a high-risk source inventory checkpoint, not a claim that every repository write site has already been exhaustively enumerated.

## Confirmed mutation surfaces

| Area | Files / entry points inspected | Mutation surface and risk |
|---|---|---|
| Dense cell API | `src/core/CellState.ts`, `src/core/VoxelGrid.ts` | `VoxelGrid.buffer` and `backBuffer` are public typed arrays. `cell()`, `cellAt()`, and `cellBack()` return mutable `CellState` wrappers. Setter calls write through to the array without informing `SimulationEngine`. |
| Sparse grid and chunks | `src/core/SparseVoxelGrid.ts`, `src/core/Chunk.ts` | Sparse dense arrays, chunk buffers, and chunk maps are exposed or mutable. `swapBuffers()`, `snapshot()`, `clear()`, `restoreState()`, `syncDenseToChunks()`, `syncChunksToDense()`, and chunk loading/reconciliation change data or representation identity. A mutation can affect a dense view, a chunk mirror, or both. |
| CPU physics | `src/simulation/FieldPhysics.ts`, `src/simulation/EntropyLayer.ts`, `src/simulation/TemporalLayer.ts`, `src/simulation/InfoPhysics.ts` | Physics layers mutate cell state/typed-array data directly. These are legitimate in-frame writers but must be treated as part of a single frame transaction rather than independently revisioned per cell. |
| Agents and entities | `src/simulation/AgentSystem.ts`, `src/simulation/EntityLayer.ts` | Agent logic writes energy, signals, information and occupancy markers. Entity logic changes the dense grid, entity objects, RNG and identity allocation; it also invokes full-domain chunk reconciliation. |
| Chemistry, events and laws | `src/chemistry/ChemLayer.ts`, `src/world/WorldEvents.ts`, `src/laws/LawEngine.ts` | These mutate grid fields, pending transfers, event state, laws, overrides, and PRNG state. Recovery must include both array and non-array subsystem state. |
| Engine transaction entry points | `src/simulation/SimulationEngine.ts` | `step()`, `syncTick()`, `syncToGPU()`, `triggerEvent()`, `restoreCoreRecoveryState()`, and `reset()` are important invalidation/rollback boundaries. Direct writes performed without these boundaries may bypass generation invalidation. |
| Editing and sculpting | `src/sculpt/BrushEngine.ts`, `src/sculpt/SculptManager.ts`, transaction coordinators under `src/sculpt/` and `src/infinity/` | Brush operations write the dense buffer and synchronize dense/chunk mirrors; rollback/undo/redo also write arrays. These paths need a clearly owned transaction and a single publication point. |
| World composition and scripts | `src/ux/WorldComposer.ts`, `src/world/ScriptEngine.ts` | World composition uses direct buffer references and calls `syncToGPU()` in its main execution path. Script commands can clear or mutate the world and may call `syncToGPU()`; every mutating command needs to be classified, not just the main happy path. |
| Worker transport and restore | `src/core/SimWorker.ts`, `src/core/SimWorkerState.ts` | Worker snapshots, copies, transfers, and restore paths replace or transfer buffers. Transfer and restore must invalidate any outstanding GPU result and preserve a single authoritative CPU state. |
| Serialization/import | `src/world/save/WorldSerializer.ts`, `src/world/save/SaveManager.ts`, `src/world/save/WorldSaveSystem.ts` | Deserialization writes field data into a buffer. Call sites must synchronize chunk mirrors and GPU state or route the write through the authoritative mutation transaction. |
| GPU backend | `src/gpu/GPUBackend.ts` and engine readback path | GPU buffers are a derived execution state. The CPU grid remains authoritative for the guarded readback path; stale output must be discarded, and a failure after applying output must roll back the local CPU commit. |

## Existing safeguards to retain

- `step(dt, nSteps)` rejects invalid `dt` and `nSteps` before queuing work. An asynchronous zero-step request is a no-op.
- The async step queue is not permanently poisoned by a rejected frame.
- GPU output is rejected if the engine generation changed during `await readback()`. `syncTick(0)` is intentionally retained as a sync/invalidation boundary for callers that made direct typed-array writes.
- A current GPU readback is captured immediately before CPU-side commit. Failures after that point restore the pre-commit snapshot; failures during GPU wait do not restore over newer external state.
- CPU `step()` failures and positive `syncTick(n)` failures restore the engine recovery snapshot.
- Core recovery includes dense/back buffers, sparse chunk metadata/ownership, entities, agents and RNG, pending chemistry transfers, events, causal graph, laws and RNG, recorder history, prior energy, and tick.
- Entity reconciliation is revision-bound and fail-closed for unresolved boundary evidence, ambiguous mixed-LOD topology, unverified merge, or inferred extinction without complete ownership evidence.
- `EntityDomainInventoryAuthority` revisions describe the entity/cell inventory; they are **not** a general revision for every grid/chunk write.

## Required migration sequence

### 1. Finish the write-site inventory

For every direct write or buffer-replacement path, record: owner, whether it can run while a GPU readback is pending, whether it updates dense state, chunk state and GPU state, which invalidation method is called, and how its failure is rolled back. Include imports, undo/redo, reset, workers, direct `CellState` writes, and public browser APIs.

### 2. Define one external mutation boundary

Add or designate an engine-owned synchronous transaction for external edits. The boundary must:
1. invalidate any in-flight readback before mutation;
2. capture/validate the source state needed for rollback;
3. apply the mutation synchronously without an `await`;
4. publish dense/chunk state consistently;
5. upload the authoritative CPU state to the GPU when active;
6. roll back on failure and leave the step queue usable.

Do not add a revision counter only to a small set of methods while raw mutable arrays remain an undocumented supported API.

### 3. Migrate external writers first

Route brush/sculpt, world composition, script commands, import/restore, and worker publication through the boundary. Keep read-only/reporting paths on detached snapshots. Explicitly test error paths, including failure before and after chunk synchronization and GPU upload.

### 4. Bound internal frame writes

CPU physics, entity/agent layers, chemistry, events, and laws should execute under a frame-owned mutation context. They must not independently publish partially updated state. Avoid per-cell generation increments; generation changes belong to transaction boundaries.

### 5. Reduce bypass access

After callers are migrated, narrow direct access to mutable arrays/chunk maps where practical. If performance-critical typed arrays must remain exposed, document the compatibility contract and detect unsupported mutation before accepting a GPU readback; do not claim a stale-result guarantee broader than the implemented mechanism.

## Acceptance criteria before closing the mutation-contract work

- An enumerated inventory covers all production write/replace/restore entry points.
- Every supported external mutation either uses the authoritative boundary or has a tested invalidation contract.
- A direct mutation attempted while a GPU readback is pending cannot be silently overwritten by stale output.
- Dense/chunk ownership and GPU state remain consistent after edit, import, undo/redo, reset, worker restore, and failed transaction.
- Injected failure at each transaction stage restores all covered mutable state and does not poison the next step.
- CPU and GPU browser acceptance pass on the exact resulting commit.
- Performance is measured against the current baseline before any full-state comparison or extra per-frame snapshots are enabled globally.

## Branching guidance

Do not merge the highly diverged `infinity-scale-real-diagnostics` branch wholesale. Transfer only modules proven compatible with the current `SparseVoxelGrid`, `SimulationEngine`, and authoritative entity reconciliation path. Keep topology mutation fail-closed until real refine/coarsen data transfer, boundary coverage, conservation, and rollback are verified end-to-end.


## Implementation progress — current P1 mutation-boundary work

The following production entry points have now been routed through the engine's synchronous `mutateAuthoritativeState` boundary:

- `ScriptEngine.run()`: successful script writes publish once through the transaction; failed scripts restore core engine state and the script PRNG.
- `WorldComposer.generate()` and periodic hazard batches: field/agent changes publish atomically; civilization snapshots and the composer PRNG are restored on failure.
- Main UI entry points for synchronous presets, terrain generation, agent seeding/clearing, timeline restore, and event triggering.
- `WorldSaveSystem.applySnapshot()` in the main application: fields/chunks/laws/processes/tick are applied under one engine transaction; graph and civilization state have external checkpoints.
- Sculpt stroke and undo/redo entry points invalidate pending GPU readback before direct writes, then synchronize through the existing publication callback.

The boundary rejects thenables and is deliberately synchronous. Returning a promise does not cancel the asynchronous continuation itself; callers must not provide async callbacks. Public mutable buffers and cell wrappers still exist, so unwrapped direct writes remain a documented limitation.

The world serializer now rejects missing, truncated, wrong-sized, or non-finite field buffers **before writing to the destination**, rather than allowing missing field values to become zero-filled. Regression coverage checks that the destination remains unchanged for each rejected input.

### Remaining P1 scope

- Finish the write-site inventory for all direct writes, worker restores, save/recorder/timeline restore paths, reset/import APIs, and exposed browser entry points.
- Decide which legacy direct buffer APIs remain supported and make their invalidation contract explicit; avoid pretending a local revision counter covers raw typed-array writes.
- Improve failure injection for world-restore external domains and GPU-upload errors.
- Keep entity merge/extinction and mixed-LOD topology fail-closed until complete-domain evidence, real transfer coverage, conservation, and rollback are tested together.


### Quick-save runtime completeness checkpoint

Quick saves now retain optional full runtime snapshots for the entity layer, agents, civilizations, and law engine, alongside the packed grid fields/chunks. Applying a quick save restores these snapshots within the authoritative engine transaction. Snapshots that do not carry the runtime-only payload (portable package import or older save) clear stale in-memory entity/agent registries and their grid ownership markers rather than leaving orphan registries behind. The serializer rejects missing, truncated, wrong-sized, or non-finite field buffers before mutating the target.

This does not imply byte-for-byte restoration of every external subsystem: creator graph rollback is guarded separately; the current save format does not capture all recorder/causal-graph history or external browser services. Those remain explicit future scope.


### Runtime save completeness — second pass

Quick saves additionally preserve chemistry's pending density-transfer queue, world-event history/auto-event countdown/PRNG, causal graph identity state, and the previous-energy baseline used for causal spike detection. Portable/legacy saves that omit those details reset these transient domains to their configured initial states instead of inheriting data from the previously loaded world. Civilization summaries from portable saves are loaded with a fresh per-world tick/history/PRNG baseline.

Scientific Recorder frames are intentionally **field-only snapshots**, not full runtime checkpoints. All UI restore/replay writes now go through `mutateAuthoritativeState`, invalidating pending GPU readback before the write and publishing dense/chunk/GPU state together. On world import, old Recorder history is cleared so it cannot be mistaken for frames from the newly loaded world. Replaying a Recorder field frame should not be described as restoring every entity, agent, law, or external subsystem; that remains distinct from quick-save restoration.


### World-save restore transaction contract

`WorldSaveSystem.applySnapshot()` now refuses to mutate state if the engine-owned synchronous transaction callback is absent; the former partial fallback could have applied fields/laws without a complete rollback boundary. The persistence regression harness instantiates the actual `WorldSaveSystem` implementation with deterministic ports and verifies quick-save restoration of each runtime domain, portable/legacy reset behavior, ownership-marker clearing, recorder-history invalidation, and failure-closed behavior when no transaction is supplied.


### Dense/sparse save restoration authority

Sparse chunk persistence now treats a chunk as empty only when all fields of all cells are zero; energy alone is not a sufficient emptiness signal. `loadChunks()` validates every chunk record and its complete numeric buffer before replacing the live chunk map, clears dirty/ownership metadata from the prior world, and synchronizes front/back buffers. During world restore, sparse chunks are loaded first, the packed field arrays then overwrite the dense window as the authoritative dense representation, and the dense window is published back into the overlapping chunks. Saves without chunk payload clear prior sparse topology instead of keeping chunks from another world.
