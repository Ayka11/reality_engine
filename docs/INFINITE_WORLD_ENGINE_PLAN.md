# Reality Engine — Infinite World / Unified Reality View Plan

## Current verified state

### 1. 3D Infinite World
The current InfiniteWorldRenderer is a deterministic, streamed procedural terrain engine.
- World coordinates are unbounded on X/Z through deterministic WorldGenerator sampling.
- Chunks are streamed around the camera.
- LOD is applied to loaded terrain patches.
- The renderer recenters the local Three.js coordinate frame while retaining world-space coordinates.
- Persistent objects are stored by world chunk.
- Meta-law / decision / resource / civilization layers can affect generated objects and build decisions.

Important limitation: the current chunk manager uses verticalRadius: 0. Therefore this is an **infinite horizontal terrain world**, not an infinite 3D volumetric universe.

### 2. 3D Volumetric Field
The scientific worker still uses a finite 128 × 128 × 64 grid, 8 × 8 × 8 field chunks, and 14 fields per voxel. The volumetric renderer is now spatially bound to `WorldViewContract` and can consume the authoritative Infinite World field provider for the active view. Full streamed volumetric simulation across unbounded world coordinates is not yet implemented.

### 3. 2D Multi-Slice
Production 2D Multi-Slice now projects a world-space window from `FieldSampler.sampleViewWindow()` using `WorldViewContract`. The legacy 36×28 simulation remains available as an explicit compatibility/test mode and is not the production world projection.

### 4. Hybrid
Hybrid now uses the world-space 2D projection alongside the Infinite World surface and shares center, slice Y and seed through `WorldViewContract`. Remaining work is deeper streamed volumetric continuity, not basic spatial synchronization.

## Target architecture
Authoritative Reality State → World Coordinates → Terrain/Hydrology → Scientific Fields → Meta-Laws → Matter/Resources → Biology → Agents/Civilization → Infrastructure → Events/Causality → Provenance.

All render modes become projections of this state:
- 3D Infinite World = terrain + objects + local field overlays
- 3D Volumetric Field = volumetric field projection of the same world region
- 2D Multi-Slice = orthogonal/slice projection of the same world region
- Hybrid = synchronized projections with identical world center, scale and time

## Phase 1 — Spatial contract
Create a single world-view contract containing world center (x,y,z), visible radius, active slice, simulation time, seed, law-state hash, selected region, and coordinate transforms between world coordinates, terrain chunks, scientific voxels, and 2D pixels.
Acceptance: switching modes preserves world center; selecting a point in one mode identifies the same world coordinate in the others; seed changes propagate; simulation time is shared.

## Phase 2 — Replace legacy 2D as an independent world
Keep the existing 36×28 simulation as a compatibility/test mode. Production 2D Multi-Slice should read a selected window from authoritative world/scientific state. Required controls: X/Z center, slice, field selector, zoom, coordinate readout, world/chunk coordinate.
Acceptance: a visible structure or field anomaly selected in 2D is found at the corresponding location in 3D.

## Phase 3 — Volumetric Infinite Field
Extend the finite 128×128×64 scientific field into streamed world-coordinate field chunks with deterministic initialization, bounded active memory, worker simulation, cross-chunk boundary exchange, persistence, and provenance.
Acceptance: moving beyond the current volume continues the field without a seam or coordinate reset.

## Phase 4 — Unified laws
Meta-laws must operate on the authoritative world state rather than only the legacy worker or UI controls. Law State → Field Dynamics → Terrain/Environment → Objects → Biology/Civilization → Consequence. Every material consequence emits provenance.

## Phase 5 — Reality simulation layer
Implemented: deterministic procedural terrain, climate variables, hydrology approximations, field variables, entropy/information/biology dynamics, law-controlled parameters, buildability/decision model, resources, settlements/civilization rules, event consequences, persistence, and provenance.
Still required for stronger physical simulation: conservation-tested coupled field equations, explicit mass/energy transport across chunks, physically validated fluid/hydrology, atmosphere/weather, rigid/soft-body mechanics, validated biological/ecological dynamics, calibrated time integration, and quantitative validation against reference systems.
The engine should not label unimplemented components as physically validated reality.

## Phase 6 — Performance architecture
Required: asynchronous/chunked world composition, worker-side heavy generation where possible, no synchronous full-grid generation during button handlers, incremental semantic population, incremental LOD rebuilds, frame-budgeted materialization, generation progress, and cancellation.
Acceptance: Quick Generate and Compose World return control to the browser immediately and continue generation incrementally.

## Phase 7 — Verification matrix
| Mode | Spatial continuity | Shared state | Simulation | Interaction |
|---|---|---|---|---|
| 3D Infinite World | X/Z infinite stream | required | required | required |
| 3D Volumetric Field | streamed volume | required | required | required |
| 2D Multi-Slice | slice/window | required | required | required |
| Hybrid | synchronized | required | required | required |

Automated checks: seed determinism, chunk seam test, coordinate round-trip test, mode-switch state preservation, law propagation, object↔field interaction, provenance chain, long-distance camera streaming, generation cancellation, and browser responsiveness.

## UI cleanup applied
Removed the detachable sidebar system: Sidebar top-bar toggle, LEFT · DRAG, RIGHT · DRAG, floating sidebar grips, detachable workspace chrome, and legacy left-sidebar floating state. Side panels remain normal docked workspace panels.

Next engine implementation target: extend the verified spatial contract into streamed volumetric world chunks, then unify long-distance field continuity and cross-chunk boundary exchange.