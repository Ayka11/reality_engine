/**
 * VideoRecorder — WebCodecs VideoEncoder with PNG frame fallback.
 *
 * Usage:
 *   const rec = new VideoRecorder()
 *   rec.startRecording(canvas, 30)  // 30fps
 *   // each frame:
 *   rec.captureFrame(canvas)
 *   // done:
 *   rec.stopAndDownload('my-film.webm')
 */

export class VideoRecorder {
  private frames:   Blob[]              = []
  private encoder:  VideoEncoder | null = null
  private muxBufs:  ArrayBuffer[]       = []
  private useCodecs = false
  private fps       = 30
  private frameIdx  = 0
  private recording = false

  startRecording(canvas: HTMLCanvasElement, fps = 30): void {
    if (this.recording) return
    this.recording = true
    this.fps       = fps
    this.frameIdx  = 0
    this.frames    = []
    this.muxBufs   = []

    // Try WebCodecs
    if (typeof VideoEncoder !== 'undefined') {
      try {
        this.useCodecs = true
        this.encoder = new VideoEncoder({
          output: (chunk) => {
            const buf = new ArrayBuffer(chunk.byteLength)
            chunk.copyTo(buf)
            this.muxBufs.push(buf)
          },
          error: () => { this.useCodecs = false },
        })
        this.encoder.configure({
          codec:     'vp8',
          width:     canvas.width  || 800,
          height:    canvas.height || 600,
          bitrate:   2_000_000,
          framerate: fps,
        })
      } catch {
        this.useCodecs = false
        this.encoder   = null
      }
    }
  }

  captureFrame(canvas: HTMLCanvasElement): void {
    if (!this.recording) return

    if (this.useCodecs && this.encoder) {
      try {
        const frame = new VideoFrame(canvas, {
          timestamp: (this.frameIdx / this.fps) * 1_000_000,
        })
        this.encoder.encode(frame, { keyFrame: this.frameIdx % 30 === 0 })
        frame.close()
      } catch {
        this.useCodecs = false
      }
    } else {
      // PNG fallback — capture data URL
      canvas.toBlob(blob => { if (blob) this.frames.push(blob) }, 'image/png')
    }
    this.frameIdx++
  }

  async stopAndDownload(filename = 'recording.webm'): Promise<void> {
    this.recording = false

    if (this.useCodecs && this.encoder) {
      await this.encoder.flush()
      this.encoder.close()
      // Simple raw VP8 dump — real muxing requires a WebM muxer library
      const blob = new Blob(this.muxBufs, { type: 'video/webm' })
      this._download(blob, filename)
      return
    }

    // PNG fallback: download first frame as PNG, or a zip if multiple
    if (this.frames.length === 0) return
    if (this.frames.length === 1) {
      this._download(this.frames[0], filename.replace('.webm', '_frame0.png'))
      return
    }
    // Download frames as JSON manifest (ZIP requires external library)
    const manifest = { frames: this.frames.length, fps: this.fps, note: 'Encode with ffmpeg: ffmpeg -r 30 -i frame%d.png out.mp4' }
    this._download(
      new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
      'recording_manifest.json',
    )
    this.frames.forEach((b, i) => this._download(b, `frame_${String(i).padStart(4,'0')}.png`))
  }

  exportFramePNG(canvas: HTMLCanvasElement, filename = 'frame.png'): void {
    canvas.toBlob(blob => { if (blob) this._download(blob, filename) }, 'image/png')
  }

  get isRecording(): boolean { return this.recording }
  get frameCount():  number  { return this.frameIdx }

  // ── private ─────────────────────────────────────────────────────────────

  private _download(blob: Blob, name: string): void {
    const a = document.createElement('a')
    a.href     = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
  }
}
