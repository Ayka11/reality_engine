# Infinity Scale RC-1 Validation Status

Branch: `infinity-scale-real-diagnostics`

## Validation gate

The release candidate is considered valid only when all of the following complete successfully:

1. `npm ci`
2. `npx tsc --noEmit`
3. `npm run build`
4. `npx --yes tsx scripts/validate-infinity-scale.ts`

The release validation currently covers the 59-test core regression suite and produces a deterministic validation hash. Release-candidate manifest generation remains outside the core suite to prevent recursive validation.

## CI status

The workflow is registered at:

`.github/workflows/infinity-scale-rc.yml`

It supports:
- push validation on `infinity-scale-real-diagnostics`
- pull-request validation targeting `infinity-scale-real-diagnostics`
- manual `workflow_dispatch`

The workflow was also registered on the repository default branch so GitHub can discover the manual workflow.

As of the current repository inspection, GitHub reports **no workflow run** for the latest branch commit. Therefore this document intentionally does not mark the RC as PASS.

## Release evidence artifact

The CI workflow now writes `infinity-scale-rc-package.json` and `infinity-scale-rc-release-record.json` and uploads them as the `infinity-scale-rc1-release-evidence` artifact. The release record is derived from the deterministic commit-bound package identity and does not include a wall-clock timestamp in its identity.

## Release status

- Architecture: READY
- Deterministic replay: READY
- Failure/deferred replay: READY
- Multi-epoch replay: READY
- Causal GPU budget: READY
- Release validation harness: READY
- RC manifest: READY
- CI workflow: REGISTERED
- Commit-bound provenance: READY
- RC release evidence artifact: CONFIGURED
- Automated CI execution: PENDING
- RC-1 release approval: PENDING CI evidence

## Next gate

Run the `Infinity Scale RC Validation` workflow from GitHub Actions, or restore repository Actions execution if workflows remain absent. Only after a real successful run should RC-1 be marked validated.
