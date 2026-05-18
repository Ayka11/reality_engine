---
title: Reality Engine Meta Law Simulator
emoji: 🌌
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
license: mit
pinned: false
---

# Reality Engine v5 — Meta-Law Physics Simulator

> *"A universe you can paint — where physics evolves, civilizations rise, and an AI director watches over it all."*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5.x-purple)](https://vitejs.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![HuggingFace](https://img.shields.io/badge/🤗-Live%20Demo-yellow)](https://huggingface.co/spaces/Aygun1489/Reality_Engine_Meta_Law_SImulator)

---

## What Is This

Reality Engine is an **interactive physics sandbox** where the rules of physics are themselves simulated objects — they compete, mutate, and go extinct. Paint energy and matter onto a voxel grid. Thermodynamics, chemistry, geology, and life emerge from first principles. The laws governing them evolve in real time through a **MetaLaw system**: each law has fitness, strength, and mutation rate. Laws that produce complexity survive. Laws that produce chaos go dormant.

**Autonomous AI agents** (Utility AI + FSM + genome-based evolution) inhabit the simulation. A built-in **LLM planner** (Claude Haiku) assigns collective goals via LangChain-style chaining, AutoGen two-agent debate, and CrewAI role delegation. A **Python microservice** runs NumPy / SciPy solvers for flow fields, population forecasts, and evolutionary fitness landscapes.

**This is not a game about matter. It is a game about the rules that govern matter.**

---

## Quick Start

```bash
git clone https://github.com/Ayka11/reality_engine.git
cd reality_engine
npm install
npm run dev
# → http://localhost:5173
```

Or open the **[live demo on Hugging Face](https://huggingface.co/spaces/Aygun1489/Reality_Engine_Meta_Law_SImulator)** — no install needed.

---

## Render Modes

The four tabs at the top of the viewport switch how the simulation is visualized. These are independent of the four editor modes (Create / Science / Cinema / Game Dev).

| Tab | What You See | When to Use |
|---|---|---|
| **🔲 3D Volumetric** | Isometric height-map — energy becomes pillar height, bio shows as green glow | Default view, best for exploring structure |
| **⬛ 2D Multi-Slice** | Four-quadrant view: Energy, Bio, Info, Entropy simultaneously | Comparing multiple fields at once |
| **⟐ Hybrid** | Left half = flat 2D, right half = isometric 3D — two canvases side by side | Seeing cause-and-effect across representations |
| **📈 Metrics** | Live numerical dashboard: tick, avg energy/entropy/info/bio/temp, active laws | Quick snapshot without reading the canvas |

**Switching modes:**
1. Click any tab — the view switches instantly without pausing simulation
2. In the **World Composer**, use the *Preview in Render Mode* buttons before generating to see how your world will look
3. Generating a world while in Metrics mode auto-switches to 3D Volumetric

> **Note:** Painting and cell inspection work in 3D, 2D, and Hybrid modes. In Hybrid, clicking the left (2D) half paints cells; the right (3D) half is view-only.

---

## Four Editor Modes

Switch with the top bar buttons: **Create · Science · Cinema · Game Dev**

Each mode loads its own left-panel tools. The simulation keeps running in all modes.

---

### 🎨 Create Mode

The default sandbox — paint matter, tune laws, run scripts, compose worlds.

#### World Composer Wizard

1. Click **✦ Compose World** in the top bar
2. **Step 1 — World Type**: Choose an archetype. Each archetype sets physics constants and active processes:

| Archetype | Character | Best For |
|---|---|---|
| 🌑 Dead Moon | Barren, geology only | Pure physics experiments |
| 🌊 Ocean World | Global liquid, life possible | Bio emergence |
| 🍄 Fungal Planet | Dense info networks | Information dynamics |
| 💎 Crystal Universe | Ultra-low entropy, perfect order | Stability studies |
| 🌪️ Entropy Collapse | Max chaos | Watching order fight disorder |
| 🌍 Proto Earth | Volcanic, primed for life | Default recommended start |
| 🧠 Neural Biosphere | Consciousness substrate | AI/agents experiments |
| 🏛️ Post-Human Ruins | Decaying structures | Long-duration decay studies |

3. **Step 2 — Physics Mood**: Multiplies the archetype's constants:
   - *Balanced* — no change (safe default)
   - *High Gravity* — diffusion ×0.5 (tighter clusters)
   - *Hyper Diffusion* — diffusion ×2.5 (fast spreading)
   - *Information Dominant* — INFO_RATE ×3 (rapid complexity)
   - *Chaotic Laws* — entropy ×3 (accelerated decay)
   - *Low Entropy* — entropy ×0.1 (near-crystalline)

4. **Step 3 — Evolution Goal**: Sets agent count and narrative intent (Emergent Life, Stable Ecosystem, Expanding Civ, etc.)
5. **Step 4 — Hazards** (optional): Add recurring disturbances — Meteor Showers, Solar Storms, Acid Rain, Tectonic Rifts, High Radiation
6. **Step 5 — Preview in Render Mode**: Click 3D/2D/Hybrid to preview the current selection before committing
7. Click **✦ Generate World** — the simulation fills, plays, and the panel returns to World

#### Smart Brushes

Select a brush from the left panel, then **click and drag** on the canvas:

| Brush | Effect | Best Use |
|---|---|---|
| 🌋 Volcano | Energy+heat burst with density | Starting a thermal hotspot |
| 🌲 Forest | Bio+info growth, light energy | Seeding life zones |
| 🌊 Ocean | Low energy, high density, temp | Creating fluid bodies |
| 💎 Crystal | High energy+info, entropy drain | Ordered low-entropy zones |
| ⚡ Storm | Noisy energy+heat+entropy | Introducing turbulence |
| 🧬 Life Cluster | Balanced bio-seeding | Best brush for life experiments |
| ☢️ Radiation | Entropy injection, info drain | Killing or stressing life |
| 🏛️ Civ Seed | High energy+info+bio, anti-entropy | Starting civilization zones |

**Raw paint** (no brush selected): paints whichever field is active in the layer selector (Energy / Density / Info / Entropy / Temp / Bio).

**Brush settings** (left panel → Brush Settings):
- *Size* 1–5: radius in cells
- *Strength* 50–1000: intensity per stroke
- Tools: Paint (set value), Inject (add to existing), Erase (zero all fields), Inspect (click to read cell)

#### Field Selector (Field Bar)

The **Field** bar lives below the render-mode tabs, always visible. It has an **All** button plus six field buttons. What each button does depends on which render mode is active:

| Button | 3D Volumetric | 2D Multi-Slice | Hybrid |
|---|---|---|---|
| **All** | Color = Energy (default) | 4-slice overview | 2D: 4-slice · 3D: Energy |
| **⚡ Energy** | Tiles colored by energy | Full-screen energy + stats | Same, split |
| **🌫️ Density** | Tiles colored by density | Full-screen density + stats | Same, split |
| **🧠 Info** | Tiles colored by info | Full-screen info + stats | Same, split |
| **🔥 Entropy** | Tiles colored by entropy | Full-screen entropy + stats | Same, split |
| **🌡️ Temp** | Tiles colored by temperature | Full-screen temp + stats | Same, split |
| **🧬 Bio** | Tiles colored by bio | Full-screen bio + stats | Same, split |

> **In all modes, tile height in 3D always represents energy.** Only the color changes.

**How to use:**
1. Click any field button — the viewport updates immediately
2. The button highlights (active = white border + lavender tint)
3. A hint label appears to the right of the buttons explaining what the selection does in the current render mode
4. Click the same button again to toggle back to **All** (multi-slice / default energy color)

**2D Multi-Slice — reading the 4-slice view:**
- Default (All) shows four quadrants: Energy (top-left), Bio (top-right), Info (bottom-left), Entropy (bottom-right)
- Each quadrant shows a **stats bar** at the bottom: `avg · min · max · active cells`
- A hint at the bottom of the canvas shows Density and Temp are not in the default 4-slice — use the field buttons to access them
- Click a field button to show that one field full-screen with larger statistics

**2D Multi-Slice — monitoring entropy and info:**
- **🔥 Entropy** (bottom-right quadrant) shows disorder 0–1. Values below 0.1 = highly ordered (icy/crystalline). 0.3–0.6 = turbulent. Above 0.6 = critical collapse territory
- **🧠 Info** (bottom-left quadrant) tracks complexity — it grows where energy + density co-exist and entropy is low. Watch it rise alongside Bio for emergence events

**Science Mode — Field Monitor panel:**
- The top section in the Science left panel shows a **Field Monitor** with the same field buttons plus a live table: avg / max / active-cell-count per field, updated every 5 ticks
- Use this for numerical observation without reading the canvas

#### Scene Script

Left panel → Script tab. JavaScript runs directly against the live buffer:

```js
// Paint a volcano at center
const cx = W/2, cy = H/2;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const d = Math.sqrt((x-cx)**2 + (y-cy)**2);
  const g = Math.exp(-d*d/40);
  set_(x, y, 0, g * 900);  // energy
  set_(x, y, 4, g * 600);  // temperature
}
```

Available: `buf`, `W`, `H`, `NF`, `SZ`, `set_(x,y,field,value)`, `add_(x,y,field,delta)`, `get(x,y,field)`, `Math`.

Load templates from the dropdown: *Primordial Ocean*, *Volcano*, *Life Explosion*, *Galaxy Spiral*.

#### World Mood Controls

Left panel → World panel. Click pills to snap physics to a preset regime:

- **Stability**: Fragile / Dynamic / Balanced / Self-Repairing → sets `ENTROPY_BASE`
- **Entropy Regime**: Low (Order) / Medium / High (Chaos) / Extreme
- **Life Bias**: Suppressed / Neutral / Fertile / Aggressive → sets `INFO_RATE`

#### Quick Presets

Left panel → Presets section: Energy Burst, Wave Field, Life Seed, Proto Earth, Entropy Storm, Ruins, Clear.

**Save / Load worlds:** Use `💾 Save` to download a `.reality` JSON file. Use `📂 Load` to restore a saved file — it snapshots the full buffer state at the saved tick.

**Undo:** `Ctrl+Z` reverts the last paint stroke, preset, or world generation (5-step ring buffer).

---

### 🤖 Agents Mode

Accessed via the **robot icon** in the left icon bar. Agents are autonomous entities that live on the simulation grid and act according to Utility AI.

#### Agent Architecture

| Component | Role |
|---|---|
| **Utility AI** | Each tick, score 5 candidate moves (N/S/E/W/stay) by weighted field values |
| **FSM states** | `seek_energy`, `seek_info`, `flee_entropy`, `explore`, `reproduce`, `rest`, `idle` |
| **Genome** | Weight vector (seekEnergyW, seekInfoW, fleeEntropyW, bioW, exploreW, reprodThresh, maxAge) |
| **Memory ring** | 48-cell visited-cell history prevents circling |
| **Civilization ID** | Each spawn group gets a unique civId; territory written to FCid field |

#### Spawning Agents

Click **🧬 Spawn 5** or **🧬 Spawn 20** in the Agents panel. Agents appear near grid center. The bottom bar `Agents:` counter updates live. Agent dots are drawn on the canvas — colored by civilization.

**Mutation rate** slider controls how much offspring genomes drift from the parent (1%–100%).

Max population cap: **200 agents**. Agents die from starvation (`energy < 0.005`) or old age (genome `maxAge` ≈ 200–1200 ticks).

#### LLM Planning (Claude Haiku)

The **LLM Planning** section uses Claude Haiku to generate goal text that biases all agent genome weights:

| Button | Pattern | What It Does |
|---|---|---|
| **🧠 Group Plan** | LangChain-style chain | Asks Claude for one collective survival goal based on current world state |
| **⚔️ Debate** | AutoGen two-agent | Strategist + Tactician agents debate; Claude writes a consensus plan |
| **👥 Assign CrewAI Roles** | CrewAI role delegation | Assigns each agent a role: Scout · Harvester · Guardian · Architect · Breeder |

Without an API key, heuristic goals run automatically (based on world averages).

**To set your API key:** Click the **🔑** button in the top-right of the icon bar, enter your `sk-ant-...` key, and click Save. The key is stored in `localStorage` only — never sent anywhere except `api.anthropic.com`.

#### Agent Solvers (Python Microservice)

When the FastAPI microservice is running, four additional solvers appear in the Science Mode solver panel:

| Solver | Algorithm | Output |
|---|---|---|
| **Agent Flow Field** | Gradient descent on E + I - S potential | FFX/FFY flow vectors + FBio heatmap |
| **Population Forecast** | Logistic reaction-diffusion (∂ρ/∂t = D∇²ρ + rρ(1-ρ/K)) | FBio forecast |
| **Multi-Agent Coordination** | 5-role utility maps (Scout/Harvester/Guardian/Architect/Breeder) | FCid role map + FI shared knowledge |
| **Evolutionary Fitness Landscape** | Weighted fitness surface + energy gradient bonus | FBio fitness + FI update |

---

### 🔬 Science Mode

Full instrumentation. Switch to Science Mode using the top bar.

#### Law Ecosystem

Every active law shows:
- **Fitness slider** (0–1): how strongly this law's output is rewarded
- **Strength slider** (0–1): the magnitude of this law's physical effect
- **Toggle** (colored dot): enable / disable without losing tuned values
- **Color-coded fitness line**: updated on the Law Fitness Chart in real time

**To add a custom law:**
1. Click **+ Add law** at the bottom of the law list
2. Name it, then write a fitness expression: e.g. `bio*3 + info/200 - entropy*2`
3. The expression is evaluated against live field averages each tick

**To reset all fitness values:** Click **↺ Reset** (sets all to 0.5).

#### Physics Parameters (fine control)

| Param | Range | Effect |
|---|---|---|
| `DIFF` — Diffusion | 0.01–0.3 | Speed energy spreads to neighbors |
| `ENT` — Entropy base | 0.00001–0.003 | Baseline disorder growth per tick |
| `INFO` — Info growth | 0.05–2.0 | Rate information forms in fertile zones |
| `BIO` — Bio threshold | 0.05–0.8 | Min density for bio potential to rise |

> Tip: Lower `ENT` + higher `INFO` → complex info structures persist longer. Higher `DIFF` → energy equilibrates quickly, harder to maintain hotspots.

#### Law Fitness Chart

A canvas plot below the law list. Each colored line = one active law's fitness over time. The lines update every 5 ticks. Flat lines = stable laws. Oscillating = competing laws. Declining = law losing fitness (may go dormant).

#### Data Export

| Button | Output | Use With |
|---|---|---|
| 📄 Metrics CSV | Time-series of all 9 fields | `pandas.read_csv()`, R, Excel |
| 📓 Jupyter Notebook | `.ipynb` with 4 pre-written cells | Jupyter Lab — plots + correlation matrix |
| 🗂️ Recording JSON | Sparse keyframes (`reality_engine_scientific_v2`) | Custom analysis, replay |
| 💾 Save .reality | Full world state | Re-load in Create Mode |

#### Scientific Solvers Panel

Science Mode has a **Scientific Solvers** section in the left panel that connects the Reality Engine to external PDE / molecular-dynamics solvers. The results replace field data in the live simulation — producing far more physically realistic patterns than the built-in diffusion model.

**Architecture:**
```
Reality Engine (browser)
    ↕  HTTP POST / WebSocket JSON
Python microservice  localhost:8765
    ↕
FEniCSx / MOOSE / Elmer / GROMACS / NumPy
    ↕
Float32Array result → voxel grid
```

**Every solver has a built-in NumPy fallback** — zero extra install needed for basic use.

##### Available Simulations

| Simulation | Solver | Writes To | Description |
|---|---|---|---|
| Turing Patterns | NumPy (built-in) | Info + Bio | Gray-Scott spots/stripes/labyrinths |
| Wave Propagation | NumPy (built-in) | Energy | 2D acoustic / EM wave equation |
| Heat Diffusion | NumPy / FEniCSx | Temp | Steady-state Laplace heat |
| Fluid Flow (Stokes) | NumPy / FEniCSx | Flow X/Y | Pressure-driven incompressible flow |
| Thermal Convection | NumPy | Temp + Flow | Buoyancy-driven convective heat |
| Phase Separation | NumPy / MOOSE | Density | Cahn-Hilliard spinodal decomposition |
| Electric Potential | NumPy / FEniCSx | Info | Electrostatic Laplace from charge density |
| Entropy Production | NumPy (built-in) | Entropy | Irreversible entropy from energy gradients |
| Molecular Dynamics | NumPy / GROMACS | Energy + Density | Langevin particle simulation → voxel bins |
| Coupled Heat+Flow | NumPy / Elmer | Temp + Flow | Boussinesq buoyancy convection |
| Magnetostatics | NumPy / Elmer | Info | Magnetic vector potential from currents |
| Protein CG Dynamics | NumPy / GROMACS | Bio + Info | Coarse-grained bead-spring folding |

##### How to use

1. Switch to **Science Mode** (top bar)
2. Open the **Scientific Solvers** section in the left panel
3. Select a simulation from the dropdown
4. Adjust parameters with the sliders
5. Click **▶ Run Simulation** — the field updates immediately
6. Click **↻ Live** to re-run every 3 seconds while the simulation is playing

##### Starting the microservice

All built-in NumPy solvers run without the microservice. For FEniCSx/MOOSE/Elmer/GROMACS, start the Python API:

```bash
# Option 1: direct
cd solver
pip install fastapi uvicorn numpy
uvicorn reality_solver_api:app --port 8765 --reload

# Option 2: shell script (shows capability check)
bash solver/start.sh

# Option 3: Docker (includes FEniCSx)
docker-compose -f solver/docker/docker-compose.yml up

# Option 4: Docker lite (NumPy only, fast to start)
docker-compose -f solver/docker/docker-compose.yml --profile lite up solver-lite
```

##### Installing optional heavy solvers

```bash
# FEniCSx — accurate FEM for heat, fluid, electric
conda install -c conda-forge fenics-dolfinx mpi4py

# Elmer — coupled multiphysics (heat + fluid, EM)
sudo apt install elmer          # Ubuntu/Debian
brew install elmer              # macOS

# MOOSE — materials science (phase field, grain growth)
conda install -c conda-forge moose

# GROMACS — molecular dynamics
sudo apt install gromacs        # Ubuntu/Debian
conda install -c conda-forge gromacs
```

The API status dot in the panel header turns **green (●)** when the microservice is reachable and shows which backends are available.

#### Console API (browser DevTools)

```js
// Query metrics
window.metrics.get('entropy', 'avg', 200)    // avg over last 200 samples
window.metrics.get('bio', 'max', 100)         // peak bio potential
window.metrics.getSeries('energy', 500)       // raw number[] array
window.metrics.snapshot()                     // all 9 fields, latest value
window.metrics.exportCSV()                    // CSV string

// Causal inspector
window.scienceMode.explainCell(x, y, buf)     // full causal breakdown HTML

// Exports
window.scienceMode.exportCSV()
window.scienceMode.exportJupyter()
window.scienceMode.exportJSON()

// Run a solver directly from DevTools
await window.solverClient.checkStatus()       // { online: true, capabilities: {...} }
const req = window.solverClient.buildRequest('numpy_turing_patterns', buf, W, H, NF, { steps: 1200 })
const res = await window.solverClient.solve(req)
window.solverClient.applyResult(res, buf, W, H, NF)

// Direct buffer (live — mutations are immediate)
window.buf          // Float32Array, W×H×NF cells
window.W, window.H  // grid dimensions (36×28)
window.NF           // fields per cell (12)
window.tick         // current simulation tick
```

---

### 🎬 Cinema Mode

AI-directed cinematics with timeline recording and video export. Switch to Cinema Mode using the top bar.

#### AI Scene Director

The left panel has a chat log and input field.

**To use:**
1. Type a cinematic direction: *"Make the bio zone collapse dramatically"* or *"Create a peaceful emergence moment"*
2. Click **Ask** (or press Enter)
3. The director (Claude Haiku) responds with:
   - **Narration** — descriptive text for the moment
   - **Script** — executable JavaScript that modifies the simulation
   - **Camera hint** — suggested focus point
   - **Marker label** — text for the timeline

4. If a script appears in the blue code box, click **▶ Execute director script** to run it
5. Click **🎙️ Narrate** to get a description of the *current* simulation state without a prompt
6. Click **Auto: ON** to enable auto-directing — the AI fires every ~28 seconds and applies changes automatically

> **Requires a Claude API key.** Set it in the AI Scene Director input. Without a key, the director uses pre-written fallback templates.

#### Timeline

A 3-track NLA-style canvas (SIM / CAM / MRK tracks):

| Track | What it records | How to add |
|---|---|---|
| SIM | Sparse simulation keyframe (full field snapshot) | Click **⬡ Sim KF** |
| MRK | Named marker / event label | Click **📍 Marker** |

- **Scrub**: Click anywhere on the timeline canvas to jump to that tick
- **Total ticks**: Set the timeline length with the number input (default 1000)

#### Recording

1. Click **● Record** — starts capturing frames (shown in green in rec status)
2. Run the simulation as desired
3. Click **■ Stop** — finalizes the recording
4. Download options:
   - 🗂️ **Alembic recording (.json)** — full sparse keyframe archive
   - 💬 **Markers as subtitles (.srt)** — for video editing software
   - 🖼️ **Export frame PNG** — single frame at current tick

#### Render Settings

| Slider | Effect |
|---|---|
| Brightness | Multiplies all rendered color values |
| Saturation | Boosts or mutes color saturation |

---

### 🎮 Game Dev Mode

Turn any simulation into a scored game with objectives, entity behaviors, prefabs, and AI design assistance. Switch to Game Dev Mode using the top bar.

#### AI Game Designer

A chat interface powered by Claude Haiku.

**To use:**
1. Type a design request: *"Design a survival level where players fight entropy"* or *"Suggest objectives for a civilization-building mode"*
2. Click **Ask** (or press Enter)
3. The designer responds with:
   - Game mechanic advice
   - A JSON ruleset you can apply directly (shown if detected)

4. Click **💡 Suggest** for an unprompted objective recommendation based on the current world state
5. If a JSON ruleset is returned, the **✓ Apply ruleset** button appears — click it to load objectives, lives, and time limit automatically

> **Requires a Claude API key.** Without one, the designer uses 2 built-in template suggestions (Survival Challenge, Civilization Builder).

#### Playtest Controls

| Button | Action |
|---|---|
| **▶ Start** | Begin timed playtest, start objectives tracking |
| **↺ Reset** | Clear score, reset lives, restart objectives |
| **⏸ Pause** | Freeze playtest timer without stopping simulation |

**Score** is shown in the section header. **Lives** (❤️❤️❤️) deplete when entropy exceeds critical threshold (avg entropy > 0.95).

**Load preset** — dropdown loads pre-built objectives + rules:
- ⚔️ **Survival**: Keep entropy low for 500 ticks
- 🌿 **Ecosystem**: Grow bio potential above threshold
- 🏛️ **Civilization**: Spawn 10 agents + build info network
- ✏️ **Custom**: Blank slate

#### Objectives

Add individual objectives from the dropdown:

| Objective | Win Condition |
|---|---|
| ⏱ Survive 500 ticks | Simulation must run 500 ticks without losing all lives |
| 🧬 Reach bio > 0.5 | Average bio potential across grid exceeds 0.5 |
| 🤖 Spawn 10 agents | 10 or more agents alive simultaneously |
| 🌀 Reduce entropy < 0.2 | Average entropy drops below 0.2 |
| 🧠 Info avg > 100 | Average information field exceeds 100 |

Progress bars appear for each active objective. All objectives complete = win (+500 bonus points).

**Time limit**: Set a tick deadline. Reaching it without completing objectives = game over.

#### Entity Behaviors (Finite State Machine Editor)

A visual FSM canvas showing 7 agent states:

| State | Behavior |
|---|---|
| 🔵 idle | Agents rest and recover energy |
| 🟡 seek_energy | Move toward high-energy cells |
| 🟣 seek_info | Move toward high-information zones |
| 🔴 flee_entropy | Move away from high-entropy areas |
| 🟢 reproduce | Create offspring when energy threshold met |
| 🟦 explore | Random walk, map territory |
| ⚪ rest | Low-activity energy conservation |

**Select a preset** from the dropdown:
- 🦅 **Predator** — starts in `seek_energy`, aggressive transitions
- 🔭 **Explorer** — starts in `explore`, wide-roaming
- 🛡️ **Survivor** — starts in `rest`, high flee_entropy weight

Click states on the FSM canvas to see transition conditions in the info box below.

**Spawn agents:**
- **🧬 Spawn 5** / **🧬 Spawn 20** — creates agents with the currently selected behavior genome

#### Prefab Library

Reusable cell cluster templates you can stamp anywhere.

**Built-in prefabs:**
| Prefab | Contents |
|---|---|
| 🌱 Life Bloom | High bio + info cluster, Gaussian-weighted |
| ⚡ Energy Source | Hot energy core |
| 💎 Crystal Node | Low-entropy, high-information, ordered |

**Capture a custom prefab:**
1. Position the view over the cluster you want to save
2. Click **📷 Capture prefab** — prompts for a name, captures a radius-3 sphere of cells
3. The prefab appears in the grid with a JPEG thumbnail

**Stamp a prefab:**
1. Click a prefab in the grid to select it (shown under *Active:*)
2. Click anywhere on the simulation canvas — the prefab is stamped at that position
3. Stamping uses `set` mode by default (overwrites), or `add` mode (additive blend)

#### Level Export

| Button | Output |
|---|---|
| **💾 Export level (.level.json)** | Objectives, rules, lives, time limit as JSON (`reality_engine_level_v1`) |
| **🌍 Export world (.reality)** | Full simulation state (sparse cells) |
| **🔗 Copy shareable link** | URL hash encoding the current objectives, openable in any browser |

---

## Architecture

```
index.html          ← Self-contained voxel simulation (W=36 × H=28 × NF=12)
                      Inline <script>: physics loop, render loop, UI panels
                      Two-canvas viewport: #c2d (flat/multi-slice) + #c3d (isometric)
                      World Composer Wizard with archetype + physics mood + hazards

src/connector.ts    ← Module bridge: imports all TS classes, exposes on window.*
                      Listens to 'panelRendered' events to init canvases after panel injection

src/
  scientific/
    MetricsAPI.ts          9 ring-buffered metrics (2000 pts each), queryable
    LawFitnessChart.ts     Canvas chart, per-law fitness over time
    CausalInspector.ts     Per-cell causal explanation (causes, processes, forecast)
  simulation/
    DeterministicEngine.ts XORshift32 RNG, sparse frame recording, multi-format export
  modes/
    ScienceModePanel.ts    HTML builder for science mode left panel
    GameDevModePanel.ts    HTML builder for game dev mode left panel (6 sections)
    cinema/
      KeyframeTimeline.ts  3-track NLA canvas (SIM/CAM/MRK), scrubable playhead
      CameraPathEditor.ts  Cubic-eased spline camera path
      SceneDirector.ts     Claude API (Haiku) — narration + script + camera hint
      VideoRecorder.ts     WebCodecs VideoEncoder (VP8) + PNG fallback
    gamedev/
      EntityBehaviorEditor.ts  7-state BehaviorFSM visual editor + agent genome compiler
      GameRulesetEngine.ts     Score/lives/objectives engine (5 objective types)
      PrefabSystem.ts          Capture clusters → library → stamp anywhere
      AIGameDesigner.ts        Claude API (Haiku) — game mechanic design + JSON rulesets
  core/
    SimWorker.ts         Web Worker simulation (W=32×H=24×D=10×NF=12), Transferable buffer
```

### Field Layout (NF=12)

| Index | Name | Description | Range |
|---|---|---|---|
| 0 | `FE` — Energy | Heat / kinetic energy source | 0 – 9999 |
| 1 | `FD` — Density | Matter concentration | 0 – 1 |
| 2 | `FI` — Information | Complexity / emergent signal | 0 – 999 |
| 3 | `FS` — Entropy | Disorder / decay | 0 – 1 |
| 4 | `FT` — Temperature | Thermal energy | 0 – 2000 |
| 5 | `FFX` — Flow X | Fluid / force X vector | –500 – 500 |
| 6 | `FFY` — Flow Y | Fluid / force Y vector | –500 – 500 |
| 7 | (reserved) | Unused | — |
| 8 | `FTau` — Time dilation | Local time rate | 0 – ∞ |
| 9 | `FCid` — Civilization ID | Agent civilization tag | int |
| 10 | `FBio` — Bio potential | Life readiness | 0 – 1 |
| 11 | `FProc` — Process flags | Active process bitmask | int |

> **Note**: Density (`FD`), Entropy (`FS`), and Bio (`FBio`) are normalized 0–1. Energy (`FE`), Info (`FI`), and Temperature (`FT`) are unbounded positive floats.

---

## Physics Engine

Each simulation tick (dt ≈ 0.016s) applies in order:

1. **Diffusion** — energy, density, temperature, information each spread to 4 neighbours via Laplacian scaled by `DIFFUSION`
2. **Thermodynamics** — `FE` drives `FT` up; `FT` diffuses independently
3. **Entropy growth** — `FS` increases every tick: `dS = (ENT_BASE + E×4e-5 + T×1.5e-5) × dt × 60`
4. **Energy drain** — `FE -= E × FS × 2e-4 × dt × 60` (entropy destroys energy)
5. **Information** — grows when energy and density are high, decays when entropy is high
6. **Bio emergence** — `FBio` rises when `FE > 80`, `FD > BIO_THRESH`, `FS < 0.9`, driving info up
7. **Causal logging** — cells with `|ΔE| > 55` per tick are logged as causal events

---

## MetaLaw System

Laws are first-class objects:

```js
{ name, type, active, fitness, strength, color, desc }
```

Built-in laws and their physical effect:

| Law | Controls |
|---|---|
| Energy Diffusion | `DIFFUSION` constant |
| Entropy Growth | `ENTROPY_BASE` constant |
| Info Bloom | `INFO_RATE` constant |
| Bio Emergence | `BIO_THRESH` constant |
| Thermal Coupling | Temperature coupling strength |
| Causal Threshold | Min ΔE to log a causal event |
| Density Gravity | Density diffusion rate (needs thermo) |
| Neural Plasticity | Agent learning rate (needs agents) |

---

## Data Export Reference

| Format | Function | Use With |
|---|---|---|
| **Metrics CSV** | `scienceMode.exportCSV()` | `pandas.read_csv()`, R, Excel |
| **Jupyter .ipynb** | `scienceMode.exportJupyter()` | Jupyter Lab — 4 cells: plots, correlation, complexity |
| **Recording JSON** | `scienceMode.exportJSON()` | Sparse keyframes, format `reality_engine_scientific_v2` |
| **Alembic .json** | `cinemaMode.exportAlembic()` | Per-keyframe cell archive, `reality_engine_alembic_v1` |
| **SRT subtitles** | `cinemaMode.exportSRT()` | Timeline markers → video editor subtitles |
| **Level JSON** | `gamedevMode.exportLevel()` | Objectives + rules, `reality_engine_level_v1` |
| **World .reality** | `saveWorld()` | Full sparse world state |

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `?` or `/` | Show keyboard shortcuts overlay |
| `Escape` | Close any modal or overlay |
| `Space` | Play / Pause simulation |
| `1` | Select ⚡ Energy field |
| `2` | Select 🌫️ Density field |
| `3` | Select 🧠 Info field |
| `4` | Select 🔥 Entropy field |
| `5` | Select 🌡️ Temp field |
| `6` | Select 🧬 Bio field |
| `Ctrl+S` | Save world (.reality) |
| `Ctrl+Z` | Undo last paint / preset (5-step ring) |
| Click + Drag | Paint / brush on canvas |
| Click (Inspect tool) | Select cell → causal breakdown in right panel |
| ↑ / ↓ (Debug console) | Navigate command history |

> Field shortcuts only fire when the canvas area has focus (not when a text input is active).

---

## Troubleshooting

### 3D view appears blank on first load
The isometric canvas (`#c3d`) must be initialized by clicking any render tab, or it will start hidden. Fixed in current build — a hard-refresh (**Ctrl+Shift+R**) is enough to get the latest code.

### Entropy / Density / Bio fields look invisible in 2D mode
Previously a display-threshold bug: cells with value < 50% of max were skipped. For 0–1 normalized fields this made anything below 0.5 invisible. Fixed — the threshold is now 0.001 for normalized fields.

### Switching from 2D back to 3D shows blank or stale image
Previously the 2D canvas (opaque dark fill) covered the isometric 3D canvas. Fixed — in 3D mode the flat canvas is now hidden.

### Game Dev pause doesn't stop simulation
Previously broken: the `window.loop` override was never called because the RAF held a closure reference to the original function. Fixed — the pause check is now inside the main `loop()` directly.

### Scientific Solvers panel not visible in Science Mode
The panel is injected dynamically by `connector.ts` when the `panelRendered` event fires.
1. Hard-refresh (Ctrl+Shift+R)
2. Click **Science** in the top bar
3. Scroll to the bottom of the left panel

### Microservice offline (status dot red or yellow)
```bash
cd solver
py -3 -m uvicorn reality_solver_api:app --port 8765 --reload
```

---

## Development

```bash
npm run dev      # Vite dev server (HMR) → http://localhost:5173
npm run build    # Production build → dist/
npm run preview  # Preview production build locally
npx tsc --noEmit # Type check (must produce zero errors)
```

### Adding a New Mode

1. Create `src/modes/yourmode/YourModePanel.ts` — export `buildYourModePanel(): string`
2. Add your panel to the `PANELS` object in `index.html`:
   ```js
   yourmode: () => window.yourMode?window.yourMode._buildPanel():`<div>Loading...</div>`
   ```
3. Add the panel/mode mapping in the mode button handler:
   ```js
   const panelMap = { ..., yourmode: 'yourmode' };
   ```
4. Wire it up in `src/connector.ts` — import your classes, expose on `window`, listen for `panelRendered`

---

## Project Structure

```
reality/
├── index.html              # Main app — simulation + UI + two-canvas viewport
├── src/
│   ├── connector.ts         # Module bridge → window.* APIs for all modes + agents
│   ├── main.ts              # UX system entry point
│   ├── scientific/
│   │   ├── MetricsAPI.ts
│   │   ├── LawFitnessChart.ts
│   │   ├── CausalInspector.ts
│   │   └── SolverClient.ts  # HTTP client for Python microservice solvers
│   ├── simulation/
│   │   └── DeterministicEngine.ts
│   ├── core/
│   │   └── SimWorker.ts
│   ├── modes/
│   │   ├── ScienceModePanel.ts
│   │   ├── GameDevModePanel.ts
│   │   ├── agents/
│   │   │   ├── AgentSystem.ts   # Utility AI + FSM + genome-based agent simulation
│   │   │   └── AgentPlanner.ts  # LLM goal planner (LangChain/CrewAI/AutoGen patterns)
│   │   ├── cinema/
│   │   │   ├── KeyframeTimeline.ts
│   │   │   ├── SceneDirector.ts
│   │   │   └── VideoRecorder.ts
│   │   └── gamedev/
│   │       ├── GameRulesetEngine.ts
│   │       ├── PrefabSystem.ts
│   │       └── AIGameDesigner.ts
│   └── ui/
│       └── UXIntegration.ts
├── solver/                  # Python FastAPI microservice (localhost:8765)
│   ├── reality_solver_api.py  # @register decorator + /solve endpoint
│   └── solvers/
│       ├── physics_solvers.py    # FEM heat, wave, fluid, magneto-hydro
│       ├── quantum_solvers.py    # Schrödinger, Bell states, quantum walk
│       ├── complex_solvers.py    # Reaction-diffusion, cellular automata, fractals
│       └── agent_solvers.py     # Flow field, population forecast, multi-agent, fitness
├── vite.config.ts
├── tsconfig.json
└── netlify.toml            # COOP/COEP headers for SharedArrayBuffer
```

---

## License

MIT — see [LICENSE](LICENSE).

---

*Built with [Claude Code](https://claude.ai/claude-code) by Anthropic.*
