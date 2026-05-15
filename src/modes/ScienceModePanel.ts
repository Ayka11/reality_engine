/**
 * ScienceModePanel — HTML builder for the Science Mode left sidebar.
 *
 * Sections:
 *   1. Meta-Law Ecosystem  (fitness + strength sliders per law, toggles, expr editor)
 *   2. Physics Parameters  (raw DIFF / ENT / INFO / BIO with 5-decimal precision)
 *   3. Active Processes    (thermo / bio / info / geo / emerge toggles)
 *   4. Deterministic Replay (seed, record/stop, frame counter)
 *   5. Data Export         (CSV, JSON, Jupyter, GraphML, .reality)
 *   6. Law Fitness Chart   (canvas placeholder — drawn by LawFitnessChart.draw())
 *
 * Usage:
 *   const html = buildScienceModePanel(laws, activeProcs, simParams)
 *   panelEl.innerHTML = html
 *   // then call bindSciencePanelHandlers(panelEl, ...) to wire events
 */

export interface LawEntry {
  nm:           string
  on:           boolean
  fit:          number   // 0–1
  str:          number   // 0–1
  col:          string   // hex
  tp:           string   // law type label
  desc:         string
  gen:          number   // current generation
  fitness_expr: string   // editable expression
}

export interface SimParams {
  DIFF: number
  ENT:  number
  INFO: number
  BIO:  number
}

// ── HTML builder ──────────────────────────────────────────────────────────────

export function buildScienceModePanel(
  laws:        LawEntry[],
  activeProcs: Set<string>,
  simParams:   SimParams,
): string {
  return `
<!-- SECTION 1: Meta-Law Ecosystem -->
<div class="sec sci-sec">
  <div class="sechdr" onclick="toggleSec(this)">
    <span>Meta-Law Ecosystem</span>
    <div style="display:flex;align-items:center;gap:6px">
      <span style="font-size:9px;color:var(--ok)">gen:${laws[0]?.gen ?? 0}</span>
      <span class="sarr">▾</span>
    </div>
  </div>
  <div class="secbody">
    <div style="font-size:9px;color:var(--sub);margin-bottom:5px">
      Laws sorted by fitness. Toggle + tune each independently.
      Auto-evolves every 500 ticks.
    </div>
    ${laws.map((l, i) => `
    <div class="lrow sci-law" data-law-idx="${i}" style="flex-direction:column;gap:4px">
      <div style="display:flex;align-items:center;gap:5px">
        <div class="ldot" style="background:${l.col};opacity:${l.on ? 1 : 0.35}"></div>
        <div style="flex:1">
          <div style="font-size:10px;color:${l.on ? '#ccc' : 'var(--sub)'};">${l.nm}</div>
          <div style="font-size:8px;color:var(--sub)">${l.tp} · ${l.desc}</div>
        </div>
        <button class="ltog" style="background:${l.on ? l.col : '#2a2a38'};width:14px;height:14px;border-radius:3px;border:none;cursor:pointer"
          onclick="toggleLaw(${i})"></button>
        <span style="font-size:9px;font-family:monospace;color:${l.on ? l.col : '#444'};min-width:26px;text-align:right">
          ${(l.fit * 100).toFixed(0)}%
        </span>
      </div>
      ${l.on ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:0 4px">
        <div>
          <div style="font-size:8px;color:var(--sub)">Fitness</div>
          <input type="range" min="0" max="1" step="0.01" value="${l.fit.toFixed(2)}"
            style="width:100%;height:2px;accent-color:${l.col}"
            oninput="setLawFitness(${i}, +this.value)">
        </div>
        <div>
          <div style="font-size:8px;color:var(--sub)">Strength</div>
          <input type="range" min="0" max="1" step="0.01" value="${Math.min(l.str, 1).toFixed(2)}"
            style="width:100%;height:2px;accent-color:${l.col}"
            oninput="setLawStrength(${i}, +this.value)">
        </div>
      </div>
      <div style="font-size:8px;font-family:monospace;color:#555;padding:0 4px">
        expr:&nbsp;<span contenteditable="true" spellcheck="false"
          style="color:#a09af0;outline:none;border-bottom:1px dashed #333"
          onblur="setLawExpr(${i}, this.textContent ?? '')">${l.fitness_expr}</span>
      </div>` : ''}
    </div>`).join('')}
    <div style="display:flex;gap:4px;margin-top:6px">
      <button onclick="addCustomLaw()"    class="bb" style="flex:1">+ Add law</button>
      <button onclick="resetLawFitness()" class="bb" style="flex:1">↺ Reset</button>
    </div>
  </div>
