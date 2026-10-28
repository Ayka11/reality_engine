/**
 * Chunk-aware simulation Web Worker.
 * 128×128×64 grid, iterates only active chunks — zero cost for empty space.
 * Sends only dirty chunks back to main thread as transferable ArrayBuffer.
 */

import {
  ChunkGrid, GRID_W, GRID_H, GRID_D,
  CHUNK_FLOATS, F, NF, CX, CY, CZ, chunkKey,
} from './ChunkGrid'
import { brushGeometryWeight } from '../brushes/BrushGeometry'
import { applyBrushOperation } from '../brushes/BrushMath'
import type { BrushFalloff, BrushOperation, BrushShape, BrushVerticalExtent } from '../brushes/BrushContract'
import { PROC, defaultProcessMask } from '../process/ProcessDef'
import { DEFAULT_PARAMS, type PhysicsParams } from '../laws/MetaLaw'
import { MAT, MATERIAL_LIBRARY } from '../materials/MaterialDef'

const grid = new ChunkGrid()
const W = GRID_W, H = GRID_H, D = GRID_D
let tick = 0, evCount = 0
// A restore session is isolated from normal ticks and requires unique chunk ACKs.
let activeRestoreId: number | null = null
let expectedRestoreChunks = 0
let restoredChunkCount = 0
let restoreFailed = false
let restorePrepared = false
const restoredChunkKeys = new Set<number>()
const restoreBeforeChunks = new Map<number, Float32Array | null>()
const restoreBeforeKeys = new Set<number>()
const restoreBeforeDirtyChunks = new Set<number>()
const causal: Array<{ id: number; tick: number; x: number; y: number; z: number; delta: number }> = []
let physicsParams: PhysicsParams = { ...DEFAULT_PARAMS }
let processMask = defaultProcessMask()

const LEGACY_PROCESS_IDS: Record<string, number> = {
  energy: PROC.ENERGY_DIFFUSION,
  thermo: PROC.TEMP_DIFFUSION,
  density: PROC.DENSITY_FLOW,
  entropy: PROC.ENTROPY_GROWTH,
  info: PROC.INFORMATION,
  bio: PROC.BIO_POTENTIAL,
  wave: PROC.WAVE_PROPAGATION,
  gravity: PROC.GRAVITY,
  phase: PROC.PHASE_TRANSITION,
  metabolism: PROC.METABOLISM,
  signal: PROC.SIGNAL_PROPAGATION,
  crystallization: PROC.CRYSTALLIZATION,
  radiation: PROC.RADIATION,
  pressure: PROC.PRESSURE_DIFFUSION,
  rotation: PROC.FIELD_ROTATION,
  erosion: PROC.EROSION,
}

function isProcessActive(id: number): boolean {
  return (processMask & (1 << id)) !== 0
}

function setLegacyProcesses(names: string[]): void {
  processMask = 0
  for (const name of names) {
    const id = LEGACY_PROCESS_IDS[name]
    if (id !== undefined) processMask |= 1 << id
  }
}

function applyPhysicsParams(candidate: unknown): void {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return
  const next = { ...physicsParams }
  for (const key of Object.keys(DEFAULT_PARAMS) as (keyof PhysicsParams)[]) {
    const value = (candidate as Record<string, unknown>)[key]
    if (value !== undefined) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`Invalid physics parameter: ${key}`)
      }
      next[key] = value
    }
  }
  physicsParams = next
}

function applyLegacyScalars(data: Record<string, unknown>): void {
  const aliases: Array<[string, keyof PhysicsParams]> = [
    ['DIFF', 'energyDiffusion'],
    ['ENT', 'entropyGrowthRate'],
    ['INFO', 'infoGrowthRate'],
    ['BIO', 'infoGrowthThreshD'],
  ]
  for (const [legacy, canonical] of aliases) {
    const value = data[legacy]
    if (typeof value === 'number' && Number.isFinite(value)) {
      physicsParams = { ...physicsParams, [canonical]: value }
    }
  }
}

