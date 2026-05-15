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
import { RulesetEngine }       from './modes/gamedev/RulesetEditor'

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
const ruleset = new RulesetEngine()

// Seed default rules
ruleset.rules = ruleset.defaultRules()

const gamedevMode = {
  ruleset,

  addRule(): void {
    const r = ruleset.addRule()
    const name = prompt('Rule name:', r.name)
    if (name) r.name = name
    r.active = true
    const el = document.getElementById('gdRuleList')
    if (el && typeof win['renderGameRules'] === 'function')
      el.innerHTML = (win['renderGameRules'] as ()=>string)()
  },

  tick(simTick: number, buf: Float32Array): void {
    const msgs = ruleset.tick(simTick, buf, getW(), getH(), 1, getNF())
    msgs.forEach(msg => {
      const logEl = document.getElementById('gdLog')
      if (logEl) {
        logEl.textContent = `[${simTick}] ${msg}\n` + logEl.textContent.slice(0, 400)
      }
    })
    const scoreEl = document.getElementById('gdScore')
    if (scoreEl) scoreEl.textContent = String(ruleset.score)
  },

  reset(): void { ruleset.score = 0; ruleset.gameOver = false },

  exportRuleset(): void {
    const json = ruleset.serialize()
    const blob = new Blob([json], { type: 'application/json' })
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(blob)
    a.download = 'reality_ruleset.json'
    a.click()
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
})

// ── Expose on window ──────────────────────────────────────────────────────
win['scienceMode'] = scienceMode
win['cinemaMode']  = cinemaMode
win['gamedevMode'] = gamedevMode
win['metrics']     = metrics   // direct console access: window.metrics.get('entropy','avg',200)

console.log('%c[Reality Engine] Connector ready — window.scienceMode / .cinemaMode / .gamedevMode', 'color:#a09af0')
