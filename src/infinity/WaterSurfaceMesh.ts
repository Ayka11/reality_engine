import { WORLD_CHUNK_SIZE } from './WorldCoordinate'

export type WaterMaskChunk = Readonly<{
  cx: number
  cz: number
  water: Float32Array
}>


export type WaterDepthFromHeightFieldOptions = Readonly<{
  cx: number
  cz: number
  seaLevel: number
  sampleHeight: (x: number, z: number) => number
}>

/**
 * Rebuild a sea-plane water mask from the current terrain heightfield.
 * This is required after sculpting: cached generator masks describe the
 * unedited baseline and otherwise leave water covering raised land or fail
 * to flood newly lowered cells.
 */
export function buildWaterDepthMaskFromHeightField(
  options: WaterDepthFromHeightFieldOptions,
): Float32Array {
  const { cx, cz, seaLevel, sampleHeight } = options
  if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cz) ||
      !Number.isFinite(seaLevel) || typeof sampleHeight !== 'function') {
    throw new TypeError('Water depth mask requires safe chunk coordinates, a finite sea level, and a height sampler')
  }

  const originX = cx * WORLD_CHUNK_SIZE
  const originZ = cz * WORLD_CHUNK_SIZE
  if (!Number.isSafeInteger(originX) || !Number.isSafeInteger(originZ)) {
    throw new RangeError('Water depth mask chunk origin exceeds safe world coordinates')
  }

  const water = new Float32Array(WORLD_CHUNK_SIZE * WORLD_CHUNK_SIZE)
  for (let z = 0; z < WORLD_CHUNK_SIZE; z++) {
    for (let x = 0; x < WORLD_CHUNK_SIZE; x++) {
      const height = sampleHeight(originX + x, originZ + z)
      if (!Number.isFinite(height)) {
        throw new RangeError(`Water depth sampler returned a non-finite height at (${originX + x}, ${originZ + z})`)
      }
      const depth = Math.max(0, seaLevel - height)
      if (!Number.isFinite(depth)) {
        throw new RangeError('Water depth calculation produced a non-finite value')
      }
      water[z * WORLD_CHUNK_SIZE + x] = depth
    }
  }
  return water
}

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
