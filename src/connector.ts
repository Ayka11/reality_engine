/**
 * connector.ts — bridges TypeScript modules to the inline simulation in index.html.
 *
 * Exposes on window:
 *   window.scienceMode   — MetricsAPI + LawFitnessChart + DeterministicEngine + CausalInspector
 *   window.cinemaMode    — KeyframeTimeline + CameraPathEditor + SceneDirector + VideoRecorder
 *   window.gamedevMode   — RulesetEngine
 *
 * Listens for 'panelRendered' events to init canvases after panel HTML is injected.
 */

import { MetricsAPI }          from './scientific/MetricsAPI'
import { LawFitnessChart }     from './scientific/LawFitnessChart'
import { CausalInspector, renderExplanation } from './scientific/CausalInspector'
import { SolverClient, SIMULATION_CATALOG, buildSolverPanel } from './scientific/SolverClient'
import { AgentSystem } from './modes/agents/AgentSystem'
import { AgentPlanner } from './modes/agents/AgentPlanner'
import { DeterministicEngine } from './simulation/DeterministicEngine'
import { KeyframeTimeline }    from './modes/cinema/KeyframeTimeline'
import { CameraPathEditor }    from './modes/cinema/CameraPathEditor'
import { SceneDirector }       from './modes/cinema/SceneDirector'
import { VideoRecorder }       from './modes/cinema/VideoRecorder'
import { GameRulesetEngine } from './modes/gamedev/GameRulesetEngine'
import { BehaviorFSMCanvas, PRESET_BEHAVIORS }   from './modes/gamedev/EntityBehaviorEditor'
import { PrefabSystem }                           from './modes/gamedev/PrefabSystem'
import { AIGameDesigner }                         from './modes/gamedev/AIGameDesigner'
import { buildGameDevModePanel }                  from './modes/GameDevModePanel'
import { ChunkRenderer }                          from './render/ChunkRenderer'
import { RealityMonitor, buildRealityMonitorHTML, updateMonitorPanels } from './ui/RealityMonitor'
import { NodeLawEditor }                          from './ui/NodeLawEditor'
import { sceneComposer }                          from './modes/cinema/SceneComposer'

// ── Window alias — must be declared before any top-level win[...] usage ──────
const win = window as unknown as Record<string, unknown>

// ── Chunk system — Three.js PBR renderer + 128×128×64 sparse worker ─────────

const c3dCanvas = document.getElementById('c3d') as HTMLCanvasElement
const chunkRenderer = new ChunkRenderer(c3dCanvas)
const monitor       = new RealityMonitor()
const nodeEditor    = new NodeLawEditor()

const localChunks = new Map<number, Float32Array>()
let chunkTick = 0, chunkEvCount = 0, workerBusy = false
let DIFF_cw = 0.09, ENT_cw = 0.0004, INFO_cw = 0.35, BIO_cw = 0.25

const chunkWorker = new Worker(
  new URL('./core/ChunkSimWorker.ts', import.meta.url),
  { type: 'module' }
)

chunkWorker.onmessage = (e: MessageEvent) => {
  const { cmd, tick: wTick, evCount: wEv, ab, stats } = e.data
  workerBusy = false

  if (cmd === 'frame' && ab) {
    chunkTick    = wTick    ?? chunkTick
    chunkEvCount = wEv      ?? chunkEvCount
    const NF_W = 14, CF = 512 * NF_W
    const u32 = new Uint32Array(ab as ArrayBuffer)
    const f32 = new Float32Array(ab as ArrayBuffer)
    const num = u32[0]
    let off = 1
    for (let c = 0; c < num; c++) {
      const key = u32[off]
      localChunks.set(key, f32.slice(off + 1, off + 1 + CF))
      off += 1 + CF
    }
    chunkRenderer.applyWorkerFrame(ab as ArrayBuffer)
    const el = document.getElementById('chunkStats')
    if (el && stats) el.textContent = `${stats.activeChunks}/${stats.totalChunks} · ${stats.memoryMB}MB`
  }
}

// Seed world on startup — generate sparse base then apply proto preset for visible data
chunkWorker.postMessage({ cmd: 'generate', data: { DIFF: DIFF_cw, ENT: ENT_cw, INFO: INFO_cw, BIO: BIO_cw } })
chunkWorker.postMessage({ cmd: 'preset', data: { name: 'proto' } })

// Self-contained render loop — always runs so 3D view shows even when paused
let _rafLast = 0
;(function rafLoop(ts: number) {
  const dt = Math.min((ts - _rafLast) / 1000, 0.1)
  _rafLast = ts
  chunkRenderer.render(dt)
  requestAnimationFrame(rafLoop)
})(0)

// Resize helper exposed to HTML — called by resize3D() on window/mode resize
win['resizeChunkRenderer'] = (hybrid: boolean) => {
  const parent = c3dCanvas.parentElement!
  const w = hybrid ? Math.ceil(parent.clientWidth / 2) : parent.clientWidth
  const h = parent.clientHeight
  if (w > 0 && h > 0) {
    chunkRenderer.renderer.setSize(w, h, false)
    chunkRenderer.camera.aspect = w / h
    chunkRenderer.camera.updateProjectionMatrix()
  }
}

