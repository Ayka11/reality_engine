import assert from 'node:assert/strict'
import { WORLD_CHUNK_SIZE } from '../src/infinity/WorldCoordinate.ts'
import { buildWaterSurfaceMeshData } from '../src/infinity/WaterSurfaceMesh.ts'

const cellCount = WORLD_CHUNK_SIZE * WORLD_CHUNK_SIZE
const dryChunk = { cx: 0, cz: 0, water: new Float32Array(cellCount) }
const dryMesh = buildWaterSurfaceMeshData(dryChunk, 16)
assert.equal(dryMesh.wetCellCount, 0, 'dry chunks must not create a water surface')
assert.equal(dryMesh.positions.length, 0)
assert.equal(dryMesh.indices.length, 0)

const partialMask = new Float32Array(cellCount)
partialMask[0] = 2
partialMask[1] = 0.25
partialMask[WORLD_CHUNK_SIZE] = 0.5
const partial = buildWaterSurfaceMeshData({ cx: -1, cz: 2, water: partialMask }, 16)
assert.equal(partial.wetCellCount, 3, 'only positive water-depth samples should generate cells')
assert.equal(partial.indices.length, 18, 'each wet cell must emit exactly two triangles')
assert.equal(partial.positions.length / 3, (WORLD_CHUNK_SIZE + 1) ** 2)
assert.equal(partial.positions[0], -WORLD_CHUNK_SIZE, 'negative chunk origins must be preserved')
assert.equal(partial.positions[2], WORLD_CHUNK_SIZE * 2, 'chunk z origin must be preserved')
for (let i = 1; i < partial.positions.length; i += 3) {
  assert.ok(Math.abs(partial.positions[i] - 16.05) < 1e-5, 'all water vertices must lie on sea level plus offset')
}
for (let i = 0; i < partial.indices.length; i += 3) {
  const ai = partial.indices[i] * 3
  const bi = partial.indices[i + 1] * 3
  const ci = partial.indices[i + 2] * 3
  const xs = [partial.positions[ai], partial.positions[bi], partial.positions[ci]]
  const zs = [partial.positions[ai + 2], partial.positions[bi + 2], partial.positions[ci + 2]]
  assert.ok(Math.max(...xs) - Math.min(...xs) <= 1, 'water triangles must not span dry neighboring cells')
  assert.ok(Math.max(...zs) - Math.min(...zs) <= 1, 'water triangles must stay within a 1x1 cell')
  const abx = partial.positions[bi] - partial.positions[ai]
  const abz = partial.positions[bi + 2] - partial.positions[ai + 2]
  const acx = partial.positions[ci] - partial.positions[ai]
  const acz = partial.positions[ci + 2] - partial.positions[ai + 2]
  const normalY = abz * acx - abx * acz
  assert.ok(normalY > 0, 'water triangles must face upward')
}

const oceanMask = new Float32Array(cellCount)
oceanMask.fill(1)
const ocean = buildWaterSurfaceMeshData({ cx: 3, cz: -2, water: oceanMask }, 16)
assert.equal(ocean.wetCellCount, cellCount)
assert.equal(ocean.indices.length, cellCount * 6, 'fully wet chunks must still use per-cell geometry')
assert.equal(ocean.indices.length / 6, cellCount, 'one chunk must not collapse to one giant water quad')

assert.throws(
  () => buildWaterSurfaceMeshData({ cx: 0, cz: 0, water: new Float32Array(4) }, 16),
  /Water mask length/,
)
const invalidMask = new Float32Array(cellCount)
invalidMask[7] = Number.NaN
assert.throws(() => buildWaterSurfaceMeshData({ cx: 0, cz: 0, water: invalidMask }, 16), /invalid depth/)

console.log('Water surface mask geometry tests: PASS')
