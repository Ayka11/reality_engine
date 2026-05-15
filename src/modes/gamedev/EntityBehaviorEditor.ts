/**
 * EntityBehaviorEditor — visual FSM designer for agents.
 * States: idle, seek_energy, seek_info, flee_entropy, reproduce, explore, rest
 * Transitions triggered by field thresholds.
 * Compiles to agent genome parameters.
 */

export type BehaviorState =
  | 'idle' | 'seek_energy' | 'seek_info'
  | 'flee_entropy' | 'reproduce' | 'explore' | 'rest'

export interface BehaviorTransition {
  from:      BehaviorState
  to:        BehaviorState
  condition: {
    type:      'energy_below'|'energy_above'|'entropy_above'|'bio_above'|'age_above'|'always'
    threshold: number
  }
  priority: number
}

export interface StateParams {
  metabolismMult:      number
  perceptionRadius:    number
  reproThresholdMult:  number
}

export interface BehaviorFSM {
  id:           string
  name:         string
  description:  string
  initialState: BehaviorState
  transitions:  BehaviorTransition[]
  stateParams:  Record<BehaviorState, StateParams>
}

export const PRESET_BEHAVIORS: BehaviorFSM[] = [
  {
    id: 'predator', name: 'Predator',
    description: 'Aggressive energy seeker. Reproduces fast. Dies fast.',
    initialState: 'seek_energy',
    transitions: [
      { from:'seek_energy',  to:'reproduce',    condition:{type:'energy_above', threshold:300}, priority:1 },
      { from:'reproduce',    to:'seek_energy',  condition:{type:'energy_below', threshold:150}, priority:1 },
      { from:'seek_energy',  to:'flee_entropy', condition:{type:'entropy_above',threshold:0.7}, priority:2 },
      { from:'flee_entropy', to:'seek_energy',  condition:{type:'entropy_above',threshold:0.4}, priority:1 },
    ],
    stateParams: {
      idle:         { metabolismMult:0.5, perceptionRadius:2, reproThresholdMult:1   },
      seek_energy:  { metabolismMult:1.5, perceptionRadius:5, reproThresholdMult:0.8 },
      seek_info:    { metabolismMult:1.0, perceptionRadius:4, reproThresholdMult:1   },
      flee_entropy: { metabolismMult:2.0, perceptionRadius:6, reproThresholdMult:2   },
      reproduce:    { metabolismMult:2.0, perceptionRadius:2, reproThresholdMult:0.5 },
      explore:      { metabolismMult:0.8, perceptionRadius:7, reproThresholdMult:1   },
      rest:         { metabolismMult:0.3, perceptionRadius:2, reproThresholdMult:1   },
    },
  },
  {
    id: 'explorer', name: 'Explorer',
    description: 'Curiosity-driven. Prioritizes information over energy.',
    initialState: 'explore',
    transitions: [
      { from:'explore',    to:'seek_energy', condition:{type:'energy_below', threshold:80},  priority:2 },
      { from:'explore',    to:'seek_info',   condition:{type:'bio_above',    threshold:0.3}, priority:1 },
      { from:'seek_energy',to:'explore',     condition:{type:'energy_above', threshold:200}, priority:1 },
    ],
    stateParams: {
      idle:         { metabolismMult:0.4, perceptionRadius:3, reproThresholdMult:1   },
      seek_energy:  { metabolismMult:1.0, perceptionRadius:4, reproThresholdMult:1   },
      seek_info:    { metabolismMult:0.8, perceptionRadius:8, reproThresholdMult:0.8 },
      flee_entropy: { metabolismMult:1.5, perceptionRadius:5, reproThresholdMult:2   },
      reproduce:    { metabolismMult:1.8, perceptionRadius:3, reproThresholdMult:0.5 },
      explore:      { metabolismMult:0.6, perceptionRadius:8, reproThresholdMult:1.2 },
      rest:         { metabolismMult:0.2, perceptionRadius:2, reproThresholdMult:1   },
    },
  },
  {
    id: 'survivor', name: 'Survivor',
    description: 'Entropy-resistant. Avoids chaos. Long-lived.',
    initialState: 'rest',
    transitions: [
      { from:'rest',       to:'seek_energy',  condition:{type:'energy_below', threshold:100}, priority:1 },
      { from:'seek_energy',to:'rest',         condition:{type:'energy_above', threshold:250}, priority:1 },
      { from:'rest',       to:'flee_entropy', condition:{type:'entropy_above',threshold:0.5}, priority:2 },
    ],
    stateParams: {
      idle:         { metabolismMult:0.3, perceptionRadius:3, reproThresholdMult:1   },
      seek_energy:  { metabolismMult:0.8, perceptionRadius:4, reproThresholdMult:1   },
      seek_info:    { metabolismMult:0.6, perceptionRadius:4, reproThresholdMult:1   },
      flee_entropy: { metabolismMult:1.0, perceptionRadius:6, reproThresholdMult:1.5 },
      reproduce:    { metabolismMult:1.5, perceptionRadius:2, reproThresholdMult:0.6 },
      explore:      { metabolismMult:0.5, perceptionRadius:5, reproThresholdMult:1   },
      rest:         { metabolismMult:0.2, perceptionRadius:2, reproThresholdMult:1   },
    },
  },
]

