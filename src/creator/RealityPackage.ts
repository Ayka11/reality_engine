import type { RealityGraph } from './types';

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

export interface RealityPackageMetadata {
  gridSize: { x: number; y: number; z: number };
  totalEnergy: number;
  entropy: number;
  complexityScore: number;
  dominantLaws: string[];
}

export interface RealityPackage {
  manifest: RealityPackageManifest;
  graph: RealityGraph;
  voxelState: ArrayBuffer;
  entities: EntitySnapshot[];
  laws: LawSnapshot[];
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
