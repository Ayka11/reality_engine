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
  const pendingIds = new Set<string>()
  const liveIds = new Set<string>()
  const add = (placement: ExternalAssetPlacementSnapshot, source: 'pending' | 'live') => {
    const sourceIds = source === 'pending' ? pendingIds : liveIds
    if (sourceIds.has(placement.instanceId)) {
      throw new TypeError('External asset placement ID ' + placement.instanceId + ' is duplicated in ' + source + ' records')
    }
    sourceIds.add(placement.instanceId)
    const previous = merged.get(placement.instanceId)
    if (previous) {
      if (previous.sourceAssetId !== placement.sourceAssetId ||
          previous.semanticEntryId !== placement.semanticEntryId) {
        throw new TypeError(
          'External asset placement ID ' + placement.instanceId +
          ' is claimed by different asset sources or semantic entries',
        )
      }
    }
    // A live transform may supersede the matching pending snapshot, but never
    // a descriptor owned by a different asset or semantic entry.
    merged.set(placement.instanceId, placement)
  }
  for (const placement of pending) add(placement, 'pending')
  for (const placement of live) add(placement, 'live')
  return [...merged.values()].map(placement => ({ ...placement }))
}

export type ExternalAssetPlacementMaterializer = {
  placeInstance: (
    instanceId: string,
    semanticEntryId: string,
    options: { x: number; y: number; z: number; scale: number; rotationY: number; sourceAssetId: string },
  ) => unknown | null | undefined
  hasInstance?: (instanceId: string) => boolean
  getInstanceSourceAssetId?: (instanceId: string) => string | null
  getInstanceSemanticEntryId?: (instanceId: string) => string | null
}

export type ExternalAssetPlacementMaterializationError = {
  instanceId: string
  message: string
}

export type ExternalAssetPlacementMaterializationResult = {
  remaining: ExternalAssetPlacementSnapshot[]
  restoredIds: string[]
  restoredCount: number
  errors: ExternalAssetPlacementMaterializationError[]
}

/**
 * Materialize only descriptors belonging to the explicitly imported source.
 * Failed materialization remains pending so a later retry cannot lose intent.
 */
export function materializeExternalAssetPlacements(
  runtime: ExternalAssetPlacementMaterializer,
  pending: ExternalAssetPlacementSnapshot[],
  sourceAssetId: string,
  semanticEntryId: string,
): ExternalAssetPlacementMaterializationResult {
  const remaining: ExternalAssetPlacementSnapshot[] = []
  const restoredIds: string[] = []
  const errors: ExternalAssetPlacementMaterializationError[] = []

  for (const placement of pending) {
    if (placement.sourceAssetId !== sourceAssetId ||
        placement.semanticEntryId !== semanticEntryId) {
      remaining.push({ ...placement })
      continue
    }

    try {
      const alreadyExists = runtime.hasInstance?.(placement.instanceId) ?? false
      if (alreadyExists) {
        const existingSourceId = runtime.getInstanceSourceAssetId?.(placement.instanceId)
        const existingSemanticId = runtime.getInstanceSemanticEntryId?.(placement.instanceId)
        if (existingSourceId !== sourceAssetId || existingSemanticId !== semanticEntryId) {
          throw new Error(
            'Existing instance ID is owned by a different asset source or semantic entry',
          )
        }
        restoredIds.push(placement.instanceId)
        continue
      }

      const instance = runtime.placeInstance(
        placement.instanceId,
        placement.semanticEntryId,
        {
          x: placement.x,
          y: placement.y,
          z: placement.z,
          scale: placement.scale,
          rotationY: placement.rotationY,
          sourceAssetId,
        },
      )
      if (instance || runtime.hasInstance?.(placement.instanceId)) {
        restoredIds.push(placement.instanceId)
      } else {
        remaining.push({ ...placement })
      }
    } catch (error) {
      // A persistence callback may fail after placeInstance has already
      // committed the object. Do not keep a duplicate pending descriptor
      // when the runtime confirms that the instance is present.
      const alreadyPublished = runtime.hasInstance?.(placement.instanceId) ?? false
      const publishedMatchesExpectedSource = alreadyPublished &&
        runtime.getInstanceSourceAssetId?.(placement.instanceId) === sourceAssetId &&
        runtime.getInstanceSemanticEntryId?.(placement.instanceId) === semanticEntryId
      if (publishedMatchesExpectedSource) restoredIds.push(placement.instanceId)
      else remaining.push({ ...placement })
      errors.push({
        instanceId: placement.instanceId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    remaining,
    restoredIds,
    restoredCount: restoredIds.length,
    errors,
  }
}
