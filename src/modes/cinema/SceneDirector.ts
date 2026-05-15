/**
 * SceneDirector — Claude API integration for AI-directed cinematics.
 *
 * ask(prompt, simContext) → DirectorResponse
 * startAutoDirecting(intervalTicks, getContext, onResponse)
 * stopAutoDirecting()
 *
 * DirectorResponse: { narration, script, cameraHint, markerLabel }
 *   narration   — human-readable description of what is happening
 *   script      — JS code the user can execute in the inline sim console
 *   cameraHint  — { x, y, fov? } suggestion for next camera keyframe
 *   markerLabel — short label for the timeline marker
 */

export interface SimContext {
  tick:       number
  avgEnergy:  number
  avgEntropy: number
  avgInfo:    number
  avgBio:     number
  agentCount: number
}

export interface DirectorResponse {
  narration:   string
  script:      string
  cameraHint:  { x: number; y: number; fov?: number }
  markerLabel: string
}

export class SceneDirector {
  private apiKey      = ''
  private autoHandle  = 0
  private lastTick    = -9999
  private intervalTicks: number

  constructor(intervalTicks = 420) {   // ~28s at 15fps
    this.intervalTicks = intervalTicks
  }

  setApiKey(key: string): void { this.apiKey = key }

  async ask(userPrompt: string, ctx: SimContext): Promise<DirectorResponse> {
    if (!this.apiKey) {
      return this._fallback(ctx)
    }
    const systemMsg = `You are the director of a physics simulation called Reality Engine.
The user describes what cinematic moment they want. You reply with JSON exactly matching this schema:
{
  "narration":   "A vivid one-sentence description of what is visually happening.",
  "script":      "JavaScript code (max 5 lines) using set_(x,y,field,value) to alter the simulation.",
  "cameraHint":  { "x": <0-36>, "y": <0-28>, "fov": <30-90> },
  "markerLabel": "Short label for the timeline marker (max 25 chars)"
}
Reply ONLY with valid JSON, no markdown fences.`

    const userMsg = `Simulation state: tick=${ctx.tick}, energy=${ctx.avgEnergy.toFixed(1)}, entropy=${ctx.avgEntropy.toFixed(4)}, info=${ctx.avgInfo.toFixed(1)}, bio=${ctx.avgBio.toFixed(3)}, agents=${ctx.agentCount}\nDirector prompt: ${userPrompt}`

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
          max_tokens: 300,
          system:     systemMsg,
          messages:   [{ role: 'user', content: userMsg }],
        }),
      })
      const data = await res.json()
      const text = data?.content?.[0]?.text ?? '{}'
      return JSON.parse(text) as DirectorResponse
    } catch {
      return this._fallback(ctx)
    }
  }

  startAutoDirecting(
    getContext:  () => SimContext,
    onResponse:  (r: DirectorResponse) => void,
  ): void {
    if (this.autoHandle) return
    const prompts = [
      'Create a dramatic energy surge',
      'Something beautiful is emerging from chaos',
      'Life is beginning to take hold',
      'Show the entropy at its peak',
      'A moment of crystalline order',
    ]
    let pi = 0
    const check = () => {
      const ctx = getContext()
      if (ctx.tick - this.lastTick >= this.intervalTicks) {
        this.lastTick = ctx.tick
        this.ask(prompts[pi % prompts.length], ctx).then(onResponse)
        pi++
      }
    }
    this.autoHandle = window.setInterval(check, 2000) as unknown as number
  }

  stopAutoDirecting(): void {
    if (this.autoHandle) { clearInterval(this.autoHandle); this.autoHandle = 0 }
  }

  // ── private ─────────────────────────────────────────────────────────────

  private _fallback(ctx: SimContext): DirectorResponse {
    const intense = ctx.avgEnergy > 200 || ctx.avgEntropy > 0.5
    return {
      narration:   intense
        ? 'A chaotic surge of energy tears through the simulation field.'
        : 'The simulation hums with quiet complexity, patterns emerging from the field.',
      script:      '',
      cameraHint:  { x: 18, y: 14, fov: 60 },
      markerLabel: `Tick ${ctx.tick}`,
    }
  }
}
