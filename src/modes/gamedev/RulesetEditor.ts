/**
 * RulesetEngine — visual rule system for Game Dev mode.
 *
 * A Rule = Condition + Action.
 * Conditions fire when a field stat crosses a threshold, agent count
 * hits a value, a tick interval elapses, or an event spike occurs.
 * Actions award points, spawn agents, set fields, or end the game.
 *
 * Usage:
 *   const rs = new RulesetEngine()
 *   rs.rules = rs.defaultRules()
 *   // each sim tick:
 *   const messages = rs.tick(simTick, buf, W, H, D, NF)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConditionType =
  | 'field_above'
  | 'field_below'
  | 'agent_count_above'
  | 'agent_count_below'
  | 'tick_interval'
  | 'event_spike'

export type ActionType =
  | 'award_points'
  | 'deduct_points'
  | 'spawn_agents'
  | 'trigger_hazard'
  | 'set_field_global'
  | 'end_game'
  | 'log_event'

export interface RuleCondition {
  type: ConditionType
  /** Field index (0–13) for field_above / field_below conditions */
  fieldIndex?: number
  threshold?: number
  /** Agent count for agent_count_* conditions */
  agentCount?: number
  /** Tick modulus for tick_interval */
  interval?: number
}

export interface RuleAction {
  type: ActionType
  /** Points to award / deduct */
  value?: number
  /** Message shown in event log */
  message?: string
  /** Field index + value for set_field_global */
  fieldIndex?: number
  fieldValue?: number
}

export interface GameRule {
  id: string
  name: string
  active: boolean
  condition: RuleCondition
  action: RuleAction
  /** Minimum ticks between firings (0 = fire every tick while condition holds) */
  cooldownTicks: number
  lastFiredTick: number
  firedCount: number
}

// ── Field index constants (mirrors SimWorker) ─────────────────────────────────
const FE   = 0   // energy
const FS   = 3   // entropy
const FBIO = 10  // bio potential

// ── RulesetEngine ─────────────────────────────────────────────────────────────

export class RulesetEngine {
  rules: GameRule[] = []
  score    = 0
  gameOver = false
  /** External agent count — set by the agent system each tick */
  agentCount = 0

  /** Factory: sensible starter rules for a new game world. */
  defaultRules(): GameRule[] {
    return [
      {
        id: 'r_life_emerges',
        name: 'Life Emerges',
        active: true,
        cooldownTicks: 100,
        lastFiredTick: 0,
        firedCount: 0,
        condition: { type: 'field_above', fieldIndex: FBIO, threshold: 0.5 },
        action: { type: 'award_points', value: 100, message: 'Life emerged! +100 pts' },
      },
      {
        id: 'r_entropy_death',
        name: 'Entropy Death',
        active: true,
        cooldownTicks: 0,
        lastFiredTick: 0,
        firedCount: 0,
        condition: { type: 'field_above', fieldIndex: FS, threshold: 0.95 },
        action: { type: 'end_game', message: 'World collapsed into entropy.' },
      },
      {
        id: 'r_energy_low',
        name: 'Energy Depletion',
        active: true,
        cooldownTicks: 200,
        lastFiredTick: 0,
        firedCount: 0,
        condition: { type: 'field_below', fieldIndex: FE, threshold: 5 },
        action: { type: 'deduct_points', value: 50, message: 'Energy critical! −50 pts' },
      },
      {
        id: 'r_periodic_spawn',
        name: 'Periodic Agent Spawn',
        active: false,
        cooldownTicks: 200,
        lastFiredTick: 0,
        firedCount: 0,
        condition: { type: 'tick_interval', interval: 200 },
        action: { type: 'spawn_agents', value: 3, message: '3 agents spawned' },
      },
    ]
  }

  /**
   * Evaluate all active rules against the current sim state.
   * Returns an array of triggered messages to show in the event log.
   *
   * @param simTick  Current simulation tick
   * @param buf      Flat field buffer (W×H×D×NF)
   * @param W,H,D    Grid dimensions
   * @param NF       Fields per cell
   */
  tick(
    simTick: number,
    buf: Float32Array,
    W: number,
    H: number,
    D: number,
    NF: number,
  ): string[] {
    if (this.gameOver) return []

    const SZ = W * H * D
    const messages: string[] = []

    // Compute per-field averages once (cheaper than per-rule loops)
    const fieldAvg = new Float32Array(NF)
    for (let i = 0; i < SZ; i++) {
      const base = i * NF
      for (let f = 0; f < NF; f++) fieldAvg[f] += buf[base + f]
    }
    for (let f = 0; f < NF; f++) fieldAvg[f] /= SZ

    for (const rule of this.rules) {
      if (!rule.active) continue
      if (
        rule.cooldownTicks > 0 &&
        simTick - rule.lastFiredTick < rule.cooldownTicks
      ) continue

      const triggered = this.evaluateCondition(rule.condition, fieldAvg, simTick)
      if (!triggered) continue

      rule.lastFiredTick = simTick
      rule.firedCount++

      this.applyAction(rule.action)
      if (rule.action.message) messages.push(rule.action.message)
    }

    return messages
  }

  private evaluateCondition(
    cond: RuleCondition,
    fieldAvg: Float32Array,
    simTick: number,
  ): boolean {
    switch (cond.type) {
      case 'field_above':
        return fieldAvg[cond.fieldIndex ?? FBIO] > (cond.threshold ?? 0.5)
      case 'field_below':
        return fieldAvg[cond.fieldIndex ?? FE] < (cond.threshold ?? 5)
      case 'agent_count_above':
        return this.agentCount > (cond.agentCount ?? 0)
      case 'agent_count_below':
        return this.agentCount < (cond.agentCount ?? 1)
      case 'tick_interval':
        return cond.interval != null && simTick % cond.interval === 0
      case 'event_spike':
        return false  // wired up externally via onEventSpike()
    }
  }

  private applyAction(action: RuleAction): void {
    switch (action.type) {
      case 'award_points':
        this.score += action.value ?? 0
        break
      case 'deduct_points':
        this.score -= action.value ?? 0
        break
      case 'end_game':
        this.gameOver = true
        break
      case 'spawn_agents':
        // Handled by the caller observing returned messages
        break
      case 'log_event':
        break
      case 'trigger_hazard':
        break
      case 'set_field_global':
        break
    }
  }

  /** Reset score and game-over state for a new playtest session. */
  reset(): void {
    this.score    = 0
    this.gameOver = false
    this.rules.forEach(r => { r.lastFiredTick = 0; r.firedCount = 0 })
  }

  /** Add a new blank rule ready for the user to configure. */
  addRule(): GameRule {
    const r: GameRule = {
      id: `r_${Date.now()}`,
      name: 'New Rule',
      active: false,
      cooldownTicks: 100,
      lastFiredTick: 0,
      firedCount: 0,
      condition: { type: 'field_above', fieldIndex: FBIO, threshold: 0.5 },
      action: { type: 'award_points', value: 10, message: 'Rule triggered' },
    }
    this.rules.push(r)
    return r
  }

  removeRule(id: string): void {
    this.rules = this.rules.filter(r => r.id !== id)
  }

  /** Export ruleset as JSON for save/load. */
  serialize(): string {
    return JSON.stringify({ rules: this.rules, score: this.score }, null, 2)
  }

  /** Restore from JSON produced by serialize(). */
  deserialize(json: string): void {
    try {
      const d = JSON.parse(json)
      this.rules = d.rules ?? []
      this.score = d.score ?? 0
      this.gameOver = false
    } catch { /* ignore corrupt saves */ }
  }
}
