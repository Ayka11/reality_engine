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

# Reality Engine v6 — Meta-Law Physics Simulator

> *"A universe you can paint — where physics evolves, civilizations rise, and an AI director watches over it all."*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-green)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-5.x-purple)](https://vitejs.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![HuggingFace](https://img.shields.io/badge/🤗-Live%20Demo-yellow)](https://huggingface.co/spaces/Aygun1489/Reality_Engine_Meta_Law_SImulator)

---

## What Is This

Reality Engine is an **interactive physics sandbox** where the rules of physics are themselves simulated objects — they compete, mutate, and go extinct. Paint energy and matter onto a voxel grid. Thermodynamics, chemistry, geology, and life emerge from first principles. The laws governing them evolve in real time through a **MetaLaw system**: each law has fitness, strength, and mutation rate. Laws that produce complexity survive. Laws that collapse into chaos go dormant.

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

## 3D PBR Renderer (Phase 2 — Complete)

The 3D Volumetric view is powered by a **Three.js PBR renderer** running on a sparse 128×128×64 chunk grid (up to ~200 active chunks out of 2048 total). Voxels look like real materials based on their field values.

### Material Intelligence

Every cell is classified into one of 10 physical material types based on live field values:

| Material | Icon | Field Conditions | Properties |
|---|---|---|---|
| **Plasma** | 🔴 | Temperature > 800 | Emissive orange-white glow, intensity 4× |
| **Crystal** | 💎 | Energy > 600, Entropy < 0.05 | Transparent ice-blue, low roughness, emissive teal |
| **Organic** | 🌿 | Bio > 0.55 | Rough green, soft green glow |
| **Neural** | 🧠 | Info > 300, Density > 0.2 | Purple-violet, pulsing neural glow |
| **Energy** | ⚡ | Energy > 400, Density > 0.5 | Orange fire, 2.5× emissive |
| **Metal** | ⚙️ | Density > 0.7, Temperature > 200 | Reflective silver, low roughness |
| **Water** | 🌊 | Density > 0.4, Temperature < 100 | Transparent blue, mild emissive |
| **Rock** | 🪨 | Density > 0.75, Energy < 50 | Rough brown-grey, no glow |
| **Road** | 🛣️ | Default urban surface | Dark grey, near-matte |
| **Void** | ⬛ | Energy < 1, Density < 0.05 | Fully transparent — empty space |

Classification uses priority ordering: Plasma is checked first (prevents false positives), Void last. Each material gets its own **PBR InstancedMesh** with correct roughness, metalness, and emissive values — no per-frame color baking.

### Energy Glow Blending

High-energy cells of any type get an additional orange energy glow blended proportionally: `min(E / 800, 1)`. At full energy (800+), cells shift noticeably toward orange-white regardless of base material.

### Particle System

Two ambient particle layers float above the simulation:

| Layer | Count | Color | Source |
|---|---|---|---|
| Smoke | 1200 | Warm grey, slow-rising | General atmosphere |
| Sparks | 400 | Orange-red, fast | Energy hotspots |

Particles are GPU points with custom size and opacity. Both layers toggle with the **✨ Particles** button in the 3D Controls panel.

### Time-of-Day Atmosphere

The **Time of day** slider (0–24h) moves a sun arc across the sky and adjusts:
- **DirectionalLight** position and color (warm noon → cool dusk → dark midnight)
- **AmbientLight** intensity
- **ACES filmic tonemapping** exposure (0.6 at midnight → 1.4 at noon)
- **FogExp2** density and tint

### Camera Presets

Five camera presets in the **3D Controls** right panel:

| Preset | View |
|---|---|
| **Orbit** | Default — user-controlled orbit around scene center |
| **Top** | Orthographic-style top-down at 90° elevation |
| **ISO** | Cinematic isometric — 45° yaw, 35° elevation |
| **Street** | Low street-level view at ground height |
| **Fly ✈** | Autonomous smooth orbit path, `flyAngle += dt × 0.22` |

### Material Mode Selector

Three visualization modes in the **layer bar** (next to field buttons):

| Mode | What you see |
|---|---|
| **Field** | Classic color-ramp coloring by selected field value |
| **PBR** | Material-classified — each voxel looks like its real material |
| **Height** | Height-map gradient by Z-coordinate |

### Z-Slice Cutting Plane

The **Z-Slice** slider (0–63) cuts the world at a given Z level, hiding everything above. Use it to look inside mountains, read underground strata, or focus on a floor of a building. Value 63 = show all (no cut).

---

## Visual Rendering (Phase 1 — Complete)

The 2D canvas modes keep all Phase 1 effects: 4-stop color palettes per field, emissive glow on high-energy tiles, 220-particle bio/energy/info spark system, atmospheric vignette, and world-state mood tint (red wash on entropy crisis, green on life, blue on energy death).

---

## Scene Composer (Cinema Mode)

Open Cinema Mode → the **🎬 Scene Composer** panel appears in the left sidebar. It is a drag-and-drop cinematic scene builder: pick components, toggle them on/off, then click **▶ Apply All** to paint field values into the live 3D chunk grid.

### Scene Components

| Component | Icon | Description | Key Fields |
|---|---|---|---|
| **Downtown Core** | 🏙️ | Dense energy towers, high info, neural activity | E 400–700, I 280, D 0.9 |
| **Park District** | 🌳 | NW quadrant — lush bio, low entropy, cool | Bio 0.7+, S 0.01, T 50 |
| **Industrial Zone** | 🏭 | SE quadrant — max energy, high entropy, metallic | E 650, T 450, S 0.55 |
| **Road Grid** | 🛣️ | Info arteries every 16 units across the world | I 200, D 0.6 |
| **Ocean Layer** | 🌊 | Fills lower Z-levels with water | D 0.85, T 18, S 0.01 |
| **Crystal Ridge** | 💎 | Diagonal vein — ultra-low entropy, high energy | E 680, S 0.004, I 520 |
| **Life Cluster** | 🧬 | 24 random bio blooms with organic energy | Bio 0.7, E 220, I 100 |
| **Storm Front** | ⛈️ | Top strip — turbulent high entropy, kinetic | E 800, T 1200, S 0.95 |
| **Coastal City** | 🌅 | NE urban gradient meeting ocean coast | Mixed urban + water |
| **Mountain Ridge** | 🏔️ | Rocky base with crystal snow caps at altitude | D 0.88, crystal peaks |

**Workflow:**
1. Click **+ Add component...** dropdown — pick a component
2. Enable/disable each component with the ✓/○ toggle
3. × to remove
4. Click **▶ Apply All** — sends paint commands to the 3D chunk worker

Each component also has `apply2D()` for inline 2D simulation buffer compatibility.

---

## 3D Controls Panel

Always visible in the **right panel**. Controls the Three.js renderer in real time:

| Control | What it does |
|---|---|
| Camera buttons (Orbit/Top/ISO/Street/✈ Fly) | Switch camera preset instantly |
| 🌅 Time of day slider (0–24h) | Moves sun, adjusts exposure and fog tint |
| 🌫️ Fog density slider (0–0.06) | Atmospheric density (0 = clear, 0.06 = thick) |
| ✂️ Z-Slice slider (0–63) | Cross-section cutting plane |
| ✨ Particles ON/OFF | Toggle smoke and spark particle layers |

---

## Four Editor Modes

Switch with the top bar buttons: **Create · Science · Cinema · Game Dev**

Each mode loads its own left-panel tools. The simulation keeps running in all modes.

---

### 🎨 Create Mode

The default sandbox — paint matter, tune laws, run scripts, compose worlds.

#### Integral Reality Composer

The World Composer is aligned with the governing formula:

> **𝒓 = ∫ Φ · ρ · E · I · C  dV dτ**

Each step maps directly to one term. All steps have defaults pre-selected so you can click **⚡ Quick Generate** in the top bar to generate instantly, or open the wizard to customize each dimension.

**Quick Generate** (top bar button): generates the world with whatever the composer currently has selected — no wizard required.

**Step-by-step wizard** — click **✦ Compose World**:

1. **Φ Potential** — the fundamental substrate. Sets coupling strength across the entire integrand.

| Archetype | Icon | Character |
|---|---|---|
| Harmonic | ♪ | Ordered, resonant — physics obeys harmonics (default) |
| Chaotic | 🌪️ | Turbulent — laws shift unpredictably |
| Crystalline | 💎 | Ultra-low entropy, near-perfect order |
| Living | 🧬 | Self-organizing vital field — life emerges naturally |
| Void | ⚫ | Sparse, nearly empty reality |
| Resonant | 〜 | Wave-interference dominated — standing patterns form |

2. **ρ·E·I Fields** — density, energy, information balance. Controls the integrand magnitude across dV.

| Balance | Icon | Character |
|---|---|---|
| Balanced | ⚖️ | Even distribution — all fields contribute equally (default) |
| Energy Dominant | ⚡ | Heat and radiation rule |
| Information Dense | 🧠 | Patterns proliferate |
| Mass Dominant | 🪨 | Dense matter — gravity wells, slow diffusion |
| Sparse | ✦ | Low density — information flows freely |
| Pure Info | ∞ | Information dominates — substrate of pure mind |

3. **C Complexity** — emergence rate. Governs how complexity grows, stabilizes, or collapses over process time dτ. Also sets ongoing MetaLaw evolution rate — higher growth = faster law adaptation.

| Mode | Icon | Character |
|---|---|---|
| Emergent | 📈 | Structures self-organize over time (default) |
| Stable | 🌿 | Ecology in homeostasis |
| Explosive | 💥 | Unbounded growth — cascades to collapse |
| Collapsing | 📉 | Entropy wins, structures dissolve |
| Oscillating | 〰️ | Cyclic extinction and rebirth |

4. **dτ·dV Dynamics** — process time and spatial structure. Also wires directly to the simulation **Speed** slider: `timeDil=1.0` → 4× speed (default); `timeDil=0.3` (Slow Time) → 1× speed; faster dynamics run quicker.

| Profile | Icon | timeDil | Spatial noise |
|---|---|---|---|
| Standard | ⚖️ | 1.0 | 1.0 (default) |
| Slow Time | ⏳ | 0.3 | 1.0 |
| Fractal Space | 🔷 | 1.0 | 2.0 |
| High Radiation | ☢️ | 1.0 | 1.0 + radiation hazard |
| Meteor Zone | ☄️ | 1.0 | 1.2 + impact hazards |
| Frozen Topology | ❄️ | 0.5 | 0.5 |

5. **Generate** — shows the integral estimate `≈ Φ · avg(ρ,E,I) · C · dτ` and the final configuration. Click **✦ Generate Reality** (or the footer **Generate →** button).

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

#### Quick Presets

Left panel → Presets section. World chunk presets (3D volumetric grid):

| Preset | Description |
|---|---|
| Energy Burst | Sphere of E=900, T=500, D=0.8 at center |
| Life | 60 random organic clusters across the grid |
| Proto Earth | Sinusoidal density gradient with warm surface |
| 🏙️ Town | Full 128×128×64 city — radial zoning, roads, parks, industry, river |

**Town preset** — realistic city layout on the 3D chunk grid:
- **Downtown** (r < 14): E=700, D=0.9, I=400, T=180
- **Inner city** (14–30): E=400, D=0.75, roads at 16-unit grid
- **Parks** (NW arc): Bio=0.8, low entropy, cool T
- **Industrial** (SE arc): E=600, T=400, S=0.4
- **River**: Water material diagonal strip
- Physics: DIFF=0.12, ENT=0.00015, INFO=0.45, BIO=0.32

**Save / Load worlds:** Use `💾 Save` to download a `.reality` JSON file. Use `📂 Load` to restore a saved file — it snapshots the full buffer state at the saved tick.

**Undo:** `Ctrl+Z` reverts the last paint stroke, preset, or world generation (5-step ring buffer).

---

### 🔬 Science Mode

Full instrumentation. Switch to Science Mode using the top bar.

#### Law Ecosystem

Every active law shows:
- **Fitness slider** (0–1): how strongly this law's output is rewarded
- **Strength slider** (0–1): the magnitude of this law's physical effect
- **Toggle** (colored dot): enable / disable without losing tuned values
- **Color-coded fitness line**: updated on the Law Fitness Chart in real time

#### Node Law Editor

A visual canvas graph editor for composing law pipelines:

- **Nodes** represent physics operations (Diffusion, Entropy, Bio Growth, Info Rate, etc.)
- **Edges** (drag from node port to node port) connect outputs to inputs
- **Compile** applies the pipeline to the chunk worker's physics parameters
- **Shortcuts**: Delete/Backspace removes selected node; Escape cancels; double-click node header toggles active; double-click body edits a parameter; right-click an edge removes it
- **Property panel**: click a node to see sliders for all numeric parameters inline below the canvas

**🏙️ Town Physics button** — snaps physics to realistic city parameters: DIFF=0.12, ENT=0.00015, INFO=0.45, BIO=0.32, processes: thermo+bio+info.

#### Physics Parameters (fine control)

| Param | Range | Effect |
|---|---|---|
| `DIFF` — Diffusion | 0.01–0.3 | Speed energy spreads to neighbors |
| `ENT` — Entropy base | 0.00001–0.003 | Baseline disorder growth per tick |
| `INFO` — Info growth | 0.05–2.0 | Rate information forms in fertile zones |
| `BIO` — Bio threshold | 0.05–0.8 | Min density for bio potential to rise |

#### Reality Monitor

Live ΨR integral chart below the node editor. Shows 4 running series:
- **Energy** (orange), **Entropy** (red), **Info** (cyan), **Bio** (green)
- Scrolls rightward as ticks accumulate

#### Scientific Solvers Panel

Science Mode has a **Scientific Solvers** section that connects to external PDE solvers:

| Simulation | Solver | Writes To |
|---|---|---|
| Turing Patterns | NumPy (built-in) | Info + Bio |
| Wave Propagation | NumPy (built-in) | Energy |
| Heat Diffusion | NumPy / FEniCSx | Temp |
| Fluid Flow (Stokes) | NumPy / FEniCSx | Flow X/Y |
| Thermal Convection | NumPy | Temp + Flow |
| Phase Separation | NumPy / MOOSE | Density |
| Electric Potential | NumPy / FEniCSx | Info |
| Entropy Production | NumPy (built-in) | Entropy |
| Molecular Dynamics | NumPy / GROMACS | Energy + Density |
| Coupled Heat+Flow | NumPy / Elmer | Temp + Flow |
| Magnetostatics | NumPy / Elmer | Info |
| Protein CG Dynamics | NumPy / GROMACS | Bio + Info |

#### Data Export

| Button | Output | Use With |
|---|---|---|
| 📄 Metrics CSV | Time-series of all fields | `pandas.read_csv()`, R, Excel |
| 📓 Jupyter Notebook | `.ipynb` with 4 pre-written cells | Jupyter Lab — plots + correlation matrix |
| 🗂️ Recording JSON | Sparse keyframes (`reality_engine_scientific_v2`) | Custom analysis, replay |
| 💾 Save .reality | Full world state | Re-load in Create Mode |

---

### 🎬 Cinema Mode

AI-directed cinematics with Scene Composer, timeline recording, and video export.

#### 🎬 Scene Composer

Drag-and-drop scene builder — each component auto-configures field values and materials across the 3D chunk grid. Components can be layered: add Downtown Core + Park District + Ocean Layer for a realistic coastal city.

See **[Scene Composer](#scene-composer-cinema-mode)** section above for full component list.

#### AI Scene Director

The left panel has a chat log and input field.

**To use:**
1. Type a cinematic direction — see built-in keywords below, or anything descriptive
2. Click **Ask** (or press Enter)
3. The director responds with vivid narration and **immediately applies** the effect to the simulation
4. The generated script remains visible — click **▶ Execute director script** to re-apply it
5. Click **🎙️ Narrate** to describe the current simulation state without a prompt
6. Click **Auto: ON** to enable auto-directing (~28 second intervals)

**Built-in scene keywords (no API key needed):**

| Keyword | Scene Applied |
|---|---|
| `volcano`, `lava`, `erupt`, `fire` | Volcanic energy eruption from center — radial energy + entropy burst |
| `explosion`, `burst`, `blast`, `shock` | Full-field shockwave — scattered energy and maximum entropy |
| `ocean`, `water`, `wave`, `flood` | Lower-field ocean — steady energy, near-zero entropy, rising info |
| `life`, `bio`, `forest`, `grow`, `nature` | Bio bloom — 35 scattered nodes of life energy and information |
| `freeze`, `ice`, `cold`, `winter`, `snow` | Glacial collapse — drains 85% energy and 95% entropy field-wide |
| `chaos`, `storm`, `entropy`, `disorder` | Entropy storm — 45 random high-entropy energy bursts across grid |
| `order`, `crystal`, `calm`, `harmony` | Crystalline order — entropy drops to 8%, information rises |
| `desert`, `arid`, `dry`, `sand` | Desert — low uniform energy, zero bio, near-zero entropy |
| `city`, `urban`, `civilization`, `town` | City rising — 30 high-energy info+bio nodes across the grid |
| `space`, `void`, `cosmos`, `galaxy` | Cosmic void — clears energy, leaves 8 stellar hotspots |
| `energy`, `power`, `surge`, `boost` | Energy surge — 20 high-power nodes ignite across the field |

> **With a Claude API key** (set via 🔑), the director generates fully custom narration, scripts, and camera hints for any prompt. Without a key, the built-in keyword engine handles all 11 scenarios above and provides a generic fallback for unrecognized prompts.

#### Timeline

A 3-track NLA-style canvas (SIM / CAM / MRK tracks). Click **⬡ Sim KF** to snapshot, **📍 Marker** to add a labeled event. Click the timeline canvas to scrub to any tick.

#### Recording

Click **● Record** → run simulation → **■ Stop** → download:
- 🗂️ **Alembic recording (.json)** — full sparse keyframe archive
- 💬 **Markers as subtitles (.srt)** — for video editing software
- 🖼️ **Export frame PNG** — single frame at current tick

---

### 🤖 Agents Mode

Accessed via the robot icon in the left icon bar. Agents are autonomous entities with Utility AI + FSM + genome-based evolution.

#### Agent Architecture

| Component | Role |
|---|---|
| **Utility AI** | Each tick, score 5 candidate moves (N/S/E/W/stay) by weighted field values |
| **FSM states** | `seek_energy`, `seek_info`, `flee_entropy`, `explore`, `reproduce`, `rest`, `idle` |
| **Genome** | Weight vector (seekEnergyW, seekInfoW, fleeEntropyW, bioW, exploreW, reprodThresh, maxAge) |
| **Memory ring** | 48-cell visited-cell history prevents circling |

#### LLM Planning (Claude Haiku)

| Button | Pattern | What It Does |
|---|---|---|
| **🧠 Group Plan** | LangChain-style chain | Asks Claude for one collective survival goal |
| **⚔️ Debate** | AutoGen two-agent | Strategist + Tactician debate; Claude writes consensus |
| **👥 Assign CrewAI Roles** | CrewAI role delegation | Assigns roles: Scout · Harvester · Guardian · Architect · Breeder |

---

### 🎮 Game Dev Mode

Turn any simulation into a scored game with objectives, entity behaviors, prefabs, and AI design assistance.

#### AI Game Designer

Ask the AI Game Designer for design advice — type any request and click **Ask**:

| Message type | What you get |
|---|---|
| *"Design a survival level"* | Full survival ruleset with entropy + tick objectives — **Apply ruleset** button appears |
| *"Create a civilization challenge"* | Info network + population objectives applied |
| *"Suggest an ecosystem level"* | Bio potential + survival objectives applied |
| *"How do I fight entropy?"* | Conversational strategy tip — no ruleset applied |
| *"Give me civilization advice"* | Tactical guidance on info/agent balance |
| Any message without "design/create/challenge/objective" | Conversational response without applying anything |

> The **Apply ruleset** button only appears when you explicitly ask for a level, challenge, or objectives — not on every message. **💡 Suggest** pre-fills the input with a context-aware suggestion and sends it automatically.

#### Playtest Presets

| Preset | Description |
|---|---|
| ⚔️ Survival | Keep entropy low for 500 ticks |
| 🌿 Ecosystem | Grow bio potential above threshold |
| 🏛️ Civilization | Spawn 10 agents + build info network |
| 🏙️ Town | 5-objective city challenge: survive 1000 ticks, grow parks, reduce entropy, high info, spawn 25 citizens |
| ✏️ Custom | Blank slate |

#### Objectives

| Objective | Win Condition |
|---|---|
| ⏱ Survive 500 ticks | Run 500 ticks without losing all lives |
| 🏅 City milestone 1000 | Reach tick 1000 |
| 🧬 Reach bio > 0.5 | Average bio potential exceeds 0.5 |
| 🌳 Bio flourish > 0.7 | Bio exceeds 0.7 |
| 🤖 Spawn 10 agents | 10+ agents simultaneously |
| 👥 Spawn 25 citizens | 25+ agents simultaneously |
| 🌀 Entropy < 0.2 | Average entropy drops below 0.2 |
| 🏗️ City entropy < 0.12 | Entropy drops below 0.12 |
| 🧠 Info avg > 100 | Average information exceeds 100 |
| 📡 Info grid > 300 | Average information exceeds 300 |

#### Entity Behaviors (FSM Editor)

Visual 7-state FSM canvas. Presets: 🦅 Predator · 🔭 Explorer · 🛡️ Survivor.

#### Prefab Library

Capture a cluster → stamp it anywhere. Built-ins: Life Bloom, Energy Source, Crystal Node.

#### Level Export

| Button | Output |
|---|---|
| **💾 Export level (.level.json)** | Objectives, rules, lives, time limit |
| **🌍 Export world (.reality)** | Full simulation state |
| **🔗 Copy shareable link** | URL hash encoding current objectives |

---

## Render Modes

The four tabs at the top of the viewport:

| Tab | What You See |
|---|---|
| **🔲 3D Volumetric** | Three.js PBR renderer — 10 material types, particles, atmosphere |
| **⬛ 2D Multi-Slice** | Four-quadrant view: Energy, Bio, Info, Entropy simultaneously |
| **⟐ Hybrid** | Left: 4-field 2D overview (Energy/Bio/Info/Entropy) · Right: 3D PBR |
| **📈 Metrics** | Live numerical dashboard |

---

## Architecture

```
index.html          ← Inline sim (W=36×H=28×NF=12) + World Composer + all UI
                      Two-canvas viewport: #c2d (2D) + #c3d (Three.js PBR)

src/connector.ts    ← Module bridge — all TS classes exposed on window.*
                      RAF loop with dt, SceneComposer injection on cinema panel
                      window.setMatMode / setTimeOfDay / setFogDensity /
                       setCameraPreset / setZSlice / setShowParticles /
                       addSceneComp / applyScene / clearScene / toggleComp

src/
  core/
    ChunkGrid.ts           Sparse 128×128×64 grid, 8×8×8 chunks, Map<key,Float32Array>
    ChunkSimWorker.ts      Web Worker — iterates only active chunks, zero-copy ArrayBuffer
  render/
    ChunkRenderer.ts       Three.js PBR — 9 InstancedMesh (one per MatType), custom
                           emissive GLSL shader, 1600 particles, OrbitControls,
                           fly camera, time-of-day sun arc, FogExp2, ACES tonemapping
    VoxelMaterials.ts      classifyVoxel() → MatType, getMat(), blendEnergyGlow(),
                           LAYER_PALS (6 color ramps), lerpPalette()
  scientific/
    MetricsAPI.ts          9 ring-buffered metrics (2000 pts each)
    LawFitnessChart.ts     Canvas chart, per-law fitness over time
    CausalInspector.ts     Per-cell causal explanation
    SolverClient.ts        HTTP client for Python microservice solvers
  simulation/
    DeterministicEngine.ts XORshift32 RNG, sparse frame recording, multi-format export
  modes/
    ScienceModePanel.ts    HTML builder for science mode left panel
    GameDevModePanel.ts    HTML builder for game dev mode left panel (6 sections)
    cinema/
      SceneComposer.ts     10 scene components — apply2D() + chunkPaints()
                           SceneComposerUI — add/remove/toggle/applyAll/buildHTML
      KeyframeTimeline.ts  3-track NLA canvas (SIM/CAM/MRK), scrubable playhead
      CameraPathEditor.ts  Cubic-eased spline camera path
      SceneDirector.ts     Claude API (Haiku) — narration + script + camera hint
      VideoRecorder.ts     WebCodecs VideoEncoder (VP8) + PNG fallback
    gamedev/
      EntityBehaviorEditor.ts  7-state BehaviorFSM visual editor + genome compiler
      GameRulesetEngine.ts     Score/lives/objectives engine (10 objective types)
      PrefabSystem.ts          Capture → library → stamp anywhere
      AIGameDesigner.ts        Claude API (Haiku) — game mechanic design + JSON rulesets
    agents/
      AgentSystem.ts       Utility AI + FSM + genome-based agents
      AgentPlanner.ts      LLM goal planner (LangChain/CrewAI/AutoGen patterns)
  ui/
    RealityMonitor.ts      ΨR integral + 4 live field charts
    NodeLawEditor.ts       Canvas node graph editor — compile to chunk worker params
solver/              Python FastAPI microservice (localhost:8765)
```

### Field Layout (NF=14 — Chunk Grid)

| Index | Name | Description | Range |
|---|---|---|---|
| 0 | `E` — Energy | Heat / kinetic energy | 0 – 9999 |
| 1 | `D` — Density | Matter concentration | 0 – 1 |
| 2 | `I` — Information | Complexity / emergent signal | 0 – 999 |
| 3 | `S` — Entropy | Disorder / decay | 0 – 1 |
| 4 | `T` — Temperature | Thermal energy | 0 – 2000 |
| 5 | `P` — Pressure | Local pressure | 0 – ∞ |
| 6 | `FX` — Flow X | Fluid / force X vector | –500 – 500 |
| 7 | `FY` — Flow Y | Fluid / force Y vector | –500 – 500 |
| 8 | `TAU` — Time dilation | Local time rate | 0 – ∞ |
| 9 | `CID` — Causality ID | Causal event ID | int |
| 10 | `BIO` — Bio potential | Life readiness | 0 – 1 |
| 11 | `MAT` — Material ID | Material type index | int |
| 12 | `WAVE` — Wave amplitude | Wave field | 0 – 1 |
| 13 | `PROC` — Process activity | Active process flags | int |

The inline 2D simulation uses NF=12 (no MAT/WAVE fields). The 3D chunk grid uses NF=14.

---

## Physics Engine (Chunk Worker)

Each tick applies across all active 8×8×8 chunks:

1. **Laplacian diffusion** — E, T, D, I each spread to 6 face-neighbors (cubic lattice)
2. **Thermodynamics** — E drives T up; controlled by `DIFF`
3. **Entropy growth** — `dS = (ENT + E×4e-5 + T×1.5e-5) × dt × 60`
4. **Energy drain** — `E -= E × S × 2e-4 × dt × 60`
5. **Info growth** — rises when E > 80, D > BIO threshold, S < 0.9
6. **Bio emergence** — `BIO` rises when E + D + sup > 0; decays otherwise
7. **Time dilation** — `TAU += dt × (1 + E×0.0008 + S×0.2)`
8. **Causal logging** — |ΔE| > 55 per tick → causal event logged
9. **Chunk pruning** — every 100 ticks removes empty chunks

---

## MetaLaw System

Laws are first-class objects:

```js
{ name, type, active, fitness, strength, color, desc }
```

| Law | Controls |
|---|---|
| Energy Diffusion | `DIFFUSION` constant |
| Entropy Growth | `ENTROPY_BASE` constant |
| Info Bloom | `INFO_RATE` constant |
| Bio Emergence | `BIO_THRESH` constant |
| Thermal Coupling | Temperature coupling strength |
| Causal Threshold | Min ΔE to log a causal event |
| Density Gravity | Density diffusion rate |
| Neural Plasticity | Agent learning rate |

---

## Console API

```js
// 3D renderer
window.setMatMode('field' | 'material' | 'height')
window.setTimeOfDay(12)            // 0–24h
window.setFogDensity(0.02)         // 0–0.06
window.setCameraPreset('orbit' | 'top' | 'iso' | 'street' | 'fly')
window.setZSlice(32)               // 0–63, 63 = show all
window.setShowParticles(false)

// Scene Composer
window.addSceneComp('downtown')    // adds a component
window.toggleComp('park')          // enable/disable
window.removeComp('storm')         // remove
window.applyScene()                // paint all enabled components to chunk grid
window.clearScene()                // remove all active components

// Chunk worker
window.applyChunkPreset('town')    // load 3D town layout
window.tickChunkWorker(playing, speed)

// Science metrics
window.metrics.snapshot()          // all fields, latest value
window.metrics.exportCSV()
window.scienceMode.exportCSV()
window.scienceMode.exportJupyter()

// Agents
window.spawnAgents(20)
window.requestAgentPlan()          // LLM group plan
window.debateAgentPlan()           // AutoGen debate
window.assignAgentRoles()          // CrewAI roles

// Debug
window.buf          // Float32Array — inline 2D sim buffer
window.W, window.H  // 36 × 28
window.tick         // current simulation tick
```

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `?` or `/` | Show keyboard shortcuts overlay |
| `Escape` | Close any modal or overlay |
| `Space` | Play / Pause simulation |
| `1`–`6` | Select field (Energy / Density / Info / Entropy / Temp / Bio) |
| `Ctrl+S` | Save world (.reality) |
| `Ctrl+Z` | Undo last paint / preset (5-step ring) |
| `Delete` / `Backspace` | Remove selected node in Node Law Editor |
| Click + Drag | Paint / brush on canvas |
| Click (Inspect tool) | Select cell → causal breakdown in right panel |

---

## Troubleshooting

### 3D view blank after mode switch
Switching modes used to call `canvas.width = w` which resets the WebGL context. Fixed — resize now calls `renderer.setSize()` correctly.

### 3D view frozen when simulation is paused
Previously the render call was gated on `playing === true`. Fixed — an unconditional `requestAnimationFrame` RAF loop always runs, independent of the simulation.

### Scientific Solvers panel not visible in Science Mode
The panel is injected dynamically when the `panelRendered` event fires. Hard-refresh (Ctrl+Shift+R) → click **Science**.

### Scene Composer not visible in Cinema Mode
Same dynamic injection. Click **Cinema** mode — the panel appears at the bottom of the left sidebar.

### Microservice offline (status dot red)
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

---

## Data Export Reference

| Format | Function | Use With |
|---|---|---|
| **Metrics CSV** | `scienceMode.exportCSV()` | `pandas.read_csv()`, R, Excel |
| **Jupyter .ipynb** | `scienceMode.exportJupyter()` | Jupyter Lab — 4 cells: plots, correlation, complexity |
| **Recording JSON** | `scienceMode.exportJSON()` | Sparse keyframes, `reality_engine_scientific_v2` |
| **Alembic .json** | `cinemaMode.exportAlembic()` | Per-keyframe cell archive, `reality_engine_alembic_v1` |
| **SRT subtitles** | `cinemaMode.exportSRT()` | Timeline markers → video editor subtitles |
| **Level JSON** | `gamedevMode.exportLevel()` | Objectives + rules, `reality_engine_level_v1` |
| **World .reality** | `saveWorld()` | Full sparse world state |

---

## License

MIT — see [LICENSE](LICENSE).

---

*Built with [Claude Code](https://claude.ai/claude-code) by Anthropic.*
