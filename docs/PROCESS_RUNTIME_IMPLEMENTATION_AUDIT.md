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
| 0 | Energy diffusion | 3D sparse stencil using `p.energyDiffusion` and the canonical mask | Uses `energyDiffusion` × material conductivity | Uses `energyDiffusion` without the material-conductivity multiplier | Implemented, but CPU/GPU coefficient semantics differ from the worker |
| 1 | Temperature diffusion | Uses `tempDiffusion` and `tempEnergyCoupling` | Uses `tempDiffusion / heatCapacity` plus energy coupling | Uses `tempDiffusion` and energy coupling without material heat capacity | Implemented; material and discretization semantics differ |
| 2 | Density flow | Uses `p.densityDiffusion` in a Laplacian | Six-neighbor Laplacian uses `p.densityDiffusion` | Six-neighbor Laplacian uses `p.densityDiffusion` | Dedicated density mobility is wired across all three paths; boundary and sparse allocation semantics still differ |
| 3 | Entropy growth | Masked; parameterized rate/coupling plus a temperature term | Masked; parameterized rate/coupling plus a temperature term | `EntropyLayer` uses parameterized rate/coupling plus a temperature term | Present; the temperature and energy-decay terms remain partly heuristic |
| 4 | Information | Parameterized threshold growth/decay; combines information and signal updates; no memory field in compact worker layout | Parameterized threshold growth/decay | `EntropyLayer` plus `InfoPhysics` decay, coherence, memory and resonance (both process-mask gated) | Present, but the equations and state variables differ substantially across backends |
| 5 | Bio potential | Uses field values and material `bioAffinity` | Uses field values and material `bioAffinity` | Computes from information, energy, density and entropy; no material-affinity term | Implemented with inconsistent material response |
| 6 | Wave propagation | Spatial Laplacian on scalar wave field plus energy coupling | Updates phase/amplitude and energy; no spatial wave equation | Updates phase/amplitude; no spatial wave equation | Not equivalent across backends; not a calibrated wave solver |
| 7 | Gravity | Density gradients modify the compact worker's 2D `FX/FY` vector | Changes density using `gravity_pot` | Changes density using `GRAVITY_POT` | Different modeled quantities across the worker and authoritative grid solvers |
| 8 | Phase transition | Threshold rule using `p.phaseTransitionRate` | Threshold rules use `p.phaseTransitionRate` | Threshold rules use `p.phaseTransitionRate` from the GPU parameter buffer | Rate parameter is now shared across CPU/GPU/worker; thresholds remain phenomenological and are not empirically calibrated |
| 9 | Metabolism | Uses `p.metabolismRate` | Uses hard-coded `0.12` | Uses hard-coded `0.12` | Implemented, but parameter sensitivity differs across backends |
| 10 | Signal propagation | Adds Laplacian-based transport into the information field using `p.signalPropagationRate` | Diffusion-like update of information using `infoGrowthRate` | Diffusion-like update of information using `infoGrowthRate` | Does not transport a distinct signal field; parameter mapping differs |
| 11 | Crystallization | Uses `p.crystallizationRate` × material rate; converts Vacuum/Stone/Sand to Crystal | Uses `p.crystallizationRate` × material rate; converts Vacuum/Stone/Sand to Crystal | Uses `p.crystallizationRate` × material rate; converts Vacuum/Stone/Sand to Crystal | Parameter and material-transition behavior aligned; regression covers mask, zero rate, material sensitivity and finite outputs. GPU runtime still requires hardware-backed numerical comparison |
| 12 | Radiation | Uses shared threshold/rates and material absorption; threshold delta uses pre-step energy | Uses shared threshold/rates and material absorption; WGSL parameter ABI indexes 25–27 | Uses shared threshold/rates and material absorption; threshold delta uses pre-step energy | Parameter/material response aligned in code; deterministic CPU and static cross-backend regressions added, but WebGPU numerical parity still needs hardware-backed verification |
| 13 | Pressure diffusion | Pressure Laplacian plus relaxation toward the density/temperature equation of state | Six-neighbor pressure Laplacian plus equation-of-state relaxation, parameterized by `pressureDiffusion` | Six-neighbor pressure Laplacian plus equation-of-state relaxation, parameterized by `pressureDiffusion` | Transport is present in all three paths; CPU/GPU use Neumann boundaries and worker samples sparse neighbors |
| 14 | Field rotation | Parameterized `FX/FY` smoothing/cross-coupling; no updates when disabled | Parameterized 3D vector update; only in-bounds neighbors enter its average; no updates when disabled | Parameterized 3D vector update; no updates when disabled | Mask and coefficients are covered by CPU regression and cross-backend contract; worker retains a 2D vector schema and the rule remains heuristic, not a true curl solver |
| 15 | Erosion | Material resistance and `p.erosionRate`; planar `FX/FY` flow threshold | Material resistance and `p.erosionRate`; 3D `FX/FY/FZ` flow threshold | Material resistance and `p.erosionRate`; 3D `FIELD_X/Y/Z` flow threshold | Now present in all three paths; worker's compact field schema lacks a Z-flow component |

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
5. `PhysicsParams` includes dedicated coefficients for density mobility,
   pressure diffusion, phase transitions, metabolism, crystallization, radiation,
   field rotation, and erosion. However, the CPU/GPU paths do not consume all of
   those values: the worker uses more of the canonical parameters, while GPU
   `SimParams` and CPU `FieldPhysics` still contain hard-coded rates. A declared
   parameter is not considered operational until tests prove parameter sensitivity
   on each backend that claims to support it.

