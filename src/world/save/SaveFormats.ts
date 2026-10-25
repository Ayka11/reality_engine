import type { EntitySnapshot, LawSnapshot, ProcessSnapshot } from '../../creator';
import type { RealityGraph } from '../../creator/types';
import type { AgentSystemSnapshot } from '../../simulation/AgentSystem';
import type { EntityLayerSnapshot } from '../../simulation/EntityLayer';
import type { CivilizationSystemSnapshot } from '../../simulation/CivilizationSystem';
import type { LawEngineSnapshot } from '../../laws/LawEngine';
import type { ChemLayerSnapshot } from '../../chemistry/ChemLayer';
import type { WorldEventsSnapshot } from '../../world/WorldEvents';
import type { CausalGraphSnapshot } from '../../simulation/CausalGraph';
import type { ClimateSystemSnapshot } from '../../simulation/ClimateSystem';
import type { MultiScaleSystemSnapshot } from '../../simulation/MultiScaleSystem';
import type { LanguageSystemSnapshot } from '../../simulation/LanguageEmergence';
import type { EconomicSystemSnapshot } from '../../simulation/EconomicSystem';
import type { MetaLawEvolutionSnapshot } from '../../simulation/MetaLawEvolution';
import type { CosmologicalSimSnapshot } from '../../simulation/CosmologicalSim';

export type SaveFormat = 'reality' | 'quick' | 'scientific' | 'minimal';

export interface CivSnapshot {
  id: number;
  name: string;
  color: [number, number, number];
  origin: [number, number, number];
  territory: number[];
  techLevel: number;
  population: number;
  energy: number;
  age: number;
  diplomacy: Record<number, 'neutral' | 'ally' | 'war'>;
  history: string[];
}

export interface WorldRuntimeStateSnapshot {
  /** Complete in-process snapshots for faithful quick-save restoration. */
  entityLayer?: EntityLayerSnapshot;
  agents?: AgentSystemSnapshot;
  civilizations?: CivilizationSystemSnapshot;
  laws?: LawEngineSnapshot;
  chemistry?: ChemLayerSnapshot;
  worldEvents?: WorldEventsSnapshot;
  causal?: CausalGraphSnapshot;
  /** Energy baseline used to calculate causal spikes after the next frame. */
  previousEnergy?: Float32Array;
  climate?: ClimateSystemSnapshot;
  multiScale?: MultiScaleSystemSnapshot;
  language?: LanguageSystemSnapshot;
  economy?: EconomicSystemSnapshot;
  metaLawEvolution?: MetaLawEvolutionSnapshot;
  cosmologicalSim?: CosmologicalSimSnapshot;
}

export interface WorldSnapshot {
  version: string;
  timestamp: number;
  name: string;
  seed?: number;
  gridSize: { width: number; height: number; depth: number };
  fields: Record<string, ArrayBuffer>;
  /** Optional runtime detail retained by quick saves; portable packages may omit it. */
  runtimeState?: WorldRuntimeStateSnapshot;
  realityGraph?: RealityGraph;
  activeLaws: LawSnapshot[];
  activeProcesses: ProcessSnapshot[];
  entities: EntitySnapshot[];
  civilizations: CivSnapshot[];
  metadata: {
    totalEnergy: number;
    entropy: number;
    complexity: number;
    activeLawsCount: number;
    entityCount: number;
    simulationTicks: number;
    dominantBiome: string;
  };
  thumbnail?: Blob;
  causalLog?: unknown[];
  directorNotes?: string;
  chunks?: {
    chunkSize: number;
    activeCount: number;
    serialized: Array<{
      key: string;
      cx: number;
      cy: number;
      cz: number;
      active: boolean;
      buffer: ArrayBuffer;
    }>;
  };
}

export interface StoredWorldSnapshot {
  id: string;
  name: string;
  timestamp: number;
  format: SaveFormat;
  snapshot: WorldSnapshot;
}

export interface WorldSaveSummary {
  id: string;
  name: string;
  timestamp: number;
  format: SaveFormat;
  metadata: WorldSnapshot['metadata'];
}
