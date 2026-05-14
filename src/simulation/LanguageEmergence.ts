import { SimulationEngine } from './SimulationEngine';
import { F } from '../core/CellState';

interface SignalPattern {
  id: number;
  meaning: { type: string; value: string };
  firstSeen: number;
}

interface SignalEntry {
  tick: number;
  word: string;
  meaning: string;
}

export class LanguageSystem {
  private sim: SimulationEngine;
  readonly vocabulary: Map<string, SignalPattern> = new Map();
  readonly signalLog: SignalEntry[] = [];
  private readonly lexiconAge: Map<string, number> = new Map();
  private nextWordId = 1;
  communicationEvents = 0;
  private tickCount = 0;

  constructor(sim: SimulationEngine) {
    this.sim = sim;
  }

  tick(): void {
    if (++this.tickCount % 5 !== 0) return; // throttle
    const agents = this.sim.agents.getAgents();
    if (agents.length < 2) return;

    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const a = agents[i], b = agents[j];
        const dist = Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2);
        if (dist > 5) continue;

        const signal = this._encodeSignal(a);
        const meaning = this._decodeMeaning(a);
        const key = signal.join(',');

        if (this.vocabulary.has(key)) {
          // Receiver understands — boost information at receiver position
          const bi = this.sim.grid.idx(b.x, b.y, b.z);
          const buf = this.sim.grid.buffer;
          buf[bi + F.INFORMATION] = Math.min(999, buf[bi + F.INFORMATION] + 8);
          this.communicationEvents++;
        } else {
          const age = (this.lexiconAge.get(key) ?? 0) + 1;
          this.lexiconAge.set(key, age);
          if (age >= 5) {
            const wid = this.nextWordId++;
            this.vocabulary.set(key, { id: wid, meaning, firstSeen: this.sim.tick });
            this.signalLog.push({ tick: this.sim.tick, word: `W${wid}`, meaning: meaning.type });
            if (this.signalLog.length > 20) this.signalLog.shift();
          }
        }
        this._propagateSignal(a.x, a.y, a.z, signal);
      }
    }
  }

  private _encodeSignal(agent: { energy: number; signal: number; behavior: string }): number[] {
    const behaviors = ['explorer','harvester','signaler','builder','destroyer'];
    const behIdx = behaviors.indexOf(agent.behavior);
    return [
      Math.min(7, Math.floor(agent.energy / 200)),
      Math.min(7, Math.floor(agent.signal / 10)),
      Math.max(0, behIdx),
      Math.min(7, Math.floor(agent.energy / 100) % 8),
    ];
  }

  private _decodeMeaning(agent: { energy: number; behavior: string }): { type: string; value: string } {
    if (agent.energy < 80)  return { type: 'danger',    value: 'low energy' };
    if (agent.energy > 400) return { type: 'abundance', value: 'high energy nearby' };
    if (agent.behavior === 'signaler') return { type: 'contact', value: 'signaler active' };
    return { type: 'neutral', value: 'status ok' };
  }

  private _propagateSignal(x: number, y: number, z: number, signal: number[]): void {
    const strength = signal.reduce((s, v) => s + v, 0) / 28;
    const { grid } = this.sim;
    const buf = grid.buffer;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (!grid.inBounds(nx, ny, z)) continue;
        const d = Math.sqrt(dx*dx + dy*dy);
        const bi = grid.idx(nx, ny, z);
        buf[bi + F.INFORMATION] = Math.min(999, buf[bi + F.INFORMATION] + strength * 3 / (d + 1));
      }
    }
  }

  getStats(): { vocabularySize: number; communicationEvents: number; recentWords: string } {
    return {
      vocabularySize: this.vocabulary.size,
      communicationEvents: this.communicationEvents,
      recentWords: this.signalLog.slice(-5).map(s => `${s.word}(${s.meaning})`).join(' '),
    };
  }
}
