/**
 * GameRulesetEngine — score, lives, objectives, win/lose, canvas popups.
 * Objectives: survival, reach_bio, spawn_agents, reduce_entropy, max_info, tick_count.
 * Replaces the basic RulesetEditor for full game mode use.
 */

export type ObjectiveType =
  | 'survival' | 'reach_bio' | 'spawn_agents'
  | 'reduce_entropy' | 'max_info' | 'tick_count'

export interface GameObjective {
  id:          string
  name:        string
  description: string
  completed:   boolean
  progress:    number   // 0–1
  target:      number
  current:     number
  type:        ObjectiveType
}

export interface Popup {
  text:   string
  color:  string
  expiry: number   // tick
}

export interface GameState {
  score:      number
  lives:      number
  tick:       number
  timeLimit:  number | null
  objectives: GameObjective[]
  gameOver:   boolean
  won:        boolean
  message:    string
  popups:     Popup[]
}

export const OBJECTIVES_PRESETS: Omit<GameObjective, 'current'|'progress'|'completed'>[] = [
  { id:'survive_500', name:'Survive 500 ticks',     description:'Keep the simulation running',    type:'tick_count',     target:500  },
  { id:'grow_life',   name:'Reach bio > 0.5',        description:'Grow bio potential to 0.5 avg',  type:'reach_bio',      target:0.5  },
  { id:'spawn_10',    name:'Spawn 10 agents',         description:'Have 10 agents alive at once',   type:'spawn_agents',   target:10   },
  { id:'reduce_ent',  name:'Entropy below 0.2',       description:'Keep entropy under control',     type:'reduce_entropy', target:0.2  },
  { id:'max_info',    name:'Info avg > 100',           description:'Build an information network',   type:'max_info',       target:100  },
]

// Field indices (mirrors inline sim)
const FE   = 0
const FS   = 3
const FI   = 2
const FBIO = 10

export class GameRulesetEngine {
  state: GameState = {
    score:0, lives:3, tick:0, timeLimit:null,
    objectives:[], gameOver:false, won:false,
    message:'', popups:[],
  }

  playtestMode = false

  // ── Presets ───────────────────────────────────────────────────────────

  loadPreset(preset: 'survival' | 'ecosystem' | 'civilization' | 'custom'): void {
    this.state.score     = 0
    this.state.lives     = 3
    this.state.gameOver  = false
    this.state.won       = false
    this.state.popups    = []

    const makeObj = (id: string): GameObjective => {
      const base = OBJECTIVES_PRESETS.find(p => p.id === id)!
      return { ...base, current:0, progress:0, completed:false }
    }

    switch (preset) {
      case 'survival':
        this.state.objectives = [makeObj('survive_500'), makeObj('reduce_ent')]
        this.state.timeLimit  = 1000
        this.state.message    = 'Keep entropy below 0.2 for 500 ticks!'
        break
      case 'ecosystem':
        this.state.objectives = [makeObj('grow_life'), makeObj('spawn_10')]
        this.state.timeLimit  = null
        this.state.message    = 'Grow life and spawn 10 agents!'
        break
      case 'civilization':
        this.state.objectives = [makeObj('max_info'), makeObj('spawn_10')]
        this.state.timeLimit  = null
        this.state.message    = 'Build an information civilization!'
        break
      case 'custom':
        this.state.objectives = []
        this.state.message    = 'Custom game — add your own objectives.'
        break
    }
  }

  addObjective(id: string): void {
    const base = OBJECTIVES_PRESETS.find(p => p.id === id)
    if (!base) return
    if (this.state.objectives.some(o => o.id === id)) return
    this.state.objectives.push({ ...base, current:0, progress:0, completed:false })
  }

  removeObjective(id: string): void {
    this.state.objectives = this.state.objectives.filter(o => o.id !== id)
  }

  // ── Per-tick evaluation ───────────────────────────────────────────────

