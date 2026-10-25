import assert from 'node:assert/strict'
import { buildSurfaceNetsMesh } from '../src/render/SurfaceNetsMesher.ts'

const singlePoint = buildSurfaceNetsMesh({
  size: [1, 1, 1],
  isoLevel: 0.5,
  sampleValue: (x, y, z) => x === 0 && y === 0 && z === 0 ? 1 : 0,
})
assert.equal(singlePoint.quadCount, 6, 'one isolated high sample has six surrounding quads')
assert.equal(singlePoint.positions.length / 3, 8, 'one isolated sample produces one vertex per crossed cube')
assert.equal(singlePoint.indices.length, 36, 'six quads produce twelve triangles')
assert.equal(singlePoint.normals.length, singlePoint.positions.length)
assert.equal(singlePoint.fieldValues.length, singlePoint.positions.length / 3)
assert.ok(singlePoint.positions.every(Number.isFinite), 'positions must remain finite')
assert.ok(singlePoint.normals.every(Number.isFinite), 'normals must remain finite')
for (let i = 0; i < singlePoint.normals.length; i += 3) {
  const length = Math.hypot(
    singlePoint.normals[i],
    singlePoint.normals[i + 1],
    singlePoint.normals[i + 2],
  )
  assert.ok(Math.abs(length - 1) < 1e-9, 'surface normals must be normalized')
}

const empty = buildSurfaceNetsMesh({
  size: [3, 2, 4],
  isoLevel: 0.5,
  sampleValue: () => 0,
})
assert.equal(empty.quadCount, 0, 'a field below the isovalue emits no surface')
assert.equal(empty.positions.length, 0)
assert.equal(empty.indices.length, 0)

const plane = buildSurfaceNetsMesh({
  size: [4, 3, 2],
  isoLevel: 1.5,
  sampleValue: x => x,
})
assert.equal(plane.quadCount, 6, 'a planar crossing has one quad per crossed lattice edge')
assert.equal(plane.positions.length / 3, 12, 'the planar surface shares one vertex per active cube')
for (let i = 0; i < plane.positions.length; i += 3) {
  assert.ok(Math.abs(plane.positions[i] - 1.5) < 1e-9, 'plane vertices lie on the isovalue')
}
for (let i = 0; i < plane.indices.length; i += 3) {
  const a = plane.indices[i] * 3
  const b = plane.indices[i + 1] * 3
  const c = plane.indices[i + 2] * 3
  const abx = plane.positions[b] - plane.positions[a]
  const aby = plane.positions[b + 1] - plane.positions[a + 1]
  const abz = plane.positions[b + 2] - plane.positions[a + 2]
  const acx = plane.positions[c] - plane.positions[a]
  const acy = plane.positions[c + 1] - plane.positions[a + 1]
  const acz = plane.positions[c + 2] - plane.positions[a + 2]
  const normalX = aby * acz - abz * acy
  assert.ok(normalX < -1e-9, 'plane triangles must face toward the below-isovalue side')
}

const translated = buildSurfaceNetsMesh({
  size: [1, 1, 1],
  origin: [10, 20, 30],
  isoLevel: 0.5,
  sampleValue: (x, y, z) => x === 10 && y === 20 && z === 30 ? 1 : 0,
})
assert.equal(translated.quadCount, singlePoint.quadCount)
assert.deepEqual(translated.positions, singlePoint.positions, 'origin offsets samples but keeps mesh positions local')

assert.throws(() => buildSurfaceNetsMesh({
  size: [0, 1, 1], isoLevel: 0.5, sampleValue: () => 1,
}), RangeError)
assert.throws(() => buildSurfaceNetsMesh({
  size: [1, 1, 1], isoLevel: Number.NaN, sampleValue: () => 1,
}), RangeError)
assert.throws(() => buildSurfaceNetsMesh({
  size: [1, 1, 1], isoLevel: 0.5, sampleValue: () => Number.NaN,
}), RangeError)

console.log(JSON.stringify({
  status: 'PASS',
  singlePoint: { vertices: singlePoint.positions.length / 3, quads: singlePoint.quadCount, triangles: singlePoint.indices.length / 3 },
  plane: { vertices: plane.positions.length / 3, quads: plane.quadCount, triangles: plane.indices.length / 3 },
  empty: { vertices: empty.positions.length / 3, quads: empty.quadCount },
}))
