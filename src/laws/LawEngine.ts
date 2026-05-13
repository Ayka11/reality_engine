import { MetaLaw, LawCondition, WorldMetrics, PhysicsParams, DEFAULT_PARAMS } from './MetaLaw';
import { PROC, PROCESS_LIBRARY, defaultProcessMask } from '../process/ProcessDef';

function evalCond(c: LawCondition, m: WorldMetrics): boolean {
  const v = m[c.metric];
  if (c.op === 'gt')  return v > c.value;
  if (c.op === 'lt')  return v < c.value;
  if (c.op === 'gte') return v >= c.value;
  return v <= c.value;
}

function uid() { return 'law_' + Math.random().toString(36).slice(2, 9); }

export class LawEngine {
  laws: MetaLaw[];
  private _mask = 0;
  private _params: PhysicsParams = { ...DEFAULT_PARAMS };

  constructor() {
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

  tick(metrics: WorldMetrics): void {
    let dirty = false;
    for (const law of this.laws) {
      const shouldBeActive = law.conditions.length === 0
        || law.conditions.every(c => evalCond(c, metrics));

      if (shouldBeActive !== law.active) {
        law.active = shouldBeActive;
        dirty = true;
      }

      law.age++;

      // Fitness: reward laws that are active during high-complexity states
      const complexity = metrics.avgInfo / 500 + metrics.avgBio;
      law.fitness = law.fitness * 0.999 + (law.active ? complexity * 0.001 : 0);

      // Mutation: slowly drift law thresholds and param overrides
      if (law.mutationRate > 0 && Math.random() < law.mutationRate) {
        this._mutate(law);
        dirty = true;
      }
    }
    if (dirty) this._recompute();
  }

  private _mutate(law: MetaLaw): void {
    // Drift a random condition threshold ±8%
    if (law.conditions.length > 0) {
      const c = law.conditions[Math.floor(Math.random() * law.conditions.length)];
      c.value *= 0.92 + Math.random() * 0.16;
    }

    // Drift a random param override ±15%
    const keys = Object.keys(law.paramOverrides) as (keyof PhysicsParams)[];
    if (keys.length > 0) {
      const k = keys[Math.floor(Math.random() * keys.length)];
      (law.paramOverrides as Record<string, number>)[k] *= 0.85 + Math.random() * 0.3;
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
  }

  get activeProcessMask(): number { return this._mask; }
  get params(): Readonly<PhysicsParams> { return this._params; }

  spawnMutation(parentId: string): MetaLaw | null {
    const parent = this.laws.find(l => l.id === parentId);
    if (!parent) return null;

    const child: MetaLaw = JSON.parse(JSON.stringify(parent));
    child.id = uid();
    child.parentId = parent.id;
    child.generation = parent.generation + 1;
    child.fitness = 0.2;
    child.age = 0;
    child.mutationRate = Math.min(0.01, parent.mutationRate * (0.6 + Math.random() * 0.8));
    child.name = parent.name + '+';

    // Mutate a condition value aggressively
    if (child.conditions.length > 0) {
      const c = child.conditions[Math.floor(Math.random() * child.conditions.length)];
      c.value *= 0.5 + Math.random() * 1.0;
    }

    // Possibly add/remove a process
    const mutableProcs = PROCESS_LIBRARY.filter(p => p.mutable);
    const rp = mutableProcs[Math.floor(Math.random() * mutableProcs.length)];
    if (Math.random() < 0.5) {
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

  toggleProcess(procId: number, on: boolean): void {
    if (on) this._mask |= (1 << procId);
    else    this._mask &= ~(1 << procId);
  }
}
