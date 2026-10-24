import { SimulationEngine } from '../simulation/SimulationEngine';
import { CivilizationSystem } from '../simulation/CivilizationSystem';
import { F } from '../core/CellState';

// ── Integral Reality Archetypes ───────────────────────────────────────────────
export interface PhiArchetype {
  icon: string; desc: string; phiStrength: number; coupling: number;
}
export const PHI_ARCHETYPES: Record<string, PhiArchetype> = {
  'Harmonic':    { icon:'♪',  desc:'Ordered, resonant substrate',            phiStrength:0.9,  coupling:0.7  },
  'Chaotic':     { icon:'🌪️', desc:'Turbulent creative potential',           phiStrength:0.3,  coupling:1.4  },
  'Crystalline': { icon:'💎', desc:'Low entropy, high coherence',             phiStrength:0.95, coupling:0.4  },
  'Living':      { icon:'🧬', desc:'Self-organizing vital field',            phiStrength:0.75, coupling:1.1  },
  'Void':        { icon:'⚫', desc:'Null potential — sparse reality',         phiStrength:0.1,  coupling:0.2  },
  'Resonant':    { icon:'〜', desc:'Wave-interference dominated',            phiStrength:0.8,  coupling:0.9  },
};

export interface FieldBalance {
  icon: string; desc: string; rho: number; E: number; I: number;
}
export const FIELD_BALANCES: Record<string, FieldBalance> = {
  'Energy Dominant':   { icon:'⚡', desc:'High-energy — heat and radiation rule',             rho:0.4,  E:0.95, I:0.5  },
  'Information Dense': { icon:'🧠', desc:'Complexity via information',                        rho:0.6,  E:0.55, I:0.95 },
  'Balanced':          { icon:'⚖️', desc:'Even distribution — all fields contribute equally', rho:0.7,  E:0.7,  I:0.7  },
  'Mass Dominant':     { icon:'🪨', desc:'Dense matter — gravity wells, slow diffusion',      rho:0.95, E:0.4,  I:0.3  },
  'Sparse':            { icon:'✦',  desc:'Low density — information flows freely',            rho:0.25, E:0.4,  I:0.8  },
  'Pure Info':         { icon:'∞',  desc:'Information dominates — substrate of pure mind',   rho:0.2,  E:0.3,  I:1.0  },
};

export interface ComplexityMode {
  icon: string; desc: string; growth: number; stability: number; agents: number;
}
export const COMPLEXITY_MODES: Record<string, ComplexityMode> = {
  'Emergent':    { icon:'📈', desc:'Complexity rises — structures self-organize',            growth:1.3, stability:0.6, agents:8  },
  'Stable':      { icon:'🌿', desc:'Balanced complexity — ecology in homeostasis',           growth:0.7, stability:0.9, agents:5  },
  'Explosive':   { icon:'💥', desc:'Unbounded growth — complexity cascades to collapse',    growth:2.1, stability:0.3, agents:15 },
  'Collapsing':  { icon:'📉', desc:'Complexity decays — entropy wins',                      growth:0.4, stability:0.2, agents:3  },
  'Oscillating': { icon:'〰️', desc:'Cyclic rise and fall — extinction and rebirth loops',  growth:1.0, stability:0.5, agents:20 },
};

export interface SpacetimeProfile {
  icon: string; desc: string; timeDil: number; sNoise: number; hazards: string[];
}
export const SPACETIME_PROFILES: Record<string, SpacetimeProfile> = {
  'Standard':        { icon:'⚖️', desc:'Normal causal flow',           timeDil:1.0, sNoise:1.0, hazards:[]                      },
  'Slow Time':       { icon:'⏳', desc:'Time dilation',                timeDil:0.3, sNoise:1.0, hazards:[]                      },
  'Fractal Space':   { icon:'🔷', desc:'Self-similar geometry',        timeDil:1.0, sNoise:2.0, hazards:[]                      },
  'High Radiation':  { icon:'☢️', desc:'Entropy injection',            timeDil:1.0, sNoise:1.0, hazards:['radiation']           },
  'Meteor Zone':     { icon:'☄️', desc:'Kinetic impacts',              timeDil:1.0, sNoise:1.2, hazards:['meteors','solar']     },
  'Frozen Topology': { icon:'❄️', desc:'Cold slow dynamics',           timeDil:0.5, sNoise:0.5, hazards:['freeze']              },
};

// ── Integral Composer Selection ────────────────────────────────────────────────
export interface ComposerSelection {
  phi: string | null; fields: string; complexity: string; spacetime: string;
}

