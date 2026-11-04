import type { WorldAssetImportManifest } from '../worldLibrary/AssetImportManifest'

/**
 * Portable placement intent for a GLTF asset. Coordinates are absolute world
 * coordinates, not renderer-local coordinates after origin rebasing.
 */
export type ExternalAssetPlacementSnapshot = {
  instanceId: string
  sourceAssetId: string
  semanticEntryId: string
  x: number
  y: number
  z: number
  scale: number
  rotationY: number
}

export type ExternalAssetPlacementValidation = {
  valid: boolean
  errors: string[]
  placements: ExternalAssetPlacementSnapshot[]
}

const MAX_EXTERNAL_ASSET_PLACEMENTS = 100_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512
}

/** Validate placement data before adding it to a world or persisting it. */
export function validateExternalAssetPlacements(
  value: unknown,
  manifest?: WorldAssetImportManifest,
  requireManifest = false,
): ExternalAssetPlacementValidation {
  const errors: string[] = []
  if (!Array.isArray(value)) {
    return { valid: false, errors: ['External asset placements must be an array'], placements: [] }
  }
  if (value.length > MAX_EXTERNAL_ASSET_PLACEMENTS) {
    return { valid: false, errors: ['External asset placement count exceeds the supported limit'], placements: [] }
  }

  const seen = new Set<string>()
  const entries = manifest?.entries ?? []
  const placements: ExternalAssetPlacementSnapshot[] = []

  value.forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      errors.push(`External asset placement ${index} must be an object`)
      return
    }
    const {
      instanceId, sourceAssetId, semanticEntryId,
      x, y, z, scale, rotationY,
    } = candidate
    const label = nonEmpty(instanceId) ? instanceId : String(index)
    if (!nonEmpty(instanceId)) errors.push(`External asset placement ${index} is missing instanceId`)
    else if (seen.has(instanceId)) errors.push(`External asset placement ${instanceId} is duplicated`)
    else seen.add(instanceId)
    if (!nonEmpty(sourceAssetId)) errors.push(`External asset placement ${label} is missing sourceAssetId`)
    if (!nonEmpty(semanticEntryId)) errors.push(`External asset placement ${label} is missing semanticEntryId`)

    for (const [field, coordinate] of Object.entries({ x, y, z, rotationY })) {
      if (typeof coordinate !== 'number' || !Number.isFinite(coordinate)) {
        errors.push(`External asset placement ${label} has an invalid ${field}`)
      }
    }
    if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0 || scale > 1_000_000) {
      errors.push(`External asset placement ${label} has an invalid scale`)
    }

    if (manifest && nonEmpty(sourceAssetId) && nonEmpty(semanticEntryId)) {
      const matchingEntry = entries.some(entry =>
        entry.sourceAssetId === sourceAssetId && entry.semanticEntryId === semanticEntryId
      )
      if (!matchingEntry) {
        errors.push(`External asset placement ${label} has no matching asset manifest source/semantic entry`)
      }
    } else if (requireManifest && !manifest && value.length > 0) {
      errors.push('External asset placements require an asset provenance manifest')
    }

    if (nonEmpty(instanceId) && nonEmpty(sourceAssetId) && nonEmpty(semanticEntryId) &&
        typeof x === 'number' && Number.isFinite(x) &&
        typeof y === 'number' && Number.isFinite(y) &&
        typeof z === 'number' && Number.isFinite(z) &&
        typeof scale === 'number' && Number.isFinite(scale) && scale > 0 && scale <= 1_000_000 &&
        typeof rotationY === 'number' && Number.isFinite(rotationY)) {
      placements.push({ instanceId, sourceAssetId, semanticEntryId, x, y, z, scale, rotationY })
    }
  })

  return { valid: errors.length === 0, errors, placements }
}

/** Pending descriptors are retained, while live transforms take precedence. */
export function mergeExternalAssetPlacements(
  pending: ExternalAssetPlacementSnapshot[],
  live: ExternalAssetPlacementSnapshot[],
): ExternalAssetPlacementSnapshot[] {
  const merged = new Map<string, ExternalAssetPlacementSnapshot>()
  for (const placement of pending) merged.set(placement.instanceId, placement)
  for (const placement of live) merged.set(placement.instanceId, placement)
  return [...merged.values()].map(placement => ({ ...placement }))
}
