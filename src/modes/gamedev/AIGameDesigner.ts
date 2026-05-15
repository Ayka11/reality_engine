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
    void msg
    const templates: DesignerResult[] = [
      {
        advice: 'Try a survival challenge: keep entropy below 0.2 while growing bio potential. Entropy will creep up — you\'ll need to inject energy to fight it.',
        rulesetJSON: JSON.stringify({
          objectives: [
            { id:'reduce_ent', name:'Entropy below 0.2', type:'reduce_entropy', target:0.2, description:'Keep entropy under control' },
            { id:'survive_500', name:'Survive 500 ticks', type:'tick_count', target:500, description:'Keep the simulation running' },
          ],
          timeLimit: 800, lives: 3, message: 'Fight entropy — keep life alive!',
        }, null, 2),
        objective: 'Entropy below 0.2',
      },
      {
        advice: 'Build a civilization: grow information to 100+ average while keeping 10 agents alive. Information networks emerge when bio and energy are balanced.',
        rulesetJSON: JSON.stringify({
          objectives: [
            { id:'max_info',  name:'Info avg > 100',  type:'max_info',      target:100, description:'Build an information network' },
            { id:'spawn_10',  name:'Spawn 10 agents', type:'spawn_agents',  target:10,  description:'Have 10 agents alive at once' },
          ],
          timeLimit: null, lives: 5, message: 'Build an information civilization!',
        }, null, 2),
        objective: 'Info avg > 100',
      },
    ]
    const pick = templates[gs.score % templates.length]
    return pick
  }
}
