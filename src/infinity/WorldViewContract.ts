export type RealityRenderMode = '3d' | 'field3d' | '2d' | 'hybrid' | 'metrics'

export type WorldViewSnapshot = {
  version: 1
  center: { x: number; y: number; z: number }
  visibleRadius: number
  sliceY: number
  simulationTime: number
  seed: string
  renderMode: RealityRenderMode
}

export class WorldViewContract {
  private state: WorldViewSnapshot = {
    version: 1,
    center: { x: 0, y: 0, z: 0 },
    visibleRadius: 128,
    sliceY: 0,
    simulationTime: 0,
    seed: 'reality-engine-infinity-v1',
    renderMode: '3d',
  }

  snapshot(): WorldViewSnapshot {
    return {
      ...this.state,
      center: { ...this.state.center },
    }
  }

  setCenter(x: number, y: number, z: number) {
    if (![x, y, z].every(Number.isFinite)) return this.snapshot()
    this.state.center = { x, y, z }
    return this.snapshot()
  }

  setVisibleRadius(radius: number) {
    if (!Number.isFinite(radius)) return this.snapshot()
    this.state.visibleRadius = Math.max(1, radius)
    return this.snapshot()
  }

  setSliceY(y: number) {
    if (!Number.isFinite(y)) return this.snapshot()
    this.state.sliceY = Math.round(y)
    return this.snapshot()
  }

  setSimulationTime(time: number) {
    if (!Number.isFinite(time)) return this.snapshot()
    this.state.simulationTime = Math.max(0, time)
    return this.snapshot()
  }

  setSeed(seed: string) {
    if (!seed.trim()) return this.snapshot()
    this.state.seed = seed
    return this.snapshot()
  }

  setRenderMode(mode: RealityRenderMode) {
    this.state.renderMode = mode
    return this.snapshot()
  }

  worldToSlice(x: number, z: number, width: number, height: number) {
    const safeW = Math.max(1, width)
    const safeH = Math.max(1, height)
    const diameter = Math.max(1, this.state.visibleRadius * 2)
    return {
      x: ((x - this.state.center.x) / diameter + 0.5) * safeW,
      y: ((z - this.state.center.z) / diameter + 0.5) * safeH,
    }
  }

  sliceToWorld(px: number, py: number, width: number, height: number) {
    const safeW = Math.max(1, width)
    const safeH = Math.max(1, height)
    const diameter = Math.max(1, this.state.visibleRadius * 2)
    return {
      x: this.state.center.x + (px / safeW - 0.5) * diameter,
      y: this.state.sliceY,
      z: this.state.center.z + (py / safeH - 0.5) * diameter,
    }
  }
}

export const worldViewContract = new WorldViewContract()