function chunkWorkerCompile() {
  const pipeline = nodeEditor.compile()
  const params   = { DIFF: DIFF_cw, ENT: ENT_cw, INFO: INFO_cw, BIO: BIO_cw }
  nodeEditor.applyPipeline(pipeline, params)
  DIFF_cw = params.DIFF; ENT_cw = params.ENT; INFO_cw = params.INFO; BIO_cw = params.BIO
  chunkWorker.postMessage({ cmd: 'setParams', data: params })
  const log = document.getElementById('ngCompileLog')
  if (log) log.textContent = `Compiled → DIFF:${DIFF_cw.toFixed(4)} ENT:${ENT_cw.toFixed(5)}`
}
nodeEditor.onCompile = () => chunkWorkerCompile()
nodeEditor.onSelect  = (node) => {
  const el = document.getElementById('ngNodeProps')
  if (!el) return
  if (!node) { el.style.display = 'none'; return }
  const numEntries = Object.entries(node.params).filter(([, v]) => typeof v === 'number')
  if (!numEntries.length) { el.style.display = 'none'; return }
  el.style.display = 'block'
  el.innerHTML = `<div style="font-size:9px;color:${node.color};margin-bottom:4px;font-weight:600">${node.label}</div>` +
    numEntries.map(([k, v]) => {
      const max = k === 'fitness' ? 1 : k === 'strength' ? 1 : k === 'factor' ? 5 : k === 'blend' ? 1 : 10
      return `<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px">
        <span style="font-size:9px;color:var(--sub);min-width:52px">${k}</span>
        <input type="range" style="flex:1;accent-color:${node.color};height:3px"
          min="0" max="${max}" step="0.0001" value="${v}"
          data-node="${node.id}" data-param="${k}"
          oninput="this.nextElementSibling.textContent=parseFloat(this.value).toFixed(4);
            var ne=window.nodeLawEditor;if(ne&&ne.selected)ne.selected.params[this.dataset.param]=parseFloat(this.value);"
          onchange="if(window.chunkWorkerCompile)window.chunkWorkerCompile()">
        <span style="font-size:9px;font-family:monospace;min-width:42px;text-align:right;color:var(--tx)">${(v as number).toFixed(4)}</span>
      </div>`
    }).join('')
}
win['chunkWorkerCompile'] = chunkWorkerCompile
win['nodeLawEditor']      = nodeEditor
win['applyChunkPreset']   = (name: string) => {
  chunkWorker.postMessage({ cmd: 'preset', data: { name } })
  if (name === 'town') {
    DIFF_cw = 0.12; ENT_cw = 0.00015; INFO_cw = 0.45; BIO_cw = 0.32
    chunkWorker.postMessage({ cmd: 'setParams', data: { DIFF: DIFF_cw, ENT: ENT_cw, INFO: INFO_cw, BIO: BIO_cw, procs: ['thermo', 'bio', 'info'] } })
  }
}

// 3D renderer controls — called from HTML UI controls
win['setMatMode']      = (m: string) => chunkRenderer.setMatMode(m as 'field'|'material'|'height')
win['setTimeOfDay']    = (h: number) => chunkRenderer.setTimeOfDay(h)
win['setFogDensity']   = (d: number) => chunkRenderer.setFogDensity(d)
win['setCameraPreset'] = (p: string) => chunkRenderer.setCameraPreset(p as 'orbit'|'top'|'iso'|'street'|'fly')
win['setZSlice']       = (z: number) => chunkRenderer.setZSlice(z)
win['setShowParticles']= (v: boolean) => { chunkRenderer.showParticles = v }
win['setChunkLayer']   = (l: number) => chunkRenderer.setLayer(l)
win['paintChunkAt']    = (x: number, y: number, z: number, f: number, v: number, r: number, mode?: string) => {
  chunkWorker.postMessage({ cmd: 'paint', data: { x, y, z, f, v, r, mode: mode ?? 'add' } })
}

// Scene Composer APIs
sceneComposer.setOnApply((cmds) => {
  for (const cmd of cmds) {
    chunkWorker.postMessage({ cmd: 'paint', data: cmd })
  }
})
win['addSceneComp'] = (id: string)  => { sceneComposer.addComponent(id) }
win['removeComp']   = (id: string)  => { sceneComposer.removeComponent(id) }
win['toggleComp']   = (id: string)  => { sceneComposer.toggleComp(id) }
win['applyScene']   = ()            => { sceneComposer.applyAll() }
win['clearScene']   = ()            => { sceneComposer.active = []; (sceneComposer as any)._refreshUI() }

// Science mode town configuration — realistic city physics
win['sciTownMode'] = () => {
  DIFF_cw = 0.12; ENT_cw = 0.00015; INFO_cw = 0.45; BIO_cw = 0.32
  chunkWorker.postMessage({ cmd: 'setParams', data: { DIFF: DIFF_cw, ENT: ENT_cw, INFO: INFO_cw, BIO: BIO_cw, procs: ['thermo', 'bio', 'info'] } })
  const log = document.getElementById('ngCompileLog')
  if (log) log.textContent = 'Town physics: DIFF=0.12 · ENT=0.00015 · INFO=0.45 · BIO=0.32 · procs: thermo+bio+info'
}

function tryInitMonitorPanel() {
  const panel = document.getElementById('realityMonitorPanel')
  if (panel && !panel.querySelector('#psiRCanvas')) panel.innerHTML = buildRealityMonitorHTML()
}