type CellImage = Map<number, Float32Array>
type SculptHistoryRecord = { before: CellImage; after: CellImage }
const sculptUndo: SculptHistoryRecord[] = []
const sculptRedo: SculptHistoryRecord[] = []
const MAX_SCULPT_HISTORY = 50
function affectedCellIndices(x: number, y: number, z: number, radius: number): number[] {
  const r = Math.max(0, Number.isFinite(radius) ? radius : 0)
  const x0 = Math.max(0, Math.ceil(x-r)), x1 = Math.min(GRID_W-1, Math.floor(x+r))
  const y0 = Math.max(0, Math.ceil(y-r)), y1 = Math.min(GRID_H-1, Math.floor(y+r))
  const z0 = Math.max(0, Math.ceil(z-r)), z1 = Math.min(GRID_D-1, Math.floor(z+r))
  const cells:number[]=[]
  for(let cz=z0;cz<=z1;cz++)for(let cy=y0;cy<=y1;cy++)for(let cx=x0;cx<=x1;cx++){
    const dx=cx-x,dy=cy-y,dz=cz-z
    if(Math.sqrt(dx*dx+dy*dy+dz*dz)<=r)cells.push((cz*GRID_H+cy)*GRID_W+cx)
  }
  return cells
}
function affectedBrushCellIndices(
  x: number, y: number, z: number, geometry: {
    shape: BrushShape; falloff: BrushFalloff; verticalExtent: BrushVerticalExtent;
    radius: number; shellThickness: number; layerThickness: number;
  },
): number[] {
  const pad = geometry.shape === 'shell' ? geometry.shellThickness : 0
  const x0 = Math.max(0, Math.floor(x - geometry.radius - pad))
  const x1 = Math.min(GRID_W - 1, Math.ceil(x + geometry.radius + pad))
  const z0 = Math.max(0, Math.floor(z - geometry.radius - pad))
  const z1 = Math.min(GRID_D - 1, Math.ceil(z + geometry.radius + pad))
  const fullColumn = geometry.shape === 'column' && geometry.verticalExtent === 'full-column'
  const y0 = fullColumn ? 0 : Math.max(0, Math.floor(y - geometry.radius - pad))
  const y1 = fullColumn ? GRID_H - 1 : Math.min(GRID_H - 1, Math.ceil(y + geometry.radius + pad))
  const cells: number[] = []
  for (let cz = z0; cz <= z1; cz++) for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    if (brushGeometryWeight({ center: { x, y, z }, point: { x: cx, y: cy, z: cz }, geometry, selectedLayerY: y }) > 0) {
      cells.push((cz * GRID_H + cy) * GRID_W + cx)
    }
  }
  return cells
}

function captureCells(indices:number[]):CellImage {
  const image:CellImage=new Map()
  for(const index of indices){
    const x=index%GRID_W,y=Math.floor(index/GRID_W)%GRID_H,z=Math.floor(index/(GRID_W*GRID_H))
    const values=new Float32Array(NF)
    for(let f=0;f<NF;f++)values[f]=grid.get(x,y,z,f)
    image.set(index,values)
  }
  return image
}
function restoreCells(image:CellImage):void {
  const touchedChunks=new Set<number>()
  for(const [index,values] of image){
    const x=index%GRID_W,y=Math.floor(index/GRID_W)%GRID_H,z=Math.floor(index/(GRID_W*GRID_H))
    for(let f=0;f<NF;f++)grid.set(x,y,z,f,values[f])
    touchedChunks.add(chunkKey(Math.floor(x/CX),Math.floor(y/CY),Math.floor(z/CZ)))
  }
  // A first sculpt can allocate a formerly empty chunk. Remove it again only
  // when no other cell in that chunk still contains data.
  for(const key of touchedChunks){
    const chunk=grid.chunks.get(key)
    if(!chunk)continue
    let nonzero=false
    for(let i=0;i<chunk.length;i++)if(Math.abs(chunk[i])>0.001){nonzero=true;break}
    if(!nonzero){grid.chunks.delete(key);grid.dirtyChunks.add(key)}
  }
}
function commitSculptEdit(indices:number[],before:CellImage):void {
  sculptUndo.push({before,after:captureCells(indices)})
  if(sculptUndo.length>MAX_SCULPT_HISTORY)sculptUndo.shift()
  sculptRedo.length=0
}
function clearSculptHistory():void {sculptUndo.length=0;sculptRedo.length=0}

