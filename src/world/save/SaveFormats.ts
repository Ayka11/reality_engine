import type { EntitySnapshot, LawSnapshot, ProcessSnapshot } from '../../creator';
import type { RealityGraph } from '../../creator/types';

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

export interface WorldSnapshot {
  version: string;
  timestamp: number;
  name: string;
  seed?: number;
  gridSize: { width: number; height: number; depth: number };
  fields: Record<string, ArrayBuffer>;
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
