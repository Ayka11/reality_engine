import assert from 'node:assert/strict'
import { buildGreedyChunkMesh } from '../src/render/GreedyMesher.ts'

const solid = (cells: Map<string, number>) => (x: number, y: number, z: number) =>
  cells.get(`${x},${y},${z}`) ?? 0

/** Check triangle winding against vertex normals and compute total triangle area. */
function assertConsistentWindingAndArea(
  mesh: ReturnType<typeof buildGreedyChunkMesh>,
  expectedArea: number,
  label: string,
): void {
  let area = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ia = mesh.indices[i] * 3;
    const ib = mesh.indices[i + 1] * 3;
    const ic = mesh.indices[i + 2] * 3;
    const abx = mesh.positions[ib] - mesh.positions[ia];
    const aby = mesh.positions[ib + 1] - mesh.positions[ia + 1];
    const abz = mesh.positions[ib + 2] - mesh.positions[ia + 2];
    const acx = mesh.positions[ic] - mesh.positions[ia];
    const acy = mesh.positions[ic + 1] - mesh.positions[ia + 1];
    const acz = mesh.positions[ic + 2] - mesh.positions[ia + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const normalOffset = ia;
    const dot = nx * mesh.normals[normalOffset] +
      ny * mesh.normals[normalOffset + 1] +
      nz * mesh.normals[normalOffset + 2];
    assert.ok(dot > 0, `${label}: triangle winding must agree with its outward normal`);
    area += Math.hypot(nx, ny, nz) / 2;
  }
  assert.ok(Math.abs(area - expectedArea) < 1e-9,
    `${label}: expected surface area ${expectedArea}, received ${area}`);
}

const single = buildGreedyChunkMesh({
  size: [1, 1, 1],
  sampleMaterial: solid(new Map([['0,0,0', 1]])),
})
assert.equal(single.quadCount, 6, 'single voxel has six exposed faces')
assert.equal(single.positions.length, 6 * 4 * 3)
assert.equal(single.normals.length, single.positions.length)
assert.equal(single.indices.length, 6 * 6)
assert.deepEqual(single.materialIds, [1, 1, 1, 1, 1, 1])
assertConsistentWindingAndArea(single, 6, 'single voxel')

const pair = buildGreedyChunkMesh({
  size: [2, 1, 1],
  sampleMaterial: solid(new Map([['0,0,0', 1], ['1,0,0', 1]])),
})
assert.equal(pair.quadCount, 6, 'same-material adjacent voxels merge into six quads')
assertConsistentWindingAndArea(pair, 10, 'same-material pair')

const mixed = buildGreedyChunkMesh({
  size: [2, 1, 1],
  sampleMaterial: solid(new Map([['0,0,0', 1], ['1,0,0', 2]])),
})
assert.equal(mixed.quadCount, 12, 'different materials retain both sides of their shared interface')
assert.equal(mixed.materialIds.length, 12)
assertConsistentWindingAndArea(mixed, 12, 'mixed-material pair')

const mixedOpaque = buildGreedyChunkMesh({
  size: [2, 1, 1],
  emitMaterialInterfaces: false,
  sampleMaterial: solid(new Map([['0,0,0', 1], ['1,0,0', 2]])),
})
assert.equal(mixedOpaque.quadCount, 10, 'opaque surfaces keep the differently colored outside faces but suppress their coincident interface')
assertConsistentWindingAndArea(mixedOpaque, 10, 'opaque mixed-material pair')

const boundary = buildGreedyChunkMesh({
  size: [1, 1, 1],
  origin: [0, 0, 0],
  sampleMaterial: solid(new Map([['0,0,0', 1], ['1,0,0', 1]])),
})
assert.equal(boundary.quadCount, 5, 'neighboring chunk occupancy culls the shared boundary face')
assertConsistentWindingAndArea(boundary, 5, 'cross-chunk occupied boundary')

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
