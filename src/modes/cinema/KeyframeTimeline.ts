/**
 * KeyframeTimeline — 3-track NLA-style canvas timeline.
 * Tracks: SIM (simulation keyframes), CAM (camera path), MRK (markers/subtitles).
 * Exposes: addSimKF, addCamKF, addMarker, draw, scrubTo, exportSRT.
 */

export interface SimKeyframe {
  tick:   number
  label?: string
  cells:  number[]   // sparse: [cellIdx, f0..fNF-1, ...]
  NF:     number
}

export interface CamKeyframe {
  tick: number
  x: number; y: number; z: number
  fov?: number
}

export interface Marker {
  tick:     number
  label:    string
  duration: number   // ticks this marker lasts (for SRT)
}

interface Track { label: string; color: string }

const TRACKS: Track[] = [
  { label: 'SIM', color: '#7c6fcd' },
  { label: 'CAM', color: '#3db872' },
  { label: 'MRK', color: '#e09030' },
]
const TRACK_H   = 22
const HEADER_H  = 18
const PLAYHEAD  = '#e04848'

export class KeyframeTimeline {
  simKFs:     SimKeyframe[] = []
  camKFs:     CamKeyframe[] = []
  markers:    Marker[]      = []
  totalTicks: number        = 1000
  playhead:   number        = 0

