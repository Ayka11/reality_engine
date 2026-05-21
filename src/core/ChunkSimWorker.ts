/**
 * Chunk-aware simulation Web Worker.
 * 128×128×64 grid, iterates only active chunks — zero cost for empty space.
 * Sends only dirty chunks back to main thread as transferable ArrayBuffer.
 */

import {
  ChunkGrid, GRID_W, GRID_H, GRID_D,
  CHUNK_FLOATS, F,
} from './ChunkGrid'

const grid = new ChunkGrid()
const W = GRID_W, H = GRID_H, D = GRID_D
let tick = 0, evCount = 0
const causal: Array<{ id: number; tick: number; x: number; y: number; z: number; delta: number }> = []
let DIFF = 0.09, ENT = 0.0004, INFO = 0.35, BIO = 0.25
const activeProcs = new Set<string>(['thermo', 'bio'])

function simStep(dt: number) {
  for (const { x, y, z, base, chunk } of grid.activeCells()) {
    let lapE = 0, lapT = 0, lapD = 0, lapI = 0, nc = 0
    const dirs: Array<[number, number, number]> = [
      [-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1],
    ]
    for (const [dx, dy, dz] of dirs) {
      const nx = x + dx, ny = y + dy, nz = z + dz
      if (nx < 0 || nx >= W || ny < 0 || ny >= H || nz < 0 || nz >= D) continue
      lapE += grid.get(nx, ny, nz, F.E)
      lapT += grid.get(nx, ny, nz, F.T)
      lapD += grid.get(nx, ny, nz, F.D)
      lapI += grid.get(nx, ny, nz, F.I)
      nc++
    }
    const E = chunk[base + F.E], T = chunk[base + F.T]
    const D_ = chunk[base + F.D], I = chunk[base + F.I]
    lapE -= nc * E; lapT -= nc * T; lapD -= nc * D_; lapI -= nc * I

    const newE = Math.max(0, Math.min(9999, E + DIFF * lapE * dt))
    grid.set(x, y, z, F.E, newE)

    if (activeProcs.has('thermo')) {
      grid.set(x, y, z, F.T, Math.max(0, Math.min(2000, T + 0.07 * lapT * dt + newE * 0.002 * dt)))
      grid.set(x, y, z, F.D, Math.max(0, Math.min(1, D_ + 0.012 * lapD * dt)))
    }
    if (activeProcs.has('info'))
      grid.set(x, y, z, F.I, Math.max(0, Math.min(999, I + 0.04 * lapI * dt - chunk[base + F.S] * 0.2 * dt)))

    const dS = (ENT + newE * 0.00004 + (chunk[base + F.T] || 0) * 0.000015) * dt * 60
    const newS = Math.max(0, Math.min(1, chunk[base + F.S] + dS))
    grid.set(x, y, z, F.S, newS)
    grid.set(x, y, z, F.E, Math.max(0, newE * (1 - newS * 0.0002 * dt * 60)))

    if (activeProcs.has('bio')) {
      const sup = Math.max(0, 1 - newS * 0.9)
      const D2 = grid.get(x, y, z, F.D)
      if (newE > 80 && D2 > BIO && sup > 0) {
        grid.add(x, y, z, F.I, INFO * sup * dt)
        grid.add(x, y, z, F.BIO, 0.015 * sup * dt)
      } else {
        grid.set(x, y, z, F.I,   Math.max(0, (grid.get(x, y, z, F.I)   || 0) * Math.pow(0.9985, dt * 60)))
        grid.set(x, y, z, F.BIO, Math.max(0, (grid.get(x, y, z, F.BIO) || 0) * Math.pow(0.996,  dt * 60)))
      }
    }

    grid.add(x, y, z, F.TAU, dt * (1 + newE * 0.0008 + newS * 0.2))

    const delta = grid.get(x, y, z, F.E) - E
    if (Math.abs(delta) > 55) {
      evCount++
      causal.push({ id: evCount, tick, x, y, z, delta: Math.round(delta) })
      if (causal.length > 500) causal.shift()
    }
  }

  if (tick % 100 === 0) grid.prune()
  tick++
}

