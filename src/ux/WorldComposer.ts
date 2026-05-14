import { SimulationEngine } from '../simulation/SimulationEngine';
import { CivilizationSystem } from '../simulation/CivilizationSystem';
import { F } from '../core/CellState';

// ── World Archetypes ──────────────────────────────────────────────────────────
export interface ArchetypeBase {
  energy: number; density: number; info: number;
  entropy: number; temp: number; bio: number;
}
export interface Archetype {
  desc: string; icon: string; base: ArchetypeBase;
}
export const WORLD_ARCHETYPES: Record<string, Archetype> = {
  'Dead Moon':         { icon:'🌑', desc:'Barren, low entropy, no life. Geology only.',                     base:{ energy:80,  density:0.7, info:0,   entropy:0.05, temp:20,  bio:0   } },
  'Ocean World':       { icon:'🌊', desc:'Global ocean. High density at depth. Life possible.',             base:{ energy:150, density:0.6, info:40,  entropy:0.08, temp:80,  bio:0.2 } },
  'Fungal Planet':     { icon:'🍄', desc:'Dense information networks. Slow but deep biology.',              base:{ energy:200, density:0.5, info:200, entropy:0.1,  temp:60,  bio:0.6 } },
  'Machine Ecology':   { icon:'⚙️',  desc:'High energy, structured order. Information dominant.',            base:{ energy:600, density:0.8, info:400, entropy:0.03, temp:200, bio:0.1 } },
  'Crystal Universe':  { icon:'💎', desc:'Ultra-low entropy. Perfect order. Energy locked in crystals.',    base:{ energy:800, density:0.9, info:300, entropy:0.01, temp:10,  bio:0   } },
  'Entropy Collapse':  { icon:'🌪️', desc:'Heat death approaching. Maximum chaos. Watch structures fight it.',base:{ energy:300, density:0.4, info:50,  entropy:0.8,  temp:400, bio:0.1 } },
  'Proto Earth':       { icon:'🌋', desc:'Volcanic, energetic, primed for life emergence.',                  base:{ energy:400, density:0.6, info:60,  entropy:0.15, temp:250, bio:0.15} },
  'Neural Biosphere':  { icon:'🧠', desc:'Life evolved into information. Consciousness substrate.',          base:{ energy:300, density:0.4, info:600, entropy:0.06, temp:100, bio:0.9 } },
  'Gas Giant':         { icon:'🪐', desc:'Massive energy flows. No solid surface. Weather dominates.',      base:{ energy:700, density:0.3, info:20,  entropy:0.2,  temp:500, bio:0   } },
  'Post-Human Ruins':  { icon:'🏛️', desc:'High information residue. Decaying structures. Memory of civilization.',base:{ energy:150, density:0.5, info:350, entropy:0.4, temp:80, bio:0.3 } },
};

// ── Physics Profiles ──────────────────────────────────────────────────────────
export interface PhysicsProfile { desc: string; energyMult?: number; infoMult?: number; entropyMult?: number; }
export const PHYSICS_PROFILES: Record<string, PhysicsProfile> = {
  'Balanced':              { desc:'Default physical constants' },
  'High Gravity':          { desc:'Matter compresses, density dominates',     energyMult:0.8 },
  'Slow Time':             { desc:'Everything happens at 30% speed',          energyMult:0.3 },
  'Low Entropy':           { desc:'Order preserved longer, structures stable', entropyMult:0.2 },
  'Hyper Diffusion':       { desc:'Energy spreads instantly, no local hotspots',energyMult:1.4 },
  'Chaotic Laws':          { desc:'Laws evolve rapidly, physics unstable',     entropyMult:1.5 },
  'Stable Matter':         { desc:'Dense, ordered, resistant to change',       entropyMult:0.1 },
  'Information Dominant':  { desc:'Information field overpowers physical fields', infoMult:3.0 },
};

