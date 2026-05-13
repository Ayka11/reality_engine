# Reality Engine v3 — Meta-Law Physics Simulator

A real-time 3D voxel physics simulation where the laws of physics themselves evolve. Paint energy and matter onto a 64×64×32 grid, watch thermodynamics, geology, and life emerge, and observe self-organizing entities appear spontaneously.

**Live demo:** http://localhost:5173 (run locally with `npm run dev`)

---

## Getting Started

```bash
git clone https://github.com/Ayka11/reality_engine.git
cd reality_engine
npm install
npm run dev
```

Open **http://localhost:5173** in Chrome or Edge (WebGPU is required for GPU acceleration; Firefox falls back to CPU automatically).

---

## How to Use the App

### Step 1 — Load a preset
Click any preset in the left panel to populate the grid instantly:

- **Energy burst** — a Gaussian ball of energy and density at the center. Good starting point for watching diffusion and pressure waves.
- **Life seed** — 40 random bio-potential seeds scattered at mid-altitude. Wait ~100 ticks for information to build and entities to form.
- **Ecosystem** — a dense ground layer of matter with energy clusters above it. Simulates a layered world with biology potential above geology.
- **Wave** — a 3D standing wave pattern. Good for watching wave propagation and signal physics.
- **Entropy storm** — fully randomized chaos. Useful for observing how order emerges from disorder under active laws.
- **Vortex** — a rotating energy ring with tangential field vectors.
- **Clear** — reset everything to zero.

### Step 2 — Press Play
Click **Play** in the bottom bar. The simulation runs at the speed set by the slider (1x–16x steps per frame). Higher speed = faster evolution, lower FPS.

### Step 3 — Paint on the grid
**Left-click and drag** on the 3D view to paint the currently selected field (shown in the top layer buttons).

| Mouse | Action |
|---|---|
| Left-click + drag | Paint voxels |
| Right-click + drag | Orbit / rotate the 3D view |
| Scroll wheel | Zoom in / out |
| Middle-click + drag | Pan |
| **P** key | Toggle Paint ↔ Explore mode |

**Z-Slice slider** (bottom-center of canvas) — sets which altitude layer (Z=0 is ground, Z=31 is top) you paint on. Adjust this to paint at different heights.

### Step 4 — Choose what to paint
**Layer buttons** (top bar) select the active field:

| Layer | Color scheme | What it does |
|---|---|---|
| Energy | Black → blue → green → orange → white | The primary field. Diffuses outward, drives all other processes. |
| Density | Black → green | Mass. Sinks under gravity. High density + high energy → pressure. |
| Information | Black → purple | Complexity. Grows where energy and density are both high. Suppressed by entropy. |
| Entropy | Dark red → bright red | Disorder. Always increases. Kills information and degrades structure. |
| Temperature | Blue → red → white | Thermal energy. Coupled to energy. Drives phase transitions and crystallization. |
| Bio | Black → green | Life potential. Peaks where info + energy + density are high and entropy is low. |

**Paint tools** (pencil icons in top bar):

| Icon | Tool | Behavior |
|---|---|---|
| Pencil | Paint | Set the selected field to exactly the brush strength value |
| Plus | Inject | Add to the existing value — accumulates over repeated strokes |
| Eraser | Erase | Zero out energy, temperature, density, information, entropy at the brush position |
| Eye | Inspect | Click any cell to open its stats in the Cell Inspector panel |

**Brush size** and **Brush strength** sliders tune the radius and intensity.

---

## Reading the Panels

### Left panel — Presets & Layer info
The bottom section shows a description of the currently selected layer so you always know what you're painting.

### Right panel — Inspector, Laws, Processes

**Selected cell** — shows the live values of the cell you last clicked with the Inspect tool:
- Energy, Temperature, Density, Information, Entropy, Bio potential, Pressure
- Local τ (local time dilation — cells with high energy run faster)
- Causality ID (which event last touched this cell)

