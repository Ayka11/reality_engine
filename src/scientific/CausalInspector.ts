/**
 * CausalInspector — click any voxel, get a human-readable causal explanation.
 *
 * For each cell it:
 *  1. Reads all 14 field values
 *  2. Compares to 6 neighbors (directional gradient analysis)
 *  3. Derives a list of causes (why is this field at this value?)
 *  4. Lists active processes (what is happening here?)
 *  5. Gives recommendations (what would improve bio / reduce entropy?)
 *  6. Predicts near-term evolution
 *  7. Assigns a stability label
 */

// Field offsets — must match SimWorker and CellState
const F = {
  E:   0,   // energy
  D:   1,   // density
  I:   2,   // information
  S:   3,   // entropy
  T:   4,   // temperature
  BIO: 10,  // bio potential
  TAU: 8,   // local time dilation
} as const

// ── Types ─────────────────────────────────────────────────────────────────────

export type FieldLevel = 'low' | 'medium' | 'high' | 'critical'
export type Stability  = 'stable' | 'unstable' | 'critical'

export interface FieldReading {
  name:  string
  value: number
  unit:  string
  level: FieldLevel
}

export interface CausalExplanation {
  position:        { x: number; y: number; z: number }
  fields:          FieldReading[]
  causes:          string[]
  processes:       string[]
  recommendations: string[]
  prediction:      string
  stability:       Stability
}

// ── CausalInspector ──────────────────────────────────────────────────────────

export class CausalInspector {
  constructor(
    private readonly W:  number,
    private readonly H:  number,
    private readonly D:  number,
    private readonly NF: number,
  ) {}