// ── Canvas positions & colours ─────────────────────────────────────────────

const STATE_POS: Record<BehaviorState, [number, number]> = {
  idle:         [120, 100],
  seek_energy:  [240,  40],
  seek_info:    [360, 100],
  flee_entropy: [300, 200],
  reproduce:    [180, 220],
  explore:      [ 60, 180],
  rest:         [ 60,  80],
}

const STATE_COLORS: Record<BehaviorState, string> = {
  idle:         '#555',
  seek_energy:  '#6080ff',
  seek_info:    '#a060e0',
  flee_entropy: '#e04040',
  reproduce:    '#30a060',
  explore:      '#ef8030',
  rest:         '#3a6a5a',
}

// ── BehaviorFSMCanvas ──────────────────────────────────────────────────────

export class BehaviorFSMCanvas {
  fsm:      BehaviorFSM | null    = null
  selected: BehaviorState | null  = null
  canvas:   HTMLCanvasElement | null = null

  init(canvas: HTMLCanvasElement, fsm: BehaviorFSM): void {
    this.canvas = canvas
    this.fsm    = fsm
    this.selected = null
    canvas.addEventListener('click', e => {
      const hit = this._hitTest(e)
      if (hit) {
        this.selected = hit
        this._showStateInfo(hit)
        this.draw()
      }
    })
    this.draw()
  }

