/**
 * AgentSystem — Utility AI + FSM agents with genome-based adaptation.
 *
 * Architecture:
 *   Utility AI    — each tick, score 5 candidate moves by weighted field values
 *   FSM states    — state reflects the dominant utility driver
 *   Genome        — weight vector; offspring carry mutated copy (simplified RL)
 *   LLM plan      — external string that temporarily biases utility weights
 *   Memory        — visited-cell set prevents circling
 */

// Field indices — must match index.html constants
const FE   = 0   // energy
const FI   = 2   // information
const FS   = 3   // entropy
// FT=4 (temperature) reserved for future use
const FBio = 10  // bio potential
const FCid = 9   // civilization id

export type AgentState =
  | 'idle' | 'seek_energy' | 'seek_info'
  | 'flee_entropy' | 'reproduce' | 'explore' | 'rest'

export interface AgentGenome {
  seekEnergyW:   number   // 0-1 weight for moving to high-energy cells
  seekInfoW:     number   // 0-1 weight for moving to high-info cells
  fleeEntropyW:  number   // 0-1 weight for avoiding high-entropy cells
  bioW:          number   // 0-1 weight for cells with bio potential
  exploreW:      number   // 0-1 novelty bonus for unvisited cells
  reprodThresh:  number   // energy fraction (0.3-0.9) needed to reproduce
  maxAge:        number   // ticks until natural death (200-1200)
}

export interface Agent {
  id:         number
  x:          number
  y:          number
  energy:     number     // 0-1 personal energy store
  age:        number
  genome:     AgentGenome
  state:      AgentState
  civId:      number
  memory:     number[]   // ring buffer of (y*W+x) visited hashes
  memHead:    number
  score:      number
  plan:       string     // current LLM-assigned goal text
  planBias:   Partial<AgentGenome>  // temporary weight override from plan
}

const DEFAULTS: AgentGenome = {
  seekEnergyW:  0.8,
  seekInfoW:    0.6,
  fleeEntropyW: 0.7,
  bioW:         0.4,
  exploreW:     0.3,
  reprodThresh: 0.65,
  maxAge:       700,
}

const MEM_SIZE = 48
let _nextId  = 0
let _nextCiv = 1

function rng(a = 0, b = 1): number { return a + Math.random() * (b - a) }
function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v }

function mutateGenome(g: AgentGenome, rate: number): AgentGenome {
  const m = rate / 100
  const d = () => (Math.random() - 0.5) * m
  return {
    seekEnergyW:  clamp01(g.seekEnergyW  + d()),
    seekInfoW:    clamp01(g.seekInfoW    + d()),
    fleeEntropyW: clamp01(g.fleeEntropyW + d()),
    bioW:         clamp01(g.bioW         + d()),
    exploreW:     clamp01(g.exploreW     + d()),
    reprodThresh: Math.max(0.3, Math.min(0.95, g.reprodThresh + d() * 0.5)),
    maxAge:       Math.max(150, g.maxAge + (Math.random() - 0.5) * 120),
  }
}

function makeAgent(x: number, y: number, genome: AgentGenome, civId: number): Agent {
  return {
    id:       _nextId++,
    x, y,
    energy:   0.5 + rng(-0.1, 0.15),
    age:      0,
    genome,
    state:    'idle',
    civId,
    memory:   new Array(MEM_SIZE).fill(-1),
    memHead:  0,
    score:    0,
    plan:     '',
    planBias: {},
  }
}

export class AgentSystem {
  agents: Agent[] = []

  // ── Spawn ───────────────────────────────────────────────────────────────

  spawn(cx: number, cy: number, n: number, baseGenome?: Partial<AgentGenome>): void {
    const W = 36, H = 28  // fallback; overridden by step() args
    const base: AgentGenome = { ...DEFAULTS, ...baseGenome }
    const civId = _nextCiv++
    for (let i = 0; i < n; i++) {
      const g = mutateGenome(base, 15)
      const x = Math.max(1, Math.min(W - 2, cx + Math.round(rng(-4, 4))))
      const y = Math.max(1, Math.min(H - 2, cy + Math.round(rng(-4, 4))))
      this.agents.push(makeAgent(x, y, g, civId))
    }
  }

  // ── Main step (call once per animation frame) ───────────────────────────

