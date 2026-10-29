# Recovery assertion parity audit — 2026-10-25

## Exact baseline and CI

- Audited baseline: `main` at `d5cefaa150beeca6f06ec07d226ee720d1a7f1ae`.
- CI run #1350: [workflow run](https://github.com/Ayka11/reality_engine/actions/runs/40198177672).
- Result: **PASS** for the `build` job. The run completed npm audit gate/report, lint, recovery/regression checks, build, both Docker image builds, Hugging Face smoke/CPU checks, and Playwright browser acceptance.
- This establishes CI health for this exact commit; it does not close the known production capability gaps tracked in [#50](https://github.com/Ayka11/reality_engine/issues/50) and [#62](https://github.com/Ayka11/reality_engine/issues/62).

## Assertion-level comparison

### CPU frame rollback

Current `main` test: `scripts/check-simulation-engine-cpu-frame-rollback.ts`.

Covered on `main`:
- Inject a failure after frame work and mutate grid front/back buffers, agent state and membership, subsystem PRNGs, laws, world events, causal events, recorder state, chunk ownership and dirty-chunk metadata.
- Compare the full captured recovery snapshot before/after rollback.
- Retry the same engine and compare its next frame against a clean control restored from the same snapshot.
- Reject invalid asynchronous/synchronous step arguments without mutation or queue poisoning; zero-step and zero-delta calls are no-ops.

Older branch-only `SimulationEngineFrameRollback.regression.ts` additionally has two scenario details:
1. A second injected failure inside `LawEngine.tick` after a LOD/entity/agent commit barrier, explicitly creating a chunk and changing ownership/dirty metadata.
2. Replacement of the active `InfinityScaleExecutionPlan` during `syncDenseToChunks`; the frame must reject the stale plan, roll back simulation state, and preserve the newly installed plan.

Disposition:
- The active-plan replacement assertion is **not portable as written**: current `main`'s `SimulationEngine` has no `setInfinityScaleExecutionPlan()` API or equivalent active-plan contract. Do not restore the legacy API merely to make the old test pass.
- The late-failure test overlaps current full-snapshot rollback coverage, but its exact post-commit injection point is not proven equivalent. If the current frame pipeline gains a supported post-commit hook or equivalent boundary, add a regression there. Until then, classify this as a documented coverage difference, not proof of a current-main defect.
- The current main test also validates invalid arguments and no-op calls, which the old branch regression does not.

### RNG recovery

Current `main` CI executes:
- `scripts/check-script-engine-rng-recovery.mjs`
- `scripts/check-agent-worldevents-rng-recovery.mjs`
- `scripts/check-terrain-worldcomposer-rng-recovery.mjs`

Current coverage includes:
- Script deterministic replay; invalid PRNG snapshots; rollback of grid writes and script RNG after exceptions and rejected asynchronous script results.
- Agent/grid replay and per-instance ID isolation; WorldEvents effects/history/automatic-event replay, reset semantics and invalid snapshots.
- Same-seed terrain replay across biomes, seed divergence, deterministic default terrain, WorldComposer hazard replay and RNG rewind after a failed authoritative mutation.

Older `WorldGenerationRNGRecovery.regression.ts` checks a module-level `ENV_HAZARDS["Meteor Activity"]` RNG snapshot/restore and checks seeded preset/terrain replay plus invalid zero RNG state. Current `main` has moved toward instance-owned `WorldComposer` RNG and authoritative mutation transactions; its periodic-hazard replay and failure-rewind tests cover the maintained contract. Do not port the old module-global RNG API back solely for test parity.

## Remaining actions and deletion decision

1. Keep `infinity-scale-real-diagnostics` until its unique experimental/runtime and RC-evidence material has an explicit retain/port/supersede/discard disposition; this audit alone does not authorize branch deletion.
2. Keep adaptive topology changes fail-closed until issue #50 criteria pass: physical sparse-chunk remapping, complete cell transfer/conservation, atomic rollback, stale-revision rejection and end-to-end refine/coarsen tests.
3. Keep issue #62 open until supported mutation boundaries have a complete revision-invalidation contract and tests, including direct/internal writers, restore/import/worker-transfer, undo/redo, reset and rollback paths.
4. Do not label the project production-ready solely because CI #1350 is green. It is suitable for development and constrained demonstrations; production release remains gated by the open runtime correctness issues above.

No runtime implementation was changed by this audit. No branch was created, merged, archived, or deleted.