function tryInitNodeEditor() {
  const canvas = document.getElementById('ngCanvas') as HTMLCanvasElement | null
  if (canvas && !nodeEditor.canvas) nodeEditor.init(canvas)
  else if (canvas) nodeEditor.draw()
}

// Tick chunk worker alongside inline sim (called from HTML's simStep loop)
win['tickChunkWorker'] = (playing: boolean, speed: number) => {
  if (!playing || workerBusy) return
  workerBusy = true
  chunkWorker.postMessage({ cmd: 'tick', data: { speed: Math.min(speed, 3) } })

  if (localChunks.size > 0) {
    const laws: { nm: string; fit: number; on: boolean; col: string }[] =
      (win['LAWS'] as { name: string; fitness: number; active: boolean; color: string }[] | undefined)
        ?.map(l => ({ nm: l.name, fit: l.fitness, on: l.active, col: l.color })) ?? []
    monitor.sample(chunkTick, localChunks, 0, chunkEvCount)
    updateMonitorPanels(monitor, laws)
    const last = monitor.samples[monitor.samples.length - 1]
    if (last && nodeEditor.canvas) {
      nodeEditor.tick({ energy: last.energy, entropy: last.entropy, info: last.info, bio: last.bio })
    }
  }
}

// ── Inline sim constants (must match index.html) ──────────────────────────
function getW():   number { return (win['W']  as number) || 36 }
function getH():   number { return (win['H']  as number) || 28 }
function getNF():  number { return (win['NF'] as number) || 12 }

// ── Agent System ─────────────────────────────────────────────────────────
const agentSystem  = new AgentSystem()
const agentPlanner = new AgentPlanner()

// ── Science Mode ──────────────────────────────────────────────────────────
const metrics    = new MetricsAPI()
const chart      = new LawFitnessChart()
const detEngine  = new DeterministicEngine()

let inspector: CausalInspector | null = null
let inspectorW = 0

function getInspector(): CausalInspector {
  const W = getW()
  if (!inspector || inspectorW !== W) {
    inspector  = new CausalInspector(W, getH(), 1, getNF())
    inspectorW = W
  }
  return inspector
}

const scienceMode = {
  metrics,
  chart,
  det: detEngine,

  onTick(tick: number, buf: Float32Array, W: number, H: number, NF: number): void {
    const laws: { nm: string; fit: number; on: boolean; col: string }[] =
      (win['LAWS'] as {name:string;fitness:number;active:boolean;color:string}[] | undefined)
        ?.map(l => ({ nm: l.name, fit: l.fitness, on: l.active, col: l.color })) ?? []

    const avgFit = laws.length
      ? laws.filter(l => l.on).reduce((a, b) => a + b.fit, 0) / (laws.filter(l => l.on).length || 1)
      : 0

    metrics.sample(tick, buf, W, H, 1, NF, 0, 0, avgFit)
    chart.record(tick, laws)

    // Redraw the law fitness chart canvas if visible
    const canvas = document.getElementById('lawChart') as HTMLCanvasElement | null
    if (canvas) chart.draw(canvas, laws)
  },

  explainCell(x: number, y: number, buf: Float32Array): string {
    const exp = getInspector().explain(x, y, 0, buf)
    return renderExplanation(exp)
  },

  exportCSV(): void {
    const csv  = metrics.exportCSV()
    const blob = new Blob([csv], { type: 'text/csv' })
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(blob)
    a.download = `reality_metrics_t${Date.now()}.csv`
    a.click()
  },

  exportJSON(): void {
    const json = detEngine.exportJSON()
    const blob = new Blob([json], { type: 'application/json' })
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(blob)
    a.download = `reality_recording_t${Date.now()}.json`
    a.click()
  },

  exportJupyter(): void {
    const nb   = detEngine.exportJupyterNotebook()
    const blob = new Blob([nb], { type: 'application/json' })
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(blob)
    a.download = `reality_t${Date.now()}.ipynb`
    a.click()
  },
}

// ── Cinema Mode ───────────────────────────────────────────────────────────
const timeline = new KeyframeTimeline()
const camPath  = new CameraPathEditor()
const director = new SceneDirector(420)
const recorder = new VideoRecorder()

let autoDirecting = false

function getCanvas(): HTMLCanvasElement | null {
  return document.getElementById('canvas') as HTMLCanvasElement | null
}
function getBuf(): Float32Array {
  return (win['buf'] as Float32Array) ?? new Float32Array(0)
}
function getTick(): number {
  return (win['tick'] as number) ?? 0
}
function getSimContext() {
  const m = metrics.snapshot()
  return {
    tick:       getTick(),
    avgEnergy:  m.energy,
    avgEntropy: m.entropy,
    avgInfo:    m.info,
    avgBio:     m.bio,
    agentCount: m.agents,
  }
}

