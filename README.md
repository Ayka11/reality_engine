# Reality Engine v3 — Meta-Law Physics Simulator

A real-time 3D voxel physics simulation where the laws of physics themselves evolve. Paint energy and matter onto a 64×64×32 grid, watch thermodynamics, chemistry, geology, and life emerge from first principles, and observe self-organizing entities and AI agents appear spontaneously.

**Live demo:** http://localhost:5173 (run locally with `npm run dev`)

---

## Getting Started

```bash
git clone https://github.com/Ayka11/reality_engine.git
cd reality_engine
npm install
npm run dev
```

Open **http://localhost:5173** in Chrome or Edge (WebGPU required for GPU acceleration; Firefox falls back to CPU automatically).

---

## How to Use the App

### Step 1 — Load a preset
Click any preset in the left panel to populate the grid instantly. Presets are grouped into four categories:

**Classic**
| Preset | Description |
|---|---|
| Energy burst | Gaussian ball of energy at center — good for diffusion + pressure waves |
| Wave | 3D standing wave — good for wave propagation and signal physics |
| Life seed | 40 random bio-potential seeds — wait ~100 ticks for entities to form |
| Vortex | Rotating energy ring with tangential field vectors |
| Entropy storm | Fully randomized chaos — watch order emerge |
| Ecosystem | Dense ground layer + bio clusters above |
| Clear | Reset everything to zero |

**Cosmic**
| Preset | Description |
|---|---|
| Plasma Universe | Extremely hot, low-density plasma filling all cells |
| Frozen World | Ice-solid ground layers, near-zero temperature |
| High Gravity | Density stratified by depth, metallic core |
| Vacuum Seeds | Nearly empty universe with isolated energy seeds |
| Nebula | Sinusoidal gas density patterns, plasma material |
| Proto Planet | Spherical rocky body with molten core |
| Star Formation | Molecular cloud with 3 gravitationally collapsing cores |

**Biological**
| Preset | Description |
|---|---|
| Fungal Net | Mycelial network threads, organic material, signal channels |
| Ocean Biosphere | Liquid ocean with thermal vents and bio clusters |
| Toxic Ecosystem | High entropy, reactive environment — survivors adapt |
| Self-Replicating | Bio-organic seeds engineered for reproduction via EntityLayer |

**Civilizational**
| Preset | Description |
|---|---|
| Megacity Ruins | Grid of decaying structures with stored information |
| Machine Ecology | Crystalline reactive lattice converting energy → information |
| Energy Economy | Producer cells (high energy) ↔ consumer cells (high info) linked by signals |
| Causality Collapse | 30 extreme energy spikes — floods the causality event log |

### Step 2 — Press Play
Click **Play** in the bottom bar. The speed slider sets steps per animation frame (1x–16x).

### Step 3 — Paint on the grid
**Left-click and drag** on the 3D view to paint the currently selected field.

| Mouse | Action |
|---|---|
| Left-click + drag | Paint voxels |
| Right-click + drag | Orbit / rotate the 3D view |
| Scroll wheel | Zoom in / out |
| Middle-click + drag | Pan |
| **P** key | Toggle Paint ↔ Explore mode |

**Z-Slice slider** (bottom-center of canvas) — sets which altitude layer you paint on. Z=0 is ground, Z=31 is the top.

### Step 4 — Choose what to paint
**Layer buttons** (top bar) select the active field:

| Layer | Color scheme | What it shows |
|---|---|---|
| Energy | Black → blue → green → orange → white | The primary field — drives all other processes |
| Density | Black → green | Mass — sinks under gravity |
| Information | Black → purple | Complexity — grows in high-energy, low-entropy regions |
| Entropy | Dark red → bright red | Disorder — always increases, degrades structure |
| Temperature | Blue → red → white | Thermal energy — drives phase transitions |
| Bio | Black → green | Life potential — peaks where conditions align |
| **Material** | Discrete palette colors | Which of 14 materials occupies each cell |
| **Chemistry** | Gas/liquid/solid/organic/reactive | Auto-derived chemical state |
| **Signal** | Black → cyan → white | Entity communication signal |
| **Memory** | Dark blue → cyan | Long-lived information memory trace |

**Paint tools** (pencil icons in top bar):

