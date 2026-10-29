# Mainline Integration Plan — 2026-10-20

## Safety baseline

- Base branch: `main`
- Base commit at branch creation: `2e34edb20b97b7dc3ee2abe30d118153f78dcc68`
- Integration branch: `integration/mainline-infinity-scale-2026-10-20`
- Do not merge to `main` until the candidate is built from current `main`, required checks pass on the exact candidate SHA, and post-merge CI passes.

## Audit findings

1. The open Infinity Scale proposal PR #42 is not a safe whole-branch merge: it is heavily diverged from `main` and GitHub reports it non-mergeable. Selectively port functional modules instead.
2. Draft PR #48 contains useful atomic mixed-LOD transaction/rollback hardening, but its parent is the old `infinity-scale-real-diagnostics` branch and its exact head has no reported CI check runs. Do not merge it or retarget it wholesale.
3. The current `main` already contains the two-phase worker restore protocol and the `scripts/check-worker-restore-two-phase.mjs` regression. Do not re-port the old restore-ack branch wholesale.
4. The current `main` already contains a newer `src/infinity/LegacyScientificFieldBridge.ts` and a more advanced mutable world-field/persistence implementation than the old legacy-bridge branch. Do not replace these files with older versions.
5. The current `main` contains `src/InfinityScaleV2.ts` and `src/infinity/InfinityScaleRuntime.ts`, but lacks the newer mixed-LOD transaction, boundary mapping, and GPU boundary transfer modules present in `infinity-scale-real-diagnostics`.

## Integration sequence

- Phase A: retain this branch as the clean current-main staging point; verify main's baseline CI.
- Phase B: map dependency closure for the Infinity Scale transaction/LOD core; port only a coherent, dependency-complete slice with its regression tests.
- Phase C: run typecheck, focused Infinity Scale regressions, production build, browser acceptance, and full CI on the exact candidate SHA.
- Phase D: integrate the atomic rollback changes from PR #48 only after their dependency closure is present and the regressions pass.
- Phase E: review runtime/bootstrap wiring independently; preserve main's worker, persistence, sculpt transaction, and authoritative world-field behavior.
- Phase F: merge only after the exact candidate is non-conflicting and all required checks are green; verify post-merge CI.

## Current status

No production source files have been changed in this staging branch yet. This commit records the audited constraints; it is not a feature integration or a merge approval.
