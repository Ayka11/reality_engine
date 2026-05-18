/**
 * AgentPlanner — LLM-based goal assignment for agent societies.
 *
 * Patterns inspired by:
 *   LangChain   — chained reasoning steps
 *   CrewAI      — role-based multi-agent task delegation
 *   AutoGen     — agents conversing to reach a shared plan
 *
 * The browser calls the Claude API directly (same pattern as SceneDirector).
 * Without an API key the planner returns heuristic goals from world state.
 */

import type { Agent } from './AgentSystem'

export interface SimContext {
  tick:        number
  avgEnergy:   number
  avgEntropy:  number
  avgInfo:     number
  avgBio:      number
  agentCount:  number
}

interface CrewRole {
  name:  string
  goal:  string
  bias:  string   // key phrase that biases genome weights
}

// Fixed "crew" of roles that agents are assigned round-robin (CrewAI pattern)
const CREW_ROLES: CrewRole[] = [
  { name: 'Scout',     goal: 'Explore uncharted territory and map energy sources', bias: 'explore'  },
  { name: 'Harvester', goal: 'Gather maximum energy from high-density zones',       bias: 'energy'   },
  { name: 'Architect', goal: 'Build information complexity in fertile areas',        bias: 'info'     },
  { name: 'Guardian',  goal: 'Protect civilization from entropy collapse',           bias: 'entropy'  },
  { name: 'Breeder',   goal: 'Grow the population in bio-rich zones',               bias: 'bio'      },
]

export class AgentPlanner {
  private apiKey = ''
  private lastPlan = ''

  setApiKey(key: string): void { this.apiKey = key }
  hasKey(): boolean             { return this.apiKey.length > 0 }

  // ── Single group plan (LangChain-style chain) ───────────────────────────

  async groupPlan(survivors: Agent[], ctx: SimContext): Promise<string> {
    if (!this.apiKey) return this._heuristicPlan(ctx)

    const agentDescs = survivors
      .slice(0, 5)
      .map((a, i) =>
        `Agent ${i+1} (civ${a.civId}): state=${a.state}, energy=${a.energy.toFixed(2)}, age=${a.age}, score=${a.score.toFixed(1)}`)
      .join('\n')

    const prompt =
`You are directing a society of AI agents in a physics simulation.
Simulation state (tick ${ctx.tick}):
  Energy: ${ctx.avgEnergy.toFixed(1)} | Entropy: ${ctx.avgEntropy.toFixed(4)} | Info: ${ctx.avgInfo.toFixed(1)} | Bio: ${ctx.avgBio.toFixed(3)}

Top surviving agents:
${agentDescs}

Give the entire society ONE concrete 1-sentence survival goal for the next 200 ticks.
Focus on the most urgent need. Use one of these action words: gather, explore, avoid entropy, build complexity, grow population.
Reply with ONLY the goal sentence, no extra text.`

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':                            'application/json',
          'x-api-key':                               this.apiKey,
          'anthropic-version':                       '2023-06-01',
          'anthropic-dangerous-direct-browser-calls': 'true',
        },
        body: JSON.stringify({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 80,
          messages:   [{ role: 'user', content: prompt }],
        }),
      })
      const data = await res.json()
      const plan = (data?.content?.[0]?.text ?? '').trim()
      this.lastPlan = plan || this._heuristicPlan(ctx)
      return this.lastPlan
    } catch {
      return this._heuristicPlan(ctx)
    }
  }

  // ── AutoGen-style: two agents debate the best strategy ──────────────────

  async debatePlan(ctx: SimContext): Promise<{ strategist: string; tactician: string; consensus: string }> {
    if (!this.apiKey) {
      const plan = this._heuristicPlan(ctx)
      return { strategist: plan, tactician: plan, consensus: plan }
    }

    const world = `Energy=${ctx.avgEnergy.toFixed(1)}, Entropy=${ctx.avgEntropy.toFixed(4)}, Info=${ctx.avgInfo.toFixed(1)}, Bio=${ctx.avgBio.toFixed(3)}, Agents=${ctx.agentCount}`

    const strategistPrompt = `You are the Strategist agent. World: ${world}. What is the long-term survival priority? Answer in 1 sentence.`
    const tacticianPrompt  = `You are the Tactician agent. World: ${world}. What immediate action maximizes agent survival? Answer in 1 sentence.`

    const call = (content: string) =>
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':                            'application/json',
          'x-api-key':                               this.apiKey,
          'anthropic-version':                       '2023-06-01',
          'anthropic-dangerous-direct-browser-calls': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 60,
          messages: [{ role: 'user', content }],
        }),
      }).then(r => r.json()).then(d => (d?.content?.[0]?.text ?? '').trim())

    try {
      const [strategist, tactician] = await Promise.all([call(strategistPrompt), call(tacticianPrompt)])
      const consensusPrompt = `Strategist says: "${strategist}"\nTactician says: "${tactician}"\nWrite a 1-sentence consensus plan combining both views.`
      const consensus = await call(consensusPrompt)
      return { strategist, tactician, consensus: consensus || strategist }
    } catch {
      const plan = this._heuristicPlan(ctx)
      return { strategist: plan, tactician: plan, consensus: plan }
    }
  }

  // ── Assign CrewAI-style roles to agents ─────────────────────────────────

  assignRoles(agents: Agent[]): void {
    agents.forEach((a, i) => {
      const role = CREW_ROLES[i % CREW_ROLES.length]
      a.plan = `[${role.name}] ${role.goal}`
      // planBias is set by AgentSystem.applyPlan() after the plan string is set
    })
  }

  getRoleNames(): string[] {
    return CREW_ROLES.map(r => r.name)
  }

  // ── Heuristic fallback (no API key needed) ──────────────────────────────

  private _heuristicPlan(ctx: SimContext): string {
    if (ctx.avgEntropy > 0.6)  return 'Avoid entropy — seek ordered low-entropy regions'
    if (ctx.avgEnergy  < 50)   return 'Gather energy — explore for high-energy zones'
    if (ctx.avgBio     < 0.05) return 'Grow population — find bio-rich fertile territory'
    if (ctx.avgInfo    < 30)   return 'Build complexity — cluster and share information'
    return 'Explore territory and map the simulation landscape'
  }
}
