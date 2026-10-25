# Infinity Scale branch audit — 2026-10-25

## Decision

**Do not merge or delete `infinity-scale-real-diagnostics) wholesale.** Keep current `main` as the production baseline, preserve the branch while its unique experimental and release-governance material is reviewed, and port only isolated components after their dependencies and runtime contracts have been verified.

The old branch has a useful, independently passing RC validation harness. It also contains a large set of adaptive-planning, scientific-measurement, replay, and provenance modules that are not all represented on `main`. Conversely, several recovery tests overlap newer checks now run on `main`, and several files are developer backups/logs rather than candidate source.

## Exact refs and verification

| Ref | SHA | Verification |
|---|---|---|
| `main` | `dcf11851055994bc56841e111f60282fc16d5784` | Reality Engine CI #1345 passed, including npm audit gate/report, lint, regression/recovery checks, production build, both Docker images, HF smoke/CPU checks, and browser acceptance. [Run #1345](https://github.com/Ayka11/reality_engine/actions/runs/40197004428) |
| `infinity-scale-real-diagnostics` | `c95bebc75c3cf4a0ebcb06242e10deb6a5896b97` | Infinity Scale RC Validation #378 passed TypeScript validation, production build, browser smoke, Infinity Scale release validation, release-evidence validation, reproducible package check, provenance integrity, and RC evidence artifact upload. [Run #378](https://github.com/Ayka11/reality_engine/actions/runs/40090197500) |

These runs validate different revisions and workflows. The branch RC run is evidence for that branch's own harness, not evidence that its entire implementation has been integrated into or validated as part of `main`.

The Git tree comparison found 378 paths on the branch, 461 on `main`, and 133 branch-only paths. The compare API reports 626 commits ahead and 966 behind the merge base. The branch is materially divergent; a bulk merge or cherry-pick sequence is not a safe integration strategy. [Compare refs](https://github.com/Ayka11/reality_engine/compare/main...infinity-scale-real-diagnostics)

## Recovery-test overlap

The following older branch tests have current `main` test entry points covering the same named subsystem or area:

| Branch-only regression | Current `main` coverage |
|---|---|
| `AgentSystemRecovery.regression.ts` | `test:agent-system-recovery` |
| `CausalGraphRecovery.regression.ts` | `test:causal-graph-recovery` |
| `ChemLayerRecovery.regression.ts` | `test:chem-layer-recovery` |
| `CivilizationSystemRecovery.regression.ts` | `test:civilization-system-recovery` |
| `CosmologicalSimRecovery.regression.ts` | `test:cosmological-sim-recovery` |
| `EntityLayerRecovery.regression.ts` | `test:entity-layer-recovery` |
| `RecorderRecovery.regression.ts`, `RecorderControlRecovery.regression.ts` | `test:recorder-recovery`; core recovery also validates recorder state |
| `SimulationEngineCoreRecovery.regression.ts` | `test:simulation-engine-core-recovery` (current harness includes broader recovery, failed restore/rollback, and pending-readback invalidation assertions) |
| `SimulationEngineFrameRollback.regression.ts` | `test:simulation-engine-cpu-frame-rollback`; GPU stale-readback/commit paths are separately exercised |
| `SparseVoxelGridRecovery.regression.ts` | `test:sparse-voxel-grid-recovery` |
| `WorldEventsRecovery.regression.ts` | `test:worldevents-recovery` |
| `WorldGenerationRNGRecovery.regression.ts` | Split across `test:script-engine-rng-recovery`, `test:agent-worldevents-rng-recovery`, and `test:terrain-worldcomposer-rng-recovery` |

This is an entry-point/coverage overlap audit, not a claim of assertion-by-assertion equivalence for every legacy test. Before branch deletion, explicitly compare the branch-only `LawEngineRecovery.regression.ts`, `SimulationRNGReset.regression.ts`, and `SimulationStochasticReplay.regression.ts` against current core-recovery and RNG checks; their names do not have one-to-one dedicated scripts on `main`. Keep any distinct failure conditions or deterministic replay cases by porting the assertions into maintained `main` tests, not by restoring the old runtime tree.

Other branch-only recovery/replay tests—especially `InfinityScaleDeterministicReplay`, `InfinityScaleFailureReplay`, `InfinityScaleFullPipelineReplay`, and `InfinityScaleRuntimeReplay`—are Infinity Scale experimental evidence, not generic subsystem recovery tests. They need separate evaluation.

## Unique material worth preserving for review

The 133 branch-only paths include:

- **Adaptive runtime / planning:** feedback loops, mutation plan builders, predictive and closed-loop controllers, global planning, post-commit observation, and transaction/runtime regression suites.
- **Scientific and performance evidence:** telemetry, stability/causal metrics, goal-directed and controlled benchmarks, policy comparisons, statistical experiments, deterministic replay, and failure/full-pipeline replay.
- **Release governance:** RC manifest, validation suite, deterministic package creation, release-evidence and integrity validation scripts, and the RC workflow.
- **Other tests/tooling:** GPU boundary regression and a browser workspace smoke test.
- **Non-production artifacts:** 8 backup files and `.vite-dev.log`; these should not be ported as runtime source.

The release-evidence workflow is a concrete unique capability validated by RC run #378. Before porting it to `main`, audit whether the evidence package can be made to use the current `main` test suite and current topology capability flags without importing legacy implementation assumptions. The branch's successful RC validation does not by itself prove topology mutation is implemented.

## Critical topology gate — preserve fail-closed behavior

On `main`, `src/infinity/InfinityScaleAdaptiveLODTransactionBridge.ts` deliberately rejects any changed LOD topology until physical chunk remapping and full-cell transfer exist. The branch's own `InfinityScaleAdaptiveRuntime.regression.ts` also expects topology mutation to be rejected and revisions to remain unchanged when physical remapping is unavailable.

Therefore:
- Do not enable adaptive topology changes merely because planning, predictive metrics, replay, or RC packaging passes.
- Do not merge the branch wholesale over `main`.
- Retain the current authoritative transaction/rollback implementation and its fail-closed gate.
- Require physical chunk remapping, complete cell transfer/conservation, atomic rollback, stale-revision rejection, and regression coverage before a production topology commit can be enabled.

## Branch deletion gate

**Status: NOT READY FOR DELETION.** Deletion should wait until:
1. The three unresolved recovery/RNG test areas above have assertion-level dispositions.
2. The unique adaptive/replay/scientific modules have been categorized as (a) useful and ported, (b) intentionally superseded, or (c) disposable experiment artifacts.
3. RC release-evidence and provenance functionality has either been ported and tested against `main`, or explicitly recorded as intentionally not retained.
4. The decision is rechecked against the exact current branch and `main` SHAs.

No branch was deleted as part of this audit. No working branch was created.
