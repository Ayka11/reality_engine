/**
 * Reality Integral Monitor — mission-control panel for Science Mode.
 *
 * Tracks emergent complexity integral:
 *   ΨR = ∫∫∫ [E·I·(1-S) + B·τ·C] dV
 *
 * Live panels: ΨR graph · Entropy phase space · Law fitness radar · Field correlations
 */

import { F, NF } from '../core/ChunkGrid'

export interface MonitorSample {
  tick:       number
  psiR:       number
  entropy:    number
  dEntropy:   number
  info:       number
  bio:        number
  energy:     number
  complexity: number
  agentCount: number
  eventRate:  number
}

export class RealityMonitor {
  samples:           MonitorSample[] = []
  readonly MAX_SAMPLES = 2000
  private prevSample: MonitorSample | null = null

  computePsiR(chunks: Map<number, Float32Array>): number {
    let psi = 0
    for (const chunk of chunks.values()) {
      for (let i = 0; i < 512; i++) {
        const base = i * NF
        const E   = chunk[base + F.E]   || 0
        const I   = chunk[base + F.I]   || 0
        const S   = chunk[base + F.S]   || 0
        const B   = chunk[base + F.BIO] || 0
        const tau = chunk[base + F.TAU] || 0
        psi += (E / 1000 * I / 500 * (1 - S)) * (1 + B * 2) * (1 + Math.log1p(tau) * 0.01)
      }
    }
    return psi
  }

  sample(
    tick: number,
    chunks: Map<number, Float32Array>,
    agentCount: number,
    eventCount: number,
  ): MonitorSample {
    let totE = 0, totS = 0, totI = 0, totB = 0, n = 0
    for (const chunk of chunks.values()) {
      for (let i = 0; i < 512; i++) {
        const base = i * NF
        if (Math.abs(chunk[base]) > 0.001) {
          totE += chunk[base + F.E]
          totS += chunk[base + F.S]
          totI += chunk[base + F.I]
          totB += chunk[base + F.BIO]
          n++
        }
      }
    }
    if (!n) n = 1
    const psiR = this.computePsiR(chunks)
    const prevS = this.prevSample?.entropy ?? totS / n
    const s: MonitorSample = {
      tick, psiR,
      entropy:    totS / n,
      dEntropy:   totS / n - prevS,
      info:       totI / n,
      bio:        totB / n,
      energy:     totE / n,
      complexity: (totI / n / 100 + totB / n * 5) * (1 - totS / n),
      agentCount,
      eventRate: eventCount,
    }
    this.samples.push(s)
    if (this.samples.length > this.MAX_SAMPLES) this.samples.shift()
    this.prevSample = s
    return s
  }

  drawPsiRGraph(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')!
    const w = canvas.width = canvas.offsetWidth || 300
    const h = canvas.height = 90
    ctx.fillStyle = '#07070e'; ctx.fillRect(0, 0, w, h)
    if (this.samples.length < 2) return
    const data = this.samples.slice(-200).map(s => s.psiR)
    const mx = Math.max(...data, 0.001)

    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, 'rgba(124,111,205,0.6)')
    grad.addColorStop(1, 'rgba(61,184,114,0.05)')
    ctx.beginPath(); ctx.fillStyle = grad
    ctx.moveTo(0, h)
    data.forEach((v, i) => {
      const px = i / (data.length - 1) * w, py = h - (v / mx) * (h - 6) - 3
      i === 0 ? ctx.lineTo(px, h) : ctx.lineTo(px, py)
    })
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill()

    ctx.beginPath(); ctx.strokeStyle = '#7c6fcd'; ctx.lineWidth = 1.5
    data.forEach((v, i) => {
      const px = i / (data.length - 1) * w, py = h - (v / mx) * (h - 6) - 3
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
    })
    ctx.stroke()

