# Simulation Mutation and GPU Readback Audit

## Current implementation update — 2026-10-25

**Validated implementation head:** `2b5bb7b4650cb02f75a13fd1cd9b8a6404eaf1bf`  
**Validation:** Reality Engine CI #1370 passed on this exact head, including lint, recovery/regression checks, the stale-readback and mutable-buffer contract tests, both Docker builds, Hugging Face container smoke, HF smoke/CPU checks, and browser acceptance. [Run #1370](https://github.com/Ayka11/reality_engine/actions/runs/40201717422). Dependency security audit #149 also passed on the same head: [run #149](https://github.com/Ayka11/reality_engine/actions/runs/40201717433). This verifies the configured checks, not every scientific capability or every possible internal mutation path.

This update supersedes earlier statements below that public dense/chunk buffer writes and `CellState` setters are entirely untracked. The current implementation adds:

- `VoxelGrid` and `SparseVoxelGrid` mutation revisions, including tracked public front/back typed-array views.
- `Chunk` mutation listeners and tracked chunk buffer views.
- A public buffer view whose `.buffer` accessor returns a detached copy; indexed writes and supported mutating typed-array methods invalidate the owning revision.
- `CellState.set()` mutation callbacks for grid/chunk cell wrappers.
- `SimulationEngine.step()` captures both engine generation and grid mutation revision before GPU readback, and rejects GPU output if either changes while awaiting the result.
- Regression tests cover tracked buffer writes, chunk listener lifecycle, mutation metadata, concrete read-only metric totals/averages, and stale GPU readback; CI #1370 passed these checks with browser acceptance on the validated implementation head.
- `scripts/check-mutable-buffer-contract.mjs` statically inventories 30 known `getMutableBuffer()` call sites across core storage and synchronous simulation hot paths. It rejects unreviewed new call sites/imports and raw-buffer use forms outside the audited synchronous ownership patterns.
- `SparseVoxelGrid.sumFields()` aggregates the five world metrics in one backing-buffer pass without exposing a mutable alias, causing a false revision increment, or traversing the grid five times.
- Public chunk metadata collections (`dirtyChunks`, `chunkOwners`) and `activeChunkRange` now participate in mutation revision tracking, with regression coverage for pending readback invalidation and Set/Map delete/clear operations.
- `MutationTrackedChunkMap` now registers one grid listener per distinct chunk instance with reference counting, detaches it when the chunk is replaced/deleted/cleared, and avoids duplicate registration on same-key re-insertion. The stale-readback regression verifies idempotent insertion, replacement, deletion, and clear behavior.

**Important internal-alias caveat:** `getMutableBuffer()` advances the revision when it returns a raw mutable typed-array alias, but cannot observe later writes through that same alias. Such aliases must remain synchronous and transaction-local; never retain one across `await` or an ownership boundary. The remaining audit must verify all call sites and replace any cross-boundary alias with a scoped mutation API.

The GitHub workflows now pin `actions/checkout@v7` and `actions/setup-node@v7`; the Node.js 20 action-runtime deprecation warning was absent from the CI #1370 logs.

