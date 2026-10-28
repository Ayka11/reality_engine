import assert from 'node:assert/strict'
import { TerrainDeformationField } from '../src/infinity/TerrainDeformationField'

const terrain = new TerrainDeformationField('regression-seed')
assert.equal(terrain.sampleDelta(0, 0), 0)
assert.equal(terrain.applyBrush(0, 0, 2, 4, 'raise') > 0, true)
const center = terrain.sampleDelta(0, 0)
assert.ok(center > 3.9 && center <= 4)
assert.ok(terrain.sampleDelta(1, 0) > 0)
assert.equal(terrain.sampleDelta(2, 0), 0)
assert.equal(terrain.sampleDelta(0.5, 0), (terrain.sampleDelta(0, 0) + terrain.sampleDelta(1, 0)) / 2)

const afterRaise = terrain.serialize()
assert.equal(terrain.undo(), true)
assert.equal(terrain.size, 0)
assert.equal(terrain.sampleDelta(0, 0), 0)
assert.equal(terrain.redo(), true)
assert.equal(terrain.sampleDelta(0, 0), center)
assert.deepEqual(terrain.serialize(), afterRaise)

terrain.applyBrush(0, 0, 2, 1, 'lower')
assert.ok(terrain.sampleDelta(0, 0) < center)
const snapshot = terrain.serialize()
const restored = new TerrainDeformationField('regression-seed')
restored.restore(snapshot)
assert.deepEqual(restored.serialize(), snapshot)
assert.equal(restored.sampleDelta(0, 0), terrain.sampleDelta(0, 0))
assert.throws(() => new TerrainDeformationField('other-seed').restore(snapshot), /schema or seed/)
assert.throws(() => restored.applyBrush(0, 0, 0, 1, 'raise'), /finite and positive/)
assert.throws(() => restored.restore({ version: 1, seed: 'regression-seed', deltas: [['bad', 1]] }), /invalid delta/)

console.log('PASS: sparse terrain deformation, smooth interpolation, raise/lower, undo/redo, and validated persistence snapshot')
