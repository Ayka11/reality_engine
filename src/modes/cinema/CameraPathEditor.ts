/**
 * CameraPathEditor — cubic-eased spline camera path.
 * Stores control points; interpolates position+FOV at any tick.
 * applyCameraAtTick() updates window.cinemaCamera for the renderer to read.
 */

export interface CamPoint {
  tick: number
  x: number
  y: number
  z: number
  fov: number
}

export interface CameraState {
  x: number; y: number; z: number; fov: number
}

export class CameraPathEditor {
  points: CamPoint[] = []

  addKeyframe(tick: number, x: number, y: number, z = 0, fov = 60): void {
    this.points.push({ tick, x, y, z, fov })
    this.points.sort((a, b) => a.tick - b.tick)
  }

  removeKeyframe(tick: number): void {
    this.points = this.points.filter(p => p.tick !== tick)
  }

  /** Evaluate camera state at a given tick via cubic easing between control points. */
  evaluate(tick: number): CameraState {
    if (!this.points.length) return { x: 0, y: 0, z: 0, fov: 60 }
    if (tick <= this.points[0].tick)  return { ...this.points[0] }
    const last = this.points[this.points.length - 1]
    if (tick >= last.tick) return { ...last }

    let lo = 0
    for (let i = 0; i < this.points.length - 1; i++) {
      if (this.points[i].tick <= tick && this.points[i + 1].tick > tick) { lo = i; break }
    }
    const a = this.points[lo]
    const b = this.points[lo + 1]
    const t = (tick - a.tick) / (b.tick - a.tick)
    const e = this._cubicEase(t)
    return {
      x:   this._lerp(a.x,   b.x,   e),
      y:   this._lerp(a.y,   b.y,   e),
      z:   this._lerp(a.z,   b.z,   e),
      fov: this._lerp(a.fov, b.fov, e),
    }
  }

  applyCameraAtTick(tick: number): void {
    const state = this.evaluate(tick)
    ;(window as unknown as Record<string, unknown>)['cinemaCamera'] = state
  }

  exportJSON(): string {
    return JSON.stringify({
      format:  'reality_engine_camera_path_v1',
      points:  this.points,
    }, null, 2)
  }

  importJSON(json: string): void {
    const data = JSON.parse(json)
    this.points = data.points ?? []
  }

  // ── private ─────────────────────────────────────────────────────────────

  private _cubicEase(t: number): number {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2
  }

  private _lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
  }
}