| Icon | Tool | Behavior |
|---|---|---|
| Pencil | Paint | Set field to the brush strength value |
| Plus | Inject | Add to existing value |
| Eraser | Erase | Zero out all fields and reset material to VACUUM |
| Eye | Inspect | Click to open cell stats in the inspector |

**Material Brush** (left panel) — select any of 14 materials before painting. The active material is applied alongside the field value.

---

## Material System

14 materials with 7 physical coefficients each applied by the GPU shader:

| ID | Material | Key properties |
|---|---|---|
| 0 | Vacuum | Transparent, no interactions |
| 1 | Stone | High erosion resistance, low conductivity |
| 2 | Sand | Loose — low erosion resistance, flows easily |
| 3 | Crystal | High crystallization rate, low entropy |
| 4 | Metal | High conductivity, high heat capacity |
| 5 | Magma | High conductivity, high temperature, liquid |
| 6 | Ice | Low temperature, high crystallization rate |
| 7 | Organic Tissue | High bio affinity, medium conductivity |
| 8 | Spores | Very high bio affinity, fragile |
| 9 | Membrane | Elastic, high bio affinity |
| 10 | Biomass | Moderate bio affinity, organic |
| 11 | Plasma | High radiation absorption, very high conductivity |
| 12 | Superconductive Matter | Maximum conductivity, reactive |
| 13 | Information Substrate | Maximum bio affinity and information capacity |

Coefficients applied per cell: `conductivity`, `heatCapacity`, `elasticity`, `erosionResistance`, `crystallizationRate`, `bioAffinity`, `radiationAbsorption`.

---

## Chemistry Layer

Chemical state is auto-derived from physics fields each tick and drives 4 reaction rules:

| State | Color | Conditions |
|---|---|---|
| Gas | Blue-grey | Temperature > 400 or (T > 600 and density < 0.2) |
| Liquid | Blue | Density > 0.1, Temperature < 350 |
| Solid | Grey | Density > 0.6, Temperature < 80 |
| Organic | Green | Set externally by material/preset |
| Reactive | Orange | Set externally by material/preset |

**Reaction rules:**
1. **Combustion** — organic cells with energy > 500: energy burst +300, entropy surge, converts to gas
2. **Freezing** — liquid at temp < 30: density increases, entropy decreases, converts to solid
3. **Catalysis** — reactive cells with energy > 50: information grows +12/tick, energy drains
4. **Dissolution** — liquid cells touching solid neighbors: density transfers (erosion)

---

## Entity Evolution

Entities are self-organizing biological clusters detected by flood-fill on bio-potential cells. Each entity has a **genome** controlling:

- `metabolismRate` — energy consumed per tick per cell
- `reproThreshold` — energy needed to reproduce
- `signalStrength` — communication intensity
- `bioAffinity` — efficiency of bio-potential absorption
- `mutationRate` — per-field genome noise in offspring
- `memoryDecay` — how fast memory field fades

**Lifecycle stages:**
- **Juvenile** (age 0–60) — growing, shown as green spheres
- **Mature** (age 60–400) — reproducing, communicating, shown as yellow-orange spheres
- **Elder** (age 400+) — slowly decaying bio-potential, shown as purple spheres

**Behaviors each tick:**
- Metabolism drain — proportional to genome + cluster size
- Memory — rolling 8-tick energy average written to MEM_FIELD
- Communication — signal broadcast to all cells in the cluster
- Reproduction — if mature and energy > reproThreshold, spawn child with mutated genome 3–4 cells away
- Adaptation — if energy consistently low, lower bio-threshold (adapt to sparse conditions)

---

## World Events

Six catastrophic event types fire automatically every 400–1200 ticks, or can be triggered manually via the emoji buttons in the right panel:

| Icon | Event | Effect |
|---|---|---|
| ☄ | Meteor Strike | 5-cell-radius impact: max energy+3000, temp+2000, magma material |
| ☀ | Solar Flare | Top 30% of altitude layers: energy+200–500, entropy surge |
| ☢ | Radiation Storm | Whole-grid entropy increase +0.02–0.06 per cell |
| 🧬 | Mutation Wave | All bio-positive cells: bioPotential+0.15–0.35, sets organic state |
| ❄ | Entropy Collapse | 6-cell-radius region: entropy drops, density increases, crystal material |
| ⛰ | Tectonic Shift | One altitude layer shifts laterally by 1 cell, energy transferred |

