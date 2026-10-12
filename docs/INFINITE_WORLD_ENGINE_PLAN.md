# Reality Engine — Infinite World / Unified Reality View Plan

Last reconciled: 2026-10-12  
Canonical integration branch: `integration/reality-engine-unified-2026-10`

## Current verified state

### 1. 3D Infinite World
The current `InfiniteWorldRenderer` is a deterministic, streamed procedural terrain engine.
- World coordinates stream horizontally across X/Z.
- Terrain chunks are loaded around the camera and use LOD.
- The local Three.js coordinate frame can recenter while world-space coordinates remain authoritative.
- Persistent objects are stored by world chunk.
- Meta-laws and the decision/construction model can affect build decisions and generated consequences.

**Limit:** the active terrain chunk manager still uses `verticalRadius: 0`. This is an infinite horizontal terrain world, not an infinite 3D volumetric universe.

### 2. Scientific volumetric field
The scientific worker remains a finite `128 × 128 × 64` grid with `8 × 8 × 8` worker chunks and 14 fields per voxel.
- Worker chunk restore now has restore IDs, per-chunk acknowledgements, restore-tagged frames, and a renderer publication barrier.
- A failed partial restore rolls worker chunks back instead of publishing mixed state.
- Worker chunk snapshots are persisted through IndexedDB, with an explicit durable-write flush.
- Browser acceptance verifies save → full page reload → durable restore, including LRU eviction pressure.

**Limit:** durable snapshots and a guarded restore protocol do not by themselves provide continuous volumetric simulation across unbounded world coordinates. Cross-chunk field continuity and long-distance worker streaming remain unfinished.

### 3. Shared world-view contract
`WorldViewContract` represents center `(x,y,z)`, visible radius, slice Y, simulation time, seed, and render mode. Coordinate transforms connect the world-space view to the 2D slice.
- The contract and chunk-coordinate/store/boundary-exchange APIs have focused tests.
- Worker-world sampling uses a deterministic fallback when finite worker data is unavailable.
- The world-to-worker axis mapping has a regression test.

Remaining work: make every view mode and every streaming path consume the same persisted view state, and verify that changing center/seed/slice preserves spatial identity end-to-end.

### 4. 2D Multi-Slice and Hybrid
Production 2D rendering should be a world-space projection of the selected field window; the legacy small-grid simulation remains a compatibility/test mode. Hybrid should use the same center, slice, seed, and time as the 3D world.

Required acceptance: selecting a structure or field anomaly in one mode must identify the same world coordinate in the other modes. A legacy compatibility view must never be mistaken for the authoritative world projection.

### 5. Unified laws and causal provenance
The integration branch contains the law bridge, authoritative field mutation/provenance path, and construction decision contracts. Browser acceptance checks field mutation → physics modulation → construction decision, alongside Save → Load state recovery.

Remaining scientific validation:
- Conservation-tested coupled field equations.
- Explicit mass/energy transport across chunk boundaries.
- Physically validated fluid/hydrology and atmosphere/weather.
- Rigid/soft-body mechanics and calibrated time integration.
- Validated biological/ecological dynamics and quantitative comparisons to reference systems.

The engine must not label an unimplemented or unvalidated subsystem as physically validated reality.

### 6. Performance and generation
The current browser acceptance passes Quick Generate, Compose World, and Generate Reality. It also checks the unified sculpt transaction path, Worker acknowledgements, Undo/Redo rollback, and persistence after reload.

Remaining work: verify incremental generation and cancellation under stress, avoid synchronous full-grid work in UI handlers, and measure frame-time/memory budgets during long-distance navigation.

## Target architecture

Authoritative Reality State → World Coordinates → Terrain/Hydrology → Scientific Fields → Meta-Laws → Matter/Resources → Biology → Agents/Civilization → Infrastructure → Events/Causality → Provenance.

Render modes are projections of this state:
- **3D Infinite World:** terrain, objects, and local field overlays.
- **3D Volumetric Field:** scientific field projection of the same world region.
- **2D Multi-Slice:** slice/window projection of the same world region.
- **Hybrid:** synchronized projections with the same center, scale, seed, and time.

## Verification matrix

| Mode or subsystem | Verified baseline | Remaining acceptance |
|---|---|---|
| 3D Infinite World | Deterministic streamed terrain and browser generation flows | Long-distance streaming, cancellation, bounded frame time |
| Volumetric field | Finite worker grid and guarded chunk restore | Unbounded streamed volume and seam-free field continuity |
| World chunk persistence | IndexedDB snapshot survives a full page reload | Quota recovery, schema migration, multi-tab concurrency |
| Sculpt transactions | Authoritative/legacy/worker parity, ACKs, rollback, serialized Undo/Redo | Continue failure-injection and stress testing |
| 2D Multi-Slice | World-view contract and coordinate transforms | Cross-mode coordinate identity for real field anomalies |
| Hybrid | Shared view-contract foundation | End-to-end synchronization during camera and seed changes |
| Laws and construction | Field → physics → construction browser checks | Quantitative calibration and conservation evidence |

## Branch integration policy
- Do not merge divergent branches wholesale into `main`.
- Port unique changes onto `integration/reality-engine-unified-2026-10` in small, testable increments.
- Keep `main` unchanged until the integration PR has completed its full audit and is explicitly approved.
- Keep Infinity Scale RC-1 separate until its TypeScript validation and deterministic regression suite pass on a current commit; its last recorded RC workflow failed and is not evidence of a valid release.
