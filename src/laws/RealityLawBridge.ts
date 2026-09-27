import { LawEngine } from './LawEngine'
import { PROC } from '../process/ProcessDef'

export type RuntimeLawState = {
  laws: Array<{ name: string; active: boolean; fitness: number; strength: number }>
  processes: string[]
  DIFF: number
  ENT: number
  INFO: number
  BIO: number
}

const PROCESS_NAMES: Record<number, string> = {
  [PROC.ENERGY_DIFFUSION]: 'energy',
  [PROC.TEMP_DIFFUSION]: 'thermo',
  [PROC.DENSITY_FLOW]: 'density',
  [PROC.ENTROPY_GROWTH]: 'entropy',
  [PROC.INFORMATION]: 'info',
  [PROC.BIO_POTENTIAL]: 'bio',
  [PROC.WAVE_PROPAGATION]: 'wave',
  [PROC.GRAVITY]: 'gravity',
  [PROC.METABOLISM]: 'metabolism',
  [PROC.SIGNAL_PROPAGATION]: 'signal',
  [PROC.CRYSTALLIZATION]: 'crystallization',
  [PROC.RADIATION]: 'radiation',
  [PROC.PRESSURE_DIFFUSION]: 'pressure',
  [PROC.FIELD_ROTATION]: 'rotation',
  [PROC.EROSION]: 'erosion',
}

const UI_TO_PROCESS: Record<string, number[]> = {
  'Energy Diffusion': [PROC.ENERGY_DIFFUSION],
  'Entropy Growth': [PROC.ENTROPY_GROWTH],
  'Info Bloom': [PROC.INFORMATION],
  'Bio Emergence': [PROC.BIO_POTENTIAL],
  'Thermal Coupling': [PROC.TEMP_DIFFUSION],
  'Density Gravity': [PROC.DENSITY_FLOW, PROC.GRAVITY],
  'Neural Plasticity': [PROC.METABOLISM],
  'Wave Resonance': [PROC.WAVE_PROPAGATION],
}

export class RealityLawBridge {
  readonly engine = new LawEngine()
  private ui = new Map<string, { active: boolean; fitness: number; strength: number }>()

  setUiLaw(name: string, active: boolean, fitness = 0.5, strength = 0.1) {
    this.ui.set(name, { active, fitness, strength })
    const ids = UI_TO_PROCESS[name] ?? []
    const law = this.engine.laws.find(l => l.name === name)
    if (law) this.engine.setLawOverride(law.id, active ? 'on' : 'off')
    for (const id of ids) this.engine.toggleProcess(id, active)
  }

  getState(): RuntimeLawState {
    const activeIds = this.engine.activeProcessMask
    const processes = Object.entries(PROCESS_NAMES)
      .filter(([id]) => (activeIds & (1 << Number(id))) !== 0)
      .map(([, name]) => name)

    const get = (name: string, fallback: number) => this.ui.get(name)?.strength ?? fallback
    return {
      laws: [...this.ui.entries()].map(([name, v]) => ({ name, ...v })),
      processes,
      DIFF: get('Energy Diffusion', 0.09) * (this.ui.get('Energy Diffusion')?.active === false ? 0 : 1),
      ENT: get('Entropy Growth', 0.0004) * (this.ui.get('Entropy Growth')?.active === false ? 0 : 1),
      INFO: get('Info Bloom', 0.35) * (this.ui.get('Info Bloom')?.active === false ? 0 : 1),
      BIO: get('Bio Emergence', 0.25) * (this.ui.get('Bio Emergence')?.active === false ? 0 : 1),
    }
  }

  applySnapshot(laws: Array<{ name: string; active: boolean; fitness?: number; strength?: number }>) {
    for (const law of laws) this.setUiLaw(law.name, law.active, law.fitness ?? 0.5, law.strength ?? 0.1)
    return this.getState()
  }
}
