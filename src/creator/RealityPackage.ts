import type { RealityGraph } from './types';
import type { EntityLayerSnapshot } from '../simulation/EntityLayer';
import type { LawEngineSnapshot } from '../laws/LawEngine';
import type { AgentSystemSnapshot } from '../simulation/AgentSystem';
import type { CivilizationSystemSnapshot } from '../simulation/CivilizationSystem';
import type { ChemLayerSnapshot } from '../chemistry/ChemLayer';
import type { WorldEventsSnapshot } from '../world/WorldEvents';
import type { CausalGraphSnapshot } from '../simulation/CausalGraph';
import type { ClimateSystemSnapshot } from '../simulation/ClimateSystem';
import type { MultiScaleSystemSnapshot } from '../simulation/MultiScaleSystem';
import type { LanguageSystemSnapshot } from '../simulation/LanguageEmergence';
import type { EconomicSystemSnapshot } from '../simulation/EconomicSystem';
import type { MetaLawEvolutionSnapshot } from '../simulation/MetaLawEvolution';
import type { CosmologicalSimSnapshot } from '../simulation/CosmologicalSim';
import type { SceneDirectorSnapshot } from '../ai/SceneDirector';
import type { WorldEditorSnapshot } from '../infinity/WorldEditorSnapshot';

export interface RealityPackageManifest {
  version: string;
  name: string;
  author: string;
  created: string;
  description: string;
  tags: string[];
  compatibility: string;
}

export interface EntitySnapshot {
  id: string;
  type: string;
  genome: unknown;
  position: [number, number, number];
  energy: number;
  memory?: unknown;
}

export interface LawSnapshot {
  id: string;
  name: string;
  conditions: unknown;
  effects: unknown;
  fitness: number;
  mutationRate: number;
  parentId?: string;
}

export interface ProcessSnapshot {
  id: number;
  name: string;
  enabled: boolean;
  parameters: Record<string, unknown>;
}

/** Sparse chunk payloads outside the dense voxel window. */
export interface RealityPackageChunks {
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
}

/** Portable runtime snapshots mirrored from WorldRuntimeStateSnapshot. */
export interface RealityPackageRuntimeState {
  entityLayer?: EntityLayerSnapshot;
  agents?: AgentSystemSnapshot;
  civilizations?: CivilizationSystemSnapshot;
  laws?: LawEngineSnapshot;
  chemistry?: ChemLayerSnapshot;
  worldEvents?: WorldEventsSnapshot;
  causal?: CausalGraphSnapshot;
  previousEnergy?: Float32Array;
  climate?: ClimateSystemSnapshot;
  multiScale?: MultiScaleSystemSnapshot;
  language?: LanguageSystemSnapshot;
  economy?: EconomicSystemSnapshot;
  metaLawEvolution?: MetaLawEvolutionSnapshot;
  cosmologicalSim?: CosmologicalSimSnapshot;
  director?: SceneDirectorSnapshot;
}

export interface RealityPackageMetadata {
  gridSize: { x: number; y: number; z: number };
  totalEnergy: number;
  entropy: number;
  complexityScore: number;
  dominantLaws: string[];
  /** Simulation clock at export; optional for backward compatibility. */
  simulationTicks?: number;
}

export interface RealityPackage {
  manifest: RealityPackageManifest;
  graph: RealityGraph;
  voxelState: ArrayBuffer;
  /** Optional sparse field chunks; absent only in legacy/partial packages. */
  chunks?: RealityPackageChunks;
  entities: EntitySnapshot[];
  /** Complete authoritative entity state; absent only in legacy packages. */
  runtimeEntityLayer?: EntityLayerSnapshot;
  laws: LawSnapshot[];
  /** Includes manual overrides, graph bindings and deterministic law RNG state. */
  lawEngineState?: LawEngineSnapshot;
  /** Complete optional portable runtime state; absent in legacy packages. */
  runtimeState?: RealityPackageRuntimeState;
  /** Authoritative InfiniteWorldRenderer scene/terrain/surface state. */
  worldEditor?: WorldEditorSnapshot;
  processes: ProcessSnapshot[];
  metadata: RealityPackageMetadata;
}

export interface RealityPackageSummary {
  id: string;
  name: string;
  author: string;
  version: string;
  tags: string[];
  created: string;
  compatibility: string;
}