// ── World Goals ───────────────────────────────────────────────────────────────
export interface WorldGoal {
  desc: string; icon: string;
  spawnAgents?: number; spawnCivs?: boolean;
}
export const WORLD_GOALS: Record<string, WorldGoal> = {
  'Emergent Life':         { icon:'🧬', desc:'Tune world for maximum bio potential emergence',      spawnAgents:8 },
  'Stable Ecosystem':      { icon:'🌿', desc:'Balance entropy and order for long-running ecology',  spawnAgents:5 },
  'Expanding Civilization':{ icon:'🏙️', desc:'Prime conditions for civilization emergence and growth',spawnAgents:10, spawnCivs:true },
  'Infinite Storm':        { icon:'⚡', desc:'Perpetual high-energy turbulence, no equilibrium' },
  'Information Network':   { icon:'🕸️', desc:'Build a world where information is the primary resource',spawnAgents:15 },
  'High Complexity Growth':{ icon:'📈', desc:'Maximize emergence of novel structures over time',    spawnAgents:10, spawnCivs:true },
  'Extinction Cycles':     { icon:'🔄', desc:'Life rises and collapses repeatedly — evolutionary pressure',spawnAgents:20 },
};

// ── Environment Hazards ───────────────────────────────────────────────────────
type HazardFn = (grid: SimulationEngine['grid']) => void;
export const ENV_HAZARDS: Record<string, { desc: string; fn: HazardFn }> = {
  'Acid Rain':            { desc:'Periodic density erosion from above',     fn: _hazardAcidRain },
  'Meteor Activity':      { desc:'Random high-energy impacts',              fn: _hazardMeteors },
  'Solar Storms':         { desc:'Periodic energy surges',                  fn: _hazardSolarStorm },
  'Tectonic Instability': { desc:'Density upheavals, heat from below',      fn: _hazardTectonics },
  'High Radiation':       { desc:'Entropy increase across the grid',        fn: _hazardRadiation },
  'Frozen Climate':       { desc:'Temperature drops periodically',          fn: _hazardFreezing },
};

function _hazardMeteors(grid: SimulationEngine['grid']): void {
  const buf = grid.buffer; const { W, H, D } = grid;
  const n = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(Math.random() * W), y = Math.floor(Math.random() * H);
    const r = 2 + Math.floor(Math.random() * 4);
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
function _hazardAcidRain(grid: SimulationEngine['grid']): void {
  const buf = grid.buffer; const { W, H, D } = grid;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const bi = grid.idx(x, y, D - 1);
    buf[bi+F.DENSITY] = Math.max(0, buf[bi+F.DENSITY] - 0.05 * Math.random());
    buf[bi+F.ENTROPY] = Math.min(1, buf[bi+F.ENTROPY] + 0.02 * Math.random());
  }
}
function _hazardSolarStorm(grid: SimulationEngine['grid']): void {
  const buf = grid.buffer; const { W, H, D } = grid;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const bi = grid.idx(x, y, D - 1);
    buf[bi+F.ENERGY]      = Math.min(9999, buf[bi+F.ENERGY]      + 50 + Math.random()*150);
    buf[bi+F.TEMPERATURE] = Math.min(2000, buf[bi+F.TEMPERATURE] + 30);
  }
}
function _hazardTectonics(grid: SimulationEngine['grid']): void {
  const buf = grid.buffer; const { W, H, D } = grid;
  const cx = Math.floor(Math.random() * W), cy = Math.floor(Math.random() * H);
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
function _hazardRadiation(grid: SimulationEngine['grid']): void {
  const buf = grid.buffer; const { W, H, D } = grid;
  for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const bi = grid.idx(x, y, z);
    buf[bi+F.ENTROPY] = Math.min(1, buf[bi+F.ENTROPY] + 0.003 * Math.random());
  }
}
function _hazardFreezing(grid: SimulationEngine['grid']): void {
  const buf = grid.buffer; const { W, H, D } = grid;
  for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const bi = grid.idx(x, y, z);
    buf[bi+F.TEMPERATURE] = Math.max(0, buf[bi+F.TEMPERATURE] - 20);
  }
}