  tick(
    simTick:    number,
    buf:        Float32Array,
    W:          number, H: number, D: number, NF: number,
    agentCount: number,
  ): string[] {
    if (this.state.gameOver || !this.playtestMode) return []
    this.state.tick = simTick
    const messages: string[] = []

    const SZ = W * H * D
    let sumS = 0, sumB = 0, sumI = 0, sumE = 0
    for (let i = 0; i < SZ; i++) {
      const b = i * NF
      sumS += buf[b + FS]
      sumB += buf[b + FBIO]
      sumI += buf[b + FI]
      sumE += buf[b + FE]
    }
    const avgS = sumS / SZ
    const avgB = sumB / SZ
    const avgI = sumI / SZ

    // Update objective progress
    for (const obj of this.state.objectives) {
      if (obj.completed) continue

      switch (obj.type) {
        case 'tick_count':     obj.current = simTick;         break
        case 'reach_bio':      obj.current = avgB;            break
        case 'spawn_agents':   obj.current = agentCount;      break
        case 'reduce_entropy': obj.current = 1 - avgS;        break
        case 'max_info':       obj.current = avgI;            break
        case 'survival':       obj.current = simTick;         break
      }

      const met =
        obj.type === 'reduce_entropy' ? avgS <= obj.target
          : obj.current >= obj.target

      obj.progress = Math.min(1,
        obj.type === 'reduce_entropy'
          ? Math.max(0, (1 - avgS / obj.target))
          : obj.current / obj.target,
      )

      if (met) {
        obj.completed   = true
        this.state.score += 100
        this.addPopup(`✓ ${obj.name}  +100 pts`, '#40c060', simTick)
        messages.push(`Objective complete: ${obj.name}`)
      }
    }

    // Win: all objectives complete
    if (this.state.objectives.length && this.state.objectives.every(o => o.completed)) {
      this.state.won      = true
      this.state.gameOver = true
      this.state.score   += 500
      this.addPopup('🏆 YOU WIN!  +500 pts', '#ffd700', simTick)
      messages.push('GAME WON')
    }

    // Lose: entropy critical
    if (avgS > 0.95) {
      this.state.lives--
      this.addPopup(`💀 Entropy collapse! Lives: ${this.state.lives}`, '#e04040', simTick)
      messages.push(`Life lost — entropy ${avgS.toFixed(3)}`)
      if (this.state.lives <= 0) {
        this.state.gameOver = true
        messages.push('GAME OVER — entropy collapsed the world')
      }
    }

    // Time limit
    if (this.state.timeLimit !== null && simTick >= this.state.timeLimit && !this.state.won) {
      this.state.gameOver = true
      this.addPopup('⏰ Time up!', '#e09030', simTick)
      messages.push('TIME UP')
    }

    // Passive complexity score every 50 ticks
    if (simTick % 50 === 0) {
      const complexity = (avgI / 100 + avgB * 5) * Math.max(0, 1 - avgS)
      const pts        = Math.floor(complexity * 10)
      if (pts > 0) {
        this.state.score += pts
        this.addPopup(`+${pts} complexity`, '#6080ff', simTick)
      }
    }

    // Expire old popups
    this.state.popups = this.state.popups.filter(p => p.expiry > simTick)

    return messages
  }

  addPopup(text: string, color: string, currentTick: number): void {
    this.state.popups.push({ text, color, expiry: currentTick + 80 })
  }

  reset(): void {
    this.state.score    = 0
    this.state.lives    = 3
    this.state.tick     = 0
    this.state.gameOver = false
    this.state.won      = false
    this.state.popups   = []
    this.state.objectives.forEach(o => { o.completed = false; o.current = 0; o.progress = 0 })
  }

  exportLevel(): string {
    return JSON.stringify({
      format:     'reality_engine_level_v1',
      objectives: this.state.objectives,
      timeLimit:  this.state.timeLimit,
      lives:      this.state.lives,
      message:    this.state.message,
    }, null, 2)
  }

  importLevel(json: string): void {
    const data = JSON.parse(json)
    if (data.objectives) this.state.objectives = data.objectives
    if (data.timeLimit  !== undefined) this.state.timeLimit  = data.timeLimit
    if (data.lives      !== undefined) this.state.lives      = data.lives
    if (data.message)                  this.state.message    = data.message
  }
}
