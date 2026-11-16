# Global Entity Identity Domain Inventory

**Status:** partial by design  
**Runtime entry point:** `index.html` → `src/boot.js` → `src/infinityBootstrap.ts`  
**Authority model:** source subsystems own entity state and lifecycle; the global directory is a read-only, namespaced projection.

## Purpose and non-goals

`GlobalEntityIdentityRegistry` provides collision-safe addressing across independently-owned runtime domains. It does not replace their local maps, allocate local IDs, own entity state, or dispatch lifecycle mutations. A source keeps its existing ID and publishes a complete inventory when the active application asks for `window.getGlobalEntityIdentitySnapshot()`.

A global key is derived from the domain name and the local ID's type and value. Numeric `1` and string `"1"` remain distinct; equal local IDs in different domains do not collide. Candidate domain inventories are validated before publication, duplicate IDs within a domain are rejected, and the registry advances its revision when a published domain changes.

## Active domains captured by the booted application

The browser entry point is `index.html`, which loads `src/boot.js`. That module imports `src/infinityBootstrap.ts`; the directory is therefore assembled at the Infinite World bootstrap, not in the separate finite-simulation `src/main.ts` entry module.

| Domain | Authoritative owner | Identity source | Lifecycle boundary |
|---|---|---|---|
| `infinite-world-object` | `InfiniteWorldRenderer.objects` / `WorldObjectManager` | Stable `WorldObject.id` from `world.objects.values()` | Add, update, transform, remove, clear, world snapshot import/restore |
| `external-asset-placement` | `WorldAssetRuntime` plus `InfiniteWorldRenderer` pending placement descriptors | `instanceId` from validated, merged loaded and pending persistent placements | Explicit asset import/materialization, placement update/removal, save/restart recovery; binaries are not fetched automatically during recovery |
| `world-library-civilization-branch` | `CivilizationRuntime` | `branchId` from `civilizationRuntime.branchesList()` | Branch fork, branch tick/history publication, runtime snapshot restore |

### Refresh and revision semantics

The directory is refreshed when `getGlobalEntityIdentitySnapshot()` is called. Each call reads the current authoritative inventories for all three captured domains and atomically publishes them to the registry before returning the detached snapshot. It is not a second entity store and does not subscribe to every source mutation. Consequently, the exposed revision describes the most recently requested directory snapshot; clients must request a fresh snapshot after a source operation before relying on its revision or membership.

The global directory is derived runtime metadata. It is not serialized as a second owner in a world package. World objects and external placement intent are restored by their respective owners; civilization branches use the explicit `worldCivilizationRuntimeSnapshot()` / `worldRestoreCivilizationRuntime()` APIs.

## Explicit exclusions

The following stores are deliberately not reported as active entries in this directory. A source is not excluded because it is unimportant; it is excluded because its runtime scope, identity meaning, ownership, or persistence adapter is different from the three active domains above.

| Excluded domain | Source | Classification and reason |
|---|---|---|
| `finite-simulation-entity` | `src/simulation/EntityLayer.ts` / `src/simulation/SimulationEngine.ts` | Numeric IDs and cell ownership in the finite simulation. This runtime is not wired as a provider by the active `boot.js` entry point. Its dense/sparse reconciliation and rollback contract must remain separate until an explicit adapter is designed. |
| `simulation-agent` | `src/simulation/AgentSystem.ts` | Finite-simulation agents have their own ID allocator, state and migration/restore semantics; no provider is attached to the active booted runtime. |
| `simulation-civilization` | `src/simulation/CivilizationSystem.ts` | Finite simulation subsystem, distinct from the World Library's counterfactual branch runtime. It is not an active boot-domain provider. |
| `legacy-cluster` | `src/entity/EntityLayer.ts` | Legacy cluster detector; no active production provider is wired into the booted application. |
| `kernel-ecs` | `src/kernel/World.ts` and `src/kernel/Entity.ts` | Standalone ECS world with its own entity map and component store. It has no adapter connected to the active application runtime. |
| `world-resource-inventory` | `src/worldLibrary/WorldResourceEconomy.ts` | Resources are semantic inventory records keyed by resource IDs, with amount/capacity/regeneration. They are stocks, not independently placed scene entities. |
| `world-production-infrastructure` | `src/worldLibrary/ProductionInfrastructureRuntime.ts` | Infrastructure state is keyed by civilization ID and projects the civilization's production/economic state. It is not a separately-owned scene-entity identity domain. |

## World Library classification

The World Library contains several kinds of ID-bearing data. They must not all be interpreted as entities.

