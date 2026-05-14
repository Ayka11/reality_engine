# Reality Engine v4 — Meta-Law Physics Simulator

> *"A universe you can paint — where physics evolves, civilizations rise, and an AI director watches over it all."*

---

## What Is This

Reality Engine is an **interactive 3D physics sandbox** where the rules of physics are themselves simulated objects that compete, mutate, and go extinct. You paint energy and matter onto a 64 × 64 × 32 voxel grid. Thermodynamics, chemistry, geology, and life emerge from first principles. The laws governing them evolve in real time through a MetaLaw system — each law has fitness, age, and mutation rate. Laws that produce complexity survive. Laws that produce chaos go dormant.

**This is not a game about matter. It is a game about the rules that govern matter.**

Phase 4 adds an **AI Scene Director** (Claude API), a **256³ cosmological simulation**, **proto-language emergence**, an **economic system**, **cross-tab multiplayer**, and **scientific data exports**.

---

## Who It's For

| Audience | Why it's interesting |
|---|---|
| **Game developers** | Reference for emergent systems, procedural world simulation |
| **Researchers** | Toy model for studying self-organization, information physics, causal chains |
| **Students** | Visual, interactive thermodynamics and complexity theory |
| **Curious people** | Press a preset, press play, watch a universe be born |

---

## Getting Started

```bash
git clone https://github.com/Ayka11/reality_engine.git
cd reality_engine
npm install
npm run dev
```

## Distributed Simulation (Prototype v1)

This workspace includes an early Distributed Simulation scaffold under `src/distributed`.

- `ChunkOrchestrator.ts`: manages chunk ownership and simple rebalancing.
- `WorkerManager.ts`: spawns inline Web Workers and dispatches chunk simulation tasks.
- `Partitioner.ts`: creates simple static partitions for chunk keys.
- `WebRTCManager.ts`: basic WebRTC DataChannel scaffolding for peer-to-peer sync (signalling not included).
- `DistributedEngine.ts`: composes the above pieces and provides `assignInitialPartition` and `tick()` hooks.

How to try locally:

1. Open the app with `npm run dev`.
2. In the running app click the **Spawn Worker** button to create a worker.
3. Click **Assign Partition** to assign an 8-chunk test partition to the local node.

Notes & Next steps:

- WebRTC signalling is not implemented — use your own signalling server to exchange SDP/ICE between peers.
- Chunk boundary serialization and deterministic replay need implementation for production.
- Next planned features: WebRTC signalling helper, delta compression for chunk transfer, layer-aware distribution, Kubernetes deployment examples.


Open **http://localhost:5173** in Chrome or Edge (WebGPU for GPU acceleration; Firefox falls back to CPU automatically).

---

## Navigation Controls

| Input | Action |
|---|---|
| **Right-drag** | Orbit / rotate the 3D view |
| **Scroll wheel** | Zoom in / out |
| **Middle-drag** | Zoom (dolly) |
| **Left-click + drag** | Paint voxels (in Paint mode) |
| **One-finger drag** (touch) | Orbit |
| **Two-finger pinch** (touch) | Zoom + pan |
| **WASD / Arrow keys** | Pan camera |
| **P** | Toggle Paint ↔ Explore mode |
| **R** | Reset camera to default view |
| **⌂ button** (topbar) | Reset camera |

In **Explore mode** (P to toggle): left-drag orbits — no painting.
In **Paint mode** (default): left-click paints, right-drag orbits.

---

## How to Use the App

### Step 1 — Load a preset or generate terrain
Click any preset in the left panel, or use the **Terrain Generator** (also left panel):

1. Choose a biome from the dropdown (earth, alien, ocean, volcanic, arctic, desert, forest, crystalline)
2. Enter a seed number
3. Click **Generate terrain** — the entire grid is rebuilt with procedural noise

### Step 2 — Press Play
Click **Play** in the bottom bar. The speed slider sets steps per animation frame (1x–16x).

### Step 3 — Paint on the grid
Select a field layer from the top bar, then left-click and drag on the 3D view.
Use the **Z-Slice slider** (bottom-center) to choose which altitude layer you paint on.

### Step 4 — Explore systems
- **Spawn 5 agents** — seed AI agents into the current world
- **Seed civs from bio zones** — spawn civilizations from high bio-potential regions
- **Climate: ON/OFF** — toggle wind advection and precipitation
- **💥 Big Bang** — seed the parallel 256³ cosmological simulation
- **AI Scene Director** — type a question or command; Claude analyzes the world and writes runnable scripts
- **🔗 Connect** — enable cross-tab multiplayer (open a second browser tab to the same URL)
- **Save snap / Restore** — save any world state and restore it later
- **CSV / Scientific exports** — download tick-by-tick metrics, NumPy field data, Jupyter notebooks