  private canvas: HTMLCanvasElement | null = null
  private dragging = false

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
    canvas.addEventListener('mousedown', e => this.onMouse(e, 'down'))
    document.addEventListener('mousemove', e => this.onMouse(e, 'move'))
    document.addEventListener('mouseup',   e => this.onMouse(e, 'up'))
    this.draw()
  }

  addSimKF(tick: number, buf: Float32Array, W: number, H: number, NF: number): void {
    const SZ = W * H
    const cells: number[] = []
    for (let i = 0; i < SZ; i++) {
      const b = i * NF
      let any = false
      for (let f = 0; f < NF; f++) if (Math.abs(buf[b + f]) > 0.01) { any = true; break }
      if (any) {
        cells.push(i)
        for (let f = 0; f < NF; f++) cells.push(buf[b + f])
      }
    }
    this.simKFs.push({ tick, NF, cells })
    this._sort()
    this.draw()
  }

  addCamKF(tick: number, x: number, y: number, z = 0, fov = 60): void {
    this.camKFs.push({ tick, x, y, z, fov })
    this._sort()
    this.draw()
  }

  addMarker(tick: number, label: string, duration = 60): void {
    this.markers.push({ tick, label, duration })
    this._sort()
    this.draw()
  }

  scrubTo(tick: number): SimKeyframe | null {
    this.playhead = Math.max(0, Math.min(tick, this.totalTicks))
    this.draw()
    // find nearest sim KF at or before playhead
    const before = this.simKFs.filter(k => k.tick <= this.playhead)
    return before.length ? before[before.length - 1] : null
  }

  restoreKF(kf: SimKeyframe, buf: Float32Array): void {
    const NF = kf.NF
    const cells = kf.cells
    let ci = 0
    while (ci < cells.length) {
      const idx = cells[ci++]
      const base = idx * NF
      for (let f = 0; f < NF; f++) buf[base + f] = cells[ci++]
    }
  }

  draw(): void {
    const canvas = this.canvas
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.width  = canvas.offsetWidth  || 300
    const H = canvas.height = HEADER_H + TRACKS.length * TRACK_H + 4

    // Background
    ctx.fillStyle = '#07070e'
    ctx.fillRect(0, 0, W, H)

    // Header — tick ruler
    ctx.fillStyle = '#0e0e1a'
    ctx.fillRect(0, 0, W, HEADER_H)
    ctx.fillStyle = '#444'
    ctx.font = '7px system-ui'
    ctx.textBaseline = 'middle'
    const step = this._niceStep(this.totalTicks, W / 40)
    for (let t = 0; t <= this.totalTicks; t += step) {
      const px = this._toPx(t, W)
      ctx.fillStyle = '#2a2a38'
      ctx.fillRect(px, 0, 0.5, HEADER_H)
      ctx.fillStyle = '#555'
      ctx.fillText(String(t), px + 2, HEADER_H / 2)
    }

    // Tracks
    TRACKS.forEach((tr, ti) => {
      const ty = HEADER_H + ti * TRACK_H
      ctx.fillStyle = ti % 2 ? '#0b0b17' : '#0e0e1a'
      ctx.fillRect(0, ty, W, TRACK_H)
      // track label
      ctx.fillStyle = tr.color
      ctx.font = '7px system-ui'
      ctx.textBaseline = 'middle'
      ctx.fillText(tr.label, 3, ty + TRACK_H / 2)
    })

    // Sim keyframe diamonds (track 0)
    this.simKFs.forEach(kf => {
      this._diamond(ctx, this._toPx(kf.tick, W), HEADER_H + 0 * TRACK_H + TRACK_H / 2, 5, TRACKS[0].color)
    })

    // Cam keyframes (track 1)
    this.camKFs.forEach(kf => {
      this._diamond(ctx, this._toPx(kf.tick, W), HEADER_H + 1 * TRACK_H + TRACK_H / 2, 5, TRACKS[1].color)
    })

    // Markers (track 2)
    this.markers.forEach(mk => {
      const px = this._toPx(mk.tick, W)
      const pw = Math.max(6, (mk.duration / this.totalTicks) * W)
      ctx.fillStyle = TRACKS[2].color + '44'
      ctx.fillRect(px, HEADER_H + 2 * TRACK_H + 2, pw, TRACK_H - 4)
      ctx.fillStyle = TRACKS[2].color
      ctx.font = '7px system-ui'
      ctx.textBaseline = 'middle'
      ctx.fillText(mk.label, px + 3, HEADER_H + 2 * TRACK_H + TRACK_H / 2)
    })

    // Playhead
    const phx = this._toPx(this.playhead, W)
    ctx.strokeStyle = PLAYHEAD
    ctx.lineWidth   = 1
    ctx.beginPath()
    ctx.moveTo(phx, 0)
    ctx.lineTo(phx, H)
    ctx.stroke()
    // triangle
    ctx.fillStyle = PLAYHEAD
    ctx.beginPath()
    ctx.moveTo(phx - 4, 0)
    ctx.lineTo(phx + 4, 0)
    ctx.lineTo(phx, 7)
    ctx.fill()
  }

  exportSRT(): string {
    const fps = 24
    const ticksPerSec = fps
    const lines: string[] = []
    this.markers.forEach((mk, i) => {
      const startSec = mk.tick / ticksPerSec
      const endSec   = (mk.tick + mk.duration) / ticksPerSec
      lines.push(String(i + 1))
      lines.push(`${this._srtTime(startSec)} --> ${this._srtTime(endSec)}`)
      lines.push(mk.label)
      lines.push('')
    })
    return lines.join('\n')
  }

  // ── private ──────────────────────────────────────────────────────────────

  private _toPx(tick: number, W: number): number {
    return (tick / this.totalTicks) * W
  }

  private _toTick(px: number, W: number): number {
    return Math.round((px / W) * this.totalTicks)
  }

  private _diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string): void {
    ctx.beginPath()
    ctx.moveTo(x, y - r)
    ctx.lineTo(x + r, y)
    ctx.lineTo(x, y + r)
    ctx.lineTo(x - r, y)
    ctx.closePath()
    ctx.fillStyle = col
    ctx.fill()
  }

  private _niceStep(total: number, targetCount: number): number {
    const raw   = total / targetCount
    const mag   = Math.pow(10, Math.floor(Math.log10(raw)))
    const nice  = [1, 2, 5, 10]
    return mag * nice.find(n => mag * n >= raw)!
  }

  private _srtTime(s: number): string {
    const h  = Math.floor(s / 3600)
    const m  = Math.floor((s % 3600) / 60)
    const ss = Math.floor(s % 60)
    const ms = Math.floor((s % 1) * 1000)
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')},${String(ms).padStart(3,'0')}`
  }

  private _sort(): void {
    this.simKFs.sort((a, b) => a.tick - b.tick)
    this.camKFs.sort((a, b) => a.tick - b.tick)
    this.markers.sort((a, b) => a.tick - b.tick)
  }

  private onMouse(e: MouseEvent, type: 'down' | 'move' | 'up'): void {
    if (!this.canvas) return
    const rect = this.canvas.getBoundingClientRect()
    const px   = e.clientX - rect.left
    const W    = this.canvas.offsetWidth
    if (type === 'down') { this.dragging = true; this.scrubTo(this._toTick(px, W)) }
    if (type === 'move' && this.dragging) this.scrubTo(this._toTick(px, W))
    if (type === 'up')   this.dragging = false
  }
}