function buildFramePayload(): ArrayBuffer {
  const dirty = [...grid.dirtyChunks]
  grid.dirtyChunks.clear()
  // Layout: [numChunks(u32), chunkKey(u32), data(CHUNK_FLOATS f32), ...]
  const totalBytes = 4 + dirty.length * (4 + CHUNK_FLOATS * 4)
  const ab  = new ArrayBuffer(totalBytes)
  const u32 = new Uint32Array(ab)
  const f32 = new Float32Array(ab)
  u32[0] = dirty.length
  let offset = 1
  for (const key of dirty) {
    u32[offset] = key
    const chunk = grid.chunks.get(key) || new Float32Array(CHUNK_FLOATS)
    f32.set(chunk, offset + 1)
    offset += 1 + CHUNK_FLOATS
  }
  return ab
}

self.onmessage = (e: MessageEvent) => {
  const { cmd, data } = e.data

  if (cmd === 'tick') {
    const speed = (data?.speed as number) || 1
    for (let s = 0; s < speed; s++) simStep(0.016)
    const ab = buildFramePayload()
    ;(self as unknown as Worker).postMessage({
      cmd: 'frame', tick, evCount,
      events: causal.slice(-20),
      ab,
      stats: grid.stats,
    }, [ab])
    return
  }

  if (cmd === 'paint') {
    const { x, y, z, f, v, r, mode } = data
    if (r > 0) grid.paintSphere(x, y, z, r, f, v)
    else if (mode === 'add') grid.add(x, y, z, f, v)
    else if (mode === 'set') grid.set(x, y, z, f, v)
    else [F.E, F.D, F.I, F.S, F.T, F.BIO].forEach(ff => grid.set(x, y, z, ff, 0))
    return
  }

  if (cmd === 'generate') {
    grid.clear()
    const a = data
    DIFF = a.DIFF || 0.09; ENT = a.ENT || 0.0004
    INFO = a.INFO || 0.35; BIO  = a.BIO  || 0.25
    activeProcs.clear();(a.procs || ['thermo', 'bio']).forEach((p: string) => activeProcs.add(p))
    tick = 0; causal.length = 0; evCount = 0

    for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const n  = (Math.sin(x * 0.3 + z * 0.2) * Math.cos(y * 0.25 - z * 0.15 + x * 0.08) + 1) / 2
      const n2 = (Math.sin(x * 0.5 + y * 0.3) * Math.cos(z * 0.4) + 1) / 2
      const n3 = (Math.cos(x * 0.15) * Math.sin(y * 0.2 + z * 0.1) + 1) / 2
      const e  = (n * 0.6 + n2 * 0.3 + n3 * 0.1) * 600
      if (e > 5)    grid.set(x, y, z, F.E, e)
      const d = (n * 0.5 + n2 * 0.3) * 0.9
      if (d > 0.05) grid.set(x, y, z, F.D, d)
      const t = n * 280
      if (t > 10)   grid.set(x, y, z, F.T, t)
      const s = 0.02 + Math.random() * 0.06
      grid.set(x, y, z, F.S, s)
    }
    return
  }

  if (cmd === 'preset') {
    grid.clear(); tick = 0; causal.length = 0; evCount = 0
    const nm = data.name as string
    if (nm === 'burst') {
      grid.paintSphere(64, 64, 32, 18, F.E, 900)
      grid.paintSphere(64, 64, 32, 14, F.T, 500)
      grid.paintSphere(64, 64, 32, 16, F.D, 0.8)
    } else if (nm === 'life') {
      for (let k = 0; k < 60; k++) {
        const x = 10 + Math.floor(Math.random() * (W - 20))
        const y = 10 + Math.floor(Math.random() * (H - 20))
        const z = 8  + Math.floor(Math.random() * (D - 16))
        const e = 200 + Math.random() * 600
        grid.paintSphere(x, y, z, 4, F.E,   e)
        grid.paintSphere(x, y, z, 3, F.D,   0.5)
        grid.paintSphere(x, y, z, 3, F.I,   e * 0.4)
        grid.paintSphere(x, y, z, 2, F.BIO, 0.6)
      }
    } else if (nm === 'proto') {
      for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const n = (Math.sin(x * 0.25) * Math.cos(y * 0.2) + 1) / 2
        const e = 50 + n * 450 * (1 - z / D * 0.6)
        if (e > 20) { grid.set(x, y, z, F.E, e); grid.set(x, y, z, F.D, 0.2 + n * 0.6) }
        grid.set(x, y, z, F.T, 30 + n * 220)
        grid.set(x, y, z, F.S, 0.04 + Math.random() * 0.08)
      }
    } else if (nm === 'town') {
      // Realistic city layout: center=(64,64), radial zones, grid roads, parks, industrial
      const cx = 64, cy = 64
      const ROAD_SPACING = 16   // road every 16 units
      const ROAD_WIDTH   = 2

      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const dx = x - cx, dy = y - cy
        const r  = Math.sqrt(dx * dx + dy * dy)
        const angle = Math.atan2(dy, dx)

        // Zone classification
        const downtown   = r < 14
        const innerCity  = r >= 14  && r < 30
        const suburbs    = r >= 30  && r < 52
        const outskirts  = r >= 52  && r < 64
        const onRoadX    = Math.abs(x % ROAD_SPACING) < ROAD_WIDTH || Math.abs(x % ROAD_SPACING - ROAD_SPACING) < ROAD_WIDTH
        const onRoadY    = Math.abs(y % ROAD_SPACING) < ROAD_WIDTH || Math.abs(y % ROAD_SPACING - ROAD_SPACING) < ROAD_WIDTH
        const onRoad     = onRoadX || onRoadY

        // Park district: NW quadrant (angle 120°–200°), r 25–50
        const isPark = angle > 2.1 && angle < 3.5 && r > 22 && r < 48
        // Industrial: SE quadrant, r 20–45
        const isIndustrial = angle > -0.5 && angle < 1.1 && r > 18 && r < 44
        // River: diagonal band
        const riverDist = Math.abs(x * 0.6 - y * 0.8 - 20)
        const isRiver   = riverDist < 3 && r > 30

        // Building height (z-layer fill) — taller downtown
        const maxZ = downtown ? 28 : innerCity ? 18 : suburbs ? 10 : 5

        for (let z = 0; z < D; z++) {
          if (isRiver) {
            if (z < 2) { grid.set(x, y, z, F.E, 40); grid.set(x, y, z, F.T, 15); grid.set(x, y, z, F.D, 0.1) }
            continue
          }
          if (isPark) {
            if (z < 4) {
              grid.set(x, y, z, F.E, 60 + Math.random() * 80)
              grid.set(x, y, z, F.D, 0.15 + Math.random() * 0.15)
              grid.set(x, y, z, F.BIO, 0.5 + Math.random() * 0.4)
              grid.set(x, y, z, F.T, 18 + Math.random() * 12)
              grid.set(x, y, z, F.S, 0.02 + Math.random() * 0.03)
            }
            continue
          }
          if (z > maxZ) continue
          if (onRoad) {
            // Roads: high energy flow, low density, high info (traffic/communication)
            if (z < 3) {
              grid.set(x, y, z, F.E, 300 + Math.random() * 200)
              grid.set(x, y, z, F.D, 0.2)
              grid.set(x, y, z, F.I, 200 + Math.random() * 150)
              grid.set(x, y, z, F.T, 28 + Math.random() * 15)
              grid.set(x, y, z, F.S, 0.03 + Math.random() * 0.04)
            }
          } else if (isIndustrial) {
            const fill = 0.7 + Math.random() * 0.2
            grid.set(x, y, z, F.E, 500 + Math.random() * 350)
            grid.set(x, y, z, F.D, fill)
            grid.set(x, y, z, F.T, 80 + Math.random() * 200)
            grid.set(x, y, z, F.S, 0.15 + Math.random() * 0.2)
            grid.set(x, y, z, F.I, 80 + Math.random() * 100)
          } else if (downtown) {
            const fill = 0.75 + Math.random() * 0.2
            grid.set(x, y, z, F.E, 650 + Math.random() * 300)
            grid.set(x, y, z, F.D, fill)
            grid.set(x, y, z, F.I, 320 + Math.random() * 200)
            grid.set(x, y, z, F.T, 55 + Math.random() * 60)
            grid.set(x, y, z, F.S, 0.05 + Math.random() * 0.06)
            if (z < 6) grid.set(x, y, z, F.BIO, 0.1 + Math.random() * 0.15)
          } else if (innerCity) {
            grid.set(x, y, z, F.E, 350 + Math.random() * 250)
            grid.set(x, y, z, F.D, 0.5 + Math.random() * 0.3)
            grid.set(x, y, z, F.I, 150 + Math.random() * 120)
            grid.set(x, y, z, F.T, 35 + Math.random() * 30)
            grid.set(x, y, z, F.S, 0.04 + Math.random() * 0.05)
            if (z < 4) grid.set(x, y, z, F.BIO, 0.15 + Math.random() * 0.2)
          } else if (suburbs) {
            grid.set(x, y, z, F.E, 120 + Math.random() * 150)
            grid.set(x, y, z, F.D, 0.25 + Math.random() * 0.25)
            grid.set(x, y, z, F.I, 50 + Math.random() * 80)
            grid.set(x, y, z, F.T, 22 + Math.random() * 18)
            grid.set(x, y, z, F.S, 0.02 + Math.random() * 0.03)
            if (z < 3) grid.set(x, y, z, F.BIO, 0.3 + Math.random() * 0.3)
          } else if (outskirts) {
            grid.set(x, y, z, F.E, 40 + Math.random() * 60)
            grid.set(x, y, z, F.D, 0.08 + Math.random() * 0.12)
            grid.set(x, y, z, F.I, 15 + Math.random() * 30)
            grid.set(x, y, z, F.T, 18 + Math.random() * 12)
            grid.set(x, y, z, F.S, 0.015 + Math.random() * 0.02)
            if (z < 3) grid.set(x, y, z, F.BIO, 0.5 + Math.random() * 0.4)
          }
        }
      }
      // Set realistic town physics params
      DIFF = 0.12; ENT = 0.00015; INFO = 0.45; BIO = 0.32
      activeProcs.clear(); ['thermo', 'bio', 'info'].forEach(p => activeProcs.add(p))
    }
    return
  }

  if (cmd === 'setParams') {
    if (data.DIFF !== undefined) DIFF = data.DIFF
    if (data.ENT  !== undefined) ENT  = data.ENT
    if (data.INFO !== undefined) INFO = data.INFO
    if (data.BIO  !== undefined) BIO  = data.BIO
    if (data.procs) { activeProcs.clear(); (data.procs as string[]).forEach(p => activeProcs.add(p)) }
    return
  }

  if (cmd === 'getStats') {
    ;(self as unknown as Worker).postMessage({ cmd: 'stats', data: { ...grid.stats, tick, evCount } })
    return
  }

  if (cmd === 'snapshot') {
    ;(self as unknown as Worker).postMessage({ cmd: 'snapshot', data: { snap: grid.snapshot(), tick } })
    return
  }

  if (cmd === 'restore') {
    grid.restore(data.snap); tick = data.tick || 0
    return
  }
}

export {}