---

## Presets

### Classic
| Preset | Description |
|---|---|
| Energy burst | Gaussian energy ball at center — watch diffusion and pressure waves |
| Wave | 3D standing wave — good for signal physics |
| Life seed | 40 random bio seeds — wait ~100 ticks for entities to form |
| Vortex | Rotating energy ring with tangential field vectors |
| Entropy storm | Fully randomized chaos — watch order emerge |
| Ecosystem | Dense ground + bio clusters above |
| Clear | Reset everything to zero |

### Cosmic
| Preset | Description |
|---|---|
| Plasma Universe | Extremely hot, low-density plasma |
| Frozen World | Ice-solid ground layers, near-zero temperature |
| High Gravity | Density stratified by depth, metallic core |
| Vacuum Seeds | Nearly empty universe with isolated energy seeds |
| Nebula | Sinusoidal gas density patterns |
| Proto Planet | Spherical rocky body with molten core |
| Star Formation | Molecular cloud with 3 collapsing cores |

### Biological
| Preset | Description |
|---|---|
| Fungal Net | Mycelial network threads, organic material, signal channels |
| Ocean Biosphere | Liquid ocean with thermal vents and bio clusters |
| Toxic Ecosystem | High entropy, reactive environment |
| Self-Replicating | Bio-organic seeds engineered for reproduction |

### Civilizational
| Preset | Description |
|---|---|
| Megacity Ruins | Grid of decaying structures with stored information |
| Machine Ecology | Crystalline reactive lattice converting energy to information |
| Energy Economy | Producers (high energy) and consumers (high info) linked by signals |
| Causality Collapse | 30 extreme energy spikes — floods the causal event log |

---

## Terrain Generator

Eight procedural biomes generated with FBM (fractal Brownian motion) noise. Each biome writes different patterns of energy, density, temperature, entropy, information, and bio-potential into the grid.

| Biome | Key character |
|---|---|
| **Earth** | Height map + moisture + latitude temperature gradient; water in valleys |
| **Alien** | Crystal clusters at random 3D positions, extremely low entropy, high energy |
| **Ocean** | Full water volume with depth gradient; bio-active surface layer |
| **Volcanic** | Dense rock base with 4 lava vents injecting high energy + heat |
| **Arctic** | Flat ice sheet, near-zero temperature, ordered crystalline entropy |
| **Desert** | Dune-shaped height map, extreme surface heat, low moisture |
| **Forest** | Layered ground + canopy with high bio-potential |
| **Crystalline** | Sparse fractal crystal lattice with near-zero entropy, high information |

---

## Climate System

When **Climate: ON**, a wind and precipitation model runs on top of the field simulation:

- **Pressure field** — derived from surface density and temperature each tick
- **Wind advection** — surface energy and temperature are transported by the wind vector field
- **Precipitation** — oversaturated (high density + low temperature) surface cells drop density to lower layers
- **Wind evolution** — pressure gradients drive wind acceleration; speed capped at 2 units/tick
- **Coriolis-like initialization** — wind patterns start with latitude-based rotation

---

## Volumetric Raymarcher (WebGPU)

When Chrome/Edge with WebGPU is available, the simulation can be rendered as **soft glowing volumes** via a full WGSL raymarcher:

- **Ray-AABB intersection** — rays are clipped to the grid bounding box before marching
- **Trilinear interpolation** — samples the field at sub-voxel precision for smooth volumes
- **Emissive bloom** — cells above 55% intensity glow with 1.6× emissive boost
- **Animated sun** — directional light orbits slowly over time
- **Exponential fog** — distance fog with configurable density
- **72 march steps** at 0.55 step size — enough for the 64×64×32 grid at oblique angles
- **7 layer modes** — energy, density, information, entropy, temperature, bio-potential, signal

---

## Field Animator

**FieldAnimator** detects bio-clusters every 60 ticks using BFS on cells with `bioPotential > 0.32`, then instantiates animated Three.js creature groups at each cluster centroid:

- Up to **8 creatures** tracked simultaneously
- Each creature has **7 body parts**: body, head, left/right arms, left/right legs, tail — all MeshStandardMaterial
- **Animation driven by field energy**: breathing (body scale), head bobbing, arm swing, alternating leg stride, tail wag
- Speed of animation scales with average cluster energy
- Creatures smoothly lerp toward their current cluster position each frame
- All geometry and materials are disposed when clusters disappear

---

