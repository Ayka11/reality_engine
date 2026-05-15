/**
 * LawFitnessChart — Canvas-based real-time chart of law fitness over time.
 *
 * Usage:
 *   const chart = new LawFitnessChart()
 *   // each tick in science mode:
 *   chart.record(tick, laws)
 *   chart.draw(canvas, laws)
 */

export interface LawRecord {
  nm:  string   // law name
  fit: number   // 0–1 fitness
  on:  boolean  // active/inactive
  col: string   // hex color for this law's line
}

interface HistoryPoint {
  tick:    number
  fitness: number
  active:  boolean
}

export class LawFitnessChart {
  private history    = new Map<string, HistoryPoint[]>()
  private maxPoints  = 300

  record(tick: number, laws: LawRecord[]): void {
    for (const l of laws) {
      if (!this.history.has(l.nm)) this.history.set(l.nm, [])
      const h = this.history.get(l.nm)!
      h.push({ tick, fitness: l.fit, active: l.on })
      if (h.length > this.maxPoints) h.shift()
    }
  }

  draw(canvas: HTMLCanvasElement, laws: LawRecord[]): void {
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width  = canvas.offsetWidth  || 400
    const h = canvas.height = 180

    // Background
    ctx.fillStyle = '#07070e'
    ctx.fillRect(0, 0, w, h)

    // Horizontal grid + Y-axis labels
    ctx.strokeStyle = '#1a1a28'
    ctx.lineWidth   = 0.5
    ctx.font        = '8px system-ui'
    ctx.fillStyle   = '#333'
    ctx.textBaseline = 'middle'
    for (let i = 0; i <= 4; i++) {
      const y = h * i / 4
      ctx.beginPath()
      ctx.moveTo(0, y); ctx.lineTo(w, y)
      ctx.stroke()
      ctx.fillStyle = '#333'
      ctx.fillText((1 - i / 4).toFixed(2), 2, y)
    }

    // Law lines
    for (const l of laws) {
      const pts = this.history.get(l.nm)
      if (!pts || pts.length < 2) continue

      ctx.beginPath()
      ctx.strokeStyle = l.on ? l.col : '#2a2a3a'
      ctx.lineWidth   = l.on ? 1.5 : 0.5

      pts.forEach((p, idx) => {
        const px = (idx / (pts.length - 1)) * w
        const py = h - p.fitness * (h - 8) - 4
        idx === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
      })
      ctx.stroke()

      // Dot at current value
      const last = pts[pts.length - 1]
      const dotY = h - last.fitness * (h - 8) - 4
      ctx.beginPath()
      ctx.arc(w - 4, dotY, l.on ? 3 : 2, 0, Math.PI * 2)
      ctx.fillStyle = l.on ? l.col : '#2a2a3a'
      ctx.fill()
    }

    // Legend — up to 6 laws, row along the top
    ctx.font         = '9px system-ui'
    ctx.textBaseline = 'top'
    laws.slice(0, 6).forEach((l, idx) => {
      const x = 6 + idx * 66
      ctx.fillStyle = l.on ? l.col : '#333'
      ctx.fillRect(x, 4, 8, 8)
      ctx.fillStyle = l.on ? '#aaa' : '#444'
      ctx.fillText(l.nm.split(' ')[0], x + 10, 4)
    })
  }

  /** Return the latest fitness value for a named law (0 if unknown). */
  latestFitness(nm: string): number {
    const h = this.history.get(nm)
    return h?.length ? h[h.length - 1].fitness : 0
  }

  clear(): void {
    this.history.clear()
  }
}
