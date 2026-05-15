/**
 * SimTimeline — Blender-like keyframe recorder for Cinema mode.
 *
 * Usage:
 *   const tl = new SimTimeline()
 *   tl.startRecording()
 *   // each frame from SimWorker:
 *   tl.captureKeyframe(tick, buf, NF, canvas)
 *   tl.stopRecording()
 *   tl.exportAlembic()  // → JSON string for Blender importer
 */

export interface Keyframe {
  tick: number
  label: string
  /** Sparse cell data: flat [cellIndex, f0, f1, …fNF-1, …] */
  sparseData: number[]
  /** base64 JPEG thumbnail (120×80) */
  thumbnail: string
}

export class SimTimeline {
  keyframes: Keyframe[] = []
  isRecording = false
  isPlaying   = false
  playIdx     = 0
  /** Capture a keyframe every N ticks */
  recordInterval = 50
  /** Max keyframes stored in memory */
  maxKeyframes = 300

  startRecording(): void {
    this.keyframes  = []
    this.isRecording = true
    this.isPlaying   = false
  }

  stopRecording(): void {
    this.isRecording = false
  }

  /**
   * Called each frame from the worker message handler.
   * Only stores a keyframe when tick % recordInterval === 0.
   */
  captureKeyframe(
    tick: number,
    buf: Float32Array,
    NF: number,
    canvas: HTMLCanvasElement | null,
  ): void {
    if (!this.isRecording) return
    if (tick % this.recordInterval !== 0) return

    const SZ = buf.length / NF

    // Sparse encoding: only cells with any non-zero field
    const sparseData: number[] = []
    for (let i = 0; i < SZ; i++) {
      const base = i * NF
      let hasValue = false
      for (let f = 0; f < NF; f++) {
        if (Math.abs(buf[base + f]) > 0.01) { hasValue = true; break }
      }
      if (hasValue) {
        sparseData.push(i)
        for (let f = 0; f < NF; f++) sparseData.push(buf[base + f])
      }
    }

    // Thumbnail
    let thumbnail = ''
    if (canvas) {
      try {
        const tc = document.createElement('canvas')
        tc.width = 120; tc.height = 80
        tc.getContext('2d')?.drawImage(canvas, 0, 0, 120, 80)
        thumbnail = tc.toDataURL('image/jpeg', 0.5)
      } catch { /* canvas may be cross-origin or unavailable */ }
    }

    this.keyframes.push({ tick, label: `t:${tick}`, sparseData, thumbnail })

    if (this.keyframes.length > this.maxKeyframes) this.keyframes.shift()
  }

  /** Restore a keyframe into the provided Float32Array buffer. */
  restoreKeyframe(kf: Keyframe, buf: Float32Array, NF: number): void {
    buf.fill(0)
    const d = kf.sparseData
    let pos = 0
    while (pos < d.length) {
      const cellIdx = d[pos++]
      const base    = cellIdx * NF
      for (let f = 0; f < NF; f++) buf[base + f] = d[pos++]
    }
  }

  /**
   * Export as JSON — compatible with the Blender Python importer
   * (reality_engine_alembic_v1 format).
   */
  exportAlembic(): string {
    return JSON.stringify({
      format: 'reality_engine_alembic_v1',
      fps: 25,
      frameCount: this.keyframes.length,
      frames: this.keyframes.map(kf => ({
        tick: kf.tick,
        label: kf.label,
        // Re-encode as flat [idx, v0, v1, …] pairs (compact)
        cells: kf.sparseData,
      })),
    })
  }

  /** Export a single keyframe as a PNG data URL (uses the stored thumbnail). */
  exportThumbnail(idx: number): string {
    return this.keyframes[idx]?.thumbnail ?? ''
  }

  get frameCount(): number { return this.keyframes.length }
  get durationTicks(): number {
    if (this.keyframes.length < 2) return 0
    return this.keyframes.at(-1)!.tick - this.keyframes[0].tick
  }
}