## Civilization System

**CivilizationSystem** seeds up to **12 civilizations** from high bio-potential zones and simulates territorial expansion, technology research, and inter-civ diplomacy:

| Mechanic | Details |
|---|---|
| **Spawning** | Samples 300 random cells per tick; spawns where `bioPotential > 0.35` |
| **Territory** | Expands one adjacent cell per 20 ticks while energy allows; max 200 + techLevel×40 cells |
| **Growth** | Population and energy derived from bio-potential in territory |
| **Tech** | Tech level 0–10; chance of advance grows with energy and population |
| **Diplomacy** | Overlap > 5 cells → war; isolated civs may form alliances; wars end randomly |
| **Collapse** | Civs with population < 1 or zero energy are removed |

History log and live civ list (name, tech level, population, war/ally count) shown in the right panel.

---

## Multi-Scale Physics

**MultiScaleSystem** runs a 1/8-resolution **macro grid** alongside the full voxel simulation, updated every 20 ticks:

- **Downscale** — averages energy, entropy, bio-potential, and temperature from every 8×8×8 block of cells into a macro voxel
- **Micro chemistry** — cells with `bioPotential > 0.3` run an organic catalysis pass: bio + energy → information
- **Upscale coupling** — macro energy averages are nudged back into cell values with strength 0.0015 per update — a gentle pressure toward macro-level equilibrium

Macro stats (average E / S / Bio / T) shown in the right panel.

---

## Meta-Law Evolution

**MetaLawEvolution** runs an evolutionary cull every **500 ticks** on top of the existing law fitness system:

1. All laws are ranked by fitness (accrued by being active during high-complexity world states)
2. The **bottom 20%** of non-core laws (excluding Thermodynamics, Gravity, Information Physics) are removed
3. **Mutations are spawned** from the top-performing survivors
4. Mutations inherit parent condition thresholds and param overrides, then drift ±50% aggressively

The cycle count and last action ("culled N, spawned M from Law X") are shown in the right panel.

---

## AI Scene Director (Phase 4)

**SceneDirector** embeds Claude into the simulation. It reads a live world-state summary (energy totals, entropy, agents, civs, active laws, recent causal events) and sends it with every request.

### Setup
Enter your Anthropic API key in the **Director panel** (right panel → AI Scene Director → password field → Set). The key is stored in `localStorage` and never leaves the browser. Uses `claude-haiku-4-5-20251001` by default for low latency.

### What you can ask
| Type of request | What Claude does |
|---|---|
| **Describe** | Gives a vivid scientific + poetic narrative of the current simulation state |
| **Do something** | Returns a description + a `world.*` JS script block you can run with **▶ Run code** |
| **Predict** | Reasons about upcoming dynamics based on current field values |
| **Analyze** | Correlates field states, civ relations, law fitness |

### Auto-directing mode
Toggle **Auto: ON** — Claude fires every 25 seconds with a random prompt ("Something interesting is about to happen. Make it so.", "The entropy is getting high. Seed some new order.", etc.). Actions and their descriptions accumulate in the world log.

### How scripts are executed
The **▶ Run code** button passes the returned JS to `scriptEngine.run()` — the same engine used by the Scene Script DSL panel — so all `world.*` commands work identically.

---

## Cosmological Simulation (Phase 4)

**CosmologicalSim** runs a parallel **256 × 256 × 64** universe using a sparse Map-based grid. Only non-empty cells are stored, so the 4M-cell grid stays memory-efficient.

| Feature | Details |
|---|---|
| **Big Bang** | Singularity at center (energy=9999, temp=5000) + 500 dark-energy seeds scattered randomly |
| **Galaxy seeding** | 8 galaxies at random positions; each is a Gaussian energy+density+temperature sphere |
| **Dark energy** | Cells with dark_energy > 0.05 multiply their energy each tick — accelerating expansion |
| **Entropy** | Increases monotonically every tick across all filled cells |
| **Galaxy aging** | Star count decays slowly with age |
| **Sparse diffusion** | Laplacian diffusion over only the filled cells — scales with activity, not grid volume |

Stats shown: filled cells count, total energy, galaxy count, cosmological tick.

**This runs alongside** the main simulation — click **💥 Big Bang** then let the main simulation play; the cosmological sim steps every 5 ticks.

---

## Language Emergence (Phase 4)

**LanguageSystem** grows a proto-vocabulary from agent proximity signals.

