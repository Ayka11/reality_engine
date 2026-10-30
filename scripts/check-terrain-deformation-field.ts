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

assert.equal(terrain.hasDeformationsInChunk(0, 0), true)
assert.equal(terrain.hasDeformationsInChunk(1, 0), false,
  'chunk-scoped deformation queries must not report unrelated chunks')

const boundaryField = new TerrainDeformationField('boundary-seed')
boundaryField.applyBrush(-32, 64, 1, 2, 'raise')
assert.equal(boundaryField.hasDeformationsInChunk(-1, 2), true,
  'negative chunk coordinates must use floor-based world-to-chunk mapping')
assert.equal(boundaryField.hasDeformationsInChunk(-2, 2), true,
  'brush samples crossing a chunk boundary must mark both touched chunks')
assert.equal(boundaryField.hasDeformationsInChunk(0, 2), false)
assert.throws(() => boundaryField.hasDeformationsInChunk(0, 0, 0), /positive chunk size/)

const afterRaise = terrain.serialize()
assert.equal(terrain.undo(), true)
assert.equal(terrain.size, 0)
assert.equal(terrain.sampleDelta(0, 0), 0)
assert.equal(terrain.redo(), true)
assert.equal(terrain.sampleDelta(0, 0), center)
assert.deepEqual(terrain.serialize(), afterRaise)

// Overlapping sparse transactions must undo/redo in LIFO order without reverting
// unrelated terrain cells introduced by later brush strokes.
const historyField = new TerrainDeformationField('history-seed')
historyField.applyBrush(0, 0, 2, 2, 'raise')
historyField.applyBrush(1, 0, 2, 1, 'raise')
const overlappingFinal = historyField.serialize()
assert.equal(historyField.undo(), true)
assert.ok(historyField.sampleDelta(0, 0) < overlappingFinal.deltas.find(([key]) => key === '0,0')?.[1]!)
assert.equal(historyField.undo(), true)
assert.equal(historyField.size, 0)
assert.equal(historyField.redo(), true)
assert.equal(historyField.redo(), true)
assert.deepEqual(historyField.serialize(), overlappingFinal)

terrain.applyBrush(0, 0, 2, 1, 'lower')
assert.ok(terrain.sampleDelta(0, 0) < center)
const snapshot = terrain.serialize()
const restored = new TerrainDeformationField('regression-seed')
restored.restore(snapshot)
assert.deepEqual(restored.serialize(), snapshot)
assert.equal(restored.sampleDelta(0, 0), terrain.sampleDelta(0, 0))
assert.throws(() => new TerrainDeformationField('other-seed').restore(snapshot), /schema or seed/)
assert.throws(() => restored.applyBrush(0, 0, 0, 1, 'raise'), /supported limits/)
assert.throws(() => restored.applyBrush(0, 0, 65, 1, 'raise'), /supported limits/,
  'public brush calls must not allow unbounded work beyond the UI-supported radius')
assert.throws(() => restored.applyBrush(0, 0, 2, 9, 'raise'), /supported limits/)
assert.throws(() => restored.applyBrush(Number.MAX_VALUE, 0, 2, 1, 'raise'), /supported limits/)
assert.throws(() => restored.restore({ version: 1, seed: 'regression-seed', deltas: [['bad', 1]] }), /invalid delta/)
assert.throws(() => restored.restore({ version: 1, seed: 'regression-seed', deltas: [['01,2', 1]] }), /invalid delta/,
  'snapshot keys must use canonical integer coordinates so every restored delta is sampleable')
assert.throws(() => restored.restore({ version: 1, seed: 'regression-seed', deltas: [['1,2', 1], ['1,2', 2]] }), /invalid delta/,
  'duplicate snapshot keys must be rejected instead of silently overriding prior deltas')
assert.throws(() => restored.restore({ version: 1, seed: 'regression-seed', deltas: [['1,2', 0], ['1,2', 2]] }), /invalid delta/,
  'duplicate keys must be rejected even when the first delta would be discarded as near-zero')

console.log('PASS: sparse terrain deformation, smooth interpolation, raise/lower, undo/redo, and validated persistence snapshot')