// ── Evolution Modes ───────────────────────────────────────────────────────────
export interface EvoMode { desc: string; agentSpawnMult?: number; }
export const EVOLUTION_MODES: Record<string, EvoMode> = {
  'Rapid Mutation':          { desc:'Fast genetic drift',                  agentSpawnMult:1 },
  'Slow Evolution':          { desc:'Gradual, stable change',              agentSpawnMult:1 },
  'Civilization Bias':       { desc:'Agents lean toward cooperation',      agentSpawnMult:1 },
  'Biological Dominance':    { desc:'Life spreads aggressively',           agentSpawnMult:3 },
  'Extinction Cycles':       { desc:'Periodic die-offs',                   agentSpawnMult:2 },
  'Self-Organizing Systems': { desc:'Information drives order',            agentSpawnMult:1 },
};

// ── WorldComposer ─────────────────────────────────────────────────────────────
export interface ComposerSelection {
  archetype: string | null;
  physics: string;
  goal: string | null;
  hazards: string[];
  evolution: string | null;
}

export class WorldComposer {
  readonly selection: ComposerSelection = {
    archetype: null, physics: 'Balanced',
    goal: null, hazards: [], evolution: null,
  };
  private activeHazardInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private sim: SimulationEngine,
    private civSystem: CivilizationSystem | null = null
  ) {}

  generate(): string {
    const { sim, selection } = this;
    const arch = WORLD_ARCHETYPES[selection.archetype ?? ''];
    if (!arch) return 'Select a world archetype first';

    const phys = PHYSICS_PROFILES[selection.physics] ?? {};
    const goal = selection.goal ? WORLD_GOALS[selection.goal] : null;
    const evo  = selection.evolution ? EVOLUTION_MODES[selection.evolution] : null;
    const { grid } = sim;
    const { W, H, D, buffer: buf } = grid;

    // 1. Fill grid
    for (let z = 0; z < D; z++) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const heightFactor  = z / D;
          const noiseFactor   = (Math.sin(x * 0.4) * Math.cos(y * 0.3) + 1) / 2;
          const bi = grid.idx(x, y, z);
          buf[bi + F.ENERGY]        = arch.base.energy  * (0.5 + noiseFactor * 0.8) * (phys.energyMult  ?? 1);
          buf[bi + F.DENSITY]       = Math.min(1, arch.base.density * (0.7 + heightFactor * 0.3));
          buf[bi + F.INFORMATION]   = arch.base.info    * noiseFactor               * (phys.infoMult    ?? 1);
          buf[bi + F.ENTROPY]       = arch.base.entropy                              * (phys.entropyMult ?? 1);
          buf[bi + F.TEMPERATURE]   = arch.base.temp    * (0.5 + noiseFactor * 0.6);
          buf[bi + F.BIO_POTENTIAL] = arch.base.bio     * noiseFactor;
        }
      }
    }

    // 2. Spawn agents
    const nAgents = Math.round((goal?.spawnAgents ?? 0) * (evo?.agentSpawnMult ?? 1));
    if (nAgents > 0) {
      sim.agents.seed(grid, nAgents);
    }

    // 3. Spawn civs
    if (goal?.spawnCivs && this.civSystem) {
      this.civSystem.seedFromGrid();
    }

    // 4. Setup hazards
    this._clearHazards();
    if (selection.hazards.length > 0) {
      this.activeHazardInterval = setInterval(() => {
        for (const name of selection.hazards) {
          ENV_HAZARDS[name]?.fn(sim.grid);
        }
      }, 5000);
    }

    sim.syncToGPU();
    return `World "${selection.archetype}" generated — ${arch.desc}`;
  }

  _clearHazards(): void {
    if (this.activeHazardInterval) {
      clearInterval(this.activeHazardInterval);
      this.activeHazardInterval = null;
    }
  }
}
