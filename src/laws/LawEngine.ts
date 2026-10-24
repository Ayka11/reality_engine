import { MetaLaw, LawCondition, WorldMetrics, PhysicsParams, DEFAULT_PARAMS } from './MetaLaw';
import { PROC, PROCESS_LIBRARY, defaultProcessMask } from '../process/ProcessDef';
import type { GraphExecutionPlan } from '../creator';

function evalCond(c: LawCondition, m: WorldMetrics): boolean {
  const v = m[c.metric];
  if (c.op === 'gt')  return v > c.value;
  if (c.op === 'lt')  return v < c.value;
  if (c.op === 'gte') return v >= c.value;
  return v <= c.value;
}

function uid(random: () => number) { return 'law_' + random().toString(36).slice(2, 9); }

export interface LawEngineSnapshot {
  laws: MetaLaw[];
  lawOverrides: Array<[string, 'on' | 'off']>;
  manualOn: number[];
  manualOff: number[];
  graphProcessIds: number[] | null;
  rngState: number;
}

function cloneLaw(law: MetaLaw): MetaLaw {
  return {
    ...law,
    conditions: law.conditions.map(condition => ({ ...condition })),
    enablesProcesses: [...law.enablesProcesses],
    disablesProcesses: [...law.disablesProcesses],
    paramOverrides: { ...law.paramOverrides },
  };
}

function isProcessIdList(value: unknown): value is number[] {
  return Array.isArray(value) &&
    value.every(id => Number.isSafeInteger(id) && id >= 0 && id <= 10_000) &&
    new Set(value).size === value.length;
}

function isMetaLaw(value: unknown): value is MetaLaw {
  if (!value || typeof value !== 'object') return false;
  const law = value as Partial<MetaLaw>;
  const overrides = law.paramOverrides;
  return typeof law.id === 'string' && law.id.length > 0 &&
    typeof law.name === 'string' && typeof law.active === 'boolean' &&
    Array.isArray(law.conditions) && law.conditions.every(condition =>
      !!condition && typeof condition.metric === 'string' &&
      ['gt', 'lt', 'gte', 'lte'].includes(condition.op) &&
      Number.isFinite(condition.value)) &&
    isProcessIdList(law.enablesProcesses) &&
    isProcessIdList(law.disablesProcesses) &&
    !!overrides && typeof overrides === 'object' && !Array.isArray(overrides) &&
    Object.values(overrides).every(item => typeof item === 'number' && Number.isFinite(item)) &&
    Number.isFinite(law.fitness) &&
    Number.isSafeInteger(law.age) && (law.age as number) >= 0 &&
    Number.isFinite(law.mutationRate) && (law.mutationRate as number) >= 0 && (law.mutationRate as number) <= 1 &&
    Number.isSafeInteger(law.generation) && (law.generation as number) >= 0 &&
    typeof law.color === 'string' &&
    (law.parentId === undefined || typeof law.parentId === 'string');
}

export class LawEngine {
  laws: MetaLaw[];
  private _mask = 0;
  private _params: PhysicsParams = { ...DEFAULT_PARAMS };
  private _rngState: number;

  constructor(seed = 0x6d2b79f5) {
    this._rngState = Number.isSafeInteger(seed) ? (seed >>> 0) || 0x6d2b79f5 : 0x6d2b79f5;
    this.laws = this._defaultLaws();
    this._recompute();
  }

  private _defaultLaws(): MetaLaw[] {
    return [
      {
        id: 'law_thermo', name: 'Thermodynamics', active: true,
        conditions: [],
        enablesProcesses: [PROC.ENERGY_DIFFUSION, PROC.TEMP_DIFFUSION, PROC.ENTROPY_GROWTH, PROC.PRESSURE_DIFFUSION],
        disablesProcesses: [],
        paramOverrides: {},
        fitness: 1.0, age: 0, mutationRate: 0.00005, generation: 0, color: '#ef8f3f',
      },
      {
        id: 'law_gravity', name: 'Gravity', active: true,
        conditions: [],
        enablesProcesses: [PROC.GRAVITY, PROC.DENSITY_FLOW],
        disablesProcesses: [],
        paramOverrides: {},
        fitness: 0.9, age: 0, mutationRate: 0.0002, generation: 0, color: '#c084fc',
      },
      {
        id: 'law_info', name: 'Information Physics', active: true,
        conditions: [],
        enablesProcesses: [PROC.INFORMATION, PROC.BIO_POTENTIAL, PROC.WAVE_PROPAGATION],
        disablesProcesses: [],
        paramOverrides: {},
        fitness: 0.7, age: 0, mutationRate: 0.0005, generation: 0, color: '#7c9fff',
      },
      {
        id: 'law_radiation', name: 'Radiation Law', active: false,
        conditions: [{ metric: 'totalEnergy', op: 'gt', value: 200000 }],
        enablesProcesses: [PROC.RADIATION, PROC.WAVE_PROPAGATION],
        disablesProcesses: [],
        paramOverrides: { entropyGrowthRate: 0.003, energyDiffusion: 0.25 },
        fitness: 0.5, age: 0, mutationRate: 0.001, generation: 0, color: '#f47b7b',
      },
      {
        id: 'law_order', name: 'Order Emergence', active: false,
        conditions: [{ metric: 'avgEntropy', op: 'lt', value: 0.15 }],
        enablesProcesses: [PROC.CRYSTALLIZATION, PROC.DENSITY_FLOW],
        disablesProcesses: [],
        paramOverrides: { energyDiffusion: 0.04, gravityDensityCoupling: 0.3 },
        fitness: 0.5, age: 0, mutationRate: 0.001, generation: 0, color: '#8eceab',
      },
      {
        id: 'law_life', name: 'Life Law', active: false,
        conditions: [
          { metric: 'avgBio', op: 'gt', value: 0.25 },
          { metric: 'avgEntropy', op: 'lt', value: 0.45 },
        ],
        enablesProcesses: [PROC.METABOLISM, PROC.SIGNAL_PROPAGATION],
        disablesProcesses: [],
        paramOverrides: { infoGrowthRate: 0.9, infoEntropySupp: 0.7 },
        fitness: 0.4, age: 0, mutationRate: 0.002, generation: 0, color: '#4caf7d',
      },
      {
        id: 'law_geo', name: 'Geology', active: false,
        conditions: [{ metric: 'avgDensity', op: 'gt', value: 0.5 }],
        enablesProcesses: [PROC.EROSION, PROC.PHASE_TRANSITION, PROC.CRYSTALLIZATION],
        disablesProcesses: [],
        paramOverrides: { gravityDensityCoupling: 0.25 },
        fitness: 0.4, age: 0, mutationRate: 0.0008, generation: 0, color: '#a0855a',
      },
    ];
  }

