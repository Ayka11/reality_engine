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

export function sculptEraseToMutation(
  cell: LegacyVoxelCoordinate,
  radius: number,
  strength: number,
  metadata: Record<string, unknown> = {},
): WorldFieldMutation {
  const p = legacyToWorldCoordinate(cell)
  const fade = Math.max(0, Math.min(1, strength))
  const scale: Partial<Record<keyof ScientificFieldSample, number>> = {
    energy: 1 - fade,
    density: 1 - fade,
    information: 1 - fade,
    entropy: 1 - fade,
    temperature: 1 - fade,
    biology: 1 - fade,
  }
  return {
    id: 0,
    kind: 'brush',
    x: p.x,
    y: p.y,
    z: p.z,
    radius,
    scale,
    metadata: {
      ...metadata,
      source: metadata.source ?? 'legacy-sculpt-erase',
      brush: 'Erase',
      coordinateContract: 'legacy-grid-x-y-z-to-world-x-z-y-v1',
      unsupportedFields: ['materialId', 'signal', 'memField'],
      materialClearRule: 'legacy-fade-below-0.08-not-represented-in-authoritative-field-v1',
    },
  }
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

export function sculptNoiseToMutation(
  cell: LegacyVoxelCoordinate,
  radius: number,
  strength: number,
  noiseScale: number,
  seed: number,
  fields: Partial<{ energy: number; information: number; bio: number; temperature: number }>,
  metadata: Record<string, unknown> = {},
): WorldFieldMutation {
  const origin = legacyToWorldCoordinate(cell)
  return {
    ...legacyBrushDeltaToMutation(cell, {}, radius, {
      ...metadata,
      source: metadata.source ?? 'legacy-sculpt-noise',
      brush: 'Noise',
    }),
    profile: {
      schemaVersion: 'scientific-field-profile-v1',
      kind: 'radial',
      falloff: 'linear',
      radius,
    },
    spatialPattern: {
      schemaVersion: 'scientific-field-pattern-v1',
      kind: 'noise3',
      origin,
      scale: noiseScale,
      seed,
      octaves: 4,
      coordinateFrame: 'legacy-grid',
    },
    delta: {
      energy: strength * 0.1 * (fields.energy ?? 0),
      information: strength * 0.02 * (fields.information ?? 0),
      biology: strength * 0.0001 * (fields.bio ?? 0),
      temperature: strength * 0.06 * (fields.temperature ?? 0),
    },
  }
}

export function sculptPatternToMutation(
  cell: LegacyVoxelCoordinate,
  radius: number,
  strength: number,
  noiseScale: number,
  fields: Partial<{ energy: number; density: number; information: number }>,
  metadata: Record<string, unknown> = {},
): WorldFieldMutation {
  const origin = legacyToWorldCoordinate(cell)
  return {
    ...legacyBrushDeltaToMutation(cell, {}, radius, {
      ...metadata,
      source: metadata.source ?? 'legacy-sculpt-pattern',
      brush: 'Pattern',
    }),
    profile: {
      schemaVersion: 'scientific-field-profile-v1',
      kind: 'radial',
      falloff: 'linear',
      radius,
    },
    spatialPattern: {
      schemaVersion: 'scientific-field-pattern-v1',
      kind: 'pattern3',
      origin,
      scale: noiseScale,
      coordinateFrame: 'legacy-grid',
    },
    delta: {
      energy: strength * 0.08 * (fields.energy ?? 0),
      density: strength * 0.01 * (fields.density ?? 0),
      information: strength * 0.15 * (fields.information ?? 0),
    },
  }
}

export function sculptStampToMutation(
  cell: LegacyVoxelCoordinate,
  radius: number,
  strength: number,
  period = 4,
  metadata: Record<string, unknown> = {},
): WorldFieldMutation {
  const origin = legacyToWorldCoordinate(cell)
  return {
    ...legacyBrushDeltaToMutation(cell, {}, radius, {
      ...metadata,
      source: metadata.source ?? 'legacy-sculpt-stamp',
      brush: 'Stamp',
    }),
    profile: {
      schemaVersion: 'scientific-field-profile-v1',
      kind: 'radial',
      falloff: 'linear',
      radius,
    },
    spatialPattern: {
      schemaVersion: 'scientific-field-pattern-v1',
      kind: 'stamp-lattice',
      origin,
      period,
      low: 0.2,
      high: 1,
      coordinateFrame: 'legacy-grid',
    },
    delta: {
      density: 0.02,
      information: strength * 0.1,
    },
  }
}

export function sculptSmartBrushToMutation(
  name: 'Volcano'|'Forest'|'Ocean'|'Crystal'|'Storm'|'Life Cluster'|'Radiation'|'Civilization Seed',
  cell: LegacyVoxelCoordinate,
  radius: number,
  selectedLegacyZ?: number,
  metadata: Record<string, unknown> = {},
): WorldFieldMutation {
  const origin = legacyToWorldCoordinate(cell)
  const spatialPattern = {
    schemaVersion: 'scientific-smart-brush-v1' as const,
    kind: 'smart-brush' as const,
    name,
    origin,
    radius,
    ...(selectedLegacyZ === undefined ? {} : { selectedLegacyZ }),
  }
  const delta: Partial<ScientificFieldSample> = {}
  const operations: NonNullable<WorldFieldMutation['operations']> = {}
  switch (name) {
    case 'Volcano':
      delta.energy=9; delta.density=.7; delta.temperature=60; delta.entropy=.2; break
    case 'Forest':
      delta.energy=2; delta.density=.5; delta.information=18; delta.biology=.7; delta.temperature=8; delta.entropy=-.05; break
    case 'Ocean':
      delta.energy=.8; delta.information=4
      operations.density={mode:'max',value:.7}; operations.temperature={mode:'max',value:7}; break
    case 'Crystal':
      delta.energy=7; delta.density=.8; delta.entropy=-.08; delta.information=25; break
    case 'Storm':
      delta.temperature=20
      delta.energy=5
      operations.entropy={mode:'add',value:.15,weighting:'radial'}
      break
    case 'Life Cluster':
      delta.energy=3; delta.density=.4; delta.information=20; delta.biology=.6; delta.entropy=-.1; delta.temperature=12; break
    case 'Radiation':
      delta.entropy=.3; delta.information=-5; break
    case 'Civilization Seed':
      delta.energy=4; delta.density=.5; delta.information=40; delta.biology=.8; delta.entropy=-.15; delta.temperature=10; break
  }
  return {
    id:0, kind:'brush', x:origin.x, y:origin.y, z:origin.z, radius,
    spatialPattern, delta, operations,
    metadata:{
      ...metadata,
      source: metadata.source ?? 'legacy-smart-brush',
      brush:name,
      coordinateContract:'legacy-grid-x-y-z-to-world-x-z-y-v1',
      unsupportedFields:['materialId','pressure','fieldX','fieldY','fieldZ','localTime','causalityId','wavePhase','waveAmp','gravityPotential','chemState','signal','memField','agentMark','entityId'],
    },
  }
}

export function sculptSmoothToMutation(
  cell: LegacyVoxelCoordinate,
  radius: number,
  strength: number,
  metadata: Record<string, unknown> = {},
): WorldFieldMutation {
  const p = legacyToWorldCoordinate(cell)
  const operations: NonNullable<WorldFieldMutation['operations']> = {}
  for (const field of ['energy','density','information','entropy','temperature','biology'] as const) {
    operations[field] = { mode: 'smooth6', value: strength }
  }
  return {
    id: 0,
    kind: 'brush',
    x: p.x,
    y: p.y,
    z: p.z,
    radius,
    operations,
    metadata: {
      ...metadata,
      source: metadata.source ?? 'legacy-sculpt-smooth',
      brush: 'Smooth',
      coordinateContract: 'legacy-grid-x-y-z-to-world-x-z-y-v1',
    },
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
