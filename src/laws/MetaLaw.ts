export interface PhysicsParams {
  energyDiffusion: number;
  tempDiffusion: number;
  tempEnergyCoupling: number;
  pressureDensityCoupling: number;
  entropyGrowthRate: number;
  entropyEnergyCoupling: number;
  infoGrowthRate: number;
  infoEntropySupp: number;
  infoGrowthThreshE: number;
  infoGrowthThreshD: number;
  waveSpeed: number;
  waveDamping: number;
  gravityDensityCoupling: number;
  timeBaseRate: number;
  timeEnergyBoost: number;
}

export const DEFAULT_PARAMS: PhysicsParams = {
  energyDiffusion:        0.12,
  tempDiffusion:          0.08,
  tempEnergyCoupling:     0.005,
  pressureDensityCoupling:100,
  entropyGrowthRate:      0.001,
  entropyEnergyCoupling:  0.0005,
  infoGrowthRate:         0.3,
  infoEntropySupp:        0.5,
  infoGrowthThreshE:      100,
  infoGrowthThreshD:      0.3,
  waveSpeed:              2.0,
  waveDamping:            0.98,
  gravityDensityCoupling: 0.1,
  timeBaseRate:           1.0,
  timeEnergyBoost:        0.002,
};

export type MetricKey = 'totalEnergy' | 'avgEntropy' | 'avgInfo' | 'avgDensity' | 'avgBio' | 'tick';
export type CompareOp = 'gt' | 'lt' | 'gte' | 'lte';

export interface LawCondition {
  metric: MetricKey;
  op: CompareOp;
  value: number;
}

export interface MetaLaw {
  id: string;
  name: string;
  active: boolean;
  // Conditions on global world metrics that trigger this law
  conditions: LawCondition[];
  // Process bitmask effects
  enablesProcesses: number[];
  disablesProcesses: number[];
  // Parameter overrides when active (merged on top of DEFAULT_PARAMS)
  paramOverrides: Partial<PhysicsParams>;
  // Evolution state
  fitness: number;
  age: number;
  mutationRate: number;
  generation: number;
  parentId?: string;
  // Visualization
  color: string;
}

export interface WorldMetrics {
  totalEnergy: number;
  avgEntropy: number;
  avgInfo: number;
  avgDensity: number;
  avgBio: number;
  tick: number;
}
