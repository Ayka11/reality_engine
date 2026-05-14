export interface Participant {
  id: string;
  name: string;
  role: 'observer' | 'sculptor' | 'lawmaker' | 'director' | 'admin';
  lastActive: number;
}

export interface WorldSession {
  worldId: string;
  name: string;
  host: string;
  participants: Participant[];
  isPersistent: boolean;
  lastTick: number;
  version: number;
}

export type SyncOperation =
  | { type: 'brush_stroke'; data: any; author: string }
  | { type: 'graph_update'; data: any; author: string }
  | { type: 'law_change'; data: any; author: string }
  | { type: 'chunk_update'; chunkKey: string; data: ArrayBuffer }
  | { type: 'director_command'; data: any; author: string };