// ── Environment Hazards ───────────────────────────────────────────────────────
type HazardFn = (grid: SimulationEngine['grid'], random?: () => number) => void;
export const ENV_HAZARDS: Record<string, { desc: string; fn: HazardFn }> = {
  'Acid Rain':            { desc:'Periodic density erosion from above',     fn: _hazardAcidRain },
  'Meteor Activity':      { desc:'Random high-energy impacts',              fn: _hazardMeteors },
  'Solar Storms':         { desc:'Periodic energy surges',                  fn: _hazardSolarStorm },
  'Tectonic Instability': { desc:'Density upheavals, heat from below',      fn: _hazardTectonics },
  'High Radiation':       { desc:'Entropy increase across the grid',        fn: _hazardRadiation },
  'Frozen Climate':       { desc:'Temperature drops periodically',          fn: _hazardFreezing },
};

function _hazardMeteors(grid: SimulationEngine['grid'], random: () => number = Math.random): void {
  const buf = grid.buffer; const { W, H, D } = grid;
  const n = 1 + Math.floor(random() * 3);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(random() * W), y = Math.floor(random() * H);
    const r = 2 + Math.floor(random() * 4);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (!grid.inBounds(nx, ny, D - 1) || dx*dx+dy*dy > r*r) continue;
      const g = Math.exp(-(dx*dx+dy*dy) / (r*r) * 2);
      const bi = grid.idx(nx, ny, D - 1);
      buf[bi+F.ENERGY]      = Math.min(9999, buf[bi+F.ENERGY]      + g*800);
      buf[bi+F.TEMPERATURE] = Math.min(2000, buf[bi+F.TEMPERATURE] + g*500);
      buf[bi+F.ENTROPY]     = Math.min(1,    buf[bi+F.ENTROPY]     + g*0.3);
    }
  }
}
function _hazardAcidRain(grid: SimulationEngine['grid'], random: () => number = Math.random): void {
  const buf = grid.buffer; const { W, H, D } = grid;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const bi = grid.idx(x, y, D - 1);
    buf[bi+F.DENSITY] = Math.max(0, buf[bi+F.DENSITY] - 0.05 * random());
    buf[bi+F.ENTROPY] = Math.min(1, buf[bi+F.ENTROPY] + 0.02 * random());
  }
}
function _hazardSolarStorm(grid: SimulationEngine['grid'], random: () => number = Math.random): void {
  const buf = grid.buffer; const { W, H, D } = grid;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const bi = grid.idx(x, y, D - 1);
    buf[bi+F.ENERGY]      = Math.min(9999, buf[bi+F.ENERGY]      + 50 + random()*150);
    buf[bi+F.TEMPERATURE] = Math.min(2000, buf[bi+F.TEMPERATURE] + 30);
  }
}
function _hazardTectonics(grid: SimulationEngine['grid'], random: () => number = Math.random): void {
  const buf = grid.buffer; const { W, H, D } = grid;
  const cx = Math.floor(random() * W), cy = Math.floor(random() * H);
  for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
    const nx = cx+dx, ny = cy+dy;
    if (!grid.inBounds(nx, ny, 0) || Math.sqrt(dx*dx+dy*dy) > 8) continue;
    const g = Math.exp(-(dx*dx+dy*dy) / 20);
    for (let z = 0; z < D; z++) {
      const bi = grid.idx(nx, ny, z);
      buf[bi+F.DENSITY]     = Math.min(1,    buf[bi+F.DENSITY]     + g*0.3);
      buf[bi+F.TEMPERATURE] = Math.min(2000, buf[bi+F.TEMPERATURE] + g*100);
    }
  }
}
function _hazardRadiation(grid: SimulationEngine['grid'], random: () => number = Math.random): void {
  const buf = grid.buffer; const { W, H, D } = grid;
  for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const bi = grid.idx(x, y, z);
    buf[bi+F.ENTROPY] = Math.min(1, buf[bi+F.ENTROPY] + 0.003 * random());
  }
}
function _hazardFreezing(grid: SimulationEngine['grid']): void {
  const buf = grid.buffer; const { W, H, D } = grid;
  for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const bi = grid.idx(x, y, z);
    buf[bi+F.TEMPERATURE] = Math.max(0, buf[bi+F.TEMPERATURE] - 20);
  }
}

// ── WorldComposer ─────────────────────────────────────────────────────────────
export class WorldComposer {
  readonly selection: ComposerSelection = {
    phi: null, fields: 'Balanced', complexity: 'Emergent', spacetime: 'Standard',
  };
  private activeHazardInterval: ReturnType<typeof setInterval> | null = null;
  private _rngState: number;


