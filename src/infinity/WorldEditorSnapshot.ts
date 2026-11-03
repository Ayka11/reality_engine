import type { WorldObject } from './WorldObject'
import type { TerrainDeformationSnapshot } from './TerrainDeformationField'
import type { MutableWorldFieldProvider } from './MutableWorldFieldProvider'
import type { WorldSurfaceProviderSnapshot } from './WorldSurfaceProvider'

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
  objects: WorldObject[]
  terrainDeformations: TerrainDeformationSnapshot
  authoritativeField: ReturnType<MutableWorldFieldProvider['serialize']>
}
