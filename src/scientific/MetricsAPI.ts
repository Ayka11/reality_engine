/**
 * MetricsAPI — queryable time-series metrics sampled from the simulation buffer.
 *
 * Designed to be accessible from the browser console for power users:
 *   window.metrics.get('entropy', 'avg', 200)  → number
 *   window.metrics.getSeries('energy', 300)    → number[]
 *   window.metrics.exportCSV()                 → CSV string
 *
 * Sampling: call metrics.sample() each tick (or every N ticks in Science mode).
 * All series are ring-buffered at BUFFER entries to keep memory bounded.
 */

export type MetricName =
  | 'energy'
  | 'entropy'
  | 'info'
  | 'bio'
  | 'temp'
  | 'agents'
  | 'events'
  | 'complexity'
  | 'lawFitness'

export type AggOp = 'last' | 'avg' | 'max' | 'min' | 'series'

export interface MetricPoint {
  tick:  number
  value: number
}

// Field offsets (mirrors SimWorker)
const FE   = 0   // energy
const FI   = 2   // information
const FS   = 3   // entropy
const FT   = 4   // temperature
const FBIO = 10  // bio potential

export class MetricsAPI {
  private readonly BUFFER = 2000
  private series = new Map<MetricName, MetricPoint[]>()

  constructor() {
    const names: MetricName[] = [
      'energy', 'entropy', 'info', 'bio', 'temp',
      'agents', 'events', 'complexity', 'lawFitness',
    ]
    names.forEach(n => this.series.set(n, []))
  }

  /**
   * Sample simulation state into all metric series.
   * Call this in the render loop (e.g., every 5 ticks in Science mode).
   */
  sample(
    tick: number,
    buf: Float32Array,
    W: number, H: number, D: number, NF: number,
    agentCount: number,
    eventCount: number,
    lawFitness: number,
  ): void {
    const SZ = W * H * D
    let tE = 0, tS = 0, tI = 0, tB = 0, tT = 0
    for (let i = 0; i < SZ; i++) {
      const b = i * NF
      tE += buf[b + FE]
      tS += buf[b + FS]
      tI += buf[b + FI]
      tB += buf[b + FBIO]
      tT += buf[b + FT]
    }
    const push = (name: MetricName, v: number) => {
      const s = this.series.get(name)!
      s.push({ tick, value: v })
      if (s.length > this.BUFFER) s.shift()
    }

    const avgE = tE / SZ
    const avgS = tS / SZ
    const avgI = tI / SZ
    const avgB = tB / SZ

    push('energy',     avgE)
    push('entropy',    avgS)
    push('info',       avgI)
    push('bio',        avgB)
    push('temp',       tT / SZ)
    push('agents',     agentCount)
    push('events',     eventCount)
    // Complexity: information × bio suppressed by entropy
    push('complexity', (avgI / 100 + avgB * 5) * Math.max(0, 1 - avgS))
    push('lawFitness', lawFitness)
  }

  /**
   * Query a metric.
   * @param name   metric name
   * @param op     aggregation operator (default 'last')
   * @param n      how many recent points to include (default 100)
   * @returns      single number for last/avg/max/min, MetricPoint[] for 'series'
   */
  get(name: MetricName, op: AggOp = 'last', n = 100): number | MetricPoint[] {
    const s     = this.series.get(name) ?? []
    const slice = s.slice(-n)
    if (!slice.length) return op === 'series' ? [] : 0
    switch (op) {
      case 'last':   return slice[slice.length - 1].value
      case 'avg':    return slice.reduce((a, b) => a + b.value, 0) / slice.length
      case 'max':    return Math.max(...slice.map(p => p.value))
      case 'min':    return Math.min(...slice.map(p => p.value))
      case 'series': return slice
    }
  }

  /** Convenience: returns just the raw value array (no tick metadata). */
  getSeries(name: MetricName, n = 200): number[] {
    return (this.series.get(name)?.slice(-n) ?? []).map(p => p.value)
  }

  /** Latest value for each metric — useful for HUD displays. */
  snapshot(): Record<MetricName, number> {
    const out = {} as Record<MetricName, number>
    for (const [name, pts] of this.series) {
      out[name] = pts.length ? pts[pts.length - 1].value : 0
    }
    return out
  }

  exportCSV(): string {
    const names: MetricName[] = ['energy', 'entropy', 'info', 'bio', 'agents', 'complexity']
    const rows    = ['tick,' + names.join(',')]
    const series  = names.map(n => this.series.get(n)!)
    const len     = Math.min(...series.map(s => s.length))
    for (let i = 0; i < len; i++) {
      const tick = series[0][i].tick
      const vals = names.map((_, ni) => (series[ni][i]?.value ?? 0).toFixed(4))
      rows.push(tick + ',' + vals.join(','))
    }
    return rows.join('\n')
  }

  /** Number of recorded samples for the given metric. */
  length(name: MetricName): number {
    return this.series.get(name)?.length ?? 0
  }

  clear(): void {
    this.series.forEach(s => s.length = 0)
  }
}
