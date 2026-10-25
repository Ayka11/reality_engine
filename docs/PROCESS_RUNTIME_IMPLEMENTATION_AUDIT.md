# Process Runtime Implementation Audit

Audit scope: `main`, `src/process/ProcessDef.ts`, `src/laws/MetaLaw.ts`,
`src/laws/LawEngine.ts`, `src/core/ChunkSimWorker.ts`,
`src/gpu/GPUBackend.ts`, `src/simulation/FieldPhysics.ts`,
`src/simulation/EntropyLayer.ts`, `src/simulation/InfoPhysics.ts`, and
`src/simulation/SimulationEngine.ts`.

This document distinguishes the authoritative `SimulationEngine` path (GPU
compute when available, CPU field layers otherwise) from the separate sparse
`ChunkSimWorker` path. A process implemented in one does not mean it is
implemented in the other. A GPU branch is counted as code present, not as proof
of a complete or scientifically validated solver.

## Inventory (16 declared processes)

| ID | Process | ChunkSimWorker | GPUBackend | CPU SimulationEngine layers | Assessment |
|---:|---|---|---|---|---|
| 0 | Energy diffusion | Implemented, gated by legacy string `energy`; coefficient `DIFF` | Implemented with `energyDiffusion` and material conductivity | Implemented with `energyDiffusion` | Present in both; worker was inconsistent |
| 1 | Temperature diffusion | Partial: legacy `thermo`; hardcoded coefficients | Implemented with `tempDiffusion`, heat capacity, `tempEnergyCoupling` | Implemented with `tempDiffusion`, `tempEnergyCoupling` | Present; CPU/GPU have different discretization |
| 2 | Density flow | Partial: Laplacian but legacy `thermo` gate; hardcoded rate | Density Laplacian with `0.02 * energyDiffusion` | Density Laplacian with `0.02 * energyDiffusion` | Present, but no dedicated density mobility parameter |
| 3 | Entropy growth | Implemented with legacy `entropy`; hardcoded terms | Implemented with `entropyGrowthRate`, `entropyEnergyCoupling`, plus hardcoded temperature term | Implemented with `PhysicsParams`; temperature term is not fully parameterized | Present; hardcoded terms remain |
| 4 | Information | Implemented with legacy `info`; hardcoded diffusion/growth | Thresholded growth and decay using info parameters | `EntropyLayer` and `InfoPhysics`; mixed parameterized and hardcoded rules | Present; exact semantics differ by backend |
| 5 | Bio potential | Implemented with legacy `bio`; hardcoded thresholds/rates | Computed from information, energy, density, entropy and material affinity | Implemented in `EntropyLayer` | Present; worker and GPU algorithms differ |
| 6 | Wave propagation | Missing | Updates phase/amplitude and energy; no spatial wave equation | Phase/amplitude update in `FieldPhysics`; not a full spatial wave equation | Partial; name overstates spatial propagation |
| 7 | Gravity | Missing | Density updated using `gravityDensityCoupling * gravity_pot` | Density updated using `gravityDensityCoupling * GRAVITY_POT` | Partial; validate potential source and stability |
| 8 | Phase transition | Missing | Temperature/density threshold rules | Temperature/density threshold rules | Partial phenomenological rule; no explicit phase state |
| 9 | Metabolism | Missing | Converts energy to information at bio threshold | Implemented in `EntropyLayer` | Present in authoritative path only |
| 10 | Signal propagation | Missing | Diffusion-like information update | Information diffusion plus separate signal effects | Partial; not a distinct signal-field transport model |
| 11 | Crystallization | Missing | Thresholded density/entropy update with material coefficient | Low-entropy/high-density threshold rule | Partial phenomenological rule |
| 12 | Radiation | Missing | High-energy density/energy reduction with material absorption | High-energy density/energy reduction | Partial; hardcoded coefficients |
| 13 | Pressure diffusion | Missing | Computes pressure from density and temperature; no spatial pressure diffusion | Computes pressure from density and temperature; no spatial pressure diffusion | Partial; label overstates implementation |
| 14 | Field rotation | Missing | Vector smoothing and cross-coupling heuristic | Vector smoothing and cross-coupling heuristic | Partial; not a true curl-based solver |
| 15 | Erosion | Missing | Flow/density threshold reduces density and information using material resistance | No erosion branch found in inspected CPU layers | Partial; GPU only |

## Contract findings

1. `PROCESS_LIBRARY` and `LawEngine.activeProcessMask` are the canonical
   process registry and activation contract for `SimulationEngine`.
2. `SimulationEngine` passes `this.laws.params` and
   `this.laws.activeProcessMask` into `GPUBackend.writeParams`, `FieldPhysics`,
   and `EntropyLayer`. The GPU shader has code branches for all 16 process IDs,
   but several branches are heuristic, reuse unrelated coefficients, or do not
   implement the process description literally.
3. `ChunkSimWorker` previously used `Set<string>` values such as `thermo`,
   `bio`, `info`, and four legacy scalars. It did not consume the full mask or
   `PhysicsParams`. The current change replaces that activation Set with the
   canonical process bitmask and forwards resolved parameters from `sim.laws`.
4. `main.ts` creates the chunk worker independently. It now sends the canonical
   mask and parameter object at startup and before each worker tick, so law
   overrides are reflected in that worker. Legacy node-editor scalar inputs are
   still adapted, but the authoritative LawEngine sync wins on the next tick.
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
