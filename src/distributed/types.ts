export interface ChunkOwnership {
  chunkKey: string;
  ownerId: string;
  lastUpdated: number;
  version: number;
}

export interface SimulationNode {
  id: string;
  type: 'client' | 'worker' | 'server';
  capacity: number;
  activeChunks: string[];
  status: 'healthy' | 'overloaded' | 'offline';
}

export type DistributionStrategy = 'static' | 'dynamic' | 'layered' | 'evolutionary';

export type SyncMessage =
  | { type: 'claim'; chunkKey: string; ownerId: string; version?: number }
  | { type: 'release'; chunkKey: string; ownerId: string }
  | { type: 'boundary'; chunkKey: string; data: ArrayBuffer }
  | { type: 'tick'; tick: number }
  | { type: 'ping'; ts: number };
