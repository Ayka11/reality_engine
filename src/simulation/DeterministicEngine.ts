/**
 * DeterministicEngine — wraps SimWorker with seed-controlled reproducibility.
 * Same seed + same command sequence = identical simulation every run.
 * Used by Science Mode for deterministic replay and scientific publications.
 *
 * Recording format: reality_engine_scientific_v2
 * Export targets: JSON replay, CSV metrics, Jupyter .ipynb, GraphML (Gephi)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SimParams {
  DIFF: number
  ENT:  number
  INFO: number
  BIO:  number
  procs: string[]
}

export interface RecordedFrame {
  tick: number
  /** Sparse interleaved data: [cellIndex, f0, f1, …fNF-1, cellIndex2, …] */
  sparse: Float32Array
  agentCount: number
  entropy: number
  energy: number
  info: number
}

export interface SimRecording {
  seed: number
  startTick: number
  W: number; H: number; D: number; NF: number
  params: SimParams
  frames: RecordedFrame[]
}

// ── DeterministicEngine ───────────────────────────────────────────────────────

export class DeterministicEngine {
  seed = 42
  recording: SimRecording | null = null
  isRecording = false
  replayMode  = false
  replayIdx   = 0
  maxFrames   = 500

  private rngState = 42

  // XORshift32 — fast, deterministic, seedable. Period 2^32−1.
  rand(): number {
    let x = this.rngState
    x ^= x << 13
    x ^= x >> 17
    x ^= x << 5
    this.rngState = x >>> 0
    return (x >>> 0) / 0xffffffff
  }

  setSeed(seed: number): void {
    this.seed     = seed
    this.rngState = seed || 1
  }

  startRecording(
    params: SimParams,
    W: number, H: number, D: number, NF: number,
  ): void {
    this.recording = {
      seed: this.seed, startTick: 0,
      W, H, D, NF, params, frames: [],
    }
    this.isRecording = true
  }

  /**
   * Called every frame from the worker message handler.
   * Captures a sparse keyframe every 5 ticks.
   */
  captureFrame(
    tick: number,
    buf: Float32Array,
    W: number, H: number, D: number, NF: number,
    stats: { entropy: number; energy: number; info: number; agentCount: number },
  ): void {
    if (!this.isRecording || !this.recording) return
    if (tick % 5 !== 0) return
    if (this.recording.frames.length >= this.maxFrames) {
      this.stopRecording(); return
    }

    const SZ  = W * H * D
    const tmp: number[] = []
    for (let i = 0; i < SZ; i++) {
      const base = i * NF
      let any = false
      for (let f = 0; f < NF; f++) if (Math.abs(buf[base + f]) > 0.01) { any = true; break }
      if (any) {
        tmp.push(i)
        for (let f = 0; f < NF; f++) tmp.push(buf[base + f])
      }
    }

    this.recording.frames.push({
      tick,
      sparse:     new Float32Array(tmp),
      agentCount: stats.agentCount,
      entropy:    stats.entropy,
      energy:     stats.energy,
      info:       stats.info,
    })
  }

  stopRecording(): SimRecording | null {
    this.isRecording = false
    return this.recording
  }

  // ── Export formats ──────────────────────────────────────────────────────────

  exportJSON(): string {
    if (!this.recording) return '{}'
    return JSON.stringify({
      format:     'reality_engine_scientific_v2',
      seed:       this.recording.seed,
      params:     this.recording.params,
      W:          this.recording.W,
      H:          this.recording.H,
      D:          this.recording.D,
      NF:         this.recording.NF,
      frameCount: this.recording.frames.length,
      frames: this.recording.frames.map(f => ({
        tick:   f.tick,
        sparse: Array.from(f.sparse),
        stats: {
          entropy:    f.entropy,
          energy:     f.energy,
          info:       f.info,
          agents:     f.agentCount,
        },
      })),
    })
  }

  exportCSV(): string {
    if (!this.recording) return 'tick,energy,entropy,info,agents\n'
    const rows = ['tick,energy,entropy,info,agents']
    for (const f of this.recording.frames) {
      rows.push(
        `${f.tick},${f.energy.toFixed(3)},${f.entropy.toFixed(5)},${f.info.toFixed(2)},${f.agentCount}`,
      )
    }
    return rows.join('\n')
  }

