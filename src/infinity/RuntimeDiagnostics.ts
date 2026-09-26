export type RuntimeDiagnosticsSnapshot = {
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
  private frames = 0
  private elapsed = 0
  private frameTimeMs = 0
  private physicsTimeMs = 0
  private chunkSyncTimeMs = 0
  private terrainLodTimeMs = 0
  private spatialQueries = 0
  private physicsInteractions = 0
  private fps = 0

  beginFrame() {
    return performance.now()
  }

  recordFrame(start: number, dtMs: number) {
    this.frames++
    this.elapsed += dtMs
    this.frameTimeMs = this.frameTimeMs * 0.9 + dtMs * 0.1
    if (this.elapsed >= 1000) {
      this.fps = this.frames * 1000 / this.elapsed
      this.frames = 0
      this.elapsed = 0
    }
    return performance.now() - start
  }

  recordPhysics(ms: number, interactions: number, queries: number) {
    this.physicsTimeMs = this.physicsTimeMs * 0.9 + ms * 0.1
    this.physicsInteractions = interactions
    this.spatialQueries = queries
  }

  recordChunkSync(ms: number) {
    this.chunkSyncTimeMs = this.chunkSyncTimeMs * 0.9 + ms * 0.1
  }

  recordTerrainLod(ms: number) {
    this.terrainLodTimeMs = this.terrainLodTimeMs * 0.9 + ms * 0.1
  }

  snapshot(loadedChunks: number, visibleObjects: number, particleCount: number): RuntimeDiagnosticsSnapshot {
    return {
      fps: this.fps,
      frameTimeMs: this.frameTimeMs,
      physicsTimeMs: this.physicsTimeMs,
      chunkSyncTimeMs: this.chunkSyncTimeMs,
      terrainLodTimeMs: this.terrainLodTimeMs,
      spatialQueries: this.spatialQueries,
      physicsInteractions: this.physicsInteractions,
      loadedChunks,
      visibleObjects,
      particleCount,
    }
  }
}