  constructor(
    private sim: SimulationEngine,
    private civSystem: CivilizationSystem | null = null,
    seed = 0x4f1bbcdc
  ) {
    this._rngState = Number.isSafeInteger(seed) ? (seed >>> 0) || 0x4f1bbcdc : 0x4f1bbcdc;
  }

  private _random(): number {
    let x = this._rngState >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this._rngState = x >>> 0;
    return this._rngState / 0x100000000;
  }

  snapshotRandomState(): number { return this._rngState; }

  restoreRandomState(state: number): void {
    if (!Number.isSafeInteger(state) || state <= 0 || state > 0xffffffff) {
      throw new Error('Invalid WorldComposer PRNG state');
    }
    this._rngState = state >>> 0;
  }

  generate(): string {
    const { sim, selection } = this;
    const phi  = PHI_ARCHETYPES[selection.phi ?? ''];
    if (!phi) return 'Select a Φ Potential first';
    const fld  = FIELD_BALANCES[selection.fields]  ?? FIELD_BALANCES['Balanced'];
    const cplx = COMPLEXITY_MODES[selection.complexity] ?? COMPLEXITY_MODES['Emergent'];
    const st   = SPACETIME_PROFILES[selection.spacetime] ?? SPACETIME_PROFILES['Standard'];
    const { grid } = sim;
    const { W, H, D, buffer: buf } = grid;
    const civilizationBefore = cplx.growth >= 1.3 && this.civSystem
      ? this.civSystem.snapshot()
      : null;

    try {
      sim.mutateAuthoritativeState(() => {
        // Fill grid — dV noise shaped by sNoise.
        for (let z = 0; z < D; z++) {
          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              const n  = (Math.sin(x * 0.4) * Math.cos(y * 0.3) + 1) / 2;
              const nz = (Math.sin(x * 0.7 * st.sNoise) * Math.cos(y * 0.6 * st.sNoise) + 1) / 2;
              const bi = grid.idx(x, y, z);
              buf[bi + F.ENERGY]        = Math.max(0, (n*0.7+nz*0.3) * 600 * fld.E * phi.phiStrength + 20);
              buf[bi + F.DENSITY]       = Math.max(0, n * fld.rho);
              buf[bi + F.INFORMATION]   = Math.max(0, nz * 100 * fld.I * phi.phiStrength);
              buf[bi + F.ENTROPY]       = Math.max(0, 0.02 + (1 - phi.phiStrength) * 0.1);
              buf[bi + F.TEMPERATURE]   = Math.max(0, n * 300 * fld.E);
              buf[bi + F.BIO_POTENTIAL] = Math.max(0, nz * fld.I * 0.5);
            }
          }
        }

        // The initial population is part of the same simulation transaction.
        const nAgents = Math.round(cplx.agents * st.timeDil * 1.5);
        if (nAgents > 0) sim.agents.seed(grid, nAgents);

        // Civilization seeding reads the freshly-generated grid. Restore its
        // independent state if a later publication/synchronization step fails.
        if (cplx.growth >= 1.3 && this.civSystem) {
          this.civSystem.seedFromGrid();
        }
      });
    } catch (error) {
      if (civilizationBefore && this.civSystem) {
        try {
          this.civSystem.restore(civilizationBefore);
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "World generation failed and civilization rollback also failed",
          );
        }
      }
      throw error;
    }

    // Apply spacetime hazards
    this._clearHazards();
    if (st.hazards.length > 0) {
      this.activeHazardInterval = setInterval(() => {
        const rngBefore = this._rngState;
        try {
          sim.mutateAuthoritativeState(() => {
            for (const h of st.hazards) {
              if (h === 'radiation') _hazardRadiation(sim.grid, () => this._random());
              if (h === 'meteors')   _hazardMeteors(sim.grid, () => this._random());
              if (h === 'solar')     _hazardSolarStorm(sim.grid, () => this._random());
              if (h === 'freeze')    _hazardFreezing(sim.grid);
            }
          });
        } catch (error) {
          this._rngState = rngBefore;
          console.error('[WorldComposer] Hazard mutation rolled back', error);
        }
      }, 5000);
    }

    return `∫ Φ=${selection.phi} · ${selection.fields} · C=${selection.complexity} → reality generated`;
  }

  _clearHazards(): void {
    if (this.activeHazardInterval) {
      clearInterval(this.activeHazardInterval);
      this.activeHazardInterval = null;
    }
  }
}
