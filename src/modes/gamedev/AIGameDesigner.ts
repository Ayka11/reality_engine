/**
 * AIGameDesigner — Claude API assistant for game mechanic design.
 * Suggests objectives, win conditions, difficulty balance, and level concepts.
 * Returns parsed JSON rulesets the game engine can apply directly.
 */

export interface DesignerResult {
  advice:       string
  rulesetJSON:  string | null   // parsed JSON block from response
  objective:    string | null
}

export class AIGameDesigner {
  private history: Array<{ role: 'user' | 'assistant'; content: string }> = []
  apiKey = ''

  setApiKey(key: string): void { this.apiKey = key }

  async ask(
    userMessage: string,
    worldSummary: string,
    gameState: { score: number; lives: number },
  ): Promise<DesignerResult> {
    const system = `You are an AI Game Designer for Reality Engine — a physics simulation game engine.
The simulation fields: energy (0=FE), density (1), information (2=FI), entropy (3=FS), temperature (4), bio potential (10=FBIO).
Agents move toward energy, reproduce, and die from entropy.

Your job: help design fun game mechanics, objectives, win conditions, and level designs.

When suggesting objectives, output them as JSON in a fenced code block:
\`\`\`json
{
  "objectives": [
    {"id":"obj1","name":"Survive 300 ticks","type":"tick_count","target":300,"description":"Keep the simulation running"}
  ],
  "timeLimit": 600,
  "lives": 3,
  "message": "Survive the entropy storm!"
}
\`\`\`

Objective types: tick_count, reach_bio, spawn_agents, reduce_entropy, max_info.
Keep suggestions concrete and achievable. Think like an indie game designer. Be concise.`

    const userContent = `World: ${worldSummary}\nGame state: score=${gameState.score}, lives=${gameState.lives}\n\nRequest: ${userMessage}`
    this.history.push({ role: 'user', content: userContent })

    if (!this.apiKey) {
      return this._fallback(userMessage, gameState)
    }

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-calls': 'true',
        },
        body: JSON.stringify({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 600,
          system,
          messages:   this.history.slice(-8),
        }),
      })
      const data   = await res.json()
      const text   = (data?.content?.[0] as { text?: string })?.text ?? ''
      this.history.push({ role: 'assistant', content: text })
      if (this.history.length > 14) this.history = this.history.slice(-14)

      const jsonMatch = text.match(/```json\n([\s\S]*?)```/)
      const rulesetJSON = jsonMatch?.[1]?.trim() ?? null
      const objMatch    = text.match(/objective[:\s]+["']([^"']+)["']/i)

      return { advice: text, rulesetJSON, objective: objMatch?.[1] ?? null }
    } catch (err) {
      return { advice: `Designer unavailable: ${String(err)}`, rulesetJSON: null, objective: null }
    }
  }

  clearHistory(): void { this.history = [] }

  // ── private ─────────────────────────────────────────────────────────

  private _fallback(msg: string, gs: { score: number; lives: number }): DesignerResult {
    const lo = msg.toLowerCase()
    const wantsRuleset = /ruleset|objective|mission|challenge|goal|win|level|create|design|make|suggest|give me/.test(lo)

    const isSurvival = /surviv|entropy|danger|threat|hard|difficult|enemy/.test(lo)
    const isCiv      = /civil|city|urban|info|knowledge|network|complex/.test(lo)
    const isEco      = /eco|nature|bio|life|forest|organism|balance|ecosystem/.test(lo)
    const isExplore  = /explor|discover|travel|scout|expand|territory/.test(lo)

    if (wantsRuleset && isSurvival) return {
      advice: 'Survival challenge: fight entropy while keeping agents alive. Energy drains fast — inject fuel into low-entropy zones to stabilize the field.',
      rulesetJSON: JSON.stringify({
        objectives: [
          { id:'reduce_ent', name:'Entropy below 0.2', type:'reduce_entropy', target:0.2, description:'Keep entropy under control' },
          { id:'survive_500', name:'Survive 500 ticks', type:'tick_count', target:500, description:'Keep the simulation running' },
        ],
        timeLimit: 800, lives: 3, message: 'Fight entropy — keep life alive!',
      }, null, 2),
      objective: 'Entropy below 0.2',
    }

    if (wantsRuleset && isCiv) return {
      advice: 'Information civilization challenge: grow knowledge networks while sustaining a population of 10+ agents simultaneously.',
      rulesetJSON: JSON.stringify({
        objectives: [
          { id:'max_info', name:'Info avg > 100', type:'max_info', target:100, description:'Build an information network' },
          { id:'spawn_10', name:'10 agents alive', type:'spawn_agents', target:10, description:'Sustain a population' },
        ],
        timeLimit: null, lives: 5, message: 'Build an information civilization!',
      }, null, 2),
      objective: 'Info avg > 100',
    }

    if (wantsRuleset && isEco) return {
      advice: 'Ecosystem challenge: cultivate bio potential while keeping entropy low. Nature needs balance — energy and order must coexist.',
      rulesetJSON: JSON.stringify({
        objectives: [
          { id:'grow_life', name:'Bio potential > 0.5', type:'reach_bio', target:0.5, description:'Grow the ecosystem' },
          { id:'survive_300', name:'Survive 300 ticks', type:'tick_count', target:300, description:'Sustain the simulation' },
        ],
        timeLimit: 600, lives: 4, message: 'Let life flourish!',
      }, null, 2),
      objective: 'Bio potential > 0.5',
    }

    if (wantsRuleset) return {
      advice: 'Here\'s a balanced starter challenge: reach 500 ticks while growing bio potential and keeping entropy in check.',
      rulesetJSON: JSON.stringify({
        objectives: [
          { id:'survive_500', name:'Survive 500 ticks', type:'tick_count', target:500, description:'Keep the simulation running' },
          { id:'grow_life', name:'Bio potential > 0.3', type:'reach_bio', target:0.3, description:'Establish life in the field' },
        ],
        timeLimit: null, lives: 3, message: 'Build, grow, survive!',
      }, null, 2),
      objective: 'Survive 500 ticks',
    }

    // Conversational advice — no ruleset applied
    if (isSurvival) return {
      advice: `Survival tip: entropy is your main enemy. Paint low-entropy areas using the brush (field FS=3, value 0.01). Keep energy avg above 200 for agents to stay alive. Try "Design a survival level" to get a full ruleset.`,
      rulesetJSON: null, objective: null,
    }
    if (isCiv) return {
      advice: `Civilization advice: information grows when bio potential and energy coexist. Paint bio clusters near high-energy zones, then spawn 20 agents. Say "Create a civilization challenge" for a full ruleset.`,
      rulesetJSON: null, objective: null,
    }
    if (isEco) return {
      advice: `Ecosystem tip: aim for energy 200–400, entropy < 0.15, and scattered bio potential > 0.3. Try the "Ecosystem" preset in Playtest. Say "Design an ecosystem level" for objectives.`,
      rulesetJSON: null, objective: null,
    }
    if (isExplore) return {
      advice: `Explorer tip: set high exploreW (0.8) and seekInfoW (0.7) in Entity Behaviors, then use the Explorer preset. Spawn 20 agents for maximum territory coverage.`,
      rulesetJSON: null, objective: null,
    }

    // Generic conversational response
    const hint = gs.lives < 2
      ? `You're low on lives — reduce entropy first by painting energy into calm zones.`
      : gs.score > 100
        ? `Great progress with score ${gs.score}! Add an information objective for more challenge.`
        : `Try asking for a specific scenario: "design a survival level", "suggest ecosystem objectives", or "create a civilization challenge". The simulation has energy, entropy, info, and bio fields — mix them for interesting gameplay.`
    return { advice: hint, rulesetJSON: null, objective: null }
  }
}