## Recommended implementation order

1. Finish the cross-backend parameter map: every `PhysicsParams` field used by a
   process must reach the GPU kernel or be explicitly documented as unsupported.
2. Align CPU, GPU, and worker process equations one process at a time, beginning
   with pressure transport and density mobility after the erosion contract.
3. Add deterministic tests per process for enabled/disabled invariance, parameter
   sensitivity, finite bounds, chunk-boundary transport, and rollback behavior.
4. Keep backend-specific model differences explicit, especially the worker's
   compact two-component force vector and the CPU/GPU finite-grid boundary rules.
5. Do not label a process "implemented" solely because a branch exists: tests
   must demonstrate that enabling it changes intended fields and that disabling
   it leaves those fields unchanged. These computational tests are not proof of
   empirical or physical validity.

## Explicit non-goals

This audit does not claim that the heuristic rules are validated physical models.
It also does not replace the authoritative `SimulationEngine` with the chunk
worker or change the sparse chunk storage format.


## Mainline follow-up — 2026-10-27

- `InfoPhysics` now receives the authoritative `activeProcessMask` in all three
  `SimulationEngine` call sites and returns without changing information, memory,
  entropy, or energy when `PROC.INFORMATION` is disabled. A focused regression is
  a mandatory CI step.
- CPU `FieldPhysics` now has a mask-gated erosion branch using the canonical
  `erosionRate`, material resistance, density gate, and flow threshold. Tests
  cover disabled erosion, sub-threshold flow, material sensitivity, and finite
  outputs.
- The subsequent cross-backend erosion patch maps `erosionRate` into GPU
  `SimParams` and aligns the worker flow threshold. The sparse worker's schema
  still exposes only `FX/FY`; it cannot currently represent Z-directed flow.
- These changes close two specific activation/parameter gaps. The pressure,
  density-mobility, wave, gravity, crystallization and radiation rows above remain
  documented backend differences, not validated physical laws.


### Pressure diffusion parity follow-up — 2026-10-27

The CPU and GPU solvers now compute a six-neighbor pressure Laplacian and relax pressure toward the density/temperature equation of state. The GPU parameter ABI forwards `PhysicsParams.pressureDiffusion`; the sparse worker uses the same pre-step density/temperature sample and retains its sparse-neighbor boundary semantics. New deterministic CPU and worker regressions check disabled-mask invariance, coefficient sensitivity, and finite pressure values. These tests verify implementation consistency, not empirical validity of the pressure equation.


### Density-flow coefficient parity follow-up — 2026-10-27