  private _random(): number {
    let x = this._rngState >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this._rngState = x >>> 0;
    return this._rngState / 0x100000000;
  }

  /** Capture laws, manual/graph overrides, and local RNG for deterministic recovery. */
  snapshot(): LawEngineSnapshot {
    return {
      laws: this.laws.map(cloneLaw),
      lawOverrides: [...this._lawOverride.entries()]
        .filter((entry): entry is [string, 'on' | 'off'] => entry[1] !== 'auto')
        .map(([id, state]) => [id, state] as [string, 'on' | 'off']),
      manualOn: [...this._manualOn].sort((a, b) => a - b),
      manualOff: [...this._manualOff].sort((a, b) => a - b),
      graphProcessIds: this._graphProcessIds === null
        ? null
        : [...this._graphProcessIds].sort((a, b) => a - b),
      rngState: this._rngState,
    };
  }

  /** Validate a detached candidate before replacing current law state. */
  restore(snapshot: LawEngineSnapshot): void {
    if (!snapshot || typeof snapshot !== 'object' ||
        !Array.isArray(snapshot.laws) || !snapshot.laws.every(isMetaLaw) ||
        !Number.isSafeInteger(snapshot.rngState) ||
        snapshot.rngState <= 0 || snapshot.rngState > 0xffffffff ||
        !Array.isArray(snapshot.lawOverrides) ||
        !Array.isArray(snapshot.manualOn) || !isProcessIdList(snapshot.manualOn) ||
        !Array.isArray(snapshot.manualOff) || !isProcessIdList(snapshot.manualOff) ||
        (snapshot.graphProcessIds !== null && !isProcessIdList(snapshot.graphProcessIds))) {
      throw new Error('Invalid LawEngine snapshot');
    }
    const ids = snapshot.laws.map(law => law.id);
    if (new Set(ids).size !== ids.length ||
        snapshot.lawOverrides.some(entry =>
          !Array.isArray(entry) || entry.length !== 2 ||
          typeof entry[0] !== 'string' || !entry[0] ||
          (entry[1] !== 'on' && entry[1] !== 'off')) ||
        new Set(snapshot.lawOverrides.map(entry => entry[0])).size !== snapshot.lawOverrides.length ||
        snapshot.manualOn.some(id => snapshot.manualOff.includes(id))) {
      throw new Error('Invalid LawEngine snapshot state');
    }

    const restoredLaws = snapshot.laws.map(cloneLaw);
    const restoredOverrides = new Map(
      snapshot.lawOverrides.map(([id, state]) => [id, state] as [string, 'on' | 'off']),
    );
    const restoredGraphIds = snapshot.graphProcessIds === null
      ? null
      : new Set(snapshot.graphProcessIds);
    this.laws = restoredLaws;
    this._lawOverride = restoredOverrides;
    this._manualOn = new Set(snapshot.manualOn);
    this._manualOff = new Set(snapshot.manualOff);
    this._graphProcessIds = restoredGraphIds;
    this._rngState = snapshot.rngState >>> 0;
    this._recompute();
  }

