/**
 * SimWorker — standalone Web Worker simulation.
 * Runs all physics off the main thread. Main thread sends commands,
 * worker posts back frame buffers via Transferable (zero-copy).
 *
 * Protocol:
 *   → { cmd:'tick',     data:{ speed:N } }
 *   → { cmd:'paint',    data:{ x,y,z,f,v,mode:'set'|'add'|'erase' } }
 *   → { cmd:'preset',   data:{ name:'burst'|'life'|'proto' } }
 *   → { cmd:'setParams',data:{ DIFF?,ENT?,INFO?,BIO?,procs? } }
 *   → { cmd:'generate', data:{ DIFF,ENT,INFO,BIO,procs } }
 *   → { cmd:'getStats' }
 *   ← { cmd:'frame',  buf:Float32Array, tick:N, events:[...], evCount:N }
 *   ← { cmd:'stats',  data:{ energy,entropy,info,bio,tick,evCount } }
 */

// ── Field layout ──────────────────────────────────────────────────────────────
const NF = 14 as const

const F = {
  E:    0,  // energy
  D:    1,  // density
  I:    2,  // information
  S:    3,  // entropy
  T:    4,  // temperature
  P:    5,  // pressure
  FX:   6,  // field vector X
  FY:   7,  // field vector Y
  TAU:  8,  // local time dilation
  CID:  9,  // causality event ID
  BIO:  10, // bio potential
  MAT:  11, // material ID
  WAVE: 12, // wave amplitude
  PROC: 13, // process activity
} as const

// ── Grid ──────────────────────────────────────────────────────────────────────
const W = 32, H = 24, D = 10
const SZ = W * H * D

let buf     = new Float32Array(SZ * NF)
let backBuf = new Float32Array(SZ * NF)

function idx(x: number, y: number, z: number): number {
  return (z * H * W + y * W + x) * NF
}

function set_(x: number, y: number, z: number, f: number, v: number): void {
  if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= D) return
  buf[idx(x, y, z) + f] = v
}

function add_(x: number, y: number, z: number, f: number, v: number): void {
  if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= D) return
  const i = idx(x, y, z) + f
  buf[i] = Math.max(-9999, Math.min(9999, buf[i] + v))
}

// ── Simulation state ──────────────────────────────────────────────────────────
let tick     = 0
let DIFF     = 0.09
let ENT      = 0.0004
let INFO     = 0.35
let BIO      = 0.25
let evCount  = 0
let causal: Array<{ id: number; tick: number; x: number; y: number; z: number; delta: number }> = []
const activeProcs = new Set<string>(['thermo', 'bio'])

// ── Physics step ──────────────────────────────────────────────────────────────
function simStep(dt: number) {
  backBuf.set(buf)

  for (let z = 0; z < D; z++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = idx(x, y, z)

        // Collect neighbor indices
        const ns: number[] = []
        if (x > 0)     ns.push(idx(x - 1, y, z))
        if (x < W - 1) ns.push(idx(x + 1, y, z))
        if (y > 0)     ns.push(idx(x, y - 1, z))
        if (y < H - 1) ns.push(idx(x, y + 1, z))
        if (z > 0)     ns.push(idx(x, y, z - 1))
        if (z < D - 1) ns.push(idx(x, y, z + 1))
        const nc = ns.length

        // Laplacians
        let lapE = 0, lapD = 0, lapT = 0, lapI = 0
        for (const ni of ns) {
          lapE += backBuf[ni + F.E]
          lapD += backBuf[ni + F.D]
          lapT += backBuf[ni + F.T]
          lapI += backBuf[ni + F.I]
        }
        lapE -= nc * backBuf[i + F.E]
        lapD -= nc * backBuf[i + F.D]
        lapT -= nc * backBuf[i + F.T]
        lapI -= nc * backBuf[i + F.I]

        // Energy diffusion (always on)
        buf[i + F.E] = Math.max(0, Math.min(9999,
          backBuf[i + F.E] + DIFF * lapE * dt
        ))

        // Thermodynamics
        if (activeProcs.has('thermo')) {
          buf[i + F.T] = Math.max(0, Math.min(2000,
            backBuf[i + F.T] + 0.07 * lapT * dt + buf[i + F.E] * 0.002 * dt
          ))
          buf[i + F.D] = Math.max(0, Math.min(1,
            backBuf[i + F.D] + 0.012 * lapD * dt
          ))
        }

        // Information diffusion
        if (activeProcs.has('info')) {
          buf[i + F.I] = Math.max(0, Math.min(999,
            backBuf[i + F.I] + 0.04 * lapI * dt - buf[i + F.S] * 0.2 * dt
          ))
        }

        // Entropy increase
        const dS = (ENT + buf[i + F.E] * 0.00004 + (buf[i + F.T] || 0) * 0.000015) * dt * 60
        buf[i + F.S] = Math.max(0, Math.min(1, buf[i + F.S] + dS))
        buf[i + F.E] = Math.max(0, buf[i + F.E] * (1 - buf[i + F.S] * 0.0002 * dt * 60))

        // Biology emergence
        if (activeProcs.has('bio')) {
          const sup = Math.max(0, 1 - buf[i + F.S] * 0.9)
          if (buf[i + F.E] > 80 && buf[i + F.D] > BIO && sup > 0) {
            buf[i + F.I]   = Math.min(999, (buf[i + F.I]   || 0) + INFO * sup * dt)
            buf[i + F.BIO] = Math.min(1,   (buf[i + F.BIO] || 0) + 0.015 * sup * dt)
          } else {
            buf[i + F.I]   *= Math.pow(0.9985, dt * 60)
            buf[i + F.BIO] *= Math.pow(0.996,  dt * 60)
          }
        }

        // Local time dilation
        buf[i + F.TAU] = (buf[i + F.TAU] || 0) + dt * (1 + buf[i + F.E] * 0.0008 + buf[i + F.S] * 0.2)

        // Causality event tracking
        const delta = buf[i + F.E] - backBuf[i + F.E]
        if (Math.abs(delta) > 55) {
          evCount++
          causal.push({ id: evCount, tick, x, y, z, delta: Math.round(delta) })
          if (causal.length > 400) causal.shift()
        }
      }
    }
  }

  tick++
}