  step(buf: Float32Array, W: number, H: number, NF: number, mutRate: number): void {
    const dead: number[] = []
    const DIRS = [[0,0],[1,0],[-1,0],[0,1],[0,-1]] as const

    for (let ai = 0; ai < this.agents.length; ai++) {
      const a = this.agents[ai]
      a.age++

      // Starvation / old age
      if (a.energy < 0.005 || a.age > a.genome.maxAge) {
        dead.push(ai)
        continue
      }

      // Passive energy drain
      a.energy -= 0.0012

      // Build effective weights (base + plan bias)
      const ew = clamp01((a.genome.seekEnergyW  + (a.planBias.seekEnergyW  ?? 0)))
      const iw = clamp01((a.genome.seekInfoW    + (a.planBias.seekInfoW    ?? 0)))
      const sw = clamp01((a.genome.fleeEntropyW + (a.planBias.fleeEntropyW ?? 0)))
      const bw = clamp01((a.genome.bioW         + (a.planBias.bioW         ?? 0)))
      const xw = clamp01((a.genome.exploreW     + (a.planBias.exploreW     ?? 0)))

      // Utility AI: score each direction
      let bestScore = -Infinity, bestDx = 0, bestDy = 0
      for (const [dx, dy] of DIRS) {
        const nx = (a.x + dx + W) % W
        const ny = (a.y + dy + H) % H
        const base2 = (ny * W + nx) * NF
        const e    = buf[base2 + FE]   / 1000
        const info = buf[base2 + FI]   / 500
        const s    = buf[base2 + FS]
        const bio  = buf[base2 + FBio]
        const hash = ny * W + nx
        const novel = a.memory.includes(hash) ? 0 : 1
        const score =
          ew * Math.min(e, 1) +
          iw * Math.min(info, 1) +
          sw * (1 - s) +
          bw * bio +
          xw * novel
        if (score > bestScore) { bestScore = score; bestDx = dx; bestDy = dy }
      }

      // Move
      a.x = (a.x + bestDx + W) % W
      a.y = (a.y + bestDy + H) % H

      // Write memory
      a.memory[a.memHead] = a.y * W + a.x
      a.memHead = (a.memHead + 1) % MEM_SIZE

      // Read cell — absorb energy, leave traces
      const base2 = (a.y * W + a.x) * NF
      const cellE = buf[base2 + FE]
      const absorbed = Math.min(cellE * 0.06, 50)
      buf[base2 + FE]   = Math.max(0, cellE - absorbed)
      a.energy           = Math.min(1, a.energy + absorbed / 1000)

      // Leave bio + info traces
      buf[base2 + FBio] = Math.min(1, (buf[base2 + FBio] || 0) + 0.004)
      buf[base2 + FI]   = Math.min(999, (buf[base2 + FI]  || 0) + 0.8)

      // Mark territory
      buf[base2 + FCid] = a.civId

      // Score accumulation
      a.score += (buf[base2 + FBio] + buf[base2 + FI] / 500) * 0.05

      // Determine FSM state
      const s    = buf[base2 + FS]
      const e    = buf[base2 + FE]
      const info = buf[base2 + FI]
      if      (s > 0.65)                         a.state = 'flee_entropy'
      else if (a.energy > a.genome.reprodThresh) a.state = 'reproduce'
      else if (e > 300)                          a.state = 'seek_energy'
      else if (info > 150)                       a.state = 'seek_info'
      else if (bestDx !== 0 || bestDy !== 0)     a.state = 'explore'
      else                                       a.state = 'rest'

      // Reproduce
      if (a.state === 'reproduce' && this.agents.length < 200) {
        const childGenome = mutateGenome(a.genome, mutRate)
        const nx = Math.max(0, Math.min(W - 1, a.x + (Math.random() > 0.5 ? 1 : -1)))
        const ny = Math.max(0, Math.min(H - 1, a.y + (Math.random() > 0.5 ? 1 : -1)))
        const child = makeAgent(nx, ny, childGenome, a.civId)
        child.energy = a.energy * 0.45
        child.plan   = a.plan
        this.agents.push(child)
        a.energy *= 0.55
        a.state   = 'rest'
      }
    }

    // Remove dead (reverse to preserve indices)
    for (let i = dead.length - 1; i >= 0; i--) {
      this.agents.splice(dead[i], 1)
    }
  }

  // ── Plan application ────────────────────────────────────────────────────

  applyPlan(plan: string): void {
    const lo = plan.toLowerCase()
    const bias: Partial<AgentGenome> = {}

    if      (lo.includes('energy') || lo.includes('fuel') || lo.includes('gather'))
      bias.seekEnergyW = 0.35
    else if (lo.includes('info') || lo.includes('complex') || lo.includes('knowledge'))
      bias.seekInfoW = 0.35
    else if (lo.includes('entropy') || lo.includes('order') || lo.includes('safe'))
      bias.fleeEntropyW = 0.35
    else if (lo.includes('explore') || lo.includes('territory') || lo.includes('spread'))
      bias.exploreW = 0.35
    else if (lo.includes('bio') || lo.includes('life') || lo.includes('grow'))
      bias.bioW = 0.35

    for (const a of this.agents) {
      a.plan     = plan
      a.planBias = bias
    }
  }

  // ── Accessors ───────────────────────────────────────────────────────────

  get count(): number { return this.agents.length }

  getSurvivors(): Agent[] {
    return [...this.agents].sort((a, b) => b.score - a.score).slice(0, 5)
  }

  stats(): string {
    if (this.agents.length === 0) return 'No agents — click Spawn to add'
    const stateCount: Record<string, number> = {}
    let sumE = 0, sumAge = 0
    for (const a of this.agents) {
      stateCount[a.state] = (stateCount[a.state] ?? 0) + 1
      sumE   += a.energy
      sumAge += a.age
    }
    const n = this.agents.length
    const topStates = Object.entries(stateCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([s, c]) => `${s}:${c}`)
      .join(' · ')
    const civs = new Set(this.agents.map(a => a.civId)).size
    return `${n} agents · ${topStates}\navgE:${(sumE/n).toFixed(2)} avgAge:${(sumAge/n).toFixed(0)} civs:${civs}`
  }

  topAgentInfo(): string {
    const top = this.getSurvivors()[0]
    if (!top) return ''
    return `Leader: civ${top.civId} age${top.age} E${top.energy.toFixed(2)} ${top.state}` +
      (top.plan ? ` | Plan: "${top.plan.slice(0, 40)}"` : '')
  }
}
