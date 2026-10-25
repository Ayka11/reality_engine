import { SimulationEngine } from './SimulationEngine';
import { F } from '../core/CellState';

export interface SignalPattern {
  id: number;
  meaning: { type: string; value: string };
  firstSeen: number;
}

export interface SignalEntry {
  tick: number;
  word: string;
  meaning: string;
}

export interface LanguageSystemSnapshot {
  vocabulary: Array<[string, SignalPattern]>;
  signalLog: SignalEntry[];
  lexiconAge: Array<[string, number]>;
  nextWordId: number;
  communicationEvents: number;
  tickCount: number;
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

  snapshot(): LanguageSystemSnapshot {
    return {
      vocabulary: [...this.vocabulary.entries()].map(([key, pattern]) => [
        key,
        { ...pattern, meaning: { ...pattern.meaning } },
      ]),
      signalLog: this.signalLog.map(entry => ({ ...entry })),
      lexiconAge: [...this.lexiconAge.entries()],
      nextWordId: this.nextWordId,
      communicationEvents: this.communicationEvents,
      tickCount: this.tickCount,
    };
  }

  restore(snapshot: LanguageSystemSnapshot): void {
    if (!snapshot ||
        !Array.isArray(snapshot.vocabulary) || snapshot.vocabulary.length > 100_000 ||
        !Array.isArray(snapshot.signalLog) || snapshot.signalLog.length > 20 ||
        !Array.isArray(snapshot.lexiconAge) || snapshot.lexiconAge.length > 100_000 ||
        !Number.isSafeInteger(snapshot.nextWordId) || snapshot.nextWordId < 1 ||
        !Number.isSafeInteger(snapshot.communicationEvents) || snapshot.communicationEvents < 0 ||
        !Number.isSafeInteger(snapshot.tickCount) || snapshot.tickCount < 0) {
      throw new Error("Invalid LanguageSystem snapshot");
    }
    const vocabulary = new Map<string, SignalPattern>();
    let maxWordId = 0;
    for (const entry of snapshot.vocabulary) {
      if (!Array.isArray(entry) || entry.length !== 2 ||
          typeof entry[0] !== "string" || vocabulary.has(entry[0])) {
        throw new Error("Invalid LanguageSystem vocabulary entry");
      }
      const pattern = entry[1];
      if (!pattern || !Number.isSafeInteger(pattern.id) || pattern.id < 1 ||
          !Number.isSafeInteger(pattern.firstSeen) || pattern.firstSeen < 0 ||
          !pattern.meaning || typeof pattern.meaning.type !== "string" ||
          typeof pattern.meaning.value !== "string") {
        throw new Error("Invalid LanguageSystem signal pattern");
      }
      maxWordId = Math.max(maxWordId, pattern.id);
      vocabulary.set(entry[0], { ...pattern, meaning: { ...pattern.meaning } });
    }
    if (snapshot.nextWordId <= maxWordId) throw new Error("Invalid LanguageSystem next word id");

    const signalLog: SignalEntry[] = [];
    for (const entry of snapshot.signalLog) {
      if (!entry || !Number.isSafeInteger(entry.tick) || entry.tick < 0 ||
          typeof entry.word !== "string" || typeof entry.meaning !== "string") {
        throw new Error("Invalid LanguageSystem signal log");
      }
      signalLog.push({ ...entry });
    }
    const lexiconAge = new Map<string, number>();
    for (const entry of snapshot.lexiconAge) {
      if (!Array.isArray(entry) || entry.length !== 2 ||
          typeof entry[0] !== "string" || !Number.isSafeInteger(entry[1]) ||
          entry[1] < 0 || lexiconAge.has(entry[0])) {
        throw new Error("Invalid LanguageSystem lexicon age");
      }
      lexiconAge.set(entry[0], entry[1]);
    }
    this.vocabulary.clear();
    for (const [key, value] of vocabulary) this.vocabulary.set(key, value);
    this.signalLog.splice(0, this.signalLog.length, ...signalLog);
    this.lexiconAge.clear();
    for (const [key, value] of lexiconAge) this.lexiconAge.set(key, value);
    this.nextWordId = snapshot.nextWordId;
    this.communicationEvents = snapshot.communicationEvents;
    this.tickCount = snapshot.tickCount;
  }

  reset(): void {
    this.vocabulary.clear();
    this.signalLog.length = 0;
    this.lexiconAge.clear();
    this.nextWordId = 1;
    this.communicationEvents = 0;
    this.tickCount = 0;
  }

  willWriteGridOnNextTick(): boolean {
    if ((this.tickCount + 1) % 5 !== 0) return false;
    const agents = this.sim.agents.getAgents();
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const a = agents[i], b = agents[j];
        if (Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2) <= 5) return true;
      }
    }
    return false;
  }

  tick(): boolean {
    if (++this.tickCount % 5 !== 0) return false; // throttle
    const agents = this.sim.agents.getAgents();
    if (agents.length < 2) return false;
    let gridChanged = false;

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
        gridChanged = true;
      }
    }
    return gridChanged;
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