</div>

<!-- SECTION 2: Raw Physics Parameters -->
<div class="sec sci-sec">
  <div class="sechdr" onclick="toggleSec(this)"><span>Physics Parameters</span><span class="sarr">▾</span></div>
  <div class="secbody">
    <div style="font-size:9px;color:var(--sub);margin-bottom:6px">
      Direct parameter control. Changes apply immediately to the simulation.
    </div>
    ${([
      ['Diffusion rate',  'DIFF', simParams.DIFF,  0.001,   0.4,    0.001,   5],
      ['Entropy base',    'ENT',  simParams.ENT,   0.00001, 0.005,  0.00001, 6],
      ['Info growth',     'INFO', simParams.INFO,  0.01,    3.0,    0.01,    3],
      ['Bio threshold',   'BIO',  simParams.BIO,   0.01,    1.0,    0.01,    3],
    ] as [string, string, number, number, number, number, number][]).map(
      ([label, key, val, min, max, step, decimals]) => `
      <div class="crow">
        <span class="clbl" style="font-size:9px;flex:1">${label}</span>
        <input type="range" min="${min}" max="${max}" step="${step}" value="${val}"
          style="width:60px"
          oninput="setParam('${key}',+this.value);document.getElementById('p_${key}').textContent=(+this.value).toFixed(${decimals})">
        <span class="cval" id="p_${key}" style="font-size:9px;font-family:monospace;min-width:58px;text-align:right">
          ${val.toFixed(decimals)}
        </span>
      </div>`).join('')}
  </div>
</div>

<!-- SECTION 3: Active Processes -->
<div class="sec sci-sec">
  <div class="sechdr" onclick="toggleSec(this)"><span>Active Processes</span><span class="sarr">▾</span></div>
  <div class="secbody">
    ${([
      ['thermo', 'Thermodynamics', 'Energy diffusion, heat coupling, density gravity'],
      ['bio',    'Biology',        'Bio potential, information growth, life emergence'],
      ['info',   'Information',    'Signal propagation, info decay, memory fields'],
      ['geo',    'Geology',        'Density settling, erosion, tectonic activity'],
      ['emerge', 'Emergence',      'Structure detection, entity auto-spawn'],
    ] as [string, string, string][]).map(([id, nm, desc]) => `
      <div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:6px">
        <button class="proctog" id="pt_${id}"
          style="width:14px;height:14px;border-radius:3px;border:none;cursor:pointer;flex-shrink:0;margin-top:2px;
            background:${activeProcs.has(id) ? 'var(--ok)' : '#2a2a38'}"
          onclick="toggleProc('${id}')"></button>
        <div>
          <div style="font-size:10px;color:var(--tx)">${nm}</div>
          <div style="font-size:8px;color:var(--sub);line-height:1.4">${desc}</div>
        </div>
      </div>`).join('')}
  </div>
</div>

<!-- SECTION 4: Deterministic Replay -->
<div class="sec sci-sec">
  <div class="sechdr" onclick="toggleSec(this)"><span>Deterministic Replay</span><span class="sarr">▾</span></div>
  <div class="secbody">
    <div class="crow">
      <span class="clbl" style="font-size:9px;flex:1">Seed</span>
      <input type="number" id="simSeed" value="42" min="0" max="99999"
        style="width:70px;font-size:10px;background:#0c0c18;color:var(--sub);
          border:1px solid var(--bd);border-radius:4px;padding:2px 5px"
        oninput="onSeedChange(+this.value)">
    </div>
    <div style="display:flex;gap:4px;margin-top:6px">
      <button id="btnRecStart" class="bb" onclick="startRecording()"
        style="flex:1;border-color:#e04848;color:#e04848">● Record</button>
      <button id="btnRecStop"  class="bb" onclick="stopRecording()"
        style="flex:1">■ Stop</button>
    </div>
    <div id="recStatus"
      style="font-size:9px;color:var(--sub);margin-top:4px;font-family:monospace">
      idle — 0 frames
    </div>
  </div>
</div>

