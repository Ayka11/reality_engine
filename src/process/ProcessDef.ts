// Each process maps to a bit in the activeProcesses bitmask (id = bit index)
export const PROC = {
  ENERGY_DIFFUSION:   0,
  TEMP_DIFFUSION:     1,
  DENSITY_FLOW:       2,
  ENTROPY_GROWTH:     3,
  INFORMATION:        4,
  BIO_POTENTIAL:      5,
  WAVE_PROPAGATION:   6,
  GRAVITY:            7,
  PHASE_TRANSITION:   8,
  METABOLISM:         9,
  SIGNAL_PROPAGATION: 10,
  CRYSTALLIZATION:    11,
  RADIATION:          12,
  PRESSURE_DIFFUSION: 13,
  FIELD_ROTATION:     14,
  EROSION:            15,
} as const;

export type ProcId = typeof PROC[keyof typeof PROC];

export interface ProcessDef {
  id: ProcId;
  name: string;
  label: string;
  description: string;
  category: 'thermodynamic' | 'biological' | 'geological' | 'informational' | 'physical';
  defaultActive: boolean;
  entropyCost: number;
  mutable: boolean;
  inputs: string[];          // field names consumed
  outputs: string[];         // field names produced / affected
  stabilityImpact: number;   // -1..+1 (negative = destabilizing, positive = ordering)
}

export const PROCESS_LIBRARY: ProcessDef[] = [
  { id: PROC.ENERGY_DIFFUSION,   name:'ENERGY_DIFFUSION',   label:'Energy Diffusion',    description:'Energy spreads via Laplacian.',                    category:'thermodynamic', defaultActive:true,  entropyCost:0.0001,  mutable:true,  inputs:['energy'],              outputs:['energy'],                    stabilityImpact: 0.1  },
  { id: PROC.TEMP_DIFFUSION,     name:'TEMP_DIFFUSION',     label:'Thermal Flow',        description:'Temperature equalizes between neighbors.',         category:'thermodynamic', defaultActive:true,  entropyCost:0.0002,  mutable:true,  inputs:['temperature'],         outputs:['temperature'],               stabilityImpact: 0.1  },
  { id: PROC.DENSITY_FLOW,       name:'DENSITY_FLOW',       label:'Density Flow',        description:'Mass flows along pressure gradients.',             category:'physical',      defaultActive:true,  entropyCost:0.00005, mutable:true,  inputs:['density'],             outputs:['density'],                   stabilityImpact: 0.0  },
  { id: PROC.ENTROPY_GROWTH,     name:'ENTROPY_GROWTH',     label:'Entropy Growth',      description:'Disorder always increases. Arrow of time.',        category:'thermodynamic', defaultActive:true,  entropyCost:0,       mutable:false, inputs:['energy'],              outputs:['entropy'],                   stabilityImpact:-0.5  },
  { id: PROC.INFORMATION,        name:'INFORMATION',        label:'Information Dynamics',description:'Complexity grows in low-entropy, high-energy zones.', category:'informational',defaultActive:true,  entropyCost:0.001,   mutable:true,  inputs:['energy','entropy'],    outputs:['information'],               stabilityImpact: 0.4  },
  { id: PROC.BIO_POTENTIAL,      name:'BIO_POTENTIAL',      label:'Bio-Emergence',       description:'Life potential where conditions align.',            category:'biological',    defaultActive:true,  entropyCost:0.002,   mutable:true,  inputs:['energy','information'],outputs:['bioPotential'],              stabilityImpact: 0.6  },
  { id: PROC.WAVE_PROPAGATION,   name:'WAVE_PROPAGATION',   label:'Wave Propagation',    description:'Oscillatory modes carry energy across space.',     category:'physical',      defaultActive:true,  entropyCost:0.00001, mutable:true,  inputs:['energy'],              outputs:['energy','signal'],           stabilityImpact: 0.0  },
  { id: PROC.GRAVITY,            name:'GRAVITY',            label:'Gravity',             description:'Density curves the field, attracting mass.',       category:'physical',      defaultActive:true,  entropyCost:0,       mutable:true,  inputs:['density'],             outputs:['density','energy'],          stabilityImpact:-0.1  },
  { id: PROC.PHASE_TRANSITION,   name:'PHASE_TRANSITION',   label:'Phase Transitions',   description:'Matter changes state at thermal thresholds.',      category:'thermodynamic', defaultActive:true,  entropyCost:0.005,   mutable:true,  inputs:['temperature','density'],outputs:['chemState','entropy'],       stabilityImpact:-0.2  },
  { id: PROC.METABOLISM,         name:'METABOLISM',         label:'Metabolism',          description:'Bio-active regions convert energy → information.',  category:'biological',    defaultActive:false, entropyCost:0.01,    mutable:true,  inputs:['energy','bioPotential'],outputs:['information','entropy'],     stabilityImpact: 0.5  },
  { id: PROC.SIGNAL_PROPAGATION, name:'SIGNAL_PROPAGATION', label:'Signal Propagation',  description:'Information spreads as signals through the field.', category:'informational', defaultActive:false, entropyCost:0.003,   mutable:true,  inputs:['information','signal'],outputs:['signal'],                    stabilityImpact: 0.2  },
  { id: PROC.CRYSTALLIZATION,    name:'CRYSTALLIZATION',    label:'Crystallization',     description:'Low-entropy density regions form ordered lattices.',category:'geological',    defaultActive:false, entropyCost:-0.005,  mutable:true,  inputs:['density','temperature'],outputs:['density','entropy'],         stabilityImpact: 0.7  },
  { id: PROC.RADIATION,          name:'RADIATION',          label:'Radiation Pressure',  description:'High-energy cells push matter outward.',           category:'physical',      defaultActive:false, entropyCost:0.001,   mutable:true,  inputs:['energy'],              outputs:['density','entropy'],         stabilityImpact:-0.3  },
  { id: PROC.PRESSURE_DIFFUSION, name:'PRESSURE_DIFFUSION', label:'Pressure Waves',      description:'Pressure propagates as acoustic waves.',           category:'physical',      defaultActive:true,  entropyCost:0.0001,  mutable:true,  inputs:['density','energy'],    outputs:['energy'],                    stabilityImpact: 0.0  },
  { id: PROC.FIELD_ROTATION,     name:'FIELD_ROTATION',     label:'Field Rotation',      description:'Vector fields develop rotational (curl) modes.',   category:'physical',      defaultActive:false, entropyCost:0.0001,  mutable:true,  inputs:['energy'],              outputs:['energy'],                    stabilityImpact:-0.1  },
  { id: PROC.EROSION,            name:'EROSION',            label:'Erosion',             description:'Flow strips material from high-density regions.',  category:'geological',    defaultActive:false, entropyCost:0.002,   mutable:true,  inputs:['density','energy'],    outputs:['density','materialId'],      stabilityImpact:-0.4  },
];

export function defaultProcessMask(): number {
  let mask = 0;
  for (const p of PROCESS_LIBRARY) {
    if (p.defaultActive) mask |= (1 << p.id);
  }
  return mask;
}
