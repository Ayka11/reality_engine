import type { WorldObject } from './WorldObject'
import type { TerrainDeformationSnapshot } from './TerrainDeformationField'
import type { MutableWorldFieldProvider } from './MutableWorldFieldProvider'
import type { WorldSurfaceProviderSnapshot } from './WorldSurfaceProvider'
import type { WorldAssetImportManifest } from '../worldLibrary/AssetImportManifest'
import type { RuntimeProvenanceTrace } from './RuntimeProvenance'

/**
 * Portable state owned by InfiniteWorldRenderer, independently of the
 * finite SimulationEngine grid and its runtime subsystems.
 */
export interface WorldEditorSnapshot {
  version: 1
  generator: {
    seed: string
    seaLevel: number
    maxElevation: number
  }
  surfaceProvider: WorldSurfaceProviderSnapshot
  /** Provenance/licensing references only; package import never auto-fetches URLs. */
  assetManifest?: WorldAssetImportManifest
  objects: WorldObject[]
  terrainDeformations: TerrainDeformationSnapshot
  authoritativeField: ReturnType<MutableWorldFieldProvider['serialize']>
  /** Causal history for authored field/law/world-state changes. */
  provenance?: RuntimeProvenanceTrace
}
