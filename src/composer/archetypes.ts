/**
 * World archetypes, physics styles, evolution styles, and hazard profiles.
 * These drive the World Composer Wizard UI and initial sim parameters.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorldArchetype {
  id: string
  name: string
  icon: string
  desc: string
  tags: string[]
  physics: {
    DIFF: number
    ENT:  number
    INFO: number
    BIO:  number
    procs: string[]
  }
}

export interface PhysicsStyle {
  id: string
  name: string
  icon: string
  desc: string
  multipliers: {
    DIFF?: number
    ENT?:  number
    INFO?: number
    BIO?:  number
    tmul?: number  // time multiplier
  }
}

export interface EvolutionStyle {
  id: string
  name: string
  icon: string
  desc: string
  agentMutRate: number
  spawnN: number
}

export interface HazardCell {
  x: number; y: number; z: number; f: number; v: number
}

export interface HazardProfile {
  id: string
  name: string
  icon: string
  desc: string
  fn: (params: { W: number; H: number; D: number }) => HazardCell[]
}

// ── Archetypes ────────────────────────────────────────────────────────────────

export const ARCHETYPES: WorldArchetype[] = [
  {
    id: 'ocean', name: 'Ocean World', icon: '🌊',
    desc: 'Global ocean. High density at depth. Life possible.',
    tags: ['water', 'life'],
    physics: { DIFF: 0.12, ENT: 0.0003, INFO: 0.2, BIO: 0.5, procs: ['thermo', 'bio'] },
  },
  {
    id: 'frozen', name: 'Frozen Moon', icon: '🌙',
    desc: 'Barren, low entropy. No life. Geology only.',
    tags: ['ice', 'geology'],
    physics: { DIFF: 0.04, ENT: 0.0001, INFO: 0, BIO: 0.05, procs: ['geo'] },
  },
  {
    id: 'machine', name: 'Machine Ecology', icon: '⚙️',
    desc: 'High energy, structured order. Information dominant.',
    tags: ['tech', 'info'],
    physics: { DIFF: 0.15, ENT: 0.00005, INFO: 1.2, BIO: 0.1, procs: ['thermo', 'info'] },
  },
  {
    id: 'crystal', name: 'Crystal Planet', icon: '💎',
    desc: 'Ultra-low entropy. Perfect order. Energy locked in crystals.',
    tags: ['crystal', 'order'],
    physics: { DIFF: 0.02, ENT: 0.00001, INFO: 0.3, BIO: 0, procs: ['geo'] },
  },
  {
    id: 'toxic', name: 'Toxic Wasteland', icon: '☣️',
    desc: 'High entropy. Hostile chemistry.',
    tags: ['entropy', 'hostile'],
    physics: { DIFF: 0.1, ENT: 0.0015, INFO: 0.1, BIO: 0.05, procs: ['thermo', 'geo'] },
  },
  {
    id: 'neural', name: 'Neural Biosphere', icon: '🧠',
    desc: 'Consciousness substrate. Information is primary.',
    tags: ['info', 'consciousness'],
    physics: { DIFF: 0.08, ENT: 0.0002, INFO: 2.0, BIO: 0.9, procs: ['bio', 'info', 'emerge'] },
  },
  {
    id: 'ruins', name: 'Post-Human Earth', icon: '🏛️',
    desc: 'Decaying structures. High information residue. Memory of civilisation.',
    tags: ['decay', 'history'],
    physics: { DIFF: 0.07, ENT: 0.0008, INFO: 0.6, BIO: 0.3, procs: ['bio', 'info'] },
  },
  {
    id: 'volcanic', name: 'Volcanic Planet', icon: '🌋',
    desc: 'High energy. Geological violence. Primed for emergence.',
    tags: ['heat', 'geology'],
    physics: { DIFF: 0.1, ENT: 0.0005, INFO: 0.1, BIO: 0.1, procs: ['thermo', 'geo', 'emerge'] },
  },
  {
    id: 'gasgiant', name: 'Gas Giant', icon: '🪐',
    desc: 'Massive energy flows. No solid surface. Weather dominates.',
    tags: ['gas', 'energy'],
    physics: { DIFF: 0.2, ENT: 0.0006, INFO: 0.05, BIO: 0, procs: ['thermo'] },
  },
  {
    id: 'collapse', name: 'Entropy Collapse', icon: '🌀',
    desc: 'Maximum chaos. Watch order fight entropy.',
    tags: ['entropy', 'chaos'],
    physics: { DIFF: 0.18, ENT: 0.002, INFO: 0.1, BIO: 0.1, procs: ['thermo', 'emerge'] },
  },
]

// ── Physics Styles ────────────────────────────────────────────────────────────

export const PHYSICS_STYLES: PhysicsStyle[] = [
  {
    id: 'stable', name: 'Stable Physics', icon: '⚖️',
    desc: 'Default constants. Balanced.',
    multipliers: {},
  },
  {
    id: 'chaotic', name: 'Chaotic Laws', icon: '🎲',
    desc: 'Laws mutate rapidly. Unpredictable.',
    multipliers: { ENT: 3, DIFF: 1.5 },
  },
  {
    id: 'slow', name: 'Slow Time', icon: '⏳',
    desc: 'Everything at 30% speed.',
    multipliers: { tmul: 0.3 },
  },
  {
    id: 'hyper', name: 'Hyper Diffusion', icon: '💨',
    desc: 'Energy spreads instantly. No local hotspots.',
    multipliers: { DIFF: 2.5 },
  },
  {
    id: 'info', name: 'Information Dominant', icon: '💡',
    desc: 'Information field overpowers physical fields.',
    multipliers: { INFO: 3 },
  },
  {
    id: 'lowent', name: 'Low Entropy', icon: '🔮',
    desc: 'Order preserved longer. Structures stable.',
    multipliers: { ENT: 0.08 },
  },
  {
    id: 'gravity', name: 'High Gravity', icon: '🌍',
    desc: 'Density compresses. Matter dominates.',
    multipliers: { DIFF: 0.5 },
  },
  {
    id: 'mutation', name: 'Aggressive Mutation', icon: '🧬',
    desc: 'Rapid evolution. Fast extinction.',
    multipliers: { ENT: 1.5, INFO: 1.5 },
  },
]

// ── Evolution Styles ──────────────────────────────────────────────────────────

export const EVOLUTION_STYLES: EvolutionStyle[] = [
  {
    id: 'rapid', name: 'Rapid Evolution', icon: '⚡',
    desc: 'Fast genetic drift. Quick extinction.',
    agentMutRate: 0.3, spawnN: 15,
  },
  {
    id: 'stable', name: 'Stable Ecosystem', icon: '🌿',
    desc: 'Gradual change. Long-lived species.',
    agentMutRate: 0.01, spawnN: 8,
  },
  {
    id: 'civ', name: 'Civilization Growth', icon: '🏙️',
    desc: 'Agents lean toward cooperation.',
    agentMutRate: 0.05, spawnN: 12,
  },
  {
    id: 'pred', name: 'Predator Dominance', icon: '🦁',
    desc: 'Aggressive competition. Extinction cycles.',
    agentMutRate: 0.15, spawnN: 20,
  },
  {
    id: 'machine', name: 'Machine Intelligence', icon: '🤖',
    desc: 'Information-driven emergence.',
    agentMutRate: 0.08, spawnN: 10,
  },
  {
    id: 'coop', name: 'Cooperative Life', icon: '🤝',
    desc: 'Entities share resources. Mutualism dominates.',
    agentMutRate: 0.02, spawnN: 10,
  },
]

// ── Hazard Profiles ───────────────────────────────────────────────────────────

export const HAZARDS: HazardProfile[] = [
  {
    id: 'meteor', name: 'Meteor Storms', icon: '☄️',
    desc: 'Periodic high-energy impacts.',
    fn: ({ W, H, D }) => {
      const cells: HazardCell[] = []
      for (let i = 0; i < 3; i++) {
        const x = Math.floor(Math.random() * W)
        const y = Math.floor(Math.random() * H)
        for (let r = 0; r < 4; r++) {
          cells.push({
            x: Math.max(0, Math.min(W - 1, x + r - 2)),
            y: Math.max(0, Math.min(H - 1, y + r - 2)),
            z: D - 1, f: 0, v: 800,
          })
        }
      }
      return cells
    },
  },
  {
    id: 'solar', name: 'Solar Radiation', icon: '☀️',
    desc: 'Periodic energy surges on surface.',
    fn: ({ W, H, D }) => {
      const cells: HazardCell[] = []
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        cells.push({ x, y, z: D - 1, f: 3, v: 0.02 })
      }
      return cells
    },
  },
  {
    id: 'acid', name: 'Acid Rain', icon: '🌧️',
    desc: 'Density erosion from above.',
    fn: ({ W, H, D }) => {
      const cells: HazardCell[] = []
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (Math.random() > 0.7) {
          cells.push({ x, y, z: D - 1, f: 1, v: -(0.05 + Math.random() * 0.05) })
        }
      }
      return cells
    },
  },
  {
    id: 'tectonic', name: 'Tectonic Chaos', icon: '⛰️',
    desc: 'Density upheavals from below.',
    fn: ({ W, H }) => {
      const cells: HazardCell[] = []
      const cx = Math.floor(Math.random() * W)
      const cy = Math.floor(Math.random() * H)
      for (let r = 0; r < 6; r++) {
        cells.push({
          x: Math.max(0, Math.min(W - 1, cx + r - 3)),
          y: Math.max(0, Math.min(H - 1, cy + r - 3)),
          z: 0, f: 0, v: 300,
        })
      }
      return cells
    },
  },
  {
    id: 'magnetic', name: 'Magnetic Instability', icon: '🧲',
    desc: 'Information field disruption.',
    fn: ({ W, H, D }) => {
      const cells: HazardCell[] = []
      for (let i = 0; i < 20; i++) {
        cells.push({
          x: Math.floor(Math.random() * W),
          y: Math.floor(Math.random() * H),
          z: Math.floor(Math.random() * D),
          f: 2, v: -(20 + Math.random() * 50),
        })
      }
      return cells
    },
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getArchetype(id: string): WorldArchetype | undefined {
  return ARCHETYPES.find(a => a.id === id)
}

export function getPhysicsStyle(id: string): PhysicsStyle | undefined {
  return PHYSICS_STYLES.find(s => s.id === id)
}

export function applyStyleToPhysics(
  base: { DIFF: number; ENT: number; INFO: number; BIO: number },
  styleId: string,
): { DIFF: number; ENT: number; INFO: number; BIO: number } {
  const style = getPhysicsStyle(styleId)
  if (!style) return base
  const m = style.multipliers
  return {
    DIFF: base.DIFF * (m.DIFF ?? 1),
    ENT:  base.ENT  * (m.ENT  ?? 1),
    INFO: base.INFO * (m.INFO ?? 1),
    BIO:  base.BIO  * (m.BIO  ?? 1),
  }
}