**Cell history graph** — sparkline of the last 200 ticks for the selected cell. Colors: blue=Energy, orange=Temperature, purple=Information, red=Entropy, green=Bio.

**Causality log** — shows the 8 most recent large energy-delta events. Each entry shows the event ID, tick, position, and magnitude. Click any entry to jump the inspector to that cell.

**Entities** — self-organizing clusters detected by flood-fill. A group of cells qualifies as an entity when:
- Bio potential > 0.32
- Entropy < 0.50
- Information > 25
- At least 5 connected cells (6-face connectivity)

Each entity shows its ID, age (ticks alive), stability %, and centroid position. Glowing spheres mark their locations in the 3D view.

**Meta-Laws** — the physics law system. Laws activate/deactivate based on world conditions and mutate over time. Each card shows:
- Active/Inactive status
- Age, fitness score, mutation rate
- Which processes it enables
- **⚡ Mutate** — spawn an aggressive variant of this law
- **✕** — remove non-core laws

Click **Spawn random mutation** to clone and mutate a random existing law.

**Active processes** — 16 individual physics process LEDs. Click any LED to manually toggle that process on or off. Green = running, dark = disabled.

### Bottom bar

| Stat | Meaning |
|---|---|
| Speed | Steps per animation frame |
| Tick | Total simulation steps |
| Energy | Sum of energy across all 131,072 cells |
| Entropy | Average entropy (0 = ordered, 1 = chaos) |
| Laws | Active laws / total laws |
| Entities | Number of detected self-organizing clusters |
| FPS | Render frames per second |

**Save** (download icon, bottom-right) — exports the complete world state as a JSON file you can reload later.

---

## Experiments to Try

### Watching life emerge
1. Click **Life seed** preset
2. Press **Play** at 4x speed
3. Wait 150–200 ticks
4. Switch to the **Bio** layer
5. Watch bio-potential clusters form — the Entity panel will start showing entries
6. Switch to **Information** to see where complexity is building

### Entropy vs order
1. Click **Entropy storm**
2. Press **Play**
3. Watch the Entropy stat in the bottom bar — even from chaos, active laws suppress entropy locally and build pockets of order

### Sculpting a world by hand
1. Press **Clear**
2. Select **Density** layer, use Inject tool, brush size 3
3. Paint a thick ground layer (Z-slice = 0, drag across the bottom)
4. Select **Energy** layer, paint a bright spot in the center at Z-slice = 5
5. Press **Play** — energy diffuses upward, density sinks, pressure builds at the boundary

### Geology simulation
1. Click **Ecosystem** preset
2. Press **Play** at 8x
3. Switch to **Density** layer — watch the ground layer compact and differentiate under gravity and erosion processes

### Spawning mutations
1. Let any preset run for 100+ ticks
2. Open the **Meta-Laws** panel (right side, scroll down)
3. Click **⚡ Mutate** on the Life Law card
4. Watch the entity count and bio-potential change as the mutant law fights for dominance

---

## Understanding the Physics

The simulation runs 16 named processes, each controlled by a bitmask. The Meta-Law system activates and deactivates them based on world conditions.

### The 16 processes

| # | Name | What it does |
|---|---|---|
| 0 | Energy diffusion | Energy spreads to neighbors via Laplacian (heat equation) |
| 1 | Temp diffusion | Temperature equalizes between neighbors |
| 2 | Density flow | Density moves toward high-energy regions |
| 3 | Entropy growth | Entropy increases proportional to energy |
| 4 | Information | Information grows in high-energy, high-density cells; entropy suppresses it |
| 5 | Bio potential | Bio rises where info+energy+density are high and entropy is low |
| 6 | Wave propagation | Wave amplitude travels at wave speed, damped over time |
| 7 | Gravity | Density pulled downward (toward z=0) |
| 8 | Phase transition | Cells with extreme temperature crystallize or melt |
| 9 | Metabolism | Entities consume energy to maintain information |
| 10 | Signal propagation | Information signal spreads between neighbors |
| 11 | Crystallization | High density + low temperature → crystalline structure (info grows) |
| 12 | Radiation | Hot cells emit energy to empty neighbors |
| 13 | Pressure diffusion | Pressure (from density × energy) spreads outward |
| 14 | Field rotation | Vector field (Fx, Fy) rotates, creating vortex-like flows |
| 15 | Erosion | High energy erodes density from neighboring cells |