    const cur = data[data.length - 1]
    ctx.fillStyle = '#a09af0'; ctx.font = '9px monospace'; ctx.textAlign = 'right'
    ctx.fillText(`ΨR:${cur.toFixed(3)}`, w - 4, 12)
  }

  drawEntropyPhaseSpace(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')!
    const w = canvas.width = canvas.offsetWidth || 200
    const h = canvas.height = 120
    ctx.fillStyle = '#07070e'; ctx.fillRect(0, 0, w, h)

    ctx.strokeStyle = '#1a1a28'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke()

    ctx.fillStyle = '#333'; ctx.font = '8px system-ui'
    ctx.textAlign = 'left'
    ctx.fillText('S', w / 2 + 3, 10)
    ctx.fillText('dS/dt', w - 30, h / 2 - 3)

    const pts = this.samples.slice(-300)
    if (pts.length < 2) return
    const sMax  = Math.max(...pts.map(p => p.entropy), 1)
    const dMax  = Math.max(...pts.map(p => Math.abs(p.dEntropy)), 0.001)

    for (let i = 1; i < pts.length; i++) {
      const p = pts[i]
      const px = (p.entropy / sMax) * (w - 20) + 10
      const py = h / 2 - (p.dEntropy / dMax) * (h / 2 - 10)
      ctx.beginPath(); ctx.arc(px, py, 1.5, 0, Math.PI * 2)
      const age = i / pts.length
      ctx.fillStyle = `rgba(${Math.round(age * 200)},${Math.round((1 - age) * 150)},200,${0.3 + age * 0.5})`
      ctx.fill()
    }

    if (pts.length > 5) {
      const last = pts[pts.length - 1], prev = pts[pts.length - 5]
      const x1 = (prev.entropy / sMax) * (w - 20) + 10
      const y1 = h / 2 - (prev.dEntropy / dMax) * (h / 2 - 10)
      const x2 = (last.entropy / sMax) * (w - 20) + 10
      const y2 = h / 2 - (last.dEntropy / dMax) * (h / 2 - 10)
      ctx.strokeStyle = '#7c6fcd'; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
    }
  }

  drawLawFitnessRadar(
    canvas: HTMLCanvasElement,
    laws: Array<{ nm: string; fit: number; on: boolean; col: string }>,
  ) {
    const ctx = canvas.getContext('2d')!
    const w = canvas.width = canvas.offsetWidth || 180
    const h = canvas.height = 160
    ctx.fillStyle = '#07070e'; ctx.fillRect(0, 0, w, h)

    const active = laws.filter(l => l.on).slice(0, 8)
    if (!active.length) return
    const n = active.length
    const cxc = w / 2, cyc = h / 2
    const R = Math.min(w, h) * 0.38
    const angle = (i: number) => -Math.PI / 2 + i * (Math.PI * 2 / n)

    for (let r = 0.25; r <= 1; r += 0.25) {
      ctx.beginPath(); ctx.strokeStyle = '#1a1a28'; ctx.lineWidth = 0.5
      for (let i = 0; i <= n; i++) {
        const a = angle(i)
        ctx.lineTo(cxc + Math.cos(a) * R * r, cyc + Math.sin(a) * R * r)
      }
      ctx.closePath(); ctx.stroke()
    }
    for (let i = 0; i < n; i++) {
      ctx.beginPath(); ctx.strokeStyle = '#1a1a28'; ctx.lineWidth = 0.5
      ctx.moveTo(cxc, cyc)
      ctx.lineTo(cxc + Math.cos(angle(i)) * R, cyc + Math.sin(angle(i)) * R)
      ctx.stroke()
    }

    ctx.beginPath()
    active.forEach((l, i) => {
      const a = angle(i), r = l.fit * R
      i === 0
        ? ctx.moveTo(cxc + Math.cos(a) * r, cyc + Math.sin(a) * r)
        : ctx.lineTo(cxc + Math.cos(a) * r, cyc + Math.sin(a) * r)
    })
    ctx.closePath()
    ctx.fillStyle = 'rgba(124,111,205,0.2)'; ctx.fill()
    ctx.strokeStyle = '#7c6fcd'; ctx.lineWidth = 1.5; ctx.stroke()

    active.forEach((l, i) => {
      const a = angle(i), r = l.fit * R
      ctx.beginPath()
      ctx.arc(cxc + Math.cos(a) * r, cyc + Math.sin(a) * r, 3, 0, Math.PI * 2)
      ctx.fillStyle = l.col; ctx.fill()
      ctx.fillStyle = '#888'; ctx.font = '7px system-ui'; ctx.textAlign = 'center'
      ctx.fillText(
        l.nm.split(' ')[0],
        cxc + Math.cos(a) * (R + 12),
        cyc + Math.sin(a) * (R + 12),
      )
    })
  }

  drawFieldCorrelationMatrix(canvas: HTMLCanvasElement) {
    const fields = ['E', 'D', 'I', 'S', 'T', 'B']
    const n = fields.length
    const cw = (canvas.offsetWidth || 180) / n
    canvas.width = cw * n; canvas.height = cw * n + 20
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#07070e'; ctx.fillRect(0, 0, canvas.width, canvas.height)

    const series: Record<string, number[]> = {
      E: this.samples.map(s => s.energy),
      D: this.samples.map(s => s.energy * 0.5),
      I: this.samples.map(s => s.info),
      S: this.samples.map(s => s.entropy),
      T: this.samples.map(s => s.energy * 0.3),
      B: this.samples.map(s => s.bio),
    }
    const corr = (a: number[], b: number[]) => {
      const len = Math.min(a.length, b.length); if (!len) return 0
      const ma = a.reduce((s, v) => s + v, 0) / len
      const mb = b.reduce((s, v) => s + v, 0) / len
      let num = 0, da = 0, db = 0
      for (let i = 0; i < len; i++) {
        num += (a[i] - ma) * (b[i] - mb)
        da  += (a[i] - ma) ** 2
        db  += (b[i] - mb) ** 2
      }
      return num / Math.sqrt(da * db + 1e-10)
    }

    fields.forEach((f1, i) => fields.forEach((f2, j) => {
      const c = corr(series[f1] || [], series[f2] || [])
      const x = j * cw, y = i * cw + 20
      ctx.fillStyle = `rgb(${c > 0 ? Math.round(c * 60) : 0},${Math.round(Math.abs(c) * 40)},${c < 0 ? Math.round(-c * 120) : 0})`
      ctx.fillRect(x + 1, y + 1, cw - 2, cw - 2)
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '8px monospace'; ctx.textAlign = 'center'
      ctx.fillText(c.toFixed(1), x + cw / 2, y + cw / 2 + 3)
    }))

    ctx.fillStyle = '#666'; ctx.font = '8px system-ui'; ctx.textAlign = 'center'
    fields.forEach((f, i) => ctx.fillText(f, i * cw + cw / 2, 14))
  }

  forecastEmergence(): string {
    if (this.samples.length < 50) return 'Need more data — run simulation'
    const recent = this.samples.slice(-50)
    const dPsi = recent[recent.length - 1].psiR    - recent[0].psiR
    const dEnt = recent[recent.length - 1].entropy - recent[0].entropy
    const dBio = recent[recent.length - 1].bio     - recent[0].bio

    if (dPsi > 0.5 && dBio > 0.01) return 'Emergence IMMINENT — complexity rising'
    if (dPsi > 0.1 && dEnt < 0.01) return 'Growing conditions — watch bio field'
    if (dEnt > 0.05)                return 'Entropy surge — emergence suppressed'
    if (dPsi < -0.1)                return 'Complexity declining — inject energy'
    return 'Stable state — no imminent emergence'
  }
}

