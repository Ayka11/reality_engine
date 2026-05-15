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

---

## What Is This

Reality Engine is an **interactive physics sandbox** where the rules of physics are themselves simulated objects — they compete, mutate, and go extinct. You paint energy and matter onto a voxel grid. Thermodynamics, chemistry, geology, and life emerge from first principles. The laws governing them evolve in real time through a **MetaLaw system**: each law has fitness, strength, and mutation rate. Laws that produce complexity survive. Laws that produce chaos go dormant.

**This is not a game about matter. It is a game about the rules that govern matter.**

---

## Who It's For

| Audience | Why |
|---|---|
| **Game developers** | Emergent systems, procedural world simulation reference |
| **Researchers** | Toy model for self-organization, information physics, causal chains |
| **Students** | Visual, interactive thermodynamics and complexity theory |
| **Filmmakers / artists** | AI-directed cinematics, keyframe timeline, video export |
| **Curious people** | Press a preset, press play, watch a universe be born |

---

## Quick Start

```bash
git clone https://github.com/Ayka11/reality_engine.git
cd reality_engine
npm install
npm run dev
# → http://localhost:5173
```

---

## Four Modes

The top bar switches between four fully independent modes. Each mode shows its own left-panel tools.

### Create Mode
The default sandbox. Paint energy, density, temperature, entropy, information, and bio-potential directly onto the grid using brushes. Use the **World Composer Wizard** to procedurally generate a world from archetypes.

- **Brushes**: Energy Burst, Heat Source, Crystal Seed, Life Spark, Entropy Vortex, Information Node, Gravity Well, Void Eraser, and more
- **Script Console**: Run JavaScript directly against the simulation buffer (`set_(x, y, field, value)`)
- **Law Panel**: Toggle and tune each physical law independently — fitness and strength sliders per law
- **Presets**: Proto Earth, Ocean World, Life Explosion, Galaxy Spiral, Volcanic

### Science Mode
Full scientific instrumentation for the simulation.

- **Law Ecosystem**: Per-law fitness + strength sliders, editable fitness expressions, generation counter. Auto-evolves every 500 ticks.
- **Physics Parameters**: Direct control of DIFF (diffusion), ENT (entropy base), INFO (information growth), BIO (bio threshold) with 5-decimal precision
- **Active Processes**: Toggle thermodynamics, biology, information, geology, and emergence independently
- **Deterministic Replay**: Seeded RNG (XORshift32) — same seed = identical simulation every time. Record frames, stop, replay.
- **MetricsAPI** (browser console): `window.metrics.get('entropy', 'avg', 200)` — queryable time-series for all 9 metrics
- **Law Fitness Chart**: Real-time canvas plot of each law's fitness over time
- **Data Export**:
  - 📄 Metrics CSV → pandas / R
  - 📓 Jupyter Notebook (.ipynb) with ready Python plots and correlation analysis
  - 🗂️ Recording JSON (sparse keyframes, format `reality_engine_scientific_v2`)
  - 🕸️ Causal Graph (.graphml) → Gephi-compatible

### Cinema Mode
AI-directed cinematics with keyframe timeline and video recording.

- **AI Scene Director** (Claude API): Type a cinematic prompt → get narration, an executable sim script, a camera position hint, and a timeline marker label. Auto-directing mode fires every ~28 seconds.
- **3-Track Timeline Canvas** (SIM / CAM / MRK): NLA-style scrubable playhead, diamond keyframes, marker blocks. Click to scrub.
- **Camera Path Editor**: Cubic-eased spline interpolation between keyframes. Applies `window.cinemaCamera` each tick for renderer use.
- **Video Recording**: WebCodecs `VideoEncoder` (VP8) with PNG frame fallback.
- **Render Settings**: Brightness and saturation boost sliders.
- **Export**:
  - 🗂️ Alembic-style recording (.json, format `reality_engine_alembic_v1`)
  - 💬 Markers as SRT subtitles (.srt) for video editors
  - 🖼️ Single-frame PNG export

### Game Dev Mode
Turn the simulation into a scoring game with a visual rule engine.

- **Agent Spawner**: Spawn biological agents at configurable mutation rates
- **Ruleset Editor**: Visual rule list with condition → action pairs. Conditions: `field_above/below`, `agent_count_above/below`, `tick_interval`, `event_spike`. Actions: `award_points`, `deduct_points`, `spawn_agents`, `end_game`, `set_field_global`. Cooldown timers prevent rule spam.
- **Playtest Log**: Live event log showing rule firings and score changes
- **Export**: Save ruleset as JSON for loading into other worlds