<!-- SECTION 5: Data Export -->
<div class="sec sci-sec">
  <div class="sechdr" onclick="toggleSec(this)"><span>Data Export</span><span class="sarr">▾</span></div>
  <div class="secbody">
    <button class="bb" onclick="exportMetricsCSV()"      style="width:100%;margin-bottom:3px">📄 Metrics CSV</button>
    <button class="bb" onclick="exportRecordingJSON()"   style="width:100%;margin-bottom:3px">🗂️ Recording JSON</button>
    <button class="bb" onclick="exportJupyterNotebook()" style="width:100%;margin-bottom:3px">📓 Jupyter Notebook (.ipynb)</button>
    <button class="bb" onclick="exportGraphML()"         style="width:100%;margin-bottom:3px">🕸️ Causal Graph (.graphml)</button>
    <button class="bb" onclick="exportWorld()"           style="width:100%">💾 World (.reality)</button>
    <div style="font-size:8px;color:var(--sub);margin-top:6px;line-height:1.6">
      CSV → pandas/R · JSON → replay + analysis<br>
      .ipynb → Jupyter with ready plots · .graphml → Gephi
    </div>
  </div>
</div>

<!-- SECTION 6: Law Fitness Chart -->
<div class="sec sci-sec">
  <div class="sechdr" onclick="toggleSec(this)"><span>Law Fitness Over Time</span><span class="sarr">▾</span></div>
  <div class="secbody" style="padding:4px">
    <canvas id="lawChart"
      style="width:100%;height:180px;display:block;border-radius:4px;border:1px solid var(--bd)">
    </canvas>
    <div style="font-size:8px;color:var(--sub);margin-top:4px;text-align:center">
      Each line = one law · Solid = active · Faded = inactive
    </div>
  </div>
</div>
`
}

// ── Event-handler binder ──────────────────────────────────────────────────────

/**
 * Wire Science Mode panel event handlers.
 * Call after injecting buildScienceModePanel() HTML into the DOM.
 *
 * Handlers exposed on `window`:
 *   toggleLaw(i)        setLawFitness(i, v)  setLawStrength(i, v)  setLawExpr(i, expr)
 *   addCustomLaw()      resetLawFitness()
 *   setParam(key, v)    toggleProc(id)
 *   onSeedChange(seed)
 *   startRecording()    stopRecording()
 *   exportMetricsCSV()  exportRecordingJSON()  exportJupyterNotebook()
 *   exportGraphML()     exportWorld()
 */
export interface SciencePanelCallbacks {
  onToggleLaw:      (idx: number) => void
  onLawFitness:     (idx: number, v: number) => void
  onLawStrength:    (idx: number, v: number) => void
  onLawExpr:        (idx: number, expr: string) => void
  onAddCustomLaw:   () => void
  onResetFitness:   () => void
  onSetParam:       (key: string, v: number) => void
  onToggleProc:     (id: string) => void
  onSeedChange:     (seed: number) => void
  onStartRecording: () => void
  onStopRecording:  () => void
  onExportCSV:      () => void
  onExportJSON:     () => void
  onExportJupyter:  () => void
  onExportGraphML:  () => void
  onExportWorld:    () => void
}

export function bindSciencePanelHandlers(cb: SciencePanelCallbacks): void {
  const w = window as unknown as Record<string, unknown>
  w.toggleLaw        = (i: number)             => cb.onToggleLaw(i)
  w.setLawFitness    = (i: number, v: number)  => cb.onLawFitness(i, v)
  w.setLawStrength   = (i: number, v: number)  => cb.onLawStrength(i, v)
  w.setLawExpr       = (i: number, s: string)  => cb.onLawExpr(i, s)
  w.addCustomLaw     = ()                       => cb.onAddCustomLaw()
  w.resetLawFitness  = ()                       => cb.onResetFitness()
  w.setParam         = (k: string, v: number)  => cb.onSetParam(k, v)
  w.toggleProc       = (id: string)            => cb.onToggleProc(id)
  w.onSeedChange     = (s: number)             => cb.onSeedChange(s)
  w.startRecording   = ()                       => cb.onStartRecording()
  w.stopRecording    = ()                       => cb.onStopRecording()
  w.exportMetricsCSV      = ()                  => cb.onExportCSV()
  w.exportRecordingJSON   = ()                  => cb.onExportJSON()
  w.exportJupyterNotebook = ()                  => cb.onExportJupyter()
  w.exportGraphML         = ()                  => cb.onExportGraphML()
  w.exportWorld           = ()                  => cb.onExportWorld()
}