// ── Panel HTML builder ────────────────────────────────────────────────────────

export function buildRealityMonitorHTML(): string {
  return `
<div class="rpsec">
  <span class="rl" style="font-size:9px;font-weight:600;color:#7c6fcd;display:block;margin-bottom:4px">Reality Integral ΨR</span>
  <canvas id="psiRCanvas" style="width:100%;height:90px;border-radius:5px;border:1px solid #1a1a28;background:#07070e;display:block"></canvas>
  <div id="psiRForecast" style="font-size:9px;margin-top:4px;padding:3px 6px;background:#0e0e18;border-radius:4px;border:1px solid #1a1a28">
    Computing forecast…
  </div>
</div>
<div class="rpsec" style="margin-top:8px">
  <span class="rl" style="font-size:9px;font-weight:600;color:#7c6fcd;display:block;margin-bottom:4px">Entropy Phase Space</span>
  <canvas id="phaseCanvas" style="width:100%;height:120px;border-radius:5px;border:1px solid #1a1a28;background:#07070e;display:block"></canvas>
  <div style="font-size:8px;color:#444;margin-top:3px">X=entropy · Y=dS/dt · trail=time</div>
</div>
<div class="rpsec" style="margin-top:8px">
  <span class="rl" style="font-size:9px;font-weight:600;color:#7c6fcd;display:block;margin-bottom:4px">Law Fitness Radar</span>
  <canvas id="radarCanvas" style="width:100%;height:160px;border-radius:5px;border:1px solid #1a1a28;background:#07070e;display:block"></canvas>
</div>
<div class="rpsec" style="margin-top:8px">
  <span class="rl" style="font-size:9px;font-weight:600;color:#7c6fcd;display:block;margin-bottom:4px">Field Correlations</span>
  <canvas id="corrCanvas" style="width:100%;border-radius:5px;border:1px solid #1a1a28;background:#07070e;display:block"></canvas>
</div>
<div class="rpsec" style="margin-top:8px">
  <span class="rl" style="font-size:9px;font-weight:600;color:#7c6fcd;display:block;margin-bottom:4px">Live Stats</span>
  <div id="monitorStats" style="font-size:9px;color:#666;font-family:monospace;line-height:1.9"></div>
</div>`
}