---

## Architecture

```
index.html          ← Self-contained voxel simulation (W=36 × H=28 × NF=12 fields)
                      Inline <script> runs the physics loop, render loop, UI panels
src/connector.ts    ← Module bridge: imports TS classes, exposes on window.*
                      Listens to 'panelRendered' events to init canvases after panel injection
src/
  scientific/
    MetricsAPI.ts         9 ring-buffered metrics (2000 pts), queryable from console
    LawFitnessChart.ts    Canvas chart, one line per law over time
    CausalInspector.ts    Per-cell causal explanation (causes, processes, recommendations, prediction)
  simulation/
    DeterministicEngine.ts  XORshift32 RNG, sparse frame recording, CSV/JSON/Jupyter/GraphML export
  modes/
    ScienceModePanel.ts     HTML builder for science mode left panel
    ModeConfig.ts           Per-mode panel/render configuration
    cinema/
      KeyframeTimeline.ts   3-track NLA canvas, scrubable playhead, SRT export
      CameraPathEditor.ts   Cubic-eased spline camera path
      SceneDirector.ts      Claude API (Haiku) — narration + script + camera hint
      VideoRecorder.ts      WebCodecs VideoEncoder + PNG fallback
    gamedev/
      RulesetEditor.ts      RulesetEngine with condition/action rule DSL
  composer/
    archetypes.ts           WorldArchetype definitions (10 world types)
    semanticMapper.ts       Maps semantic styles to physics parameter deltas
  core/
    SimWorker.ts            Web Worker simulation (W=32 × H=24 × D=10 × NF=14), Transferable buffer
  ui/
    UXIntegration.ts        Mode system, render mode switch, semantic sliders
```

### Field Layout (NF=12, inline sim)

| Index | Field | Description |
|---|---|---|
| 0 | Energy | Heat / kinetic energy |
| 1 | Density | Matter concentration |
| 2 | Information | Complexity / signal |
| 3 | Entropy | Disorder |
| 4 | Temperature | Thermal energy |
| 5 | Pressure | Local pressure |
| 6–7 | FX, FY | Force vectors |
| 8 | TAU | Local time dilation |
| 9 | CID | Civilization ID |
| 10 | BIO | Bio potential |
| 11 | PROC | Process flags |

---

## Physics

Each simulation tick applies:

1. **Diffusion** — energy spreads to 4 neighbours weighted by `DIFFUSION` constant
2. **Entropy** — all cells accumulate entropy scaled by energy and temperature
3. **Temperature coupling** — energy → temperature with feedback loop
4. **Information growth** — when energy > threshold and density > threshold, information grows at `INFO_RATE`
5. **Bio emergence** — when energy, density, information all exceed thresholds with low entropy, bio potential rises
6. **Law evaluation** — each active MetaLaw re-weights its target field every tick
7. **Agent simulation** — agents sense field gradients, move toward food, reproduce when energy is high

---

## MetaLaw System

Laws are first-class objects with:

```js
{ name, type, active, fitness, strength, color, desc, fitness_expr }
```

Built-in laws: Energy Diffusion, Entropy Growth, Info Bloom, Bio Emergence, Gravity Well, Crystal Formation, Chaos Engine, Neural Cascade.

Laws evolve every 500 ticks: low-fitness laws weaken, high-fitness laws strengthen. Add custom laws with arbitrary fitness expressions evaluated against live field averages (`bio`, `info`, `entropy`, `energy`).

---

## Console API (Science Mode)

Open browser DevTools and use `window.metrics` directly:

```js
// Metrics
window.metrics.get('entropy', 'avg', 200)   // average entropy over last 200 samples
window.metrics.get('bio', 'max', 100)        // peak bio potential
window.metrics.getSeries('energy', 500)      // raw number[] array
window.metrics.snapshot()                    // latest value for all 9 metrics
window.metrics.exportCSV()                   // CSV string

// Causal inspector
window.scienceMode.explainCell(x, y, buf)    // HTML with full causal breakdown

// Science exports
window.scienceMode.exportCSV()
window.scienceMode.exportJupyter()
window.scienceMode.exportJSON()

// Cinema
window.cinemaMode.addSimKF()                 // capture current state as keyframe
window.cinemaMode.addMarker()                // add timeline marker at current tick

// Direct buffer access
window.buf          // Float32Array — the live simulation buffer
window.W, H, NF     // grid dimensions
window.tick         // current simulation tick
```

---