function simStep(dt: number) {
  // Jacobi-style input snapshot: spatial derivatives read the same pre-tick
  // state regardless of iteration order. Candidate cells include a one-cell
  // halo so fields can enter previously empty cells and neighboring chunks.
  const sourceChunks = new Map<number, Float32Array>(
    [...grid.chunks].map(([key, values]) => [key, values.slice()]),
  )
  const sourceRead = (x: number, y: number, z: number, field: number): number => {
    if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= D) return 0
    const key = chunkKey(Math.floor(x / CX), Math.floor(y / CY), Math.floor(z / CZ))
    const source = sourceChunks.get(key)
    if (!source) return 0
    const base = (((z & 7) * CY * CX) + ((y & 7) * CX) + (x & 7)) * NF
    return source[base + field]
  }
  const candidates = new Map<number, { x: number; y: number; z: number }>()
  const addCandidate = (x: number, y: number, z: number) => {
    if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= D) return
    candidates.set((z * H + y) * W + x, { x, y, z })
  }
  const sourceCells = [...grid.activeCells()]
  for (const { x, y, z } of sourceCells) {
    addCandidate(x, y, z)
    addCandidate(x - 1, y, z); addCandidate(x + 1, y, z)
    addCandidate(x, y - 1, z); addCandidate(x, y + 1, z)
    addCandidate(x, y, z - 1); addCandidate(x, y, z + 1)
  }
  const zeroChunk = new Float32Array(CHUNK_FLOATS)
  const orderedCandidates = [...candidates.values()].sort((a, b) =>
    (a.z * H + a.y) * W + a.x - ((b.z * H + b.y) * W + b.x))
  // Reuse the six-neighbor stencil and signal-field list for every candidate.
  const dirs: Array<[number, number, number]> = [
    [-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1],
  ]
  const signalFields = [F.E, F.T, F.D, F.I, F.P, F.WAVE]
  for (const { x, y, z } of orderedCandidates) {
    const key = chunkKey(Math.floor(x / CX), Math.floor(y / CY), Math.floor(z / CZ))
    const chunk = sourceChunks.get(key) ?? zeroChunk
    const base = (((z & 7) * CY * CX) + ((y & 7) * CX) + (x & 7)) * NF
    let hasLocalState = false
    for (let field = 0; field < NF; field++) {
      if (Math.abs(chunk[base + field]) > 0.001) { hasLocalState = true; break }
    }
    let hasNeighborSignal = false
    for (const [dx, dy, dz] of dirs) {
      for (const field of signalFields) {
        if (Math.abs(sourceRead(x + dx, y + dy, z + dz, field)) > 0.001) {
          hasNeighborSignal = true
          break
        }
      }
      if (hasNeighborSignal) break
    }
    if (!hasLocalState && !hasNeighborSignal) continue
    let lapE = 0, lapT = 0, lapD = 0, lapI = 0, lapP = 0, lapWave = 0, nc = 0
    let fxSum = 0, fySum = 0
    for (const [dx, dy, dz] of dirs) {
      const nx = x + dx, ny = y + dy, nz = z + dz
      if (nx < 0 || nx >= W || ny < 0 || ny >= H || nz < 0 || nz >= D) continue
      lapE += sourceRead(nx, ny, nz, F.E)
      lapT += sourceRead(nx, ny, nz, F.T)
      lapD += sourceRead(nx, ny, nz, F.D)
      lapI += sourceRead(nx, ny, nz, F.I)
      lapP += sourceRead(nx, ny, nz, F.P)
      lapWave += sourceRead(nx, ny, nz, F.WAVE)
      fxSum += sourceRead(nx, ny, nz, F.FX)
      fySum += sourceRead(nx, ny, nz, F.FY)
      nc++
    }
    const E = chunk[base + F.E], T = chunk[base + F.T]
    const D_ = chunk[base + F.D], I = chunk[base + F.I]
    const P = chunk[base + F.P], wave = chunk[base + F.WAVE]
    const FX = chunk[base + F.FX], FY = chunk[base + F.FY]
    lapE -= nc * E; lapT -= nc * T; lapD -= nc * D_; lapI -= nc * I
    lapP -= nc * P; lapWave -= nc * wave

    const p = physicsParams
    const newE = isProcessActive(PROC.ENERGY_DIFFUSION)
      ? Math.max(0, Math.min(9999, E + p.energyDiffusion * lapE * dt))
      : E
    grid.set(x, y, z, F.E, newE)

    if (isProcessActive(PROC.TEMP_DIFFUSION)) {
      grid.set(x, y, z, F.T, Math.max(0, Math.min(2000,
        T + p.tempDiffusion * lapT * dt + newE * p.tempEnergyCoupling * dt)))
    }
    if (isProcessActive(PROC.DENSITY_FLOW)) {
      grid.set(x, y, z, F.D, Math.max(0, Math.min(1, D_ + p.densityDiffusion * lapD * dt)))
    }
    // Accumulate information growth and signal propagation into one value.
    // Writing F.I independently in each block made SIGNAL_PROPAGATION overwrite
    // INFORMATION whenever both processes were enabled.
    const informationActive = isProcessActive(PROC.INFORMATION)
    const signalActive = isProcessActive(PROC.SIGNAL_PROPAGATION)
    let nextI = I
    if (informationActive) {
      const supp = 1 - chunk[base + F.S] * p.infoEntropySupp
      if (newE > p.infoGrowthThreshE && D_ > p.infoGrowthThreshD && supp > 0) {
        nextI = Math.max(0, Math.min(999, I + p.infoGrowthRate * supp * dt))
      } else {
        nextI = Math.max(0, I * Math.pow(0.999, dt * 60))
      }
    }
    if (signalActive) {
      nextI = Math.max(0, Math.min(999,
        nextI + p.signalPropagationRate * p.infoGrowthRate * dt * lapI))
    }
    if (informationActive || signalActive) grid.set(x, y, z, F.I, nextI)

    const dS = isProcessActive(PROC.ENTROPY_GROWTH)
      ? (p.entropyGrowthRate + newE * p.entropyEnergyCoupling
        + (chunk[base + F.T] || 0) * 0.00005) * dt
      : 0
    const entropyEnabled = isProcessActive(PROC.ENTROPY_GROWTH)
    const newS = entropyEnabled
      ? Math.max(0, Math.min(1, chunk[base + F.S] + dS))
      : chunk[base + F.S]
    if (entropyEnabled) {
      grid.set(x, y, z, F.S, newS)
      grid.set(x, y, z, F.E, Math.max(0, newE * (1 - newS * 0.0005 * dt * 60)))
    }

    if (isProcessActive(PROC.BIO_POTENTIAL)) {
      const materialId = Math.max(0, Math.min(MATERIAL_LIBRARY.length - 1,
        Math.floor(grid.get(x, y, z, F.MAT))))
      const material = MATERIAL_LIBRARY[materialId] ?? MATERIAL_LIBRARY[MAT.VACUUM]
      const bio = (grid.get(x, y, z, F.I) / 200) * 0.4
        + Math.min(newE / 500, 1) * 0.3
        + grid.get(x, y, z, F.D) * 0.2
        + (1 - newS) * 0.1
        + material.bioAffinity
      grid.set(x, y, z, F.BIO, Math.max(0, Math.min(1, bio)))
    }

    if (isProcessActive(PROC.METABOLISM)) {
      const bio = grid.get(x, y, z, F.BIO)
      if (bio > 0.45) {
        const rate = bio * p.metabolismRate * dt
        grid.set(x, y, z, F.E, Math.max(0, grid.get(x, y, z, F.E) - rate * 60))
        grid.set(x, y, z, F.I, Math.min(999, grid.get(x, y, z, F.I) + rate * 25))
        grid.set(x, y, z, F.S, Math.min(1, grid.get(x, y, z, F.S) + rate * 0.008))
      }
    }

    if (isProcessActive(PROC.WAVE_PROPAGATION)) {
      const nextWave = Math.max(-9999, Math.min(9999,
        (wave + p.waveSpeed * p.waveSpeed * lapWave * dt * dt) * p.waveDamping))
      grid.set(x, y, z, F.WAVE, nextWave)
      // Wave-to-energy coupling is an additive source, but energy remains a
      // non-negative bounded field even when the wave phase removes energy.
      grid.set(x, y, z, F.E, Math.max(0, Math.min(9999,
        grid.get(x, y, z, F.E) + wave * Math.sin(tick * dt * p.waveSpeed) * 0.008 * dt)))
    }

    if (isProcessActive(PROC.GRAVITY)) {
      const leftD = sourceRead(x - 1, y, z, F.D), rightD = sourceRead(x + 1, y, z, F.D)
      const downD = sourceRead(x, y - 1, z, F.D), upD = sourceRead(x, y + 1, z, F.D)
      grid.set(x, y, z, F.FX, FX - p.gravityDensityCoupling * (rightD - leftD) * 0.5 * dt)
      grid.set(x, y, z, F.FY, FY - p.gravityDensityCoupling * (upD - downD) * 0.5 * dt)
    }

    if (isProcessActive(PROC.PRESSURE_DIFFUSION)) {
      // Use the same pre-step density/temperature sample as the CPU and GPU solvers.
      const equilibriumPressure = D_ * p.pressureDensityCoupling - T * 0.1
      grid.set(x, y, z, F.P, Math.max(-9999, Math.min(9999,
        P + p.pressureDiffusion * lapP * dt + (equilibriumPressure - P) * dt)))
    }

    if (isProcessActive(PROC.PHASE_TRANSITION)) {
      const density = grid.get(x, y, z, F.D)
      const temperature = grid.get(x, y, z, F.T)
      if (temperature > 500 && density > 0.5) {
        grid.set(x, y, z, F.D, Math.max(0, density - p.phaseTransitionRate * dt * 60))
        grid.set(x, y, z, F.S, Math.min(1, grid.get(x, y, z, F.S) + p.phaseTransitionRate * dt * 60))
        grid.set(x, y, z, F.I, Math.max(0, grid.get(x, y, z, F.I) - 3 * dt))
      } else if (temperature < 40 && density > 0.55) {
        grid.set(x, y, z, F.D, Math.min(1, density + p.phaseTransitionRate * 0.5 * dt * 60))
        grid.set(x, y, z, F.S, Math.max(0, grid.get(x, y, z, F.S) - p.phaseTransitionRate * 0.5 * dt * 60))
      }
    }

    if (isProcessActive(PROC.CRYSTALLIZATION)) {
      const entropy = grid.get(x, y, z, F.S)
      const density = grid.get(x, y, z, F.D)
      if (entropy < 0.18 && density > 0.38) {
        const currentMaterialId = Math.max(0, Math.min(MATERIAL_LIBRARY.length - 1,
          Math.floor(grid.get(x, y, z, F.MAT))))
        const currentMaterial = MATERIAL_LIBRARY[currentMaterialId] ?? MATERIAL_LIBRARY[MAT.VACUUM]
        const materialRate = currentMaterialId === MAT.VACUUM ? 1 : currentMaterial.crystallizationRate
        const rate = p.crystallizationRate * materialRate
        grid.set(x, y, z, F.D, Math.min(1, density + rate * (0.18 - entropy) * dt * 60))
        grid.set(x, y, z, F.S, Math.max(0, entropy - rate * 0.5 * dt * 60))
        if (rate > 0 && (currentMaterialId === MAT.VACUUM ||
            currentMaterialId === MAT.STONE ||
            currentMaterialId === MAT.SAND)) {
          grid.set(x, y, z, F.MAT, MAT.CRYSTAL)
        }
      }
    }

    if (isProcessActive(PROC.RADIATION)) {
      // Trigger/rate delta use the immutable pre-step energy sample, matching CPU and GPU.
      if (E > p.radiationThreshold) {
        const rawMaterialId = chunk[base + F.MAT]
        const materialId = Number.isFinite(rawMaterialId)
          ? Math.max(0, Math.min(MATERIAL_LIBRARY.length - 1, Math.floor(rawMaterialId)))
          : MAT.VACUUM
        const material = MATERIAL_LIBRARY[materialId] ?? MATERIAL_LIBRARY[MAT.VACUUM]
        grid.set(x, y, z, F.D, Math.max(0, grid.get(x, y, z, F.D)
          - (E - p.radiationThreshold) * p.radiationDensityRate * (1 - material.radiationAbsorption) * dt * 60))
        grid.set(x, y, z, F.E, Math.max(0, grid.get(x, y, z, F.E)
          - (E - p.radiationThreshold) * p.radiationEnergyRate * dt * 60))
      }
    }

    if (isProcessActive(PROC.FIELD_ROTATION)) {
      grid.set(x, y, z, F.FX, FX * p.fieldRotationDamping + fxSum / Math.max(nc, 1) * p.fieldRotationNeighborCoupling + FY * p.fieldRotationCrossCoupling)
      grid.set(x, y, z, F.FY, FY * p.fieldRotationDamping + fySum / Math.max(nc, 1) * p.fieldRotationNeighborCoupling - FX * p.fieldRotationCrossCoupling)
    }

    if (isProcessActive(PROC.EROSION)) {
      const density = grid.get(x, y, z, F.D)
      const flow = Math.abs(grid.get(x, y, z, F.FX)) + Math.abs(grid.get(x, y, z, F.FY))
      const materialId = Math.max(0, Math.min(MATERIAL_LIBRARY.length - 1,
        Math.floor(grid.get(x, y, z, F.MAT))))
      const material = MATERIAL_LIBRARY[materialId] ?? MATERIAL_LIBRARY[MAT.VACUUM]
      // Keep the threshold consistent with CPU FieldPhysics and GPUBackend.
      if (density > 0.65 && flow > 8.0) {
        const erodibility = 1 - material.erosionResistance
        grid.set(x, y, z, F.D, Math.max(0, density - p.erosionRate * erodibility * dt * 60))
        grid.set(x, y, z, F.I, Math.max(0, grid.get(x, y, z, F.I) - 0.4 * erodibility * dt))
      }
    }

    grid.add(x, y, z, F.TAU, dt * (p.timeBaseRate + newE * p.timeEnergyBoost + newS * 0.2))

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

function emitRestoreFrame(restoreId: number): void {
  const ab = buildFramePayload()
  ;(self as unknown as Worker).postMessage({
    cmd: 'frame', tick, evCount, events: causal.slice(-20), ab, stats: grid.stats, restoreId,
  }, [ab])
}

self.onmessage = (e: MessageEvent) => {
  const { cmd, data, requestId } = e.data

  if (cmd === 'restoreBegin') {
    const restoreId = data?.restoreId
    const expected = data?.expected
    if (!Number.isInteger(restoreId) || restoreId < 1 ||
        !Number.isInteger(expected) || expected < 0 || activeRestoreId !== null) {
      ;(self as unknown as Worker).postMessage({
        cmd: 'restoreComplete',
        data: { restoreId, complete: false, reason: 'invalid-or-concurrent-restore', restoredChunkCount, expectedRestoreChunks },
      })
      return
    }
    activeRestoreId = restoreId
    expectedRestoreChunks = expected
    restoredChunkCount = 0
    restoreFailed = false
    restorePrepared = false
    restoredChunkKeys.clear()
    restoreBeforeChunks.clear()
    restoreBeforeKeys.clear()
    for (const key of grid.chunks.keys()) restoreBeforeKeys.add(key)
    restoreBeforeDirtyChunks.clear()
    for (const key of grid.dirtyChunks) restoreBeforeDirtyChunks.add(key)
    grid.dirtyChunks.clear()
    return
  }

  // Do not let simulation or edits interleave with an atomic restore session.
  if (activeRestoreId !== null && !['restoreChunk', 'restoreEnd', 'restoreCommit', 'restoreAbort'].includes(cmd)) return

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
    const { x, y, z, f, v, r, mode, trackHistory } = data
    if (!trackHistory) clearSculptHistory()
    const cells = trackHistory ? affectedCellIndices(x,y,z,Math.max(0,r||0)) : []
    const before = trackHistory ? captureCells(cells) : null
    if (mode === 'erase') {
      if (r > 0) grid.eraseSphere(x, y, z, r)
      else [F.E, F.D, F.I, F.S, F.T, F.BIO].forEach(ff => grid.set(x, y, z, ff, 0))
    } else if (r > 0) grid.paintSphere(x, y, z, r, f, v, mode === 'add' ? 'add' : 'set')
    else if (mode === 'add') grid.add(x, y, z, f, v)
    else if (mode === 'set') grid.set(x, y, z, f, v)
    else [F.E, F.D, F.I, F.S, F.T, F.BIO].forEach(ff => grid.set(x, y, z, ff, 0))
    if(before)commitSculptEdit(cells,before)
    return
  }
  if(cmd==='undoSculpt'){
    const record=sculptUndo.pop();if(record){restoreCells(record.before);sculptRedo.push(record)}
    ;(self as unknown as Worker).postMessage({cmd:'sculptHistoryApplied',action:'undo',applied:!!record,requestId});return
  }
  if(cmd==='redoSculpt'){
    const record=sculptRedo.pop();if(record){restoreCells(record.after);sculptUndo.push(record)}
    ;(self as unknown as Worker).postMessage({cmd:'sculptHistoryApplied',action:'redo',applied:!!record,requestId});return
  }
  if(cmd==='clearSculptHistory'){clearSculptHistory();return}

  if (cmd === 'brush') {
    const {
      name, x, y, z, radius, strength,
      geometry: requestedShape = 'sphere',
      falloff: requestedFalloff = 'gaussian',
      verticalExtent: requestedVerticalExtent = 'bounded-volume',
      operation: requestedOperation = 'set',
      shellThickness = 1,
      layerThickness = 0.5,
    } = data as {
      name: string; x: number; y: number; z: number; radius: number; strength: number
      geometry?: BrushShape; falloff?: BrushFalloff; verticalExtent?: BrushVerticalExtent
      operation?: BrushOperation; shellThickness?: number; layerThickness?: number
      trackHistory?: boolean
    }
    const cx = Math.max(0, Math.min(W - 1, Math.round(x)))
    const cy = Math.max(0, Math.min(H - 1, Math.round(y)))
    const cz = Math.max(0, Math.min(D - 1, Math.round(z)))
    const r = Math.max(1, Math.min(24, Number.isFinite(radius) ? radius : 4))
    const s = Math.max(0, Math.min(2.5, Number.isFinite(strength) ? strength : 1))
    const shape: BrushShape = (['sphere', 'shell', 'column', 'layer'] as string[]).includes(requestedShape) ? requestedShape : 'sphere'
    const falloff: BrushFalloff = (['gaussian', 'linear', 'constant'] as string[]).includes(requestedFalloff) ? requestedFalloff : 'gaussian'
    const verticalExtent: BrushVerticalExtent = (['selected-layer', 'bounded-volume', 'full-column'] as string[]).includes(requestedVerticalExtent) ? requestedVerticalExtent : 'bounded-volume'
    const operation: BrushOperation = (['add', 'set', 'scale'] as string[]).includes(requestedOperation) ? requestedOperation : 'set'
    const brushGeometry = {
      shape, falloff, verticalExtent, radius: r,
      shellThickness: Math.max(0.25, Math.min(8, Number.isFinite(shellThickness) ? shellThickness : 1)),
      layerThickness: Math.max(0, Math.min(4, Number.isFinite(layerThickness) ? layerThickness : 0.5)),
    }
    const trackHistory = data.trackHistory === true
    if (!trackHistory) clearSculptHistory()
    const cells = trackHistory ? affectedBrushCellIndices(cx, cy, cz, brushGeometry) : []
    const before = trackHistory ? captureCells(cells) : null

    const effects: Array<[number, number]> = (() => {
      switch (name) {
        case 'Volcano': return [[F.E, 800], [F.T, 500], [F.D, 0.6], [F.S, 0.2]]
        case 'Forest': return [[F.E, 180], [F.D, 0.4], [F.I, 160], [F.BIO, 0.7]]
        case 'Ocean': return [[F.E, 60], [F.D, 0.6], [F.T, 60], [F.I, 40]]
        case 'Crystal': return [[F.E, 700], [F.I, 280], [F.S, -0.08]]
        case 'Storm': return [[F.E, 400], [F.S, 0.12], [F.T, 150]]
        case 'Life Cluster': return [[F.E, 280], [F.D, 0.45], [F.I, 200], [F.BIO, 0.65], [F.T, 110], [F.S, -0.1]]
        case 'Radiation': return [[F.S, 0.3], [F.I, -50]]
        case 'Civ Seed':
        case 'Civilization Seed': return [[F.E, 380], [F.D, 0.5], [F.I, 400], [F.BIO, 0.8], [F.S, -0.15], [F.T, 100]]
        case 'Gravity Well': return [[F.E, 450], [F.D, 0.8]]
        case 'Entropy Sink': return [[F.S, -0.4], [F.T, -200]]
        case 'Quantum Core': return [[F.I, 350], [F.BIO, 0.6], [F.E, 200]]
        case 'MetaLaw Node': return [[F.E, 400], [F.I, 300], [F.D, 0.5]]
        case 'Force Barrier': return [[F.D, 0.9], [F.E, 150]]
        default: return [[F.E, 100]]
      }
    })()
    const pad = shape === 'shell' ? brushGeometry.shellThickness : 0
    const x0 = Math.max(0, Math.floor(cx - r - pad)), x1 = Math.min(W - 1, Math.ceil(cx + r + pad))
    const z0 = Math.max(0, Math.floor(cz - r - pad)), z1 = Math.min(D - 1, Math.ceil(cz + r + pad))
    const fullColumn = shape === 'column' && verticalExtent === 'full-column'
    const y0 = fullColumn ? 0 : Math.max(0, Math.floor(cy - r - pad))
    const y1 = fullColumn ? H - 1 : Math.min(H - 1, Math.ceil(cy + r + pad))
    for (let pz = z0; pz <= z1; pz++) for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      const weight = brushGeometryWeight({
        center: { x: cx, y: cy, z: cz }, point: { x: px, y: py, z: pz },
        geometry: brushGeometry, selectedLayerY: cy,
      })
      if (weight <= 0) continue
      for (const [field, value] of effects) {
        const current = grid.get(px, py, pz, field)
        grid.set(px, py, pz, field, applyBrushOperation(current, value, operation, weight, s))
      }
    }
    if (before) commitSculptEdit(cells, before)
    ;(self as unknown as Worker).postMessage({
      cmd: 'brushApplied', name, x: cx, y: cy, z: cz, radius: r,
      geometry: shape, falloff, verticalExtent, operation,
    })
    return
  }

  if (cmd === 'generate') {
    clearSculptHistory()
    grid.clear()
    const a = data
    if (a.params) applyPhysicsParams(a.params)
    else applyLegacyScalars(a)
    if (Number.isSafeInteger(a.processMask) && a.processMask >= 0 && a.processMask <= 0xffff) {
      processMask = a.processMask
    } else if (Array.isArray(a.procs)) {
      setLegacyProcesses(a.procs as string[])
    }
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
    clearSculptHistory()
    grid.clear(); tick = 0; causal.length = 0; evCount = 0
    const nm = data.name as string
    if (nm === 'burst') {
      grid.paintSphere(64, 64, 32, 18, F.E, 900)
      grid.paintSphere(64, 64, 32, 14, F.T, 500)
      grid.paintSphere(64, 64, 32, 16, F.D, 0.8)
    } else if (nm === 'wave') {
      for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const wave = Math.sin(x * 0.6) * Math.cos(y * 0.4) * Math.sin(z * 0.3 + 0.5)
        grid.set(x, y, z, F.E, Math.max(0, 400 + 400 * wave))
        grid.set(x, y, z, F.D, Math.max(0, Math.min(1, 0.4 + 0.3 * Math.sin(x * 0.3 + y * 0.3))))
        grid.set(x, y, z, F.T, Math.max(0, 200 + 200 * Math.cos(x * 0.3 + y * 0.3)))
      }
    } else if (nm === 'storm') {
      for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        grid.set(x, y, z, F.E, Math.random() * 800)
        grid.set(x, y, z, F.S, 0.3 + Math.random() * 0.6)
        grid.set(x, y, z, F.T, Math.random() * 400)
        grid.set(x, y, z, F.D, Math.random() * 0.8)
      }
    } else if (nm === 'ruins') {
      for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const n = (Math.sin(x * 0.5) * Math.cos(y * 0.4) + 1) / 2
        if (n > 0.5) {
          grid.set(x, y, z, F.E, 50 + n * 150)
          grid.set(x, y, z, F.I, n * 300)
          grid.set(x, y, z, F.D, 0.3 + n * 0.3)
          grid.set(x, y, z, F.S, 0.2 + Math.random() * 0.4)
        }
      }
    } else if (nm === 'clear') {
      // grid was already cleared above; keep the explicit runtime contract.
      processMask = 0
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
      physicsParams = { ...physicsParams, energyDiffusion: 0.12, entropyGrowthRate: 0.00015, infoGrowthRate: 0.45 }
      setLegacyProcesses(['thermo', 'bio', 'info'])
    }
    ;(self as unknown as Worker).postMessage({
      cmd: 'presetApplied',
      name: nm,
      tick,
      stats: { ...grid.stats },
      processMask,
      processes: Object.entries(LEGACY_PROCESS_IDS).filter(([, id]) => isProcessActive(id)).map(([name]) => name),
      params: { ...physicsParams }
    })
    return
  }

  if (cmd === 'setPhysics') {
    if (data.params) applyPhysicsParams(data.params)
    if (Number.isSafeInteger(data.processMask) && data.processMask >= 0 && data.processMask <= 0xffff) {
      processMask = data.processMask
    }
    return
  }

  if (cmd === 'setParams') {
    // Backward-compatible adapter for the node-law editor's legacy scalar names.
    applyLegacyScalars(data as Record<string, unknown>)
    if (data.procs) setLegacyProcesses(data.procs as string[])
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

  if (cmd === 'restoreChunk') {
    const restoreId = data?.restoreId
    const key = data?.key
    const payload = data?.data as number[] | Float32Array | undefined
    if (activeRestoreId === null || restoreId !== activeRestoreId) return
    if (!Number.isInteger(key) || key < 0 || !payload || payload.length !== CHUNK_FLOATS) {
      restoreFailed = true
      ;(self as unknown as Worker).postMessage({ cmd: 'restoreChunkAck', data: { key, restoreId, accepted: false } })
      return
    }
    if (restoredChunkKeys.has(key)) {
      restoreFailed = true
      ;(self as unknown as Worker).postMessage({ cmd: 'restoreChunkAck', data: { key, restoreId, accepted: false, duplicate: true } })
      return
    }
    for (let i = 0; i < payload.length; i++) {
      if (!Number.isFinite(payload[i])) {
        restoreFailed = true
        ;(self as unknown as Worker).postMessage({ cmd: 'restoreChunkAck', data: { key, restoreId, accepted: false } })
        return
      }
    }
    if (!restoreBeforeChunks.has(key)) restoreBeforeChunks.set(key, grid.chunks.get(key)?.slice() ?? null)
    if (!grid.restoreChunk(key, payload)) {
      restoreFailed = true
      ;(self as unknown as Worker).postMessage({ cmd: 'restoreChunkAck', data: { key, restoreId, accepted: false } })
      return
    }
    restoredChunkKeys.add(key)
    restoredChunkCount++
    // Do not publish uncommitted chunk state. The transaction emits one
    // authoritative frame only after commit or after restoring the before-image.
    ;(self as unknown as Worker).postMessage({ cmd: 'restoreChunkAck', data: { key, restoreId, accepted: true } })
    return
  }

  if (cmd === 'restoreEnd') {
    const restoreId = data?.restoreId
    const complete = activeRestoreId === restoreId && !restoreFailed &&
      restoredChunkCount === expectedRestoreChunks && restoredChunkKeys.size === expectedRestoreChunks
    if (activeRestoreId !== restoreId) {
      ;(self as unknown as Worker).postMessage({
        cmd: 'restoreComplete', data: { restoreId, complete: false, prepared: false, reason: 'stale-restore-id', restoredChunkCount, expectedRestoreChunks },
      })
      return
    }
    if (complete) {
      // Prepare only. Keep the before-image until the main thread confirms its ACK/frame barrier.
      restorePrepared = true
      ;(self as unknown as Worker).postMessage({
        cmd: 'restoreComplete', data: { restoreId, complete: true, prepared: true, restoredChunkCount, expectedRestoreChunks },
      })
      return
    }
    // Roll back every chunk already replaced before reporting failed preparation.
    for (const [key, before] of restoreBeforeChunks) {
      if (before === null) {
        grid.chunks.delete(key)
        grid.dirtyChunks.add(key)
      } else {
        grid.restoreChunk(key, before)
      }
    }
    for (const key of restoreBeforeDirtyChunks) grid.dirtyChunks.add(key)
    emitRestoreFrame(restoreId)
    ;(self as unknown as Worker).postMessage({
      cmd: 'restoreComplete', data: { restoreId, complete: false, prepared: false, restoredChunkCount, expectedRestoreChunks },
    })
    activeRestoreId = null
    expectedRestoreChunks = 0
    restoredChunkCount = 0
    restoreFailed = false
    restorePrepared = false
    restoredChunkKeys.clear()
    restoreBeforeChunks.clear()
    restoreBeforeKeys.clear()
    restoreBeforeDirtyChunks.clear()
    return
  }

  if (cmd === 'restoreCommit') {
    const restoreId = data?.restoreId
    const matchesActive = activeRestoreId === restoreId
    const committed = matchesActive && restorePrepared && !restoreFailed &&
      restoredChunkCount === expectedRestoreChunks && restoredChunkKeys.size === expectedRestoreChunks
    if (committed) {
      // A restore replaces the complete chunk set, not merely the chunks present
      // in the incoming snapshot. Publish tombstones for old keys omitted by it.
      for (const key of restoreBeforeKeys) {
        if (!restoredChunkKeys.has(key)) {
          grid.chunks.delete(key)
          grid.dirtyChunks.add(key)
        }
      }
      clearSculptHistory()
      for (const key of restoreBeforeDirtyChunks) grid.dirtyChunks.add(key)
    } else if (matchesActive) {
      for (const [key, before] of restoreBeforeChunks) {
        if (before === null) {
          grid.chunks.delete(key)
          grid.dirtyChunks.add(key)
        } else {
          grid.restoreChunk(key, before)
        }
      }
      for (const key of restoreBeforeDirtyChunks) grid.dirtyChunks.add(key)
    }
    if (matchesActive) emitRestoreFrame(restoreId)
    ;(self as unknown as Worker).postMessage({
      cmd: 'restoreCommitted', data: { restoreId, committed },
    })
    if (matchesActive) {
      activeRestoreId = null
      expectedRestoreChunks = 0
      restoredChunkCount = 0
      restoreFailed = false
      restorePrepared = false
      restoredChunkKeys.clear()
      restoreBeforeChunks.clear()
      restoreBeforeKeys.clear()
      restoreBeforeDirtyChunks.clear()
    }
    return
  }

  if (cmd === 'restoreAbort') {
    const restoreId = data?.restoreId
    const aborted = activeRestoreId === restoreId
    if (aborted) {
      for (const [key, before] of restoreBeforeChunks) {
        if (before === null) {
          grid.chunks.delete(key)
          grid.dirtyChunks.add(key)
        } else {
          grid.restoreChunk(key, before)
        }
      }
      for (const key of restoreBeforeDirtyChunks) grid.dirtyChunks.add(key)
      emitRestoreFrame(restoreId)
      activeRestoreId = null
      expectedRestoreChunks = 0
      restoredChunkCount = 0
      restoreFailed = false
      restorePrepared = false
      restoredChunkKeys.clear()
      restoreBeforeChunks.clear()
      restoreBeforeKeys.clear()
      restoreBeforeDirtyChunks.clear()
    }
    ;(self as unknown as Worker).postMessage({
      cmd: 'restoreAborted', data: { restoreId, aborted },
    })
    return
  }

  if (cmd === 'restore') {
    grid.restore(data.snap); tick = data.tick || 0
    return
  }
}

export {}