const cinemaMode = {
  timeline,
  camPath,
  director,
  recorder,

  onTick(tick: number, _buf: Float32Array): void {
    camPath.applyCameraAtTick(tick)
    const tCanvas = document.getElementById('timelineCanvas') as HTMLCanvasElement | null
    if (tCanvas && tick % 5 === 0) timeline.draw()
    // update recording status
    if (recorder.isRecording) {
      const canvas = getCanvas()
      if (canvas) recorder.captureFrame(canvas)
      const el = document.getElementById('recStatus')
      if (el) el.textContent = `● recording — ${recorder.frameCount} frames`
    }
  },

  addSimKF(): void {
    const buf  = getBuf()
    const tick = getTick()
    timeline.addSimKF(tick, buf, getW(), getH(), getNF())
    timeline.draw()
  },

  addMarker(): void {
    const label = prompt('Marker label:', `Scene ${timeline.markers.length + 1}`) ?? 'Marker'
    timeline.addMarker(getTick(), label, 60)
    timeline.draw()
  },

  async askDirector(): Promise<void> {
    const input = document.getElementById('dirInput') as HTMLInputElement | null
    const prompt = input?.value?.trim()
    if (!prompt) return
    
    const log = document.getElementById('dirLog')
    const codeEl = document.getElementById('dirCode')
    const runBtn = document.getElementById('btnRunDir')
    
    // Clear input immediately
    if (input) input.value = ''
    
    // Show loading state
    if (log) log.textContent = '⏳ Director thinking...'
    if (codeEl) codeEl.style.display = 'none'
    if (runBtn) runBtn.style.display = 'none'

    try {
      const res = await director.ask(prompt, getSimContext())

      if (log) {
        log.textContent = res.narration
      }
      if (codeEl && res.script) {
        codeEl.textContent = res.script
        codeEl.style.display = 'block'
        if (runBtn) runBtn.style.display = 'block'
        this.runScript()
        if (log) log.textContent += '\n▶ Applied to simulation.'
      }
      timeline.addMarker(getTick(), res.markerLabel, 120)
      timeline.draw()
    } catch (err) {
      console.error('Director error:', err)
      if (log) log.textContent = `Error: ${String(err)}. Make sure API key is set.`
    }
  },

  async narrate(): Promise<void> {
    const log = document.getElementById('dirLog')
    if (log) log.textContent = '⏳ Director thinking...'
    try {
      const res = await director.ask('Describe what is visually happening right now', getSimContext())
      if (log) log.textContent = res.narration
    } catch (err) {
      console.error('Narrate error:', err)
      if (log) log.textContent = `Error: ${String(err)}. Make sure API key is set.`
    }
  },

  toggleAuto(): void {
    autoDirecting = !autoDirecting
    const btn = document.getElementById('autoDirBtn')
    if (autoDirecting) {
      director.startAutoDirecting(getSimContext, res => {
        const log = document.getElementById('dirLog')
        if (log) log.textContent = res.narration
        timeline.addMarker(getTick(), res.markerLabel, 120)
        timeline.draw()
      })
      if (btn) btn.textContent = 'Auto: ON'
    } else {
      director.stopAutoDirecting()
      if (btn) btn.textContent = 'Auto: OFF'
    }
  },

  runScript(): void {
    const codeEl = document.getElementById('dirCode')
    const code   = codeEl?.textContent ?? ''
    if (!code.trim()) return
    try {
      const fn = new Function('buf','W','H','NF','set_','Math', code)
      fn(getBuf(), getW(), getH(), getNF(), win['set_'], Math)
    } catch (e) {
      console.error('Director script error:', e)
    }
  },

  startRec(): void {
    const canvas = getCanvas()
    if (!canvas) return
    recorder.startRecording(canvas, 30)
    const el = document.getElementById('recStatus')
    if (el) el.textContent = '● recording'
  },

  stopRec(): void {
    recorder.stopAndDownload(`reality_cinema_t${getTick()}.webm`)
    const el = document.getElementById('recStatus')
    if (el) el.textContent = `idle — ${recorder.frameCount} frames captured`
  },

  exportFramePNG(): void {
    const canvas = getCanvas()
    if (canvas) recorder.exportFramePNG(canvas, `frame_t${getTick()}.png`)
  },

  exportAlembic(): void {
    // Re-use SimTimeline from TimelinePanel if available, else use our timeline's sparse data
    const kfs = timeline.simKFs.map(kf => ({ tick: kf.tick, cellCount: kf.cells.length / (kf.NF + 1) }))
    const json = JSON.stringify({ format: 'reality_engine_alembic_v1', keyframes: kfs }, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(blob)
    a.download = `reality_alembic_t${getTick()}.json`
    a.click()
  },

  exportSRT(): void {
    const srt  = timeline.exportSRT()
    const blob = new Blob([srt], { type: 'text/plain' })
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(blob)
    a.download = `reality_subtitles_t${getTick()}.srt`
    a.click()
  },

  setBrightness(v: number): void {
    ;win['cinemaBrightness'] = v
  },

  setSaturation(v: number): void {
    ;win['cinemaSaturation'] = v
  },
}

// ── Game Dev Mode ─────────────────────────────────────────────────────────
const gameRuleset    = new GameRulesetEngine()
const behaviorEditor = new BehaviorFSMCanvas()
const prefabSystem   = new PrefabSystem()
const gameDesigner   = new AIGameDesigner()

gameRuleset.loadPreset('ecosystem')   // sensible default

let activePrefab:        typeof prefabSystem.library[0] | null = null
let lastDesignerRuleset: string | null = null
let gdPaused = false

function updateGameUI(): void {
  const gs = gameRuleset.state
  const scoreEl = document.getElementById('scoreDisplay')
  const livesEl = document.getElementById('livesDisplay')
  const msgEl   = document.getElementById('gameMessage')
  const objEl   = document.getElementById('objectivesDisplay')
  const actObjEl = document.getElementById('activeObjectives')

  if (scoreEl) scoreEl.textContent = `Score: ${gs.score}`
  if (livesEl) livesEl.textContent = `Lives: ${'❤️'.repeat(Math.max(0, gs.lives))}`
  if (msgEl)   msgEl.textContent   = gs.message

  const objHTML = gs.objectives.map(o => `
    <div style="display:flex;align-items:center;gap:5px;margin-bottom:4px">
      <span style="font-size:11px">${o.completed ? '✅' : '⬜'}</span>
      <div style="flex:1">
        <div style="font-size:9px;color:${o.completed ? 'var(--ok)' : 'var(--tx)'}">${o.name}</div>
        <div style="height:3px;background:#1a1a28;border-radius:2px;margin-top:2px">
          <div style="height:100%;width:${(o.progress * 100).toFixed(0)}%;
            background:${o.completed ? 'var(--ok)' : 'var(--ac)'};border-radius:2px;transition:width .3s"></div>
        </div>
      </div>
      <span style="font-size:8px;color:var(--sub)">${(o.progress * 100).toFixed(0)}%</span>
    </div>`).join('')
  if (objEl)    objEl.innerHTML    = objHTML
  if (actObjEl) actObjEl.innerHTML = objHTML
}

function renderPrefabLibrary(): void {
  const el = document.getElementById('prefabLibrary')
  if (!el) return
  el.innerHTML = prefabSystem.library.map((p, i) => `
    <div onclick="window.gamedevMode.setActivePrefab(${i})"
      title="${p.description}"
      style="padding:5px 3px;border:1px solid ${activePrefab === p ? 'var(--ac)' : 'var(--bd)'};
      border-radius:4px;cursor:pointer;background:#0c0c18;text-align:center">
      <div style="font-size:16px">${p.icon}</div>
      <div style="font-size:7px;color:var(--sub);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</div>
    </div>`).join('')
}

const gamedevMode = {
  gameRuleset,
  behaviorEditor,
  prefabSystem,
  gameDesigner,

  // Expose for connector calls from main loop
  onTick(simTick: number, buf: Float32Array): void {
    if (simTick % 10 === 0) {
      const msgs = gameRuleset.tick(simTick, buf, getW(), getH(), 1, getNF(), 0)
      msgs.forEach(msg => {
        const logEl = document.getElementById('gdLog')
        if (logEl) logEl.textContent = `[${simTick}] ${msg}\n` + logEl.textContent.slice(0, 500)
      })
      updateGameUI()
      // Render popups on canvas
      this._renderPopups()
    }
  },

  // ── Playtest ────────────────────────────────────────────────────────

  startPlaytest(): void {
    gameRuleset.playtestMode = true
    gdPaused = false
    ;(win['playing'] as boolean | undefined)
    win['playing'] = true
    updateGameUI()
  },

  resetPlaytest(): void {
    gameRuleset.reset()
    updateGameUI()
  },

  pausePlaytest(): void {
    gdPaused = !gdPaused
    win['playing'] = !gdPaused
  },

  loadPreset(preset: 'survival' | 'ecosystem' | 'civilization' | 'custom'): void {
    gameRuleset.loadPreset(preset)
    updateGameUI()
  },

  // ── Objectives ──────────────────────────────────────────────────────

  addObjective(id: string): void {
    gameRuleset.addObjective(id)
    updateGameUI()
  },

  setTimeLimit(v: number | null): void {
    gameRuleset.state.timeLimit = v
  },

  // ── Entity Behaviors ─────────────────────────────────────────────────

  loadBehaviorPreset(id: string): void {
    const preset = PRESET_BEHAVIORS.find(b => b.id === id)
    if (!preset) return
    const canvas = document.getElementById('behaviorCanvas') as HTMLCanvasElement | null
    if (canvas) behaviorEditor.init(canvas, preset)
  },

  spawnWithBehavior(n: number): void {
    const genome = behaviorEditor.compileToGenome()
    const W = getW(), H = getH()
    const buf = getBuf()
    const NF  = getNF()
    // Inject energy clusters at random positions (visual spawn)
    for (let k = 0; k < n; k++) {
      const x = 4 + Math.floor(Math.random() * (W - 8))
      const y = 4 + Math.floor(Math.random() * (H - 8))
      const base = (y * W + x) * NF
      buf[base + 0]  = 200 + Math.random() * 200   // energy
      buf[base + 1]  = 0.4 + Math.random() * 0.3   // density
      buf[base + 10] = 0.4 + Math.random() * 0.3   // bio
    }
    const behaviorName = behaviorEditor.fsm?.name ?? 'default'
    console.log(`[GameDev] Spawned ${n} agents with ${behaviorName} behavior`, genome)
    const logEl = document.getElementById('gdLog')
    if (logEl) logEl.textContent = `Spawned ${n} × ${behaviorName}\n` + logEl.textContent.slice(0, 400)
  },

  // ── Prefabs ──────────────────────────────────────────────────────────

  capturePrefab(): void {
    const name   = prompt('Prefab name:', 'My Prefab')
    if (!name) return
    const buf    = getBuf()
    const canvas = document.getElementById('canvas') as HTMLCanvasElement | null
    const W = getW(), H = getH(), NF = getNF()
    const cx = Math.max(0, Math.floor(W / 2))
    const cy = Math.max(0, Math.floor(H / 2))
    prefabSystem.capture(cx, cy, 0, 3, buf, W, H, 1, NF, name, canvas)
    renderPrefabLibrary()
  },

  setActivePrefab(i: number): void {
    activePrefab = prefabSystem.library[i] ?? null
    const nameEl = document.getElementById('activePrefabName')
    if (nameEl) nameEl.textContent = activePrefab?.name ?? 'none'
    renderPrefabLibrary()
    // Set global tool flag so inline sim paint handler can call stampActivePrefab
    win['tool']         = 'stamp_prefab'
    win['activePrefab'] = activePrefab
  },

  stampAt(x: number, y: number): void {
    if (!activePrefab) return
    prefabSystem.stamp(activePrefab, x, y, 0, getBuf(), getW(), getH(), 1, getNF(), 'add')
  },

  // ── AI Game Designer ─────────────────────────────────────────────────

  async askDesigner(): Promise<void> {
    const input  = document.getElementById('gameDesignerInput') as HTMLInputElement | null
    const logEl  = document.getElementById('gameDesignerLog')
    const prompt = input?.value?.trim()
    if (!prompt) return
    
    // Clear input immediately
    if (input)  input.value  = ''
    if (logEl)  logEl.innerHTML += `<div style="color:#888">You: ${prompt}</div>`

    // Show loading indicator
    if (logEl)  logEl.innerHTML += `<div style="color:#666;font-style:italic">🤖 Thinking...</div>`
    if (logEl)  logEl.scrollTop  = logEl.scrollHeight

    try {
      const summary = this._worldSummary()
      const result  = await gameDesigner.ask(prompt, summary, gameRuleset.state)

      if (logEl) {
        // Remove the "thinking" message and add response
        const thinkingDiv = logEl.lastElementChild
        if (thinkingDiv?.textContent?.includes('Thinking')) {
          thinkingDiv.remove()
        }
        logEl.innerHTML += `<div style="color:#c0c8f0">🤖 ${result.advice.replace(/\n/g,'<br>')}</div>`
        logEl.scrollTop  = logEl.scrollHeight
      }
      if (result.rulesetJSON) {
        lastDesignerRuleset = result.rulesetJSON
        const applyBtn = document.getElementById('btnApplyRuleset')
        if (applyBtn) applyBtn.style.display = 'block'
      }
    } catch (err) {
      console.error('Designer error:', err)
      if (logEl) {
        const thinkingDiv = logEl.lastElementChild
        if (thinkingDiv?.textContent?.includes('Thinking')) {
          thinkingDiv.remove()
        }
        logEl.innerHTML += `<div style="color:#ff6b6b">❌ Error: ${String(err)}. Check your API key.</div>`
        logEl.scrollTop = logEl.scrollHeight
      }
    }
  },

  suggestObjective(): void {
    const input = document.getElementById('gameDesignerInput') as HTMLInputElement | null
    if (input) input.value = 'Suggest an objective for this world state'
    void this.askDesigner()
  },

  applyDesignerRuleset(): void {
    if (!lastDesignerRuleset) return
    try {
      const data = JSON.parse(lastDesignerRuleset)
      if (data.objectives)  gameRuleset.state.objectives = data.objectives
      if (data.timeLimit !== undefined) gameRuleset.state.timeLimit = data.timeLimit
      if (data.lives     !== undefined) gameRuleset.state.lives     = data.lives
      if (data.message)                 gameRuleset.state.message   = data.message
      updateGameUI()
      const applyBtn = document.getElementById('btnApplyRuleset')
      if (applyBtn) applyBtn.style.display = 'none'
    } catch (e) {
      console.error('[GameDev] Ruleset parse error:', e)
    }
  },

  // ── Level Export ────────────────────────────────────────────────────

  exportLevel(): void {
    const json = gameRuleset.exportLevel()
    const blob = new Blob([json], { type: 'application/json' })
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(blob)
    a.download = `reality_level_t${getTick()}.level.json`
    a.click()
  },

  _buildPanel(): string {
    return buildGameDevModePanel()
  },

  shareLevel(): void {
    try {
      const payload = btoa(JSON.stringify({
        type:       'level',
        objectives: gameRuleset.state.objectives.map(o => ({ id:o.id, name:o.name, type:o.type, target:o.target, description:o.description })),
        message:    gameRuleset.state.message,
      })).slice(0, 200)
      const url = new URL(window.location.href)
      url.hash  = payload
      void navigator.clipboard.writeText(url.toString())
      const logEl = document.getElementById('gdLog')
      if (logEl) logEl.textContent = 'Level link copied to clipboard!\n' + logEl.textContent.slice(0, 400)
    } catch { /* clipboard denied */ }
  },

  // ── private helpers ──────────────────────────────────────────────────

  _worldSummary(): string {
    const m  = metrics.snapshot()
    return `tick=${getTick()}, energy=${m.energy.toFixed(1)}, entropy=${m.entropy.toFixed(4)}, info=${m.info.toFixed(1)}, bio=${m.bio.toFixed(3)}, agents=0`
  },

  _renderPopups(): void {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement | null
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx)   return
    gameRuleset.state.popups.forEach((p, i) => {
      ctx.font      = 'bold 13px system-ui'
      ctx.textAlign = 'center'
      ctx.fillStyle = p.color + 'dd'
      ctx.fillText(p.text, canvas.width / 2, 55 + i * 22)
    })
  },
}

// ── Scientific Solver ─────────────────────────────────────────────────────
const solverClient = new SolverClient()
let solverStatus: 'checking' | 'online' | 'offline' = 'checking'
let selectedSolverId = ''
let sciLiveMode = false
let sciLiveInterval: ReturnType<typeof setInterval> | null = null

// Check microservice on startup (non-blocking)
solverClient.checkStatus().then(ok => {
  solverStatus = ok ? 'online' : 'offline'
}).catch(() => { solverStatus = 'offline' })

win['onSciSolverSelect'] = (id: string) => {
  selectedSolverId = id
  const sim = SIMULATION_CATALOG.find(s => s.id === id)
  const descEl = document.getElementById('sciSolverDesc')
  const eqEl   = document.getElementById('sciSolverEq')
  const parEl  = document.getElementById('sciSolverParams')
  if (descEl) descEl.textContent = sim?.desc ?? ''
  if (eqEl)   eqEl.textContent   = sim?.equation ?? ''
  if (parEl && sim) {
    parEl.innerHTML = sim.params.map(p => `
      <div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:9px;color:var(--sub);flex:1">${p.label}</span>
        <input type="range" id="sp_${p.key}" min="${p.min}" max="${p.max}"
          step="${p.step}" value="${p.default}" style="width:60px;accent-color:var(--accent)"
          oninput="document.getElementById('spv_${p.key}').textContent=this.value">
        <span style="font-size:9px;font-family:monospace;min-width:34px;text-align:right;
          color:var(--tx)" id="spv_${p.key}">${p.default}</span>
      </div>`).join('')
  }
}

win['runSciSolver'] = async () => {
  if (!selectedSolverId) return
  const statusEl = document.getElementById('sciSolverStatus')
  const runBtn   = document.getElementById('btnSciRun')
  if (statusEl) { statusEl.textContent = '⏳ Computing…'; statusEl.style.color = 'var(--warn)' }
  if (runBtn)   runBtn.setAttribute('disabled', '')

  // Gather extra params from sliders
  const extra: Record<string, unknown> = {}
  document.querySelectorAll('[id^="sp_"]').forEach(el => {
    const key = (el.id as string).replace('sp_', '')
    extra[key] = parseFloat((el as HTMLInputElement).value)
  })

  const buf = getBuf(); const W = getW(); const H = getH(); const NF = getNF()
  const req = solverClient.buildRequest(selectedSolverId, buf, W, H, NF, extra)

  // Try microservice first; fall back to inline run notification
  const result = await solverClient.solve(req)

  if (runBtn) runBtn.removeAttribute('disabled')

  if (!result.ok) {
    if (statusEl) { statusEl.textContent = `✗ ${result.error}`; statusEl.style.color = 'var(--err)' }
    return
  }

  solverClient.applyResult(result, buf, W, H, NF)
  const solverName = result.solver ?? selectedSolverId
  if (statusEl) { statusEl.textContent = `✓ ${solverName}`; statusEl.style.color = 'var(--ok)' }

  const infoEl = document.getElementById('sciSolverInfo')
  if (infoEl && result.params) {
    infoEl.style.display = 'block'
    infoEl.textContent   = Object.entries(result.params)
      .map(([k, v]) => `${k}: ${typeof v === 'number' ? (v as number).toFixed(4) : v}`).join('  ·  ')
  }

  // log to bottom bar
  if (win['log']) (win['log'] as (m: string) => void)(`🔬 ${solverName}`)
}

win['toggleSciLive'] = () => {
  sciLiveMode = !sciLiveMode
  const btn = document.getElementById('btnSciLive')
  if (sciLiveMode) {
    if (btn) { btn.style.borderColor = 'var(--ok)'; btn.style.color = 'var(--ok)' }
    sciLiveInterval = setInterval(async () => {
      if (!sciLiveMode || !(win['playing'] as boolean)) return
      if (win['runSciSolver']) await (win['runSciSolver'] as () => Promise<void>)()
    }, 3000)
  } else {
    if (btn) { btn.style.borderColor = ''; btn.style.color = '' }
    if (sciLiveInterval) { clearInterval(sciLiveInterval); sciLiveInterval = null }
  }
}

// Re-check solver status when science panel is opened
function _refreshSolverUI() {
  solverClient.checkStatus().then(ok => {
    solverStatus = ok ? 'online' : 'offline'
  })
}

// ── Panel canvas init ─────────────────────────────────────────────────────
document.addEventListener('panelRendered', (e: Event) => {
  const panel = (e as CustomEvent<{panel:string}>).detail.panel
  if (panel === 'cinema') {
    const tCanvas = document.getElementById('timelineCanvas') as HTMLCanvasElement | null
    if (tCanvas) timeline.attach(tCanvas)
    // Inject SceneComposer panel if not already present
    const leftPanel = document.getElementById('left')
    if (leftPanel && !document.getElementById('scActiveList')) {
      const div = document.createElement('div')
      div.innerHTML = sceneComposer.buildHTML()
      leftPanel.appendChild(div)
    }
  }
  if (panel === 'science') {
    const lawCanvas = document.getElementById('lawChart') as HTMLCanvasElement | null
    if (lawCanvas) {
      const laws: { nm: string; fit: number; on: boolean; col: string }[] =
        (win['LAWS'] as {name:string;fitness:number;active:boolean;color:string}[] | undefined)
          ?.map(l => ({ nm: l.name, fit: l.fitness, on: l.active, col: l.color })) ?? []
      chart.draw(lawCanvas, laws)
    }
    // Inject solver panel after the existing section content
    const leftPanel = document.getElementById('left')
    if (leftPanel && !document.getElementById('sciSolverSel')) {
      const solverDiv = document.createElement('div')
      solverDiv.innerHTML = buildSolverPanel(solverStatus)
      leftPanel.appendChild(solverDiv)
    }
    _refreshSolverUI()
    // Init Reality Monitor + Node Law Editor (may be first time panel opens)
    tryInitMonitorPanel()
    setTimeout(tryInitNodeEditor, 50) // slight delay so canvas is in layout
  }
  if (panel === 'gamedev') {
    renderPrefabLibrary()
    updateGameUI()
    // Auto-load first behavior preset into canvas if one is available
    const bCanvas = document.getElementById('behaviorCanvas') as HTMLCanvasElement | null
    if (bCanvas && PRESET_BEHAVIORS.length) {
      behaviorEditor.init(bCanvas, PRESET_BEHAVIORS[0])
    }
  }
})

// ── Agent window API ─────────────────────────────────────────────────────

win['agentSystem'] = agentSystem

// Called from index.html spawn buttons and from Game Dev mode
win['spawnAgents'] = (n: number) => {
  const W = getW(), H = getH()
  agentSystem.spawn(Math.floor(W / 2), Math.floor(H / 2), n)
  const statsEl = document.getElementById('agentStats')
  if (statsEl) statsEl.textContent = agentSystem.stats()
  console.log(`[AgentSystem] Spawned ${n} agents (total: ${agentSystem.count})`)
}

// Request LLM plan — called from agents panel "Plan" button
win['requestAgentPlan'] = async () => {
  const btn = document.getElementById('btnGroupPlan') as HTMLButtonElement | null
  const planEl = document.getElementById('agentPlanText')
  if (agentSystem.count === 0) {
    if (planEl) planEl.textContent = '⚠ Spawn agents first (click Spawn 5 or Spawn 20)'
    return
  }
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Planning…' }
  try {
    const ctx = getSimContext()
    const plan = await agentPlanner.groupPlan(agentSystem.getSurvivors(), ctx)
    agentSystem.applyPlan(plan)
    if (planEl) planEl.textContent = plan
  } catch (err) {
    if (planEl) planEl.textContent = `Error: ${String(err)}`
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🧠 Group Plan' }
  }
}

// AutoGen-style two-agent debate — called from agents panel "Debate" button
win['debateAgentPlan'] = async () => {
  const btn = document.getElementById('btnDebate') as HTMLButtonElement | null
  const planEl = document.getElementById('agentPlanText')
  if (agentSystem.count === 0) {
    if (planEl) planEl.textContent = '⚠ Spawn agents first (click Spawn 5 or Spawn 20)'
    return
  }
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Debating…' }
  try {
    const ctx = getSimContext()
    const result = await agentPlanner.debatePlan(ctx)
    agentSystem.applyPlan(result.consensus)
    if (planEl) {
      planEl.textContent = `Strategist: ${result.strategist}\nTactician: ${result.tactician}\nConsensus: ${result.consensus}`
    }
  } catch (err) {
    if (planEl) planEl.textContent = `Error: ${String(err)}`
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚔️ Debate' }
  }
}

// Assign CrewAI-style roles — each agent gets its own role plan
win['assignAgentRoles'] = () => {
  agentPlanner.assignRoles(agentSystem.agents)
  const planEl = document.getElementById('agentPlanText')
  const roles  = agentPlanner.getRoleNames().join(' · ')
  if (planEl) planEl.textContent = `Roles: ${roles}`
}

// Global Claude API key — sets key for all AI modules at once
win['setClaudeApiKey'] = (key: string) => {
  director.setApiKey(key)
  gameDesigner.setApiKey(key)
  agentPlanner.setApiKey(key)
  localStorage.setItem('reality_claude_key', key)
  const dot = document.getElementById('apiKeyDot') as HTMLElement | null
  if (dot) { dot.textContent = key ? '●' : '🔑'; dot.style.color = key ? '#4caf80' : '' }
  const status = document.getElementById('apiKeyStatus') as HTMLElement | null
  if (status) status.textContent = key ? `Key set (${key.slice(0,8)}…)` : 'No key set'
}

// Restore saved API key on load
const _savedKey = localStorage.getItem('reality_claude_key')
if (_savedKey) {
  director.setApiKey(_savedKey)
  gameDesigner.setApiKey(_savedKey)
  agentPlanner.setApiKey(_savedKey)
  // sync UI once DOM is ready
  requestAnimationFrame(() => { (win['setClaudeApiKey'] as ((k: string) => void))(_savedKey) })
}

// ── Expose on window ──────────────────────────────────────────────────────
win['scienceMode']   = scienceMode
win['cinemaMode']    = cinemaMode
win['gamedevMode']   = gamedevMode
win['metrics']       = metrics
win['solverClient']  = solverClient   // window.solverClient.solve({...}) from console

console.log('%c[Reality Engine] Connector ready — window.scienceMode / .cinemaMode / .gamedevMode', 'color:#a09af0')