export function updateMonitorPanels(
  monitor: RealityMonitor,
  laws: Array<{ nm: string; fit: number; on: boolean; col: string }>,
) {
  const psiCanvas   = document.getElementById('psiRCanvas')   as HTMLCanvasElement | null
  const phaseCanvas = document.getElementById('phaseCanvas')  as HTMLCanvasElement | null
  const radarCanvas = document.getElementById('radarCanvas')  as HTMLCanvasElement | null
  const corrCanvas  = document.getElementById('corrCanvas')   as HTMLCanvasElement | null

  if (psiCanvas)   monitor.drawPsiRGraph(psiCanvas)
  if (phaseCanvas) monitor.drawEntropyPhaseSpace(phaseCanvas)
  if (radarCanvas) monitor.drawLawFitnessRadar(radarCanvas, laws)
  if (corrCanvas)  monitor.drawFieldCorrelationMatrix(corrCanvas)

  const forecastEl = document.getElementById('psiRForecast')
  if (forecastEl) forecastEl.textContent = monitor.forecastEmergence()

  const last = monitor.samples[monitor.samples.length - 1]
  const statsEl = document.getElementById('monitorStats')
  if (statsEl && last) {
    statsEl.innerHTML = [
      ['ΨR',        last.psiR.toFixed(4)],
      ['Complexity', last.complexity.toFixed(4)],
      ['dS/dt',     last.dEntropy.toFixed(5)],
      ['Bio avg',   last.bio.toFixed(4)],
      ['Events/s',  String(last.eventRate)],
      ['Agents',    String(last.agentCount)],
    ].map(([l, v]) => `<div style="display:flex;justify-content:space-between">
      <span style="color:#444">${l}</span>
      <span style="color:#aaa">${v}</span>
    </div>`).join('')
  }
}