// ── Preset initializers ───────────────────────────────────────────────────────
function applyPreset(name: string) {
  buf.fill(0); causal = []; evCount = 0; tick = 0
  const cx = W / 2, cy = H / 2, cz = D / 2

  if (name === 'burst') {
    for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2)
      if (d < 7) {
        const g = Math.exp(-d * d / 20)
        const i = idx(x, y, z)
        buf[i + F.E] = 900 * g
        buf[i + F.T] = 400 * g
        buf[i + F.D] = 0.7 * g
      }
    }
  } else if (name === 'life') {
    for (let k = 0; k < 25; k++) {
      const x = 4 + Math.floor(Math.random() * (W - 8))
      const y = 4 + Math.floor(Math.random() * (H - 8))
      const z = Math.floor(Math.random() * D)
      const e = 150 + Math.random() * 500
      const i = idx(x, y, z)
      buf[i + F.E]   = e
      buf[i + F.D]   = 0.3 + Math.random() * 0.5
      buf[i + F.I]   = e * 0.3
      buf[i + F.T]   = 80 + Math.random() * 180
      buf[i + F.BIO] = 0.2 + Math.random() * 0.5
    }
  } else if (name === 'proto') {
    for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const n = (Math.sin(x * 0.4) * Math.cos(y * 0.3) + 1) / 2
      const i = idx(x, y, z)
      buf[i + F.E]   = 50 + n * 400 * (1 - z / D * 0.5)
      buf[i + F.D]   = 0.2 + n * 0.6
      buf[i + F.T]   = 30 + n * 250
      buf[i + F.S]   = 0.05 + Math.random() * 0.1
      if (n > 0.6) {
        buf[i + F.BIO] = n * 0.4
        buf[i + F.I]   = n * 80
      }
    }
  }
}

function applyGenerated(data: {
  DIFF?: number; ENT?: number; INFO?: number; BIO?: number; procs?: string[]
}) {
  buf.fill(0); causal = []; evCount = 0; tick = 0
  DIFF = data.DIFF ?? 0.09
  ENT  = data.ENT  ?? 0.0004
  INFO = data.INFO ?? 0.35
  BIO  = data.BIO  ?? 0.25
  activeProcs.clear()
  ;(data.procs ?? ['thermo', 'bio']).forEach(p => activeProcs.add(p))

  for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n  = (Math.sin(x * 0.4 + z * 0.3) * Math.cos(y * 0.3 - z * 0.2 + x * 0.1) + 1) / 2
    const n2 = (Math.sin(x * 0.7 + y * 0.4) * Math.cos(z * 0.5) + 1) / 2
    const i  = idx(x, y, z)
    buf[i + F.E] = Math.max(0, (n * 0.7 + n2 * 0.3) * 600)
    buf[i + F.D] = Math.max(0, n * 0.8)
    buf[i + F.I] = Math.max(0, n2 * 100)
    buf[i + F.T] = Math.max(0, n * 250)
    buf[i + F.S] = 0.02 + Math.random() * 0.05
  }
}

// ── Message handler ───────────────────────────────────────────────────────────
self.onmessage = (e: MessageEvent) => {
  const { cmd, data } = e.data as { cmd: string; data: any }

  if (cmd === 'tick') {
    const speed = (data?.speed as number) || 1
    for (let s = 0; s < speed; s++) simStep(0.016)
    const events = causal.slice(-10)
    const bufCopy = buf.slice()
    ;(self as unknown as Worker).postMessage(
      { cmd: 'frame', buf: bufCopy, tick, events, evCount },
      [bufCopy.buffer]
    )
    return
  }

  if (cmd === 'paint') {
    const { x, y, z, f, v, mode } = data as {
      x: number; y: number; z: number; f: number; v: number; mode: string
    }
    if (mode === 'set')        set_(x, y, z, f, v)
    else if (mode === 'add')   add_(x, y, z, f, v)
    else /* erase */           [F.E, F.D, F.I, F.S, F.T, F.BIO].forEach(ff => set_(x, y, z, ff, 0))
    return
  }

  if (cmd === 'preset') {
    applyPreset(data.name as string)
    return
  }

  if (cmd === 'setParams') {
    if (data.DIFF !== undefined) DIFF = data.DIFF
    if (data.ENT  !== undefined) ENT  = data.ENT
    if (data.INFO !== undefined) INFO = data.INFO
    if (data.BIO  !== undefined) BIO  = data.BIO
    if (data.procs) {
      activeProcs.clear()
      ;(data.procs as string[]).forEach(p => activeProcs.add(p))
    }
    return
  }

  if (cmd === 'generate') {
    applyGenerated(data)
    return
  }

  if (cmd === 'getStats') {
    let totE = 0, totS = 0, totI = 0, totB = 0
    for (let i = 0; i < SZ; i++) {
      totE += buf[i * NF + F.E]
      totS += buf[i * NF + F.S]
      totI += buf[i * NF + F.I]
      totB += buf[i * NF + F.BIO]
    }
    ;(self as unknown as Worker).postMessage({
      cmd: 'stats',
      data: {
        energy:  totE / SZ,
        entropy: totS / SZ,
        info:    totI / SZ,
        bio:     totB / SZ,
        tick,
        evCount,
      },
    })
  }
}

export {}  // make this file a module (required for ES worker format)