The World Events log (right panel) shows the last 6 events with timestamps.

---

## AI Agents

Autonomous agents occupy individual cells and run a sense→act loop each tick. Seed them via the **+ Seed 8** button.

| Behavior | Action |
|---|---|
| Explorer | Moves toward highest-energy neighboring cell |
| Harvester | Extracts energy from its current cell into its internal pool |
| Signaler | Broadcasts SIGNAL field and expends energy to do so |
| Builder | Increases INFORMATION and BIO_POTENTIAL in its cell |
| Destroyer | Increases entropy and drains energy; gains energy from damage |

All agents:
- Consume 2 energy/tick to survive
- Replicate when energy > 200 (child may randomly change behavior)
- Die and leave an energy trace when energy hits 0
- Are marked in the AGENT_MARK field (visible in the Chemistry layer)
- Are capped at 64 agents total

---

## Information Physics

Beyond the basic information field, InfoPhysics.ts adds:

- **Coherence** — when SIGNAL > 5, information decays slower and amplifies
- **Decay** — information degrades proportional to local entropy
- **Memory imprint** — when info > 200, a trace is written to MEM_FIELD; memory fades slowly
- **Resonance** — when 3+ neighbors have similar information levels, the cluster amplifies itself and slightly suppresses entropy
- **Information → Energy** — when info > 700, excess information radiates as energy

---

## Temporal Ecology

Each cell accumulates its own LOCAL_TIME field. The rate depends on:
- High energy + density: faster local time (like gravitational time dilation)
- High information + complex structure: slower local time (order resists temporal flow)

Neighboring cells with extreme time differences create energy gradients (frame-dragging analogue). Time is smoothly diffused between neighbors to prevent discontinuities.

---

## Scientific Mode

The **Scientific Mode** panel (right panel, bottom) provides:

- **⏺ Record** — start capturing snapshots every 30 ticks (configurable)
- **Timeline scrubber** — scroll through up to 60 captured snapshots
- **↩ Restore** — restore the grid to the state at the selected snapshot
- **CSV export** — download `tick, totalEnergy, avgEntropy, avgInfo, avgBio` as a CSV file for external analysis

---

## Process Library

16 physics processes, each shown as a card with:
- On/Off toggle (click the card)
- Category badge (thermodynamic / biological / geological / informational / physical)
- Input fields consumed → Output fields produced
- Stability impact bar (green = ordering, red = destabilizing)

| # | Name | Inputs → Outputs | Stability |
|---|---|---|---|
| 0 | Energy Diffusion | energy → energy | +0.1 |
| 1 | Thermal Flow | temperature → temperature | +0.1 |
| 2 | Density Flow | density → density | 0.0 |
| 3 | Entropy Growth | energy → entropy | -0.5 |
| 4 | Information Dynamics | energy, entropy → information | +0.4 |
| 5 | Bio-Emergence | energy, information → bioPotential | +0.6 |
| 6 | Wave Propagation | energy → energy, signal | 0.0 |
| 7 | Gravity | density → density, energy | -0.1 |
| 8 | Phase Transitions | temperature, density → chemState, entropy | -0.2 |
| 9 | Metabolism | energy, bioPotential → information, entropy | +0.5 |
| 10 | Signal Propagation | information, signal → signal | +0.2 |
| 11 | Crystallization | density, temperature → density, entropy | +0.7 |
| 12 | Radiation Pressure | energy → density, entropy | -0.3 |
| 13 | Pressure Waves | density, energy → energy | 0.0 |
| 14 | Field Rotation | energy → energy | -0.1 |
| 15 | Erosion | density, energy → density, materialId | -0.4 |

---

## Meta-Laws

Seven default laws activate/deactivate based on world metrics and mutate over time:

| Law | Activates when | Controls |
|---|---|---|
| Thermodynamics | Always | Energy/temp diffusion, entropy, pressure |
| Gravity | Always | Gravity, density flow |
| Information Physics | Always | Information, bio-potential, wave propagation |
| Radiation | totalEnergy > 200,000 | Radiation, waves |
| Order Emergence | avgEntropy < 0.15 | Crystallization, density flow |
| Life Law | avgBio > 0.25 and avgEntropy < 0.45 | Metabolism, signal propagation |
| Geology | avgDensity > 0.5 | Erosion, phase transition, crystallization |