### The 7 default laws

| Law | Activates when | Controls |
|---|---|---|
| Thermodynamics | Always active | Energy diffusion, temperature, phase transition, entropy, pressure |
| Gravity | Density > 0.1 | Gravity, density flow, field rotation |
| Information Physics | Info > 10 | Information growth, entropy suppression |
| Radiation | Energy > 5000 | Energy radiation from hot cells |
| Order Emergence | Entropy < 0.3 | Crystallization, signal propagation |
| Life Law | Bio avg > 0.1 | Metabolism, bio-potential |
| Geology | Density avg > 0.3 | Erosion, density flow, pressure |

Laws mutate every ~100 ticks: threshold values drift by ±8%, physics parameters drift by ±15%. If a mutant law outperforms its parent (higher fitness), it can dominate and reshape the physics of the entire world.

---

## Architecture

```
src/
├── core/
│   ├── CellState.ts       — 16 float fields per cell, F enum
│   ├── VoxelGrid.ts       — Double-buffered Float32Array grid
│   └── WorldConstants.ts  — Grid size (64×64×32), global constants
│
├── simulation/
│   ├── SimulationEngine.ts — Main loop: GPU/CPU dispatch, law ticking, causality
│   ├── FieldPhysics.ts     — CPU: energy, temp, density, wave, gravity, pressure
│   ├── EntropyLayer.ts     — CPU: entropy, information, bio-potential, metabolism
│   └── CausalGraph.ts      — Event log for large energy-delta events
│
├── process/
│   └── ProcessDef.ts      — PROC enum, 16 ProcessDef entries, defaultProcessMask()
│
├── laws/
│   ├── MetaLaw.ts         — PhysicsParams, MetaLaw, WorldMetrics interfaces
│   └── LawEngine.ts       — 7 default laws, mutation, process bitmask control
│
├── gpu/
│   └── GPUBackend.ts      — WebGPU init, WGSL compute shader, upload/readback
│
├── entity/
│   └── EntityLayer.ts     — Flood-fill entity detection, reconciliation
│
├── render/
│   └── VoxelRenderer.ts   — Three.js point cloud, entity spheres, OrbitControls
│
├── world/
│   └── Presets.ts         — 7 preset world states
│
└── main.ts                — UI wiring, paint loop, inspector, panels
```

### GPU acceleration

When WebGPU is available (Chrome 113+, Edge 113+), all 16 physics processes run in a single WGSL compute shader on the GPU:
- **131,072 cells** processed in parallel with `workgroup_size(8, 8, 1)`
- **Multi-step batching** — N physics steps encoded in one command encoder submission (no CPU roundtrip per step)
- **Process bitmask** — each process is gated by a single bit in `activeProcesses: u32`, so MetaLaw changes take effect instantly next frame
- **CPU fallback** — identical physics runs in JavaScript when WebGPU is unavailable; the GPU badge shows CPU/GPU mode

The GPU badge in the top-right corner shows **GPU** (green) or **CPU** (orange).

---

## Stack

- **TypeScript** — strict mode
- **Vite** — dev server + bundler
- **Three.js** — 3D point cloud rendering, OrbitControls, ray-casting for painting
- **WebGPU** (`@webgpu/types`) — compute shaders for parallel physics
- **bitecs** — ECS library (available for future use)

---

## Building for Production

```bash
npm run build      # outputs to dist/
npm run preview    # preview the production build at localhost:4173
```