  explain(x: number, y: number, z: number, buf: Float32Array): CausalExplanation {
    const i  = (z * this.H * this.W + y * this.W + x) * this.NF
    const E  = buf[i + F.E]   || 0
    const Dn = buf[i + F.D]   || 0
    const I  = buf[i + F.I]   || 0
    const S  = buf[i + F.S]   || 0
    const T  = buf[i + F.T]   || 0
    const B  = buf[i + F.BIO] || 0
    const τ  = buf[i + F.TAU] || 0

    const causes:          string[] = []
    const processes:       string[] = []
    const recommendations: string[] = []

    // ── Neighbor analysis ───────────────────────────────────────────────────
    const nb = {
      E: this.neighborGradient(x, y, z, F.E, buf, E),
      T: this.neighborGradient(x, y, z, F.T, buf, T),
      I: this.neighborGradient(x, y, z, F.I, buf, I),
    }

    // ── Energy ─────────────────────────────────────────────────────────────
    if (nb.E.inflowDirs.length) {
      causes.push(
        `Energy flowing in from ${nb.E.inflowDirs.join('+')} (+${nb.E.delta.toFixed(0)} avg Δ)`,
      )
    }
    if (nb.E.outflowDirs.length) {
      causes.push(
        `Energy diffusing out to ${nb.E.outflowDirs.join('+')} (−${(-nb.E.delta).toFixed(0)} avg Δ)`,
      )
    }
    if (E > 500) processes.push('Active energy hotspot — major diffusion driver for neighbours')
    if (E < 5)   causes.push('Near-zero energy — consumed by processes or fully diffused')

    // ── Temperature ────────────────────────────────────────────────────────
    if (T > 500) {
      causes.push(`Plasma-level temperature (${T.toFixed(0)}°) — energy→heat conversion active`)
      processes.push('Phase transition zone — material state unstable')
    } else if (T < 20) {
      causes.push('Near-freezing. Thermal coupling near zero. Ice-like ordering possible.')
    }

    // ── Entropy ────────────────────────────────────────────────────────────
    const entDrivers: string[] = []
    if (E > 200) entDrivers.push(`high energy (${E.toFixed(0)})`)
    if (T > 300) entDrivers.push(`thermal activity (${T.toFixed(0)}°)`)

    if (S > 0.6) {
      causes.push(
        `CRITICAL entropy (${S.toFixed(3)}) — caused by: ${entDrivers.join(' + ') || 'baseline increase'}`,
      )
      recommendations.push('Inject low-entropy material (crystal brush) or boost information field')
    } else if (S > 0.3) {
      causes.push(
        `Elevated entropy (${S.toFixed(3)}) — order eroding. Drivers: ${entDrivers.join(' + ') || 'baseline'}`,
      )
      recommendations.push('Reduce local temperature or inject information to counteract entropy')
    }

    // ── Information ────────────────────────────────────────────────────────
    if (I > 300) {
      processes.push('Information singularity — self-sustaining complexity loop active')
    } else if (I > 50 && E > 80 && Dn > 0.2) {
      processes.push('Information growth active — energy + density threshold met')
    } else if (I < 5 && S > 0.3) {
      causes.push(`Information suppressed by entropy (S=${S.toFixed(3)} exceeds 0.3 threshold)`)
      recommendations.push('Reduce entropy or use information-injection brush')
    }

    if (nb.I.inflowDirs.length) {
      processes.push(`Information propagating in from ${nb.I.inflowDirs.join('+')}`)
    }

    // ── Biology ────────────────────────────────────────────────────────────
    if (B > 0.7) {
      processes.push('Life emergence zone — all conditions met simultaneously')
    } else if (B > 0.1) {
      const missing: string[] = []
      if (E < 80)   missing.push(`energy (has ${E.toFixed(0)}, needs >80)`)
      if (Dn < 0.25) missing.push(`density (has ${Dn.toFixed(2)}, needs >0.25)`)
      if (S > 0.5)  missing.push(`entropy too high (${S.toFixed(3)}, needs <0.5)`)
      if (missing.length) {
        causes.push(`Bio potential (${B.toFixed(2)}) limited by: ${missing.join(', ')}`)
        recommendations.push(`Improve: ${missing.map(m => m.split(' ')[0]).join(', ')}`)
      }
    }

    // ── Stability assessment ────────────────────────────────────────────────
    const stability: Stability =
      S > 0.7 || E < 2 ? 'critical' :
      S > 0.4 || E < 15 ? 'unstable' :
      'stable'

    // ── Prediction ─────────────────────────────────────────────────────────
    let prediction: string
    if (S > 0.7) {
      prediction = 'This zone will collapse to heat death within ~200 ticks unless energy or information is injected.'
    } else if (B > 0.5 && I > 100) {
      prediction = 'Life emergence likely within 100–300 ticks if these conditions hold.'
    } else if (E > 500) {
      prediction = `High-energy region. Energy will diffuse outward over ~${Math.round(E / 20)} ticks, warming neighbours.`
    } else if (S < 0.1 && I > 200) {
      prediction = 'Information singularity forming. Complexity will accelerate if entropy stays low.'
    } else {
      prediction = 'Stable. Gradual entropy increase expected. No imminent phase transition.'
    }

    return {
      position: { x, y, z },
      fields: [
        { name: 'Energy',        value: E,  unit: '',  level: E>500?'critical':E>100?'high':E>20?'medium':'low' },
        { name: 'Temperature',   value: T,  unit: '°', level: T>500?'critical':T>200?'high':T>50?'medium':'low' },
        { name: 'Entropy',       value: S,  unit: '',  level: S>.7?'critical':S>.4?'high':S>.2?'medium':'low' },
        { name: 'Information',   value: I,  unit: '',  level: I>300?'critical':I>100?'high':I>30?'medium':'low' },
        { name: 'Bio potential', value: B,  unit: '',  level: B>.7?'critical':B>.4?'high':B>.2?'medium':'low' },
        { name: 'Density',       value: Dn, unit: '',  level: Dn>.8?'high':Dn>.4?'medium':'low' },
        { name: 'Local τ',       value: τ,  unit: 'τ', level: 'medium' },
      ],
      causes,
      processes,
      recommendations,
      prediction,
      stability,
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private neighborGradient(
    x: number, y: number, z: number,
    f: number,
    buf: Float32Array,
    selfVal: number,
  ): { inflowDirs: string[]; outflowDirs: string[]; delta: number } {
    const dirs: [number, number, number, string][] = [
      [-1, 0, 0, 'W'], [1, 0, 0, 'E'],
      [0, -1, 0, 'N'], [0, 1, 0, 'S'],
      [0, 0, -1, 'D'], [0, 0, 1, 'U'],
    ]
    let sum = 0, count = 0
    const inflowDirs:  string[] = []
    const outflowDirs: string[] = []

    for (const [dx, dy, dz, dir] of dirs) {
      const nx = x + dx, ny = y + dy, nz = z + dz
      if (nx < 0 || nx >= this.W || ny < 0 || ny >= this.H || nz < 0 || nz >= this.D) continue
      const v = buf[(nz * this.H * this.W + ny * this.W + nx) * this.NF + f] || 0
      sum += v; count++
      if (v > selfVal + 50) inflowDirs.push(dir)
      if (v < selfVal - 50) outflowDirs.push(dir)
    }

    return {
      inflowDirs,
      outflowDirs,
      delta: count ? (sum / count - selfVal) : 0,
    }
  }
}

// ── Rendering helper ─────────────────────────────────────────────────────────

/**
 * Render a CausalExplanation into an HTML string.
 * Inject this into any panel's innerHTML.
 */
export function renderExplanation(e: CausalExplanation): string {
  const stabilityColor =
    e.stability === 'critical' ? '#e04848' :
    e.stability === 'unstable' ? '#e09030' : '#3db872'

  const levelColor = (l: FieldLevel) =>
    l === 'critical' ? '#e04848' : l === 'high' ? '#e09030' : l === 'medium' ? '#7c6fcd' : '#555'

  return `
<div style="font-size:10px;line-height:1.5">
  <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
    <span style="font-size:11px;font-weight:600;color:#e0dff5">
      Cell (${e.position.x}, ${e.position.y}, ${e.position.z})
    </span>
    <span style="font-size:9px;background:${stabilityColor}22;color:${stabilityColor};
      border:1px solid ${stabilityColor}44;border-radius:3px;padding:1px 5px">
      ${e.stability}
    </span>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:8px">
    ${e.fields.map(f => `
      <div style="background:#0e0e1a;border-radius:3px;padding:3px 5px">
        <span style="color:#666;font-size:8px">${f.name}</span><br>
        <span style="color:${levelColor(f.level)};font-family:monospace;font-size:9px">
          ${f.value < 1 ? f.value.toFixed(3) : f.value.toFixed(1)}${f.unit}
        </span>
      </div>`).join('')}
  </div>

  ${e.causes.length ? `
    <div style="margin-bottom:5px">
      <div style="font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Causes</div>
      ${e.causes.map(c => `<div style="color:#a0a0c0;font-size:9px;padding-left:8px">• ${c}</div>`).join('')}
    </div>` : ''}

  ${e.processes.length ? `
    <div style="margin-bottom:5px">
      <div style="font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Active Processes</div>
      ${e.processes.map(p => `<div style="color:#3db872;font-size:9px;padding-left:8px">▶ ${p}</div>`).join('')}
    </div>` : ''}

  ${e.recommendations.length ? `
    <div style="margin-bottom:5px">
      <div style="font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Recommendations</div>
      ${e.recommendations.map(r => `<div style="color:#e09030;font-size:9px;padding-left:8px">→ ${r}</div>`).join('')}
    </div>` : ''}

  <div style="background:#0c0c18;border-radius:3px;padding:4px 6px;margin-top:4px">
    <div style="font-size:8px;color:#555;margin-bottom:2px">Prediction</div>
    <div style="font-size:9px;color:#7080a0">${e.prediction}</div>
  </div>
</div>`
}
