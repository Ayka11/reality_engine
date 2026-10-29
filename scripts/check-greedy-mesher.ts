import assert from 'node:assert/strict'
import { buildGreedyChunkMesh } from '../src/render/GreedyMesher.ts'

const solid = (cells: Map<string, number>) => (x: number, y: number, z: number) =>
  cells.get(`${x},${y},${z}`) ?? 0

const single = buildGreedyChunkMesh({
  size: [1, 1, 1],
  sampleMaterial: solid(new Map([['0,0,0', 1]])),
})
assert.equal(single.quadCount, 6, 'single voxel has six exposed faces')
assert.equal(single.positions.length, 6 * 4 * 3)
assert.equal(single.normals.length, single.positions.length)
assert.equal(single.indices.length, 6 * 6)
assert.deepEqual(single.materialIds, [1, 1, 1, 1, 1, 1])

const pair = buildGreedyChunkMesh({
  size: [2, 1, 1],
  sampleMaterial: solid(new Map([['0,0,0', 1], ['1,0,0', 1]])),
})
assert.equal(pair.quadCount, 6, 'same-material adjacent voxels merge into six quads')

const mixed = buildGreedyChunkMesh({
  size: [2, 1, 1],
  sampleMaterial: solid(new Map([['0,0,0', 1], ['1,0,0', 2]])),
})
assert.equal(mixed.quadCount, 12, 'different materials retain both sides of their shared interface')
assert.equal(mixed.materialIds.length, 12)

const mixedOpaque = buildGreedyChunkMesh({
  size: [2, 1, 1],
  emitMaterialInterfaces: false,
  sampleMaterial: solid(new Map([['0,0,0', 1], ['1,0,0', 2]])),
})
assert.equal(mixedOpaque.quadCount, 10, 'opaque surfaces keep the differently colored outside faces but suppress their coincident interface')

const boundary = buildGreedyChunkMesh({
  size: [1, 1, 1],
  origin: [0, 0, 0],
  sampleMaterial: solid(new Map([['0,0,0', 1], ['1,0,0', 1]])),
})
assert.equal(boundary.quadCount, 5, 'neighboring chunk occupancy culls the shared boundary face')

const materialBoundary = buildGreedyChunkMesh({
  size: [1, 1, 1],
  origin: [0, 0, 0],
  sampleMaterial: solid(new Map([['0,0,0', 1], ['1,0,0', 2]])),
})
assert.equal(materialBoundary.quadCount, 6, 'legacy mode emits the local material side at a chunk boundary')
const materialBoundaryOpaque = buildGreedyChunkMesh({
  size: [1, 1, 1],
  origin: [0, 0, 0],
  emitMaterialInterfaces: false,
  sampleMaterial: solid(new Map([['0,0,0', 1], ['1,0,0', 2]])),
})
assert.equal(materialBoundaryOpaque.quadCount, 5, 'opaque surfaces cull any occupied neighbor across a chunk boundary')

const empty = buildGreedyChunkMesh({ size: [3, 2, 4], sampleMaterial: () => 0 })
assert.equal(empty.quadCount, 0, 'empty chunk emits no faces')

assert.throws(() => buildGreedyChunkMesh({ size: [0, 1, 1], sampleMaterial: () => 1 }), RangeError)
console.log('greedy mesher regression checks: PASS')