- **Signal encoding** — each agent's state (energy, signal field value, behavior type) is encoded as a 4-integer vector
- **Signal propagation** — the encoded signal is written into the information field in a 5×5 radius around the sender
- **Lexicon building** — when two agents are within distance 5, they exchange signals; patterns seen ≥ 5 times across the population become vocabulary words
- **Communication effect** — when a known word is received, the receiver's information field is boosted by +8
- **Throttled** — runs every 5 simulation ticks to avoid O(n²) overhead

Stats shown: vocabulary size, total communication events, 5 most recent words with meaning type (danger / abundance / contact / neutral).

---

## Economic System (Phase 4)

**EconomicSystem** creates emergent markets between civilizations.

| Mechanic | Details |
|---|---|
| **Market spawning** | Markets appear at the midpoint between pairs of civs every 200 ticks (max 6 markets) |
| **Scarcity pricing** | `price = (max − supply) / scale × demandFactor`; high field values → low price |
| **Trade** | Nearby civs (within 15 cells) exchange a fraction of GDP; seller gains, buyer loses |
| **Tech transfer** | Each trade transfers 0.1% of the buyer's tech level to the seller |
| **GDP tracking** | Per-civ GDP initialized from `population × techLevel`, updated by trade flows |
| **GINI inequality** | Computed as `√(variance) / mean` across all civs — rises as economies diverge |

Stats shown: market count, global GDP, GINI coefficient, average energy price.

---

## Multiplayer — Collaborative Worlds (Phase 4)

**MultiplayerSync** lets multiple browser tabs share the same world in real time via the [BroadcastChannel API](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel) — no server required, works entirely in the browser.

### How to use
1. Open the simulation in two browser tabs at the same URL
2. Click **🔗 Connect** in one tab — it announces itself and requests full world state
3. The first tab to exist becomes **host** and sends the full buffer to the new joiner
4. Paint in either tab — delta cell changes sync to all peers within 500 ms
5. Click again to disconnect

| Feature | Details |
|---|---|
| **Full state sync** | On join, host serializes the full 3M-float grid and sends it via BroadcastChannel |
| **Delta sync** | During play, only painted/changed cells are broadcast (up to 100 cells per 500 ms interval) |
| **Peer cursors** | Each peer's cursor position and tool are visible with a color-coded label |
| **Host election** | First tab that receives a `join` message becomes host automatically |
| **Graceful leave** | Disconnect broadcasts `leave` so peers can remove stale cursors |

> Note: BroadcastChannel is same-origin only (same URL, same browser). For cross-device multiplayer, a WebSocket server would be needed.

---

## Scientific Export (Phase 4)

**ScientificAPI** exports simulation data in formats compatible with standard scientific toolchains.

| Export | File | Contents |
|---|---|---|
| **Field JSON** | `re_field_tN.json` | NumPy-compatible — shape `[D, H, W, 24]`, dtype `float32`, field index map, tick + timestamp |
| **Jupyter notebook** | `re_analysis_tN.ipynb` | 4 cells: data load + reshape, 4-panel field plot (energy/entropy/info/bio), correlation matrix, ready to run |
| **GraphML** | `re_causality_tN.graphml` | Last 100 causal events as a directed graph; nodes have `tick` + `type`, edges have `delta` weight |
| **All 3** | — | Downloads all three files simultaneously |

### Using the Jupyter notebook
```bash
pip install numpy matplotlib jupyter
jupyter lab re_analysis_tN.ipynb
# Run all cells → produces reality_fields.png
```

### Using the GraphML in Gephi / NetworkX
```python
import networkx as nx
G = nx.read_graphml('re_causality_tN.graphml')
print(nx.info(G))
```

---

## Layer Modes

| Layer | Color scheme | What it shows |
|---|---|---|
| Energy | Black to blue to orange to white | Primary field driving all processes |
| Density | Black to green | Mass — sinks under gravity |
| Information | Black to purple | Complexity — grows in high-energy, low-entropy regions |
| Entropy | Dark red to bright red | Disorder — always increases, degrades structure |
| Temperature | Blue to red to white | Thermal energy — drives phase transitions |
| Bio | Black to bright green | Life potential — peaks where conditions align |
| Material | Discrete palette colors | Which of 14 materials occupies each cell |
| Chemistry | Gas/liquid/solid/organic/reactive | Auto-derived chemical state |
| Signal | Black to cyan to white | Entity communication signal |
| Memory | Dark blue to cyan | Long-lived information memory trace |
| Diff | Blue (loss) / Orange (gain) | Energy delta between snapshots |

---

## Material System

14 materials with 7 physical coefficients each applied by the GPU shader:

