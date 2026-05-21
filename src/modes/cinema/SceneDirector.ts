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
      return this._fallback(userPrompt, ctx)
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
      return this._fallback(userPrompt, ctx)
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

  private _fallback(userPrompt: string, ctx: SimContext): DirectorResponse {
    const lo = userPrompt.toLowerCase()

    if (/volcan|lava|erupt|magma|hot|fire|flame|burn/.test(lo)) return {
      narration:   'Molten energy erupts from the center — a volcanic surge tears through the simulation, scattering entropy as lava consumes everything in its path.',
      script:      'for(let i=0;i<15;i++){const a=Math.random()*6.28,r=1+Math.random()*6;const vx=(18+r*Math.cos(a))|0,vy=(14+r*Math.sin(a))|0;set_(vx,vy,0,600+Math.random()*400);set_(vx,vy,3,0.5+Math.random()*0.5);}',
      cameraHint:  { x: 18, y: 14, fov: 45 },
      markerLabel: '🌋 Volcanic Eruption',
    }

    if (/explo|burst|detonate|bang|blast|shock/.test(lo)) return {
      narration:   'A shockwave detonates at the center — energy radiates outward in all directions, scattering chaotic entropy across the entire field.',
      script:      'for(let i=0;i<25;i++){const a=Math.random()*6.28,r=Math.random()*14;set_((18+r*Math.cos(a))|0,(14+r*Math.sin(a))|0,0,Math.random()*1000);set_((18+r*Math.cos(a))|0,(14+r*Math.sin(a))|0,3,Math.random());}',
      cameraHint:  { x: 18, y: 14, fov: 75 },
      markerLabel: '💥 Explosion',
    }

    if (/ocean|sea|water|wave|flood|flow|river|lake/.test(lo)) return {
      narration:   'Vast tides sweep across the lower field — a deep ocean of steady energy emerges, entropy kept low by the calming flow of information currents.',
      script:      'for(let y=8;y<H;y++)for(let x=0;x<W;x++){set_(x,y,0,150+Math.random()*100);set_(x,y,3,0.02+Math.random()*0.03);set_(x,y,2,50+Math.random()*100);}',
      cameraHint:  { x: 18, y: 20, fov: 70 },
      markerLabel: '🌊 Ocean',
    }

    if (/life|bio|forest|tree|grow|nature|plant|jungle|organism/.test(lo)) return {
      narration:   'Life stirs across the field — bio potential blooms at scattered nodes, drawing energy into complex structures as information weaves through living tissue.',
      script:      'for(let i=0;i<35;i++){const bx=2+Math.random()*32|0,by=2+Math.random()*24|0;set_(bx,by,10,0.5+Math.random()*0.5);set_(bx,by,0,200+Math.random()*300);set_(bx,by,2,100+Math.random()*200);}',
      cameraHint:  { x: 18, y: 14, fov: 55 },
      markerLabel: '🧬 Life Emerging',
    }

    if (/freez|ice|cold|winter|arctic|tundra|snow/.test(lo)) return {
      narration:   'A glacial cold sweeps the field — energy drains into crystalline stillness, entropy collapses to near-zero as the simulation freezes into ordered silence.',
      script:      'for(let y=0;y<H;y++)for(let x=0;x<W;x++){set_(x,y,0,buf[(y*W+x)*NF]*0.15);set_(x,y,3,buf[(y*W+x)*NF+3]*0.05);}',
      cameraHint:  { x: 18, y: 14, fov: 60 },
      markerLabel: '🧊 Freeze',
    }

    if (/chaos|storm|entropy|disorder|random|turbul/.test(lo)) return {
      narration:   'Entropy storms across the field — chaotic bursts of disordered energy scatter randomly, overwhelming the simulation with maximum disorder.',
      script:      'for(let i=0;i<45;i++){set_(Math.random()*W|0,Math.random()*H|0,3,0.6+Math.random()*0.4);set_(Math.random()*W|0,Math.random()*H|0,0,Math.random()*1000);}',
      cameraHint:  { x: 18, y: 14, fov: 80 },
      markerLabel: '🌀 Chaos Storm',
    }

    if (/order|cryst|calm|peace|still|quiet|harmoni|structur/.test(lo)) return {
      narration:   'A crystalline order settles over the field — entropy dissolves, information pathways align, and the simulation hums in perfect structured harmony.',
      script:      'for(let y=0;y<H;y++)for(let x=0;x<W;x++){set_(x,y,3,buf[(y*W+x)*NF+3]*0.08);set_(x,y,2,Math.min(999,buf[(y*W+x)*NF+2]+20));}',
      cameraHint:  { x: 18, y: 14, fov: 50 },
      markerLabel: '🔷 Crystalline Order',
    }

    if (/desert|arid|dry|sand|dune/.test(lo)) return {
      narration:   'The simulation bakes under a scorching field — bio potential evaporates, energy pulses low and steady across a vast arid expanse devoid of complexity.',
      script:      'for(let y=0;y<H;y++)for(let x=0;x<W;x++){set_(x,y,0,30+Math.random()*60);set_(x,y,10,0);set_(x,y,3,0.005+Math.random()*0.01);}',
      cameraHint:  { x: 18, y: 14, fov: 65 },
      markerLabel: '🏜️ Desert',
    }

    if (/city|urban|civil|town|metro|settl|civiliz/.test(lo)) return {
      narration:   'A civilization crystallizes — dense information networks pulse between high-energy nodes, bio potential clustering into the ordered complexity of urban life.',
      script:      'for(let i=0;i<30;i++){const cx=4+Math.random()*28|0,cy=4+Math.random()*20|0;set_(cx,cy,0,500+Math.random()*400);set_(cx,cy,2,400+Math.random()*500);set_(cx,cy,10,0.4+Math.random()*0.4);}',
      cameraHint:  { x: 18, y: 14, fov: 50 },
      markerLabel: '🏙️ City Rising',
    }

    if (/space|star|cosmos|galaxy|nebula|void|dark/.test(lo)) return {
      narration:   'The field darkens to cosmic void — sparse starlike points of intense energy punctuate the emptiness, vast distances of near-silence between stellar cores.',
      script:      'for(let y=0;y<H;y++)for(let x=0;x<W;x++)set_(x,y,0,0);for(let i=0;i<8;i++){const sx=Math.random()*W|0,sy=Math.random()*H|0;set_(sx,sy,0,600+Math.random()*400);}',
      cameraHint:  { x: 18, y: 14, fov: 80 },
      markerLabel: '🌌 Cosmic Void',
    }

    if (/energy|power|fuel|boost|surge|inject/.test(lo)) return {
      narration:   'An energy surge floods the simulation — high-power nodes ignite across the field, cascading into a wave of complex activity.',
      script:      'for(let i=0;i<20;i++){set_(Math.random()*W|0,Math.random()*H|0,0,400+Math.random()*600);}',
      cameraHint:  { x: 18, y: 14, fov: 60 },
      markerLabel: '⚡ Energy Surge',
    }

    // Generic fallback — still responds to the prompt text
    const intense = ctx.avgEnergy > 200 || ctx.avgEntropy > 0.5
    return {
      narration:   intense
        ? `Responding to "${userPrompt.slice(0, 40)}" — a chaotic surge tears through the simulation field.`
        : `Responding to "${userPrompt.slice(0, 40)}" — subtle patterns emerge from the field's quiet complexity.`,
      script:      'for(let i=0;i<15;i++){set_(Math.random()*W|0,Math.random()*H|0,0,300+Math.random()*400);set_(Math.random()*W|0,Math.random()*H|0,2,100+Math.random()*200);}',
      cameraHint:  { x: 18, y: 14, fov: 60 },
      markerLabel: `Scene: ${userPrompt.slice(0, 20)}`,
    }
  }
}