  tick(metrics: WorldMetrics): void {
    let dirty = false;
    for (const law of this.laws) {
      const _override = this._lawOverride.get(law.id);
      const shouldBeActive = _override === 'on' ? true
        : _override === 'off' ? false
        : (law.conditions.length === 0 || law.conditions.every(c => evalCond(c, metrics)));

      if (shouldBeActive !== law.active) {
        law.active = shouldBeActive;
        dirty = true;
      }

      law.age++;

      // Fitness: reward laws that are active during high-complexity states
      const complexity = metrics.avgInfo / 500 + metrics.avgBio;
      law.fitness = law.fitness * 0.999 + (law.active ? complexity * 0.001 : 0);

      // Mutation: slowly drift law thresholds and param overrides
      if (law.mutationRate > 0 && this._random() < law.mutationRate) {
        this._mutate(law);
        dirty = true;
      }
    }
    if (dirty) this._recompute();
  }

  private _mutate(law: MetaLaw): void {
    // Drift a random condition threshold ±8%
    if (law.conditions.length > 0) {
      const c = law.conditions[Math.floor(this._random() * law.conditions.length)];
      c.value *= 0.92 + this._random() * 0.16;
    }

    // Drift a random param override ±15%
    const keys = Object.keys(law.paramOverrides) as (keyof PhysicsParams)[];
    if (keys.length > 0) {
      const k = keys[Math.floor(this._random() * keys.length)];
      (law.paramOverrides as Record<string, number>)[k] *= 0.85 + this._random() * 0.3;
    }
    law.generation++;
  }

  private _recompute(): void {
    this._mask = defaultProcessMask();
    this._params = { ...DEFAULT_PARAMS };

    for (const law of this.laws) {
      if (!law.active) continue;
      for (const pid of law.enablesProcesses)  this._mask |= (1 << pid);
      for (const pid of law.disablesProcesses) this._mask &= ~(1 << pid);
      for (const [k, v] of Object.entries(law.paramOverrides)) {
        (this._params as unknown as Record<string, number>)[k] = v as number;
      }
    }

    // Manual overrides always win — applied last so laws can't undo them
    if (this._graphProcessIds) {
      this._mask = 0;
      for (const pid of this._graphProcessIds) this._mask |= (1 << pid);
    }

    for (const pid of this._manualOn)  this._mask |= (1 << pid);
    for (const pid of this._manualOff) this._mask &= ~(1 << pid);
  }

  get activeProcessMask(): number { return this._mask; }
  get params(): Readonly<PhysicsParams> { return this._params; }

  spawnMutation(parentId: string): MetaLaw | null {
    const parent = this.laws.find(l => l.id === parentId);
    if (!parent) return null;

    const child: MetaLaw = JSON.parse(JSON.stringify(parent));
    child.id = uid(() => this._random());
    child.parentId = parent.id;
    child.generation = parent.generation + 1;
    child.fitness = 0.2;
    child.age = 0;
    child.mutationRate = Math.min(0.01, parent.mutationRate * (0.6 + this._random() * 0.8));
    child.name = parent.name + '+';

    // Mutate a condition value aggressively
    if (child.conditions.length > 0) {
      const c = child.conditions[Math.floor(this._random() * child.conditions.length)];
      c.value *= 0.5 + this._random() * 1.0;
    }

    // Possibly add/remove a process
    const mutableProcs = PROCESS_LIBRARY.filter(p => p.mutable);
    const rp = mutableProcs[Math.floor(this._random() * mutableProcs.length)];
    if (this._random() < 0.5) {
      if (!child.enablesProcesses.includes(rp.id)) child.enablesProcesses.push(rp.id);
    } else {
      child.enablesProcesses = child.enablesProcesses.filter(p => p !== rp.id);
    }

    this.laws.push(child);
    this._recompute();
    return child;
  }

  removeLaw(id: string): void {
    const law = this.laws.find(l => l.id === id);
    // Never remove the 3 core permanent laws
    if (!law || ['law_thermo', 'law_gravity', 'law_info'].includes(id)) return;
    this.laws = this.laws.filter(l => l.id !== id);
    this._recompute();
  }

  // Per-law activation overrides (independent of conditions)
  private _lawOverride: Map<string, 'auto' | 'on' | 'off'> = new Map();

  setLawOverride(id: string, state: 'auto' | 'on' | 'off'): void {
    if (state === 'auto') this._lawOverride.delete(id);
    else this._lawOverride.set(id, state);
  }

  getLawOverride(id: string): 'auto' | 'on' | 'off' {
    return this._lawOverride.get(id) ?? 'auto';
  }

  // Manual overrides survive MetaLaw recomputes
  private _manualOn  = new Set<number>();
  private _manualOff = new Set<number>();
  private _graphProcessIds: Set<number> | null = null;

  toggleProcess(procId: number, on: boolean): void {
    if (on) { this._manualOn.add(procId);  this._manualOff.delete(procId); }
    else    { this._manualOff.add(procId); this._manualOn.delete(procId);  }
    if (on) this._mask |= (1 << procId);
    else    this._mask &= ~(1 << procId);
  }

  clearManualOverrides(): void {
    this._manualOn.clear(); this._manualOff.clear();
    this._recompute();
  }

  applyGraphPlan(plan: GraphExecutionPlan): void {
    this._graphProcessIds = new Set(plan.activeProcessIds);
    this._recompute();
  }

  clearGraphPlan(): void {
    this._graphProcessIds = null;
    this._recompute();
  }
}