| ID | Material | Key properties |
|---|---|---|
| 0 | Vacuum | Transparent, no interactions |
| 1 | Stone | High erosion resistance, low conductivity |
| 2 | Sand | Low erosion resistance, flows easily |
| 3 | Crystal | High crystallization rate, low entropy |
| 4 | Metal | High conductivity, high heat capacity |
| 5 | Magma | High conductivity, high temperature |
| 6 | Ice | Low temperature, high crystallization rate |
| 7 | Organic Tissue | High bio affinity, medium conductivity |
| 8 | Spores | Very high bio affinity, fragile |
| 9 | Membrane | Elastic, high bio affinity |
| 10 | Biomass | Moderate bio affinity, organic |
| 11 | Plasma | High radiation absorption, very high conductivity |
| 12 | Superconductive Matter | Maximum conductivity, reactive |
| 13 | Information Substrate | Maximum bio affinity and information capacity |

---

## Entity Evolution

Entities are self-organizing biological clusters detected by flood-fill on bio-potential cells. Each entity has a **genome** controlling metabolism, reproduction threshold, signal strength, bio-affinity, mutation rate, and memory decay.

**Lifecycle stages:** Juvenile (age 0-60) → Mature (60-400) → Elder (400+)

Each tick: metabolism drain, memory imprint, signal broadcast, reproduction (mutated offspring 3-4 cells away), entropy-driven adaptation.

---

## AI Agents

Autonomous agents run a sense-act loop each tick. Seed via **+ Seed 8** or **Spawn 5 agents**. Each appears as a **colored 3D sphere**.

| Behavior | Color | Action |
|---|---|---|
| Explorer | Blue | Moves toward highest-energy neighbor |
| Harvester | Green | Extracts energy aggressively |
| Signaler | Purple | Broadcasts SIGNAL field; moves toward signal clusters |
| Builder | Orange | Increases information + bio-potential; reduces entropy |
| Destroyer | Red | Increases entropy, drains energy, roams randomly |

All agents consume 0.4 energy/tick, replicate at energy > 300, deposit energy on death. Capped at 64 agents total.

---

## World Events

Six catastrophic events fire automatically every 400-1200 ticks, or triggered manually:

| Icon | Event | Effect |
|---|---|---|
| ☄ | Meteor Strike | 5-cell impact: energy+3000, temp+2000, magma material |
| ☀ | Solar Flare | Top 30% altitude: energy+200-500, entropy surge |
| ☢ | Radiation Storm | Whole-grid entropy increase |
| 🧬 | Mutation Wave | Bio cells: bioPotential+0.15-0.35, organic state set |
| ❄ | Entropy Collapse | 6-cell radius: entropy drops, crystal material |
| ⛰ | Tectonic Shift | One altitude layer shifts laterally, energy transferred |

---

## Timeline and Live Metrics

### Timeline (auto-save)
- Sparse snapshots saved automatically every 100 ticks (up to 50)
- **Save snap** — manually save current state with a label
- Click any snapshot in the list to restore that world state
- **CSV** — download `tick, energy, entropy, information, agents, bio` for all checkpoints

### Live Metrics Chart
Real-time sparkline across the last 200 checkpoints:
- Blue — total energy
- Red — average entropy
- Purple — total information
- Orange — alive agent count
- Green — average bio-potential

### Scientific Mode (Recorder)
- **Record** — full grid snapshots every 30 ticks (up to 60 snapshots)
- **Scrubber** — jump to any snapshot
- **Replay** — playback at ~8fps
- **Diff** — orange/blue energy delta overlay between snapshots
- **CSV** — export snapshot metrics

---

## Development & Troubleshooting

This section lists the recommended development environment, common commands, and troubleshooting steps for issues such as "API not found" (LLM endpoints, signalling servers, CORS, etc.).

Prerequisites
- `Node.js` >= 18 and `npm` (or `pnpm`/`yarn`).
- `git` for source control.
- Chrome or Edge recommended for WebGPU features; Firefox will fall back to CPU.

Quick start
1. Clone, install, run dev server:

```bash
git clone https://github.com/Ayka11/reality_engine.git
cd reality_engine
npm install
npm run dev
```

2. Open the URL Vite reports (usually `http://localhost:5173`).

TypeScript / build / formatting
- Type-check: `npx tsc --noEmit`
- Build (if configured): `npm run build`
- Format (if you use Prettier): `npx prettier --write .`

AI / LLM (Ollama) — "API not found" troubleshooting

The `PromptEngine` can be configured to call a local Ollama HTTP API or a remote LLM. If you see `API not found` or `404` when probing `http://localhost:11434`, do the following:

