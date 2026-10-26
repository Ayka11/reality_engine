import { WORLD_CHUNK_SIZE } from './WorldCoordinate'

export type WaterMaskChunk = Readonly<{
  cx: number
  cz: number
  water: Float32Array
}>

export type WaterSurfaceMeshData = {
  positions: Float32Array
  indices: number[]
  wetCellCount: number
}

/**
 * Build a sea-level surface only for cells marked wet by WorldGenerator.
 * Each wet sample emits one 1x1 cell quad; dry cells produce no triangles.
 */
export function buildWaterSurfaceMeshData(
  chunk: WaterMaskChunk,
  seaLevel: number,
  surfaceOffset = 0.05,
): WaterSurfaceMeshData {
  const size = WORLD_CHUNK_SIZE
  if (chunk.water.length !== size * size) {
    throw new RangeError('Water mask length does not match WORLD_CHUNK_SIZE')
  }
  if (!Number.isFinite(seaLevel) || !Number.isFinite(surfaceOffset) || surfaceOffset < 0) {
    throw new RangeError('Water surface height and offset must be finite')
  }

  let wetCellCount = 0
  for (const depth of chunk.water) {
    if (!Number.isFinite(depth) || depth < 0) {
      throw new RangeError('Water mask contains an invalid depth')
    }
    if (depth > 0) wetCellCount++
  }
  if (wetCellCount === 0) {
    return { positions: new Float32Array(0), indices: [], wetCellCount: 0 }
  }

  const side = size + 1
  const positions = new Float32Array(side * side * 3)
  const originX = chunk.cx * size
  const originZ = chunk.cz * size
  const surfaceY = seaLevel + surfaceOffset
  for (let z = 0; z <= size; z++) {
    for (let x = 0; x <= size; x++) {
      const vertex = (z * side + x) * 3
      positions[vertex] = originX + x
      positions[vertex + 1] = surfaceY
      positions[vertex + 2] = originZ + z
    }
  }

  const indices: number[] = []
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      if (chunk.water[z * size + x] <= 0) continue
      const a = z * side + x
      const b = a + 1
      const c = a + side
      const d = c + 1
      // Upward winding, consistent with the terrain patch geometry.
      indices.push(a, c, b, b, c, d)
    }
  }
  return { positions, indices, wetCellCount }
}
