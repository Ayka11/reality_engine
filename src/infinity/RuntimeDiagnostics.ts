export type RuntimeDiagnosticsSnapshot = {
  renderedFrames: number
  fps: number
  frameTimeMs: number
  physicsTimeMs: number
  chunkSyncTimeMs: number
  terrainLodTimeMs: number
  spatialQueries: number
  physicsInteractions: number
  loadedChunks: number
  visibleObjects: number
  particleCount: number
}

export class RuntimeDiagnostics {
  constructor() { Object.freeze(this) }
  #frames = 0
  #renderedFrames = 0
  #elapsed = 0
  #frameTimeMs = 0
  #physicsTimeMs = 0
  #chunkSyncTimeMs = 0
  #terrainLodTimeMs = 0
  #spatialQueries = 0
  #physicsInteractions = 0
  #fps = 0

  beginFrame() {
    return performance.now()
  }

  recordFrame(start: number) {
    const wallClockMs = Math.max(0.001, performance.now() - start)
    this.#frames++
    this.#renderedFrames++
    this.#elapsed += wallClockMs
    this.#frameTimeMs = this.#frameTimeMs * 0.9 + wallClockMs * 0.1
    if (this.#elapsed >= 1000) {
      this.#fps = this.#frames * 1000 / this.#elapsed
      this.#frames = 0
      this.#elapsed = 0
    }
    return wallClockMs
  }

  recordPhysics(ms: number, interactions: number, queries: number) {
    this.#physicsTimeMs = this.#physicsTimeMs * 0.9 + ms * 0.1
    this.#physicsInteractions = interactions
    this.#spatialQueries = queries
  }

  recordChunkSync(ms: number) {
    this.#chunkSyncTimeMs = this.#chunkSyncTimeMs * 0.9 + ms * 0.1
  }

  recordTerrainLod(ms: number) {
    this.#terrainLodTimeMs = this.#terrainLodTimeMs * 0.9 + ms * 0.1
  }

  snapshot(loadedChunks: number, visibleObjects: number, particleCount: number): RuntimeDiagnosticsSnapshot {
    return {
      renderedFrames: this.#renderedFrames,
      fps: this.#fps,
      frameTimeMs: this.#frameTimeMs,
      physicsTimeMs: this.#physicsTimeMs,
      chunkSyncTimeMs: this.#chunkSyncTimeMs,
      terrainLodTimeMs: this.#terrainLodTimeMs,
      spatialQueries: this.#spatialQueries,
      physicsInteractions: this.#physicsInteractions,
      loadedChunks,
      visibleObjects,
      particleCount,
    }
  }
}