Laws mutate every ~100 ticks (thresholds drift ±8%, params drift ±15%). Use **⚡ Mutate** to spawn aggressive variants or **Spawn random mutation** to create new laws.

---

## Architecture

```
src/
├── core/
│   ├── CellState.ts        — 24-field cell (F enum, getters/setters)
│   ├── VoxelGrid.ts        — Double-buffered Float32Array grid, cellAt()
│   └── WorldConstants.ts   — Grid size (64×64×32), thresholds
│
├── simulation/
│   ├── SimulationEngine.ts — Main loop: GPU/CPU dispatch, all layer ticks
│   ├── FieldPhysics.ts     — CPU: energy, temp, density, wave, gravity, pressure
│   ├── EntropyLayer.ts     — CPU: entropy, information, bio-potential
│   ├── CausalGraph.ts      — Event log for large energy-delta spikes
│   ├── EntityLayer.ts      — Genome-based entity evolution, lifecycle, reproduction
│   ├── TemporalLayer.ts    — Per-cell local time accumulation and diffusion
│   ├── InfoPhysics.ts      — Coherence, decay, memory, resonance, info→energy
│   ├── Recorder.ts         — Snapshot ring buffer, CSV export, diff
│   └── AgentSystem.ts      — AI agents: 5 behaviors, sense/act/replicate loop
│
├── chemistry/
│   └── ChemLayer.ts        — State auto-derivation + 4 reaction rules
│
├── process/
│   └── ProcessDef.ts       — 16 ProcessDef with inputs/outputs/stabilityImpact
│
├── laws/
│   ├── MetaLaw.ts          — PhysicsParams, MetaLaw, WorldMetrics
│   └── LawEngine.ts        — 7 default laws, mutation, process bitmask
│
├── gpu/
│   └── GPUBackend.ts       — WebGPU WGSL shader, material buffer @binding(3)
│
├── materials/
│   └── MaterialDef.ts      — 14 materials, 7 coefficients each, GPU buffer builder
│
├── entity/
│   └── EntityLayer.ts      — Legacy flood-fill entity detection (kept for reference)
│
├── render/
│   └── VoxelRenderer.ts    — Three.js point cloud, 10 layer modes, entity spheres
│
└── world/
    ├── Presets.ts          — 22 preset world states (7 classic + 15 new)
    └── WorldEvents.ts      — 6 event types, auto-fire every 400–1200 ticks
```

### GPU Acceleration

When WebGPU is available (Chrome 113+, Edge 113+), physics runs in WGSL compute shader:
- **131,072 cells** processed in parallel with `workgroup_size(8, 8, 1)`
- **Material coefficients** at `@binding(3)` — 14 × 8-float padded buffer
- **Multi-step batching** — N steps per encoder submission, no CPU roundtrip
- **Process bitmask** — each of 16 processes gated by one bit in `activeProcesses: u32`
- **CPU fallback** — identical physics in TypeScript; badge shows GPU/CPU mode

---

## Experiments to Try

### Watching life emerge
1. Click **Life seed** → Play at 4x → wait 200 ticks → switch to Bio layer
2. Entity panel populates; glowing spheres mark cluster centroids

### Chemistry cascade
1. Click **Fungal Net** → Play at 2x → switch to Chemistry layer
2. Watch organic→gas transitions at high-energy patches

### Cosmic evolution
1. Click **Star Formation** → Play at 8x → switch to Energy layer
2. Three cores collapse, temperature spikes — switch to Temperature to see the cores ignite

### Agent vs entity competition
1. Click **Self-Replicating** → Play → Seed 8 agents
2. Harvester agents drain entity energy; Builder agents reinforce bio-potential

### Scientific recording
1. Start any preset → Click **⏺ Record** → Play at 4x for 200 ticks
2. Stop recording → drag the scrubber backward → Click **CSV** to export metrics

---

## Stack

- **TypeScript** — strict mode
- **Vite** — dev server + bundler
- **Three.js** — 3D point cloud, OrbitControls, ray-casting for painting
- **WebGPU** (`@webgpu/types`) — WGSL compute shaders for parallel physics

---

## Building for Production

```bash
npm run build      # outputs to dist/
npm run preview    # preview the production build at localhost:4173
```
