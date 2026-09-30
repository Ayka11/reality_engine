export interface ScaleTelemetry {
  observer: { x: number; y: number; z: number };
  residentChunks: number;
  visibleChunks: number;
  backgroundChunks: number;
  simulatingChunks: number;
  cachedChunks: number;
  logicalExtentCells: { x: number; y: number; z: number };
  activeWindowCells: { x: number; y: number; z: number };
  chunkSize: number;
  lodLevels: number;
  amrLevels: number;
  simulationMs?: number;
  fps?: number;
  memoryBytes?: number;
}