| Store or subsystem | Classification | Directory treatment |
|---|---|---|
| `CivilizationRuntime.branches` | Persistent analytical/counterfactual branches with stable `branchId` and history | Included as `world-library-civilization-branch` |
| `CivilizationRuntime.branchStates`, branch resources, environments and causal events | Sidecar state owned by a branch | Not separate identities; each is subordinate to the branch ID |
| `CivilizationRuntime.experiments` | Experiment results referencing branch IDs and outcomes | Result records, not live world entities |
| `WorldResourceEconomy.resources` | Semantic resource inventory | Explicitly excluded |
| `ProductionInfrastructureRuntime.states` | Civilization-keyed state projection | Explicitly excluded |
| `SettlementGrowthModel` | Evaluation and transition model whose state is embedded in civilization state | Model, not an independent entity store |
| `WorldLibrary`, `WorldRuleGraph`, catalog and rules | Semantic definitions and dependency/relationship data | Definition stores, not live entities |
| Asset provider registry, discovery and import manifest | Service/provider definitions, discovered assets and provenance/licensing records | Not live world-object identities |
| Biome population, environment resolution, generation plans and event-consequence processing | Planning, resolution or transient derived results | Not persistent entity owners |
| `WorldAssetRuntime` | Runtime asset instances | Their persistent placement identities are included through the placement domain; asset source/catalog IDs are not substituted for placement IDs |

## Ownership and recovery safeguards

- `WorldObjectManager` is authoritative for placed world-object records and returns detached snapshots to callers.
- `WorldAssetRuntime` owns loaded asset instances; the renderer's placement projection merges that state with pending persistent placement intent and validates the result.
- `CivilizationRuntime.serializeState()` now returns a detached structured clone. `restoreState()` clones and validates the complete candidate before replacing live maps, rejects duplicate branch IDs, and does not partially clear live state on invalid input. `forkBranch()` skips branch IDs already used by any branch-related map.
- The browser acceptance suite exercises world-object add/remove visibility, object and pending-asset placement recovery after restart, and civilization branch create/restore visibility in the global directory.
- Unit tests exercise registry namespace collisions and atomic publication, plus CivilizationRuntime snapshot detachment, restore isolation, duplicate-ID rejection and fork-ID collision handling.
- Browser Acceptance verifies successful package import publishes the imported world-object and pending-placement IDs with a newer directory revision, and verifies the imported inventory survives a full page restart.
- Browser Acceptance verifies placement transform changes retain the same `identityKey`/`localId` and do not advance the identity revision, while updated coordinates, scale and rotation are written to the durable placement sidecar.
- Browser Acceptance verifies source-scoped GLTF removal publishes the exact remaining source IDs and then an empty placement domain after the final source is removed.
- Browser Acceptance verifies failed reseed, failed Clear World, malformed package preflight, and a late package-publication failure leave the previous identity snapshot unchanged; the late-failure case also checks restoration of object IDs, placement descriptors, seed and manifest state.
- Browser Acceptance exercises real world-object `place → undo → redo → undo` history; the global revision advances at every membership change and Redo restores the exact same `identityKey` and `localId`.

Exact-head CI evidence on 2026-11-16:
- [CI #2657](https://github.com/Ayka11/reality_engine/actions/runs/43835431361), commit `66b504c5e3a565359e6690266c639b3b86ba0daa`, 104/104 steps: failed transitions are identity no-ops; asset removal publishes exact surviving placement IDs; successful reset/reseed and restart do not resurrect removed IDs.
- [CI #2658](https://github.com/Ayka11/reality_engine/actions/runs/43837316350), commit `d71de96f9c1814bc624ee9a0cfdd851b18ec38cd`, 104/104 steps: successful package import and placement-transform persistence/stable identity.
- [CI #2659](https://github.com/Ayka11/reality_engine/actions/runs/43838485785), commit `c8937a06ec6aaf7f42459151ffdf30af2d8c3ab1`, 104/104 steps: valid package fails after editor publication is deliberately injected; Browser Acceptance verifies the prior global identity snapshot and editor state are restored.

These checks validate the covered paths. They do not establish that every excluded subsystem is globally enumerable or fully restored by the active world-package workflow. Coverage remains intentionally `partial`.

## Criteria before coverage can become complete

1. Every independently-owned domain that is active in the application has an adapter that publishes a complete and revision-consistent inventory.
2. Domain IDs remain stable within their source owner; global namespacing must not rewrite local IDs or merge ownership maps.
3. Restore/import/reset and undo/redo/rollback boundaries republish the exact post-commit inventories; failed transitions must not publish partial membership.
4. Cross-domain references and ownership relations are validated without conflating scene objects, simulation agents, analytical branches, resource stocks and infrastructure projections.
5. Browser and runtime regressions cover create, update, remove, fork, import, restore, restart and rollback for each active domain.
6. Only after every relevant domain is enumerated and verified may `coverage.status` change from `partial`.

The current status is intentionally `partial`. A green CI run proves the configured, covered contracts pass; it does not prove that excluded domains are integrated.


Exact-head history verification: [CI #2663](https://github.com/Ayka11/reality_engine/actions/runs/43855338822) passed 104/104 on `931a075f4d5791410fcddcf92d6b8a842d8fb0fa`. The observed identity revision sequence for Place/Undo/Redo/Undo was 5 → 6 → 7 → 8 → 9; Redo preserved the same key and local ID.
