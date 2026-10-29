export const MAT = {
  VACUUM:                  0,
  STONE:                   1,
  SAND:                    2,
  CRYSTAL:                 3,
  METAL:                   4,
  MAGMA:                   5,
  ICE:                     6,
  ORGANIC_TISSUE:          7,
  SPORES:                  8,
  MEMBRANE:                9,
  BIOMASS:                10,
  PLASMA:                 11,
  SUPERCONDUCTIVE_MATTER: 12,
  INFORMATION_SUBSTRATE:  13,
} as const;

export type MatId = typeof MAT[keyof typeof MAT];
export const MAT_COUNT = 14;

export interface MaterialDef {
  id: MatId;
  name: string;
  color: [number, number, number]; // RGB 0..1 for material layer rendering
  conductivity: number;            // multiplier on energyDiffusion (stone=0.15, metal=3.0)
  heatCapacity: number;            // inverse multiplier on tempDiffusion (ice=0.3, metal=2.0)
  elasticity: number;              // pressure response multiplier
  erosionResistance: number;       // 0=erodes instantly, 1=immune
  crystallizationRate: number;     // multiplier on crystallization process
  bioAffinity: number;             // additive bonus to bio_potential (organic=0.3, stone=-0.1)
  radiationAbsorption: number;     // fraction of radiation energy absorbed (0..1)
}

export const MATERIAL_LIBRARY: MaterialDef[] = [
  { id: MAT.VACUUM,                 name: 'Vacuum',                color: [0.05, 0.05, 0.10], conductivity: 0.05, heatCapacity: 0.1,  elasticity: 0.0, erosionResistance: 0.0,  crystallizationRate: 0.0,  bioAffinity: 0.0,   radiationAbsorption: 0.0  },
  { id: MAT.STONE,                  name: 'Stone',                 color: [0.45, 0.42, 0.38], conductivity: 0.15, heatCapacity: 1.4,  elasticity: 0.8, erosionResistance: 0.75, crystallizationRate: 0.5,  bioAffinity: -0.05, radiationAbsorption: 0.4  },
  { id: MAT.SAND,                   name: 'Sand',                  color: [0.82, 0.72, 0.47], conductivity: 0.25, heatCapacity: 0.9,  elasticity: 0.2, erosionResistance: 0.2,  crystallizationRate: 0.3,  bioAffinity: 0.0,   radiationAbsorption: 0.35 },
  { id: MAT.CRYSTAL,                name: 'Crystal',               color: [0.55, 0.88, 0.98], conductivity: 0.5,  heatCapacity: 1.2,  elasticity: 1.5, erosionResistance: 0.85, crystallizationRate: 3.0,  bioAffinity: 0.05,  radiationAbsorption: 0.15 },
  { id: MAT.METAL,                  name: 'Metal',                 color: [0.72, 0.72, 0.78], conductivity: 3.0,  heatCapacity: 2.0,  elasticity: 2.0, erosionResistance: 0.9,  crystallizationRate: 1.5,  bioAffinity: -0.1,  radiationAbsorption: 0.7  },
  { id: MAT.MAGMA,                  name: 'Magma',                 color: [0.95, 0.32, 0.05], conductivity: 0.8,  heatCapacity: 0.5,  elasticity: 0.1, erosionResistance: 0.1,  crystallizationRate: 0.1,  bioAffinity: -0.2,  radiationAbsorption: 0.8  },
  { id: MAT.ICE,                    name: 'Ice',                   color: [0.80, 0.92, 1.00], conductivity: 0.3,  heatCapacity: 0.3,  elasticity: 0.6, erosionResistance: 0.3,  crystallizationRate: 4.0,  bioAffinity: -0.1,  radiationAbsorption: 0.1  },
  { id: MAT.ORGANIC_TISSUE,         name: 'Organic Tissue',        color: [0.28, 0.65, 0.28], conductivity: 0.6,  heatCapacity: 0.8,  elasticity: 0.5, erosionResistance: 0.15, crystallizationRate: 0.05, bioAffinity: 0.35,  radiationAbsorption: 0.5  },
  { id: MAT.SPORES,                 name: 'Spores',                color: [0.55, 0.80, 0.35], conductivity: 0.4,  heatCapacity: 0.6,  elasticity: 0.2, erosionResistance: 0.05, crystallizationRate: 0.1,  bioAffinity: 0.45,  radiationAbsorption: 0.3  },
  { id: MAT.MEMBRANE,               name: 'Membrane',              color: [0.20, 0.78, 0.55], conductivity: 0.7,  heatCapacity: 0.9,  elasticity: 1.2, erosionResistance: 0.25, crystallizationRate: 0.2,  bioAffinity: 0.40,  radiationAbsorption: 0.45 },
  { id: MAT.BIOMASS,                name: 'Biomass',               color: [0.18, 0.50, 0.18], conductivity: 0.55, heatCapacity: 0.75, elasticity: 0.4, erosionResistance: 0.1,  crystallizationRate: 0.05, bioAffinity: 0.50,  radiationAbsorption: 0.55 },
  { id: MAT.PLASMA,                 name: 'Plasma',                color: [0.90, 0.55, 1.00], conductivity: 5.0,  heatCapacity: 0.2,  elasticity: 0.0, erosionResistance: 0.0,  crystallizationRate: 0.0,  bioAffinity: -0.3,  radiationAbsorption: 0.9  },
  { id: MAT.SUPERCONDUCTIVE_MATTER, name: 'Superconductive Matter', color: [0.40, 0.90, 0.95], conductivity: 10.0, heatCapacity: 3.0, elasticity: 3.0, erosionResistance: 0.95, crystallizationRate: 5.0,  bioAffinity: 0.1,   radiationAbsorption: 0.05 },
  { id: MAT.INFORMATION_SUBSTRATE,  name: 'Info Substrate',        color: [0.65, 0.40, 1.00], conductivity: 1.5,  heatCapacity: 1.0,  elasticity: 1.0, erosionResistance: 0.5,  crystallizationRate: 2.0,  bioAffinity: 0.6,   radiationAbsorption: 0.2  },
];

// Flat Float32Array for GPU upload: MAT_COUNT × 7 floats
export function buildMaterialBuffer(): Float32Array {
  const buf = new Float32Array(MAT_COUNT * 7);
  for (const m of MATERIAL_LIBRARY) {
    const base = m.id * 7;
    buf[base + 0] = m.conductivity;
    buf[base + 1] = m.heatCapacity;
    buf[base + 2] = m.elasticity;
    buf[base + 3] = m.erosionResistance;
    buf[base + 4] = m.crystallizationRate;
    buf[base + 5] = m.bioAffinity;
    buf[base + 6] = m.radiationAbsorption;
  }
  return buf;
}

export function matName(id: number): string {
  return MATERIAL_LIBRARY[Math.min(Math.floor(id), MAT_COUNT - 1)]?.name ?? 'Unknown';
}
