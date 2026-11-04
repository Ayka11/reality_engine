import type { WorldEditorSnapshot } from './WorldEditorSnapshot'
import { validateAssetManifest } from '../worldLibrary/AssetImportManifest'
import { validateExternalAssetPlacements } from './ExternalAssetPlacement'

export type ActiveWorldCausalEvent = {
  tick: number
  x: number
  y: number
  delta: number
}

export type ActiveWorldGridInput = {
  width: number
  height: number
  fieldsPerCell: number
  tick: number
  buffer: Float32Array
  causal?: ActiveWorldCausalEvent[]
}

export type ActiveWorldPackageV6 = {
  format: 're_v6'
  version: 6
  W: number
  H: number
  NF: number
  tick: number
  cells: Array<{ i: number; d: number[] }>
  causal: ActiveWorldCausalEvent[]
  worldEditor: WorldEditorSnapshot
}

export type DecodedActiveWorldPackage = {
  buffer: Float32Array
  tick: number
  worldEditor?: WorldEditorSnapshot
  causal: ActiveWorldCausalEvent[]
  legacy: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function validateDimensions(width: number, height: number, fieldsPerCell: number): number {
  if (!Number.isSafeInteger(width) || width <= 0 ||
      !Number.isSafeInteger(height) || height <= 0 ||
      !Number.isSafeInteger(fieldsPerCell) || fieldsPerCell <= 0) {
    throw new RangeError('Active world grid dimensions are invalid')
  }
  const cells = width * height
  const bufferLength = cells * fieldsPerCell
  if (!Number.isSafeInteger(cells) || !Number.isSafeInteger(bufferLength) ||
      bufferLength > 100_000_000) {
    throw new RangeError('Active world grid exceeds the supported package size')
  }
  return bufferLength
}

/** Encode the currently active finite simulation plus its separate Infinite World editor. */
export function encodeActiveWorldPackage(
  grid: ActiveWorldGridInput,
  worldEditor: WorldEditorSnapshot,
): string {
  const expectedLength = validateDimensions(grid.width, grid.height, grid.fieldsPerCell)
  if (!(grid.buffer instanceof Float32Array) || grid.buffer.length !== expectedLength ||
      !grid.buffer.every(Number.isFinite)) {
    throw new TypeError('Active world grid buffer is invalid or contains non-finite values')
  }
  if (!Number.isSafeInteger(grid.tick) || grid.tick < 0) {
    throw new RangeError('Active world simulation tick is invalid')
  }
  const causal = grid.causal ?? []
  if (!Array.isArray(causal) || causal.length > 1_000_000 ||
      !causal.every(event => isRecord(event) &&
        Number.isSafeInteger(event.tick) && (event.tick as number) >= 0 &&
        Number.isSafeInteger(event.x) && Number.isSafeInteger(event.y) &&
        (event.x as number) >= 0 && (event.x as number) < grid.width &&
        (event.y as number) >= 0 && (event.y as number) < grid.height &&
        typeof event.delta === 'number' && Number.isFinite(event.delta))) {
    throw new TypeError('Active world causal history is invalid')
  }
  if (!isRecord(worldEditor) || worldEditor.version !== 1 ||
      !worldEditor.assetManifest) {
    throw new TypeError('Active world package requires a versioned editor snapshot and asset manifest')
  }
  const manifestValidation = validateAssetManifest(worldEditor.assetManifest)
  if (!manifestValidation.valid) {
    throw new TypeError(`Active world asset manifest is invalid: ${manifestValidation.errors.join('; ')}`)
  }
  const placementValidation = validateExternalAssetPlacements(
    worldEditor.assetPlacements ?? [],
    worldEditor.assetManifest,
    Boolean(worldEditor.assetPlacements?.length),
  )
  if (!placementValidation.valid) {
    throw new TypeError(`Active world asset placements are invalid: ${placementValidation.errors.join('; ')}`)
  }

  const cells: ActiveWorldPackageV6['cells'] = []
  for (let index = 0; index < grid.width * grid.height; index++) {
    const offset = index * grid.fieldsPerCell
    let active = false
    for (let field = 0; field < grid.fieldsPerCell; field++) {
      if (grid.buffer[offset + field] !== 0) {
        active = true
        break
      }
    }
    if (active) {
      cells.push({
        i: index,
        d: Array.from(grid.buffer.subarray(offset, offset + grid.fieldsPerCell)),
      })
    }
  }

  const payload: ActiveWorldPackageV6 = {
    format: 're_v6',
    version: 6,
    W: grid.width,
    H: grid.height,
    NF: grid.fieldsPerCell,
    tick: grid.tick,
    cells,
    causal: structuredClone(causal),
    worldEditor: structuredClone(worldEditor),
  }
  return JSON.stringify(payload)
}

/** Decode both the current unified package and legacy finite-grid re_v5 files. */
export function decodeActiveWorldPackage(
  value: unknown,
  expected: { width: number; height: number; fieldsPerCell: number },
): DecodedActiveWorldPackage {
  const expectedLength = validateDimensions(expected.width, expected.height, expected.fieldsPerCell)
  if (!isRecord(value)) throw new TypeError('Reality world package must be a JSON object')

  const legacy = value.format === 're_v5'
  const current = value.format === 're_v6' && value.version === 6
  if (!legacy && !current) {
    throw new TypeError('Unsupported Reality world package format')
  }
  if (value.W !== expected.width || value.H !== expected.height) {
    throw new RangeError('Reality world package dimensions do not match the active simulation')
  }
  const storedFields = value.NF === undefined && legacy
    ? expected.fieldsPerCell
    : value.NF
  if (!Number.isSafeInteger(storedFields) || storedFields !== expected.fieldsPerCell) {
    throw new RangeError('Reality world package field layout does not match the active simulation')
  }
  const tick = value.tick === undefined && legacy ? 0 : value.tick
  if (!Number.isSafeInteger(tick) || (tick as number) < 0) {
    throw new RangeError('Reality world package simulation tick is invalid')
  }
  if (!Array.isArray(value.cells) || value.cells.length > expected.width * expected.height) {
    throw new TypeError('Reality world package cell collection is invalid')
  }

  const buffer = new Float32Array(expectedLength)
  const seen = new Set<number>()
  for (let cellIndex = 0; cellIndex < value.cells.length; cellIndex++) {
    const cell = value.cells[cellIndex]
    if (!isRecord(cell) || !Number.isSafeInteger(cell.i) ||
        (cell.i as number) < 0 || (cell.i as number) >= expected.width * expected.height ||
        seen.has(cell.i as number)) {
      throw new TypeError(`Reality world package contains an invalid or duplicate cell at index ${cellIndex}`)
    }
    seen.add(cell.i as number)
    if (!Array.isArray(cell.d) || cell.d.length > expected.fieldsPerCell ||
        (current && cell.d.length !== expected.fieldsPerCell) ||
        !cell.d.every(value => typeof value === 'number' && Number.isFinite(value))) {
      throw new TypeError(`Reality world package cell ${cell.i} has an invalid field vector`)
    }
    const offset = (cell.i as number) * expected.fieldsPerCell
    for (let field = 0; field < cell.d.length; field++) {
      buffer[offset + field] = cell.d[field] as number
    }
  }

  let causal: ActiveWorldCausalEvent[] = []
  if (current) {
    if (value.causal !== undefined && !Array.isArray(value.causal)) {
      throw new TypeError('Reality world package causal history is invalid')
    }
    const candidateCausal = value.causal ?? []
    if (candidateCausal.length > 1_000_000 ||
        !candidateCausal.every(event => isRecord(event) &&
          Number.isSafeInteger(event.tick) && (event.tick as number) >= 0 &&
          Number.isSafeInteger(event.x) && Number.isSafeInteger(event.y) &&
          (event.x as number) >= 0 && (event.x as number) < expected.width &&
          (event.y as number) >= 0 && (event.y as number) < expected.height &&
          typeof event.delta === 'number' && Number.isFinite(event.delta))) {
      throw new TypeError('Reality world package causal history contains an invalid event')
    }
    causal = structuredClone(candidateCausal) as ActiveWorldCausalEvent[]
  }

  let worldEditor: WorldEditorSnapshot | undefined
  if (current) {
    if (!isRecord(value.worldEditor) || value.worldEditor.version !== 1) {
      throw new TypeError('Reality world package is missing its Infinite World editor snapshot')
    }
    const candidate = value.worldEditor as unknown as WorldEditorSnapshot
    if (!candidate.assetManifest) {
      throw new TypeError('Reality world package is missing its asset provenance manifest')
    }
    const manifestValidation = validateAssetManifest(candidate.assetManifest)
    if (!manifestValidation.valid) {
      throw new TypeError(`Reality world package asset manifest is invalid: ${manifestValidation.errors.join('; ')}`)
    }
    const placementValidation = validateExternalAssetPlacements(
      candidate.assetPlacements ?? [],
      candidate.assetManifest,
      Boolean(candidate.assetPlacements?.length),
    )
    if (!placementValidation.valid) {
      throw new TypeError(`Reality world package asset placements are invalid: ${placementValidation.errors.join('; ')}`)
    }
    worldEditor = structuredClone(candidate)
  }

  return { buffer, tick: tick as number, worldEditor, causal, legacy }
}