  draw(): void {
    const canvas = this.canvas
    if (!canvas || !this.fsm) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.width  = canvas.offsetWidth  || 420
    const H = canvas.height = 260

    ctx.fillStyle = '#08080f'
    ctx.fillRect(0, 0, W, H)

    // Scale positions to canvas width
    const scaleX = W / 440

    // Arrows (transitions)
    for (const t of this.fsm.transitions) {
      const [x1, y1] = STATE_POS[t.from]
      const [x2, y2] = STATE_POS[t.to]
      const sx1 = x1 * scaleX, sx2 = x2 * scaleX
      const mx = (sx1 + sx2) / 2, my = (y1 + y2) / 2

      ctx.beginPath()
      ctx.strokeStyle = '#2a2a45'
      ctx.lineWidth   = 1.5
      ctx.moveTo(sx1, y1)
      ctx.lineTo(sx2, y2)
      ctx.stroke()

      // Arrowhead
      const angle = Math.atan2(y2 - y1, sx2 - sx1)
      ctx.beginPath()
      ctx.strokeStyle = '#3a3a55'
      ctx.moveTo(sx2 - 14 * Math.cos(angle - 0.3), y2 - 14 * Math.sin(angle - 0.3))
      ctx.lineTo(sx2, y2)
      ctx.lineTo(sx2 - 14 * Math.cos(angle + 0.3), y2 - 14 * Math.sin(angle + 0.3))
      ctx.stroke()

      // Condition label
      ctx.fillStyle   = '#444'
      ctx.font        = '7px system-ui'
      ctx.textAlign   = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(
        `${t.condition.type.replace(/_/g, ' ')} ${t.condition.threshold}`,
        mx, my - 5,
      )
    }

    // State nodes
    for (const [state, [x, y]] of Object.entries(STATE_POS) as Array<[BehaviorState, [number, number]]>) {
      const sx       = x * scaleX
      const isInit   = state === this.fsm.initialState
      const isSel    = state === this.selected
      const col      = STATE_COLORS[state]
      const r        = isSel ? 26 : 22

      if (isInit) {
        ctx.beginPath()
        ctx.arc(sx, y, r + 6, 0, Math.PI * 2)
        ctx.strokeStyle = col + '33'
        ctx.lineWidth   = 1
        ctx.stroke()
      }

      ctx.beginPath()
      ctx.arc(sx, y, r, 0, Math.PI * 2)
      ctx.fillStyle   = col + (isSel ? 'cc' : '44')
      ctx.fill()
      ctx.strokeStyle = col
      ctx.lineWidth   = isSel ? 2.5 : 1.5
      ctx.stroke()

      ctx.fillStyle    = isSel ? '#fff' : '#ccc'
      ctx.font         = `${isSel ? 9 : 8}px system-ui`
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      const label = state.replace('_', '\n')
      const lines = label.split('\n')
      lines.forEach((ln, li) => ctx.fillText(ln, sx, y + (li - (lines.length - 1) / 2) * 10))
    }

    ctx.fillStyle    = '#333'
    ctx.font         = '8px system-ui'
    ctx.textBaseline = 'bottom'
    ctx.textAlign    = 'left'
    ctx.fillText('Click state to inspect · edit transitions below', 6, H - 4)
  }

  compileToGenome(): Record<string, unknown> {
    if (!this.fsm) return {}
    const st  = this.fsm.stateParams
    const vals = Object.values(st)
    return {
      metabolismRate:   Math.max(...vals.map(s => s.metabolismMult)) * 0.3,
      perceptionRadius: Math.max(...vals.map(s => s.perceptionRadius)),
      reproThreshold:   300 * Math.min(...vals.map(s => s.reproThresholdMult)),
      mutationRate:     0.05,
      behaviorFSM:      this.fsm,
    }
  }

  // ── private ────────────────────────────────────────────────────────────

  private _hitTest(e: MouseEvent): BehaviorState | null {
    if (!this.canvas) return null
    const rect = this.canvas.getBoundingClientRect()
    const mx   = e.clientX - rect.left
    const my   = e.clientY - rect.top
    const W    = this.canvas.offsetWidth || 420
    const scaleX = W / 440
    for (const [state, [x, y]] of Object.entries(STATE_POS) as Array<[BehaviorState, [number, number]]>) {
      if (Math.sqrt((mx - x * scaleX) ** 2 + (my - y) ** 2) < 26) return state
    }
    return null
  }

  private _showStateInfo(state: BehaviorState): void {
    const el = document.getElementById('behaviorStateInfo')
    if (!el || !this.fsm) return
    const sp = this.fsm.stateParams[state]
    el.innerHTML = `<b style="color:${STATE_COLORS[state]}">${state.replace(/_/g,' ')}</b>
      &nbsp;·&nbsp;metabolism ×${sp.metabolismMult}
      &nbsp;·&nbsp;radius ${sp.perceptionRadius}
      &nbsp;·&nbsp;repro ×${sp.reproThresholdMult}`
  }
}