**Remaining limitation:** this does not close the entire mutation contract. The repository still has an internal raw-buffer escape hatch for performance-sensitive engine code, mutable chunk/map and subsystem metadata, and direct writer/restore paths that need a complete inventory and explicit ownership rules. The audit below should be read as the original inventory and migration plan, with completed items superseded by this dated update; it is not evidence that every arbitrary internal write is guarded. Keep issue [#62](https://github.com/Ayka11/reality_engine/issues/62) open until the supported mutation surfaces and failure/rollback paths are fully enumerated and tested. Keep adaptive LOD topology changes fail-closed under [#50](https://github.com/Ayka11/reality_engine/issues/50).

---

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


### Post-step subsystem publication

The main animation loop now predicts whether climate, multiscale, or language ticks will write the public CPU grid. Before a scheduled writer pass it invalidates any pending GPU readback, and after the synchronous batch it publishes dense/chunk/GPU state once. Non-writing ticks do not trigger an unnecessary whole-grid GPU upload. If a scheduled pass throws after partial writes, the `finally` publication keeps CPU, chunk and GPU representations aligned, although the independent subsystem's own non-grid state is not rolled back by the core engine snapshot.


### Synchronous mutation callback preflight

The authoritative mutation boundary now rejects native async, async-generator, and generator callbacks before invoking them. Rejecting only the returned Promise is too late for an `async` callback: code before its first `await` may mutate state, and its continuation can resume after rollback. Regression coverage verifies an async callback's body is never entered and a returned thenable still triggers synchronous-prefix rollback. Callbacks must still avoid scheduling detached side effects themselves; JavaScript cannot cancel arbitrary external work created by a nominally synchronous function.


### Auxiliary runtime state in quick saves

Quick saves now retain the in-process state that changes how future ticks evolve beyond the core grid: climate wind/pressure and cadence, multiscale caches/cadence, learned vocabulary and communication history, market/GDP state, meta-law evolution phase, and the cosmological sparse simulation including its RNG. These states use validated detached snapshots and are restored within the engine-owned world transaction, with previous-state rollback if a domain rejects a candidate. Portable/legacy imports reset omitted auxiliary engines instead of accidentally continuing the previous world's learning, market, climate, or cosmological state. Timeline field-only history is cleared only after the world restore commits successfully.


### Scene Director world-context isolation

Quick saves now preserve the Scene Director's bounded conversation history and world-action log. Portable/legacy loads reset that context so the AI director does not carry stale assumptions or observations from a different world. The API key remains app-local and is deliberately excluded from saved snapshots; the auto-directing interval is likewise application runtime state rather than part of a world's data. Regression coverage checks state round-trip, invalid-snapshot rejection without partial mutation, and reset behavior.


### Multiplayer inbound mutation boundary

Incoming remote `paint`, `delta`, and accepted host `full_state` messages now validate their payload before mutation and apply through `SimulationEngine.mutateAuthoritativeState()`. The transaction invalidates pending GPU readbacks before writes, synchronizes dense state to chunks and front/back buffers, and uploads the authoritative result to GPU. Invalid or all-filtered batches are rejected without opening a transaction. This prevents remote edits from being overwritten by stale GPU readback and avoids dense/chunk/back-buffer divergence.


### Legacy publication and dense double buffers

The compatibility method `SimulationEngine.syncToGPU()` now synchronizes dense fields to sparse chunks **and** aligns dense/chunk back buffers before GPU upload. This closes the remaining sculpt undo/redo path, which uses a pre-write invalidation callback and then the legacy publication method rather than the engine's full-state snapshot transaction. A regression test verifies the dense back-buffer and chunk mirror both contain the direct edit after publication.


### Autosave storage bound

Because each quick save now includes both dense fields and sparse chunks plus runtime state (including the cosmological simulation), automatic saves are bounded to the latest 12 records. This retains 24 minutes of checkpoints at the current two-minute interval while leaving manually named saves untouched. The prune-and-insert operations share one IndexedDB read/write transaction so a failed write can abort the deletion work, and the previous `currentSnapshot` is only updated after persistence succeeds. Autosave timer failures are caught and reported rather than becoming unhandled promise rejections.

### Frame-consistent quick-save/export capture

Quick saves and portable exports now capture state through the same serialized queue as asynchronous simulation frames. A save request arriving during GPU readback waits until the frame's readback, CPU-side commit, and tick update settle, preventing an old dense buffer from being paired with newer runtime state. The capture callback is synchronous and cannot return a thenable; a failed capture is reported to its caller without poisoning later frames.
### Full application-frame save boundary and director-context invalidation

Quick saves and portable exports now wait for the entire application loop to settle, including post-step climate, multiscale, language, economy, cosmological, rendering, and timeline work, and then queue their synchronous capture behind any remaining engine frame. The loop releases the boundary in a `finally` block and logs frame errors so one rejected/stale frame does not permanently stop the animation loop.

SceneDirector requests carry a world-context generation. Restoring or resetting director state advances that generation, causing a network response begun for a previous world to be discarded rather than appending stale history or returning runnable code into the new world. The UI clears cached runnable code and prior director log content whenever director context is restored/reset.
### Per-frame event publication

The CPU and GPU paths no longer publish dense-to-chunk state before all post-physics writers have completed. One shared synchronization runs after `WorldEvents.autoTick()`, which writes through `CellState` wrappers and can otherwise leave the sparse chunk mirror one event behind the authoritative dense buffer. Regression coverage injects the same direct event mutation into CPU and GPU frame paths and verifies dense/chunk agreement before the step resolves.