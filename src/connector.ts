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

// ── Inline sim constants (must match index.html) ──────────────────────────
const win = window as unknown as Record<string, unknown>
function getW():   number { return (win['W']  as number) || 36 }
function getH():   number { return (win['H']  as number) || 28 }
function getNF():  number { return (win['NF'] as number) || 12 }

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
    if (log) log.textContent = '⏳ Director thinking...'

    const res = await director.ask(prompt, getSimContext())

    if (log) {
      log.textContent = res.narration
    }
    const codeEl = document.getElementById('dirCode')
    const runBtn = document.getElementById('btnRunDir')
    if (codeEl && res.script) {
      codeEl.textContent = res.script
      codeEl.style.display = 'block'
      if (runBtn) runBtn.style.display = 'block'
    }
    timeline.addMarker(getTick(), res.markerLabel, 120)
    timeline.draw()
    if (input) input.value = ''
  },

  async narrate(): Promise<void> {
    const log = document.getElementById('dirLog')
    const res = await director.ask('Describe what is visually happening right now', getSimContext())
    if (log) log.textContent = res.narration
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
    if (input)  input.value  = ''
    if (logEl)  logEl.innerHTML += `<div style="color:#888">You: ${prompt}</div>`

    const summary = this._worldSummary()
    const result  = await gameDesigner.ask(prompt, summary, gameRuleset.state)

    if (logEl) {
      logEl.innerHTML += `<div style="color:#c0c8f0">🤖 ${result.advice.replace(/\n/g,'<br>')}</div>`
      logEl.scrollTop  = logEl.scrollHeight
    }
    if (result.rulesetJSON) {
      lastDesignerRuleset = result.rulesetJSON
      const applyBtn = document.getElementById('btnApplyRuleset')
      if (applyBtn) applyBtn.style.display = 'block'
    }
  },

  suggestObjective(): void {
    void this.askDesigner()
    const input = document.getElementById('gameDesignerInput') as HTMLInputElement | null
    if (input) input.value = 'Suggest an objective for this world state'
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

// ── Panel canvas init ─────────────────────────────────────────────────────
document.addEventListener('panelRendered', (e: Event) => {
  const panel = (e as CustomEvent<{panel:string}>).detail.panel
  if (panel === 'cinema') {
    const tCanvas = document.getElementById('timelineCanvas') as HTMLCanvasElement | null
    if (tCanvas) timeline.attach(tCanvas)
  }
  if (panel === 'science') {
    const lawCanvas = document.getElementById('lawChart') as HTMLCanvasElement | null
    if (lawCanvas) {
      const laws: { nm: string; fit: number; on: boolean; col: string }[] =
        (win['LAWS'] as {name:string;fitness:number;active:boolean;color:string}[] | undefined)
          ?.map(l => ({ nm: l.name, fit: l.fitness, on: l.active, col: l.color })) ?? []
      chart.draw(lawCanvas, laws)
    }
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

// ── Expose on window ──────────────────────────────────────────────────────
win['scienceMode'] = scienceMode
win['cinemaMode']  = cinemaMode
win['gamedevMode'] = gamedevMode
win['metrics']     = metrics   // direct console access: window.metrics.get('entropy','avg',200)

console.log('%c[Reality Engine] Connector ready — window.scienceMode / .cinemaMode / .gamedevMode', 'color:#a09af0')