## World Composer Wizard

Click **✦ Compose World** to open the step-by-step wizard:

1. **World Type** — 8 archetypes (Dead Moon, Ocean World, Fungal Planet, Crystal Universe, Entropy Collapse, Proto Earth, Neural Biosphere, Post-Human Ruins)
2. **Physics Mood** — 7 presets (Balanced, High Gravity, Slow Time, Hyper Diffusion, Information Dominant, Chaotic Laws, Low Entropy)
3. **Evolution Goal** — sets agent spawn count and win condition hint
4. **Hazards** — Meteor Showers, Solar Storms, Acid Rain, Tectonic Rifts, High Radiation
5. **Generate** — applies all selected parameters and spawns initial state

---

## Data Export Formats

| Format | How to use |
|---|---|
| **Metrics CSV** | `pandas.read_csv()`, R, Excel |
| **Jupyter .ipynb** | Open in Jupyter Lab — 4 cells with plots, correlation matrix, complexity analysis |
| **Recording JSON** | Full sparse keyframe recording, format `reality_engine_scientific_v2` |
| **Causal Graph .graphml** | Open in [Gephi](https://gephi.org/) for causal network visualization |
| **Alembic .json** | Sparse cell archive per keyframe, format `reality_engine_alembic_v1` |
| **Subtitles .srt** | Cinema timeline markers as SRT subtitles for video editors |
| **World .reality** | Full world save — sparse cell array with all field values |

---

## Deterministic Replay

Set a **seed** (0–99999) in Science Mode → Deterministic Replay. Any simulation started with the same seed and parameters produces an identical run. Uses XORshift32:

```
x ^= x << 13;  x ^= x >> 17;  x ^= x << 5
```

Click **● Record** to start capturing sparse keyframes (only non-zero cells stored). **■ Stop** finalizes and allows export.

---

## Causal Inspector

Click any cell to open a full causal explanation:

- **Fields** — all 7 key field values with color-coded levels (low / medium / high / critical)
- **Causes** — why each field is at its current value (directional neighbor gradient analysis)
- **Active Processes** — what is actively happening in this cell right now
- **Recommendations** — concrete actions to improve bio potential or reduce entropy
- **Prediction** — near-term forecast (collapse, emergence, stability)
- **Stability** — stable / unstable / critical

---

## Tech Stack

| Layer | Technology |
|---|---|
| Simulation | Vanilla JS (inline), Float32Array voxel grid |
| TypeScript modules | Vite 5, TypeScript 5, ES modules |
| Web Worker sim | `src/core/SimWorker.ts` — zero-copy Transferable buffer |
| Rendering | Canvas 2D (inline) |
| Video recording | WebCodecs `VideoEncoder` (VP8) + PNG fallback |
| AI Director | Anthropic Claude API (claude-haiku-4-5) |
| Build | Vite with manual Three.js chunk splitting |
| Deploy | Netlify (COOP/COEP headers for SharedArrayBuffer) |

---

## Development

```bash
npm run dev      # Vite dev server with HMR
npm run build    # Production build → dist/
npm run preview  # Preview production build
npx tsc --noEmit # Type check
```

---

## Project Structure

```
reality/
├── index.html              # Main app — self-contained simulation + UI
├── src/
│   ├── connector.ts         # Module bridge → window.scienceMode / cinemaMode / gamedevMode
│   ├── main.ts              # UX system entry point
│   ├── scientific/
│   │   ├── MetricsAPI.ts
│   │   ├── LawFitnessChart.ts
│   │   └── CausalInspector.ts
│   ├── simulation/
│   │   └── DeterministicEngine.ts
│   ├── core/
│   │   └── SimWorker.ts
│   ├── modes/
│   │   ├── ModeConfig.ts
│   │   ├── ScienceModePanel.ts
│   │   ├── cinema/
│   │   │   ├── KeyframeTimeline.ts
│   │   │   ├── CameraPathEditor.ts
│   │   │   ├── SceneDirector.ts
│   │   │   └── VideoRecorder.ts
│   │   └── gamedev/
│   │       └── RulesetEditor.ts
│   ├── composer/
│   │   ├── archetypes.ts
│   │   └── semanticMapper.ts
│   └── ui/
│       └── UXIntegration.ts
├── vite.config.ts
├── tsconfig.json
└── netlify.toml            # COOP/COEP headers for SharedArrayBuffer
```

---

## License

MIT — see [LICENSE](LICENSE).

---

*Built with [Claude Code](https://claude.ai/claude-code) by Anthropic.*
