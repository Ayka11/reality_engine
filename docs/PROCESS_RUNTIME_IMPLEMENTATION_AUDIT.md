# Process Runtime Implementation Audit

Audit scope: `main`, `src/process/ProcessDef.ts`, `src/laws/MetaLaw.ts`,
`src/laws/LawEngine.ts`, `src/core/ChunkSimWorker.ts`,
`src/simulation/FieldPhysics.ts`, `src/simulation/EntropyLayer.ts`,
`src/simulation/InfoPhysics.ts`, and `src/simulation/SimulationEngine.ts`.

This document distinguishes the **authoritative SimulationEngine path** from the
separate sparse `ChunkSimWorker` path. A process implemented in one does not mean
it is implemented in the other.

## Inventory (16 declared processes)

| ID | Process | ChunkSimWorker | SimulationEngine path | Assessment |
|---:|---|---|---|---|
| 0 | Energy diffusion | Implemented, gated by legacy string `energy`; coefficient `DIFF` | Implemented in `FieldPhysics`, gated by bitmask and `PhysicsParams.energyDiffusion` | Present in both, inconsistent contracts |
| 1 | Temperature diffusion | Partial: coupled to legacy `thermo`; hardcoded `0.07` and `0.002` | Implemented in `FieldPhysics` using `tempDiffusion` and `tempEnergyCoupling` | Present in both, worker parameters mismatch |
| 2 | Density flow | Partial: Laplacian computed but only used in `thermo`; no process-specific gate | Implemented as a density Laplacian in `FieldPhysics`, but coefficient reuses `energyDiffusion` | Partial; lacks dedicated parameter |
| 3 | Entropy growth | Implemented, gated by legacy string `entropy`; mixed hardcoded terms | Implemented in `EntropyLayer` using `entropyGrowthRate` and `entropyEnergyCoupling` | Present in both, worker parameter mismatch |
| 4 | Information | Implemented, gated by legacy string `info`; hardcoded growth/diffusion terms | Implemented in `EntropyLayer`/ `InfoPhysics`; part uses `PhysicsParams` | Present in both, worker parameter mismatch |
| 5 | Bio potential | Implemented, gated by legacy string `bio`; thresholds and rates hardcoded | Implemented in `EntropyLayer` | Present in both, worker parameter mismatch |
| 6 | Wave propagation | Not implemented as a process | Phase and amplitude updated in `FieldPhysics`; not a full spatial wave equation | Partial |
| 7 | Gravity | Not implemented as a process | Density receives `gravityDensityCoupling * GRAVITY_POT`; depends on how potential is populated | Partial; verify potential source and conservation |
| 8 | Phase transition | Not implemented as a process | Temperature/density threshold branch in `FieldPhysics` | Partial phenomenological rule; no explicit phase state |
| 9 | Metabolism | Not implemented as a process | Implemented in `EntropyLayer` when bio potential exceeds threshold | Present in authoritative path only |
| 10 | Signal propagation | Not implemented as a process | Diffusion-like update of information in `FieldPhysics`; separate signal effects in `InfoPhysics` | Partial; no explicit signal transport equation in FieldPhysics |
| 11 | Crystallization | Not implemented as a process | Low-entropy/high-density threshold rule in `FieldPhysics` | Partial phenomenological rule |
| 12 | Radiation | Not implemented as a process | High-energy density/energy reduction in `FieldPhysics` | Partial; hardcoded coefficients |
| 13 | Pressure diffusion | Not implemented as a process | Pressure assigned from density and temperature; no spatial pressure-wave diffusion | Partial; label overstates implementation |
| 14 | Field rotation | Not implemented as a process | Heuristic FX/FY/FZ neighbor smoothing and cross-coupling | Partial; not a curl-based field solver |
| 15 | Erosion | Not implemented as a process | No erosion branch found in `FieldPhysics` or `EntropyLayer` | Missing from inspected runtime paths |

## Contract findings

1. `PROCESS_LIBRARY` and `LawEngine.activeProcessMask` are the canonical
   process registry and activation contract for `SimulationEngine`.
2. `SimulationEngine` passes `this.laws.params` and
   `this.laws.activeProcessMask` into `FieldPhysics` and `EntropyLayer`.
   The authoritative path is therefore partly parameterized already; several
   process implementations still use magic numbers or are only qualitative.
3. `ChunkSimWorker` instead uses `Set<string>` values such as `thermo`,
   `bio`, `info`, and four legacy scalars (`DIFF`, `ENT`, `INFO`, `BIO`).
   It does not consume the full process bitmask or `PhysicsParams`.
4. `main.ts` creates the chunk worker independently and sends legacy parameters
   at startup/compile. Law UI interactions update `sim.laws`, but the current
   code does not synchronize the full mask/parameter object into this worker.
5. The `PhysicsParams` type has no dedicated coefficients for erosion,
   crystallization, radiation, density mobility, or pressure relaxation. Those
   processes cannot all be made fully configurable without extending the
   parameter contract and adding validation/tests.

## Recommended implementation order

1. Synchronize `PhysicsParams` + the process bitmask to the chunk worker without
   changing its sparse chunk storage or frame-transfer protocol.
2. Replace worker string activation with `PROC` bitmask checks; keep a narrow
   legacy adapter only if an existing caller requires it.
3. Add deterministic tests for each process, parameter sensitivity, disabled
   process invariance, finite bounds, and sparse-chunk allocation behavior.
4. Implement missing/partial processes in small groups with explicit numerical
   contracts: density/gravity and pressure first; then wave propagation; then
   erosion/crystallization/phase transition.
5. Do not label a process "implemented" solely because a branch exists: tests
   must demonstrate that enabling it changes the intended fields, disabling it
   leaves those fields unchanged, and parameters affect the expected response.

## Explicit non-goals

This audit does not claim that the heuristic rules are validated physical models.
It also does not replace the authoritative `SimulationEngine` with the chunk
worker or change the sparse chunk storage format.