The CPU and GPU solvers now use the dedicated `PhysicsParams.densityDiffusion` coefficient instead of deriving mobility from `energyDiffusion`. The GPU parameter ABI forwards the coefficient explicitly. The CPU regression holds `energyDiffusion` nonzero while toggling `densityDiffusion` to zero and to its configured value, verifying that the intended parameter alone controls density transport. This verifies implementation sensitivity, not empirical calibration of the density model.


### Phase-transition coefficient parity follow-up — 2026-10-27

The CPU and GPU phase-transition rules now consume `PhysicsParams.phaseTransitionRate`, matching the sparse worker. The GPU parameter ABI has since grown to 31 floats (124 bytes); `phaseTransitionRate` remains at index 23. A CPU regression covers the process mask, zero-rate behavior, boiling and freezing branches, and finite outputs. The static cross-backend contract verifies parameter forwarding and use; this establishes coefficient wiring, not the empirical validity of the phenomenological thresholds.


### Crystallization parity follow-up — 2026-10-27

CPU, GPU and sparse worker crystallization now use the configured `PhysicsParams.crystallizationRate` multiplied by the material coefficient; Vacuum retains the worker's explicit unit multiplier despite its library coefficient being zero. All three paths convert only Vacuum, Stone and Sand to Crystal, and zero rate no longer changes the material ID. GPU `SimParams` carries the coefficient at index 24; the current ABI has since grown to 31 floats (124 bytes). Mandatory CI includes a deterministic CPU regression and static cross-backend contract checks. This is implementation parity evidence, not a physically calibrated phase-transition model; a real WebGPU numerical parity test remains outstanding.


### Radiation parameter parity follow-up — 2026-10-28

CPU, GPU and sparse worker radiation now use `PhysicsParams.radiationThreshold`,
`radiationDensityRate`, and `radiationEnergyRate`. All three paths apply the
material `radiationAbsorption` fraction to density reduction and clamp density
and energy to non-negative values. The trigger and rate delta are based on the
immutable pre-step energy sample; output losses are applied to the current
per-step result so earlier enabled processes are not overwritten. GPU
`SimParams` now uses 28 floats (112 bytes), with radiation parameters at
indices 25–27. Mandatory CI includes a deterministic CPU regression for disabled
mask, below-threshold energy, zero rates, material absorption, parameter
sensitivity, clamping and finite outputs, plus static cross-backend contract
checks. These checks verify implementation wiring, not physical calibration;
hardware-backed GPU numerical comparison remains outstanding.


### Field-rotation parameter and mask follow-up — 2026-10-28

CPU and GPU field rotation now use the configured `fieldRotationDamping`,
`fieldRotationNeighborCoupling`, and `fieldRotationCrossCoupling` values;
the sparse worker already used those coefficients. CPU/GPU no longer smooth the
field vector when `PROC.FIELD_ROTATION` is disabled. The GPU neighbor average
now counts only in-bounds neighbors, matching the CPU and sparse-worker stencil
semantics. The parameter ABI has 31 floats (124 bytes), with field-rotation
coefficients at indices 28–30. The worker layout now carries FX, FY, and FZ;
FZ is appended at field index 14 so existing indices remain stable, and the
transfer parser consumes 15 fields per cell. Mandatory CI includes deterministic
CPU checks for disabled-mask invariance and parameter sensitivity plus static
parameter-forwarding checks across backends. This remains a heuristic vector
update rather than a calibrated curl-based solver.


### Sparse-worker field-vector Z component parity — 2026-10-28

The follow-up cross-backend audit found that the sparse worker applied configured field rotation to X/Y but left Z unchanged, despite CPU and GPU rotating all three components. The worker layout now appends FZ at index 14 (NF=15), without shifting the existing fields; the main-thread transfer parser uses the same expanded stride. The worker accumulates the Z-neighbor stencil and updates FZ with the same damping and neighbor-coupling coefficients. Static contract checks and a deterministic worker runtime test guard all three components. This closes the representation mismatch in software paths; GPU numerical equivalence still requires hardware-backed comparison.