1. Install Ollama (docs: https://ollama.ai/docs) and ensure your model is installed (e.g. `deepseek-r1`, `llama3`).
2. Start Ollama / the HTTP server (some installs require `ollama daemon` or `ollama serve`).
3. Verify with the CLI and HTTP:

```bash
ollama list
curl http://localhost:11434/api/info
```

4. If `curl` returns `404`:
- Confirm the Ollama version and its HTTP endpoints; older/newer releases may differ.
- Make sure the daemon is running and listening to the expected port.
- If using a non-default port, update the `baseUrl` in `PromptEngine`/`OllamaProvider`.

Configure `PromptEngine` (example)

```ts
import { PromptEngine } from './src/director/PromptEngine';

const promptEngine = new PromptEngine({ kind: 'ollama', opts: { baseUrl: 'http://localhost:11434', model: 'deepseek-r1' } });
```

Signalling & WebRTC (cross-device multiplayer)

For peers across devices, you need a signalling server to exchange SDP and ICE candidates. Example minimal signalling server (Node + `ws`):

`server/signalling-server.js`
```js
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8888 });
wss.on('connection', ws => {
    ws.on('message', msg => {
        // naive relay: broadcast to all other peers
        for (const client of wss.clients) {
            if (client !== ws && client.readyState === WebSocket.OPEN) client.send(msg);
        }
    });
});
console.log('Signalling server listening on ws://localhost:8888');
```

Run it locally:

```bash
node server/signalling-server.js
```

Then adapt `src/distributed/WebRTCManager.ts` to POST offers/answers and ICE candidates via that signalling server. The repository includes a `WebRTCManager` scaffold — you must implement signalling exchange in your app code.

Common troubleshooting checklist
- LLM `404` / `API not found`: Ollama not running, wrong port, or API shape mismatch — check `ollama list` and server logs.
- WebRTC peers never connect: signalling server not exchanging SDP/ICE, or firewall/NAT blocking ports.
- CORS issues: ensure remote LLM or signalling server allows requests from your dev origin, or use a local proxy.
- BroadcastChannel works only same-origin (cross-tab). For cross-device, use WebSocket or WebRTC with signalling.

Production & deployment notes
- Build the static app (`npm run build`) and serve via a CDN or static host.
- For distributed workers, run headless worker processes (Node/Rust) that claim chunk ownership and expose a secure chunk API.
- Never expose local-only LLM endpoints or signalling servers publicly without authentication.

If you run into a specific "API not found" error, paste the exact request URL and the response body or browser console network trace and I will help debug the issue.


## Causal Graph

The last 80 causal events rendered as a DAG in the right panel. X axis = tick time, Y axis = spatial position, edges show parentId → child relationships. Click any node to jump the inspector to that cell.

Event colors: orange = energy_spike, purple = info_bloom, red = entropy_burst, green = bio_emergence, blue = phase_transition.

---

## Scene Script DSL

Write JavaScript against the `world` API in the Script panel:

```js
world.clear()
world.sphere(24, 20, 4, 8, 'energy', 600)
world.noise('density', 0.4, 0.5)
world.gradient('temperature', 'z', 20, 200)
world.tick(100)
world.print('Done — ' + world.W + 'x' + world.H)
```

Commands: `fill`, `sphere`, `box`, `layer`, `noise`, `gradient`, `preset`, `spawnEntity`, `clear`, `tick`, `setLaw`, `print`.

Five built-in templates in the dropdown: Primordial Ocean, Volcanic Eruption, Life Explosion, Information Age, Entropy Storm, Galaxy Arms.

The **AI Director** also generates and executes these scripts — click **▶ Run code** after asking it to do something.

---

## Export

### Unreal Engine 5
- **USD** — `.usda` file; import via USD Stage plugin in UE 5.1+
- **LiveLink** — JSON snapshot for Blueprint HTTP polling

### Blender 4
- **Voxels.py** — paste into Blender Scripting tab; creates point cloud with energy_color attribute
- **Bio.py** — biological cluster export with bio-potential coloring
- **CSV** — point cloud CSV for Blender's Import Point Cloud add-on

### Scientific (Phase 4)
- **Field JSON** — NumPy-compatible `[D,H,W,24]` float32 array with field index map
- **.ipynb** — Jupyter notebook with ready-to-run analysis code (field plots, correlation matrix)
- **GraphML** — Causality DAG for Gephi, NetworkX, or yEd

---

## Process Library

16 physics processes, toggled individually by clicking their card in the right panel:

| # | Name | Category | Stability |
|---|---|---|---|
| 0 | Energy Diffusion | thermodynamic | +0.1 |
| 1 | Thermal Flow | thermodynamic | +0.1 |
| 2 | Density Flow | physical | 0.0 |
| 3 | Entropy Growth | thermodynamic | -0.5 |
| 4 | Information Dynamics | informational | +0.4 |
| 5 | Bio-Emergence | biological | +0.6 |
| 6 | Wave Propagation | physical | 0.0 |
| 7 | Gravity | physical | -0.1 |
| 8 | Phase Transitions | thermodynamic | -0.2 |
| 9 | Metabolism | biological | +0.5 |
| 10 | Signal Propagation | informational | +0.2 |
| 11 | Crystallization | geological | +0.7 |
| 12 | Radiation Pressure | thermodynamic | -0.3 |
| 13 | Pressure Waves | physical | 0.0 |
| 14 | Field Rotation | physical | -0.1 |
| 15 | Erosion | geological | -0.4 |

Manual toggles persist across MetaLaw recomputation cycles.

---

## Meta-Laws

Seven default laws activate/deactivate based on world metrics and mutate every ~100 ticks. MetaLawEvolution culls the weakest every 500 ticks and spawns mutations from top performers.

| Law | Activates when | Controls |
|---|---|---|
| Thermodynamics | Always | Energy/temp diffusion, entropy, pressure |
| Gravity | Always | Gravity, density flow |
| Information Physics | Always | Information, bio-potential, wave propagation |
| Radiation | totalEnergy > 200,000 | Radiation, waves |
| Order Emergence | avgEntropy < 0.15 | Crystallization, density flow |
| Life Law | avgBio > 0.25 and avgEntropy < 0.45 | Metabolism, signal propagation |
| Geology | avgDensity > 0.5 | Erosion, phase transition, crystallization |

---

## Architecture

```
src/
├── core/
│   ├── CellState.ts          — 24-field cell (F enum, getters/setters)
│   ├── VoxelGrid.ts          — Double-buffered Float32Array grid (64×64×32)
│   ├── SparseGrid.ts         — Map-based sparse grid for cosmological scale (256³)
│   └── WorldConstants.ts     — Grid size constants
│
├── simulation/
│   ├── SimulationEngine.ts   — Main loop: GPU/CPU dispatch, all layer ticks
│   ├── FieldPhysics.ts       — CPU: energy, temp, density, wave, gravity, pressure
│   ├── EntropyLayer.ts       — CPU: entropy, information, bio-potential
│   ├── CausalGraph.ts        — Event log for large energy-delta spikes
│   ├── EntityLayer.ts        — Genome-based entity evolution + reproduction
│   ├── TemporalLayer.ts      — Per-cell local time accumulation and diffusion
│   ├── InfoPhysics.ts        — Coherence, decay, memory, resonance, info to energy
│   ├── Recorder.ts           — Snapshot ring buffer, CSV export, diff
│   ├── AgentSystem.ts        — AI agents: 5 behaviors, sense/act/replicate
│   ├── ClimateSystem.ts      — Wind advection, precipitation, pressure evolution
│   ├── CivilizationSystem.ts — Up to 12 civs, territory, tech, diplomacy
│   ├── MultiScaleSystem.ts   — 1/8 macro grid + micro chemistry + bidirectional coupling
│   ├── MetaLawEvolution.ts   — Evolutionary cull of bottom 20% laws every 500 ticks
│   ├── CosmologicalSim.ts    — 256×256×64 sparse universe: Big Bang, galaxies, dark energy
│   ├── LanguageEmergence.ts  — Agent proximity → signal patterns → vocabulary words
│   └── EconomicSystem.ts     — Markets at civ contact zones, scarcity pricing, GDP/GINI
│
├── ai/
│   └── SceneDirector.ts      — Claude API AI director: world analysis, script generation,
│                               auto-directing mode, API key via localStorage
│
├── network/
│   └── MultiplayerSync.ts    — BroadcastChannel cross-tab multiplayer: delta sync,
│                               peer cursors, host full-state broadcast
│
├── chemistry/
│   └── ChemLayer.ts          — State derivation + 4 reaction rules
│
├── process/
│   └── ProcessDef.ts         — 16 ProcessDef with inputs/outputs/stabilityImpact
│
├── laws/
│   ├── MetaLaw.ts            — PhysicsParams, MetaLaw, WorldMetrics
│   └── LawEngine.ts          — 7 default laws, mutation, process bitmask
│
├── gpu/
│   └── GPUBackend.ts         — WebGPU WGSL compute shader, material buffer
│
├── materials/
│   └── MaterialDef.ts        — 14 materials, 7 coefficients each
│
├── render/
│   ├── VoxelRenderer.ts      — Three.js instanced mesh, PBR materials, UnrealBloom,
│   │                           11 layer modes, entity + agent spheres, touch + keyboard nav
│   ├── RaymarchRenderer.ts   — WebGPU WGSL volumetric raymarcher, trilinear interpolation,
│   │                           emissive bloom, animated sun, fog, ray-AABB
│   └── FieldAnimator.ts      — BFS bio-cluster detection → animated creature groups (7 parts)
│
├── export/
│   ├── UnrealBridge.ts       — USD export + LiveLink JSON
│   ├── BlenderBridge.ts      — Python script + CSV point cloud generators
│   └── ScientificAPI.ts      — NumPy JSON + Jupyter .ipynb + GraphML causality export
│
├── world/
│   ├── Presets.ts            — 22 preset world states
│   ├── ScriptEngine.ts       — Scene Script DSL (world.sphere / box / noise / tick…)
│   ├── WorldEvents.ts        — 6 event types, auto-fire scheduler
│   ├── TerrainGenerator.ts   — 8 procedural biomes with FBM noise
│   └── Timeline.ts           — Sparse auto-save snapshots, restore, CSV export
│
└── ui/
    ├── NodeGraph.ts          — Drag-and-drop process node graph editor
    └── MetricsPanel.ts       — Live multi-field sparkline chart
```

### GPU Acceleration

WebGPU (Chrome 113+, Edge 113+) runs physics in a WGSL compute shader:
- 131,072 cells processed in parallel with workgroup_size(8, 8, 1)
- Material coefficients at binding 3 — 14 × 8-float padded buffer
- Multi-step batching — N steps per encoder submission, no CPU roundtrip per step
- 16-process bitmask gating per tick
- CPU TypeScript fallback — badge shows GPU / CPU mode

---

## Experiments to Try

**Watch life emerge**
1. Click Life seed > Play at 4x > wait 200 ticks > switch to Bio layer
2. Entity panel populates; glowing spheres mark cluster centroids; animated creatures appear at large clusters

**Procedural world + climate**
1. Select Earth biome > Generate terrain > Play > toggle Climate ON
2. Wind redistributes surface heat; precipitation fills valleys over time

**Civilization rise and fall**
1. Select Forest or Ocean biome > Generate terrain > Play at 4x > wait 300 ticks
2. Click **Seed civs from bio zones** — watch territory expand in the civ panel
3. Tech levels rise; wars and alliances appear in the history log

**Agent-guided language**
1. Load Life seed > Spawn 5 agents (several times) > Play at 4x
2. Watch the Language stats panel — vocabulary size grows as agent pairs exchange signals
3. Communication events boost the information field in agent zones

**AI Director intervention**
1. Load any preset > Play > open the AI Scene Director panel
2. Enter your API key > ask "What's happening in my world?"
3. Ask "Make something dramatic happen" > click ▶ Run code to execute the script

**Cosmological parallel universe**
1. Click 💥 Big Bang > Play at 8x
2. Watch the cosmological stats: filled cells expand as energy diffuses, galaxy count rises after seedGalaxies

**Cross-tab collaboration**
1. Open the same localhost:5173 URL in two browser tabs
2. Click 🔗 Connect in one tab; it syncs world state to the second
3. Paint energy in one tab — appears in the other within ~500ms

**Scientific analysis**
1. Run any preset for 500+ ticks
2. Click ↓ All 3 in the Scientific export section
3. Open the `.ipynb` in JupyterLab — run all cells to produce field plots and correlation matrix

**MetaLaw evolution**
1. Start Energy Economy > Play at 16x > watch the MetaLaw evolution log in the right panel
2. After 500 ticks, the first cull happens — weak laws are replaced by mutants of successful ones

**Alien crystal evolution**
1. Select Crystalline biome > Generate > Play at 8x > switch to Information layer
2. Crystal clusters grow as information accumulates at low-entropy nodes

---

## Stack

- **TypeScript** — strict mode
- **Vite** — dev server + bundler
- **Three.js** — instanced mesh voxels, PBR materials, UnrealBloomPass, OrbitControls
- **WebGPU** — WGSL compute shaders for parallel physics; WGSL fragment shader for volumetric rendering
- **Claude API** — `claude-haiku-4-5-20251001` for the AI Scene Director (browser-side, `anthropic-dangerous-direct-browser-access` header)
- **BroadcastChannel** — same-origin cross-tab multiplayer without a server

---

## Building for Production

```bash
npm run build      # outputs to dist/
npm run preview    # preview at localhost:4173
netlify deploy --prod --dir=dist
```
