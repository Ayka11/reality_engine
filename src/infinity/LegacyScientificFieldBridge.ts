import type { ScientificFieldSample } from './FieldSampler'
import type { WorldFieldMutation } from './MutableWorldFieldProvider'

/**
 * Explicit coordinate/semantic contract between the bounded legacy voxel
 * simulation and the unbounded Infinite World field.
 *
 * Legacy logical axes are (x, y, z), where z is the altitude layer.
 * Infinite World axes are (x, y, z), where y is altitude.
 */
export type LegacyVoxelCoordinate = { x: number; y: number; z: number }
export type LegacyGridBounds = { W: number; H: number; D: number }

export const LEGACY_WORLD_AXIS_MAP = {
  x: 'x',
  y: 'z',
  z: 'y',
} as const

export function legacyToWorldCoordinate(
  cell: LegacyVoxelCoordinate,
  bounds?: LegacyGridBounds,
): { x: number; y: number; z: number } {
  if (bounds && !isLegacyCoordinateInBounds(cell, bounds)) {
    throw new RangeError(`Legacy voxel coordinate out of bounds: ${cell.x},${cell.y},${cell.z}`)
  }
  return { x: cell.x, y: cell.z, z: cell.y }
}

export function isLegacyCoordinateInBounds(
  cell: LegacyVoxelCoordinate,
  bounds: LegacyGridBounds,
): boolean {
  return (
    Number.isInteger(cell.x) && Number.isInteger(cell.y) && Number.isInteger(cell.z) &&
    cell.x >= 0 && cell.x < bounds.W &&
    cell.y >= 0 && cell.y < bounds.H &&
    cell.z >= 0 && cell.z < bounds.D
  )
}

/**
 * Converts legacy field magnitudes into the scale used by ScientificFieldSample.
 * This is deliberately explicit: legacy energy/temperature/information use
 * materially larger ranges than the authoritative world field.
 */
export function normalizeLegacyCell(cell: {
  energy: number
  density: number
  information: number
  entropy: number
  temperature: number
  bioPotential: number
  materialId: number
}): ScientificFieldSample {
  return {
    energy: Math.max(0, cell.energy / 100),
    density: clamp01(cell.density),
    information: Math.max(0, cell.information / 10),
    entropy: clamp01(cell.entropy),
    temperature: Math.max(0, cell.temperature / 10),
    biology: clamp01(cell.bioPotential),
    material: Math.max(0, cell.materialId),
  }
}

/**
 * Converts an additive legacy brush change into an authoritative mutation.
 * Fields not represented by ScientificFieldSample are intentionally excluded.
 */
export function sculptInjectToMutation(
  cell: LegacyVoxelCoordinate,
  radius: number,
  strength: number,
  fields: Partial<{ energy: number; density: number; temperature: number; bio: number; information: number; entropy: number }>,
  metadata: Record<string, unknown> = {},
): WorldFieldMutation {
  return legacyBrushDeltaToMutation(
    cell,
    {
      energy: strength * 12 * (fields.energy ?? 0),
      density: strength * 0.012 * (fields.density ?? 0),
      temperature: strength * 8 * (fields.temperature ?? 0),
      bioPotential: strength * 0.01 * (fields.bio ?? 0),
      information: strength * 2 * (fields.information ?? 0),
      entropy: strength * 0.005 * (fields.entropy ?? 0),
    },
    radius,
    { ...metadata, source: metadata.source ?? 'legacy-sculpt-inject' },
  )
}

export function sculptErodeToMutation(
  cell: LegacyVoxelCoordinate,
  radius: number,
  strength: number,
  metadata: Record<string, unknown> = {},
): WorldFieldMutation {
  return legacyBrushDeltaToMutation(
    cell,
    {
      density: -strength * 0.01,
      entropy: strength * 0.006,
      temperature: -strength * 1.5,
    },
    radius,
    { ...metadata, source: metadata.source ?? 'legacy-sculpt-erode' },
  )
}

export function legacyBrushDeltaToMutation(
  cell: LegacyVoxelCoordinate,
  delta: {
    energy?: number
    density?: number
    information?: number
    entropy?: number
    temperature?: number
    bioPotential?: number
  },
  radius: number,
  metadata: Record<string, unknown> = {},
): WorldFieldMutation {
  const p = legacyToWorldCoordinate(cell)
  return {
    id: 0,
    kind: 'brush',
    x: p.x,
    y: p.y,
    z: p.z,
    radius,
    delta: {
      ...(delta.energy === undefined ? {} : { energy: delta.energy / 100 }),
      ...(delta.density === undefined ? {} : { density: delta.density }),
      ...(delta.information === undefined ? {} : { information: delta.information / 10 }),
      ...(delta.entropy === undefined ? {} : { entropy: delta.entropy }),
      ...(delta.temperature === undefined ? {} : { temperature: delta.temperature / 10 }),
      ...(delta.bioPotential === undefined ? {} : { biology: delta.bioPotential }),
    },
    metadata: {
      ...metadata,
      source: metadata.source ?? 'legacy-scientific-field-bridge',
      coordinateContract: 'legacy-grid-x-y-z-to-world-x-z-y-v1',
      unsupportedFields: ['pressure', 'fieldX', 'fieldY', 'fieldZ', 'localTime', 'causalityId', 'wavePhase', 'waveAmp', 'gravityPotential', 'materialId', 'chemState', 'signal', 'memField', 'agentMark', 'entityId'],
    },
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
