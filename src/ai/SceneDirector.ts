import { SimulationEngine } from '../simulation/SimulationEngine';
import { CivilizationSystem } from '../simulation/CivilizationSystem';
import { MetaLawEvolution } from '../simulation/MetaLawEvolution';
import { CELL_FIELDS, F } from '../core/CellState';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

interface DirectorResult {
  text: string;
  code: string | null;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export class SceneDirector {
  private sim: SimulationEngine;
  private civSystem?: CivilizationSystem;
  private metaLawEvol?: MetaLawEvolution;
  private history: Message[] = [];
  readonly worldLog: Array<{ tick: number; director: string; action: string }> = [];
  private autoInterval: ReturnType<typeof setInterval> | null = null;
  autoDirecting = false;
  apiKey = '';

  constructor(sim: SimulationEngine, civSystem?: CivilizationSystem, metaLawEvol?: MetaLawEvolution) {
    this.sim = sim;
    this.civSystem = civSystem;
    this.metaLawEvol = metaLawEvol;
    try { this.apiKey = localStorage.getItem('re_director_key') ?? ''; } catch {}
  }

  setApiKey(key: string): void {
    this.apiKey = key;
    try { localStorage.setItem('re_director_key', key); } catch {}
  }

  summarizeWorld(): string {
    const { grid, agents, laws } = this.sim;
    const { W, H, D, buffer, size } = grid;
    const NF = CELL_FIELDS;
    let totE = 0, totS = 0, totI = 0, totB = 0, totT = 0;
    for (let i = 0; i < size; i++) {
      const o = i * NF;
      totE += buffer[o + F.ENERGY];
      totS += buffer[o + F.ENTROPY];
      totI += buffer[o + F.INFORMATION];
      totB += buffer[o + F.BIO_POTENTIAL];
      totT += buffer[o + F.TEMPERATURE];
    }
    const all = agents.getAgents();
    const civs = this.civSystem?.civs ?? [];
    const activeLaws = laws.laws.filter(l => l.active);
    const recentEvs = this.sim.causal.recent(3);
    return `WORLD STATE at tick ${this.sim.tick}:
Grid: ${W}×${H}×${D} voxels
Energy: ${Math.round(totE).toLocaleString()} total (avg ${(totE / size).toFixed(1)}/cell)
Entropy: ${(totS / size).toFixed(4)} avg (${totS / size < 0.1 ? 'low — ordered' : 'high — chaotic'})
Information: ${Math.round(totI).toLocaleString()} total
Bio potential: ${(totB / size).toFixed(3)} avg
Temperature: ${(totT / size).toFixed(1)}°C avg
Agents: ${all.length} active, behaviors: ${[...new Set(all.map(a => a.behavior))].join(', ') || 'none'}
Civilizations: ${civs.length} (${civs.map(c => `${c.name} pop:${Math.round(c.population)} tech:${c.techLevel}`).join(', ') || 'none'})
Active laws: ${activeLaws.map(l => l.name).join(', ') || 'none'}
MetaLaw cycle: ${this.metaLawEvol?.cycleCount ?? 0} — ${this.metaLawEvol?.lastAction ?? 'n/a'}
Recent causal events: ${recentEvs.map(e => `${e.type}@(${e.x},${e.y},${e.z}) Δ${e.delta}`).join('; ') || 'none'}
World age: ${this.sim.tick} ticks`;
  }

  async ask(userMessage: string): Promise<DirectorResult> {
    if (!this.apiKey) {
      return { text: 'API key not set. Enter your Anthropic API key in the Director panel.', code: null };
    }

    const worldState = this.summarizeWorld();
    const systemPrompt = `You are the AI director of a physics simulation called Reality Engine.
You have full control over the simulation world through a JavaScript API.

The simulation models energy fields, entropy, information, temperature, density,
bio-potential, causality chains, emergent entities, civilizations, and meta-laws
that themselves evolve.

WORLD API available in scripts (write as executable JS):
world.sphere(cx,cy,cz,r,'energy',value)  — inject energy sphere
world.box(x1,y1,z1,x2,y2,z2,'density',v) — fill region
world.noise('temperature',scale,amp)      — add thermal noise
world.spawnEntity(x,y,z)                 — spawn organism
world.tick(n)                            — advance N steps
world.preset('life'|'burst'|'ecosystem'|'vortex'|'wave')
world.print(msg)                         — log message

When asked to DO something, respond with:
1. A brief description (1-2 sentences)
2. A fenced \`\`\`js code block using the world API
3. What to expect after running it

When asked to DESCRIBE or ANALYZE, give a vivid scientific + poetic description.
Keep responses concise. Use simulation terminology naturally.`;

    this.history.push({ role: 'user', content: `${worldState}\n\nUser: ${userMessage}` });

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          max_tokens: 800,
          system: systemPrompt,
          messages: this.history.slice(-6),
        }),
      });
      const data = await resp.json();
      if (data.error) {
        const errText = `API error: ${data.error.message}`;
        this.history.pop();
        return { text: errText, code: null };
      }
      const text: string = data.content?.find((b: { type: string }) => b.type === 'text')?.text ?? 'No response';
      this.history.push({ role: 'assistant', content: text });
      if (this.history.length > 20) this.history = this.history.slice(-20);
      const codeMatch = text.match(/```(?:js|javascript)?\n([\s\S]*?)```/);
      return { text, code: codeMatch?.[1]?.trim() ?? null };
    } catch (e: unknown) {
      this.history.pop();
      const msg = e instanceof Error ? e.message : String(e);
      return { text: `Director error: ${msg}`, code: null };
    }
  }

  startAutoDirecting(intervalMs = 25000): void {
    this.autoDirecting = true;
    const prompts = [
      'Something interesting is about to happen. Make it so.',
      'The world feels too stable. Introduce a dramatic perturbation.',
      'Create a beautiful pattern in the energy field.',
      'The entropy is getting high. Seed some new order.',
      'Spawn life where conditions are right.',
      'Write a one-sentence history of what just happened in this world.',
    ];
    this.autoInterval = setInterval(async () => {
      const p = prompts[Math.floor(Math.random() * prompts.length)];
      const result = await this.ask(p);
      if (result.code) {
        this.worldLog.push({ tick: this.sim.tick, director: p, action: result.text.slice(0, 120) });
        if (this.worldLog.length > 50) this.worldLog.shift();
      }
    }, intervalMs);
  }

  stopAutoDirecting(): void {
    this.autoDirecting = false;
    if (this.autoInterval) { clearInterval(this.autoInterval); this.autoInterval = null; }
  }
}