  exportJupyterNotebook(): string {
    const r    = this.recording
    const meta = r
      ? `Seed: ${r.seed}  |  Frames: ${r.frames.length}  |  Grid: ${r.W}×${r.H}×${r.D}`
      : 'No recording'

    const nb = {
      nbformat: 4, nbformat_minor: 5,
      metadata: {
        kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      },
      cells: [
        {
          cell_type: 'markdown', metadata: {},
          source: ['# Reality Engine Scientific Analysis\n', meta],
        },
        {
          cell_type: 'code', execution_count: null, metadata: {}, outputs: [],
          source: [
            'import json, numpy as np, matplotlib.pyplot as plt\n',
            '# Load data — paste JSON path here\n',
            'with open("reality_recording.json") as f:\n',
            '    d = json.load(f)\n',
            'ticks   = [fr["tick"]             for fr in d["frames"]]\n',
            'energy  = [fr["stats"]["energy"]  for fr in d["frames"]]\n',
            'entropy = [fr["stats"]["entropy"] for fr in d["frames"]]\n',
            'info    = [fr["stats"]["info"]    for fr in d["frames"]]\n',
            'agents  = [fr["stats"]["agents"]  for fr in d["frames"]]\n',
            'print(f"Frames: {len(ticks)}, Max energy: {max(energy):.1f}, Final entropy: {entropy[-1]:.4f}")\n',
          ],
        },
        {
          cell_type: 'code', execution_count: null, metadata: {}, outputs: [],
          source: [
            'fig, axes = plt.subplots(2, 2, figsize=(12, 8))\n',
            'axes[0,0].plot(ticks, energy,  color="#6080ff"); axes[0,0].set_title("Energy")\n',
            'axes[0,1].plot(ticks, entropy, color="#e04040"); axes[0,1].set_title("Entropy")\n',
            'axes[1,0].plot(ticks, info,    color="#a060e0"); axes[1,0].set_title("Information")\n',
            'axes[1,1].plot(ticks, agents,  color="#30a060"); axes[1,1].set_title("Agents")\n',
            'plt.tight_layout(); plt.show()\n',
          ],
        },
        {
          cell_type: 'code', execution_count: null, metadata: {}, outputs: [],
          source: [
            '# Correlation analysis\n',
            'print(f"Energy→Entropy: {np.corrcoef(energy, entropy)[0,1]:.3f}")\n',
            'print(f"Energy→Info:    {np.corrcoef(energy, info)[0,1]:.3f}")\n',
            'print(f"Entropy→Info:   {np.corrcoef(entropy, info)[0,1]:.3f}")\n',
          ],
        },
      ],
    }
    return JSON.stringify(nb, null, 2)
  }

  exportGraphML(): string {
    if (!this.recording) return '<graphml/>'
    const frames = this.recording.frames.slice(0, 100)
    const lines  = [
      '<?xml version="1.0"?>',
      '<graphml xmlns="http://graphml.graphdrawing.org/graphml">',
      '<graph id="causality" edgedefault="directed">',
      '<key id="energy"  for="node" attr.name="energy"  attr.type="double"/>',
      '<key id="entropy" for="node" attr.name="entropy" attr.type="double"/>',
      '<key id="delta"   for="edge" attr.name="delta"   attr.type="double"/>',
    ]
    frames.forEach((f, i) => {
      lines.push(
        `<node id="f${i}">` +
        `<data key="energy">${f.energy.toFixed(2)}</data>` +
        `<data key="entropy">${f.entropy.toFixed(4)}</data>` +
        `</node>`,
      )
    })
    for (let i = 1; i < frames.length; i++) {
      const delta = frames[i].energy - frames[i - 1].energy
      lines.push(`<edge source="f${i-1}" target="f${i}"><data key="delta">${delta.toFixed(2)}</data></edge>`)
    }
    lines.push('</graph>', '</graphml>')
    return lines.join('\n')
  }
}
