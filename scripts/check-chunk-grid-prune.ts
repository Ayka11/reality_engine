import assert from 'node:assert/strict'
import { CHUNK_FLOATS, ChunkGrid, F, chunkKey } from '../src/core/ChunkGrid.ts'

const grid = new ChunkGrid()
const key = chunkKey(1, 2, 1)
grid.set(8, 16, 8, F.E, 0.005)
assert.ok(grid.chunks.has(key), 'test chunk should exist before pruning')
grid.dirtyChunks.clear()

const pruned = grid.prune(0.01)
assert.equal(pruned, 1, 'low-magnitude chunk should be pruned')
assert.equal(grid.chunks.has(key), false, 'pruned chunk should no longer be stored')
assert.ok(grid.dirtyChunks.has(key), 'pruned chunk key must be dirty so downstream consumers clear stale state')

console.log('ChunkGrid prune dirty-payload regression: PASS')

// Density is dimensionless and uses a lower sparse activity floor than energy.
// A small but resolvable density halo must be retained by active-cell iteration
// and must not be discarded by the generic 0.01 chunk-pruning threshold.
const densityGrid = new ChunkGrid()
const densityKey = chunkKey(1, 2, 1)
densityGrid.set(8, 16, 8, F.D, 0.00002)
assert.ok(densityGrid.chunks.has(densityKey), 'sub-0.001 density should allocate its destination chunk')
assert.equal([...densityGrid.activeCells()].length, 1,
  'a density-only cell above the density activity floor must remain active')
assert.equal(densityGrid.stats.activeCells, 1,
  'runtime active-cell statistics must use the same field-aware density threshold')
assert.equal(densityGrid.prune(0.01), 0,
  'chunk pruning must preserve resolvable density even when all values are below 0.01')
assert.ok(densityGrid.chunks.has(densityKey), 'density-only chunk should survive pruning')
console.log('ChunkGrid density sparse-floor/pruning regression: PASS')

// Activity is strictly greater than the configured epsilon everywhere. A
// value exactly on the boundary must not allocate an otherwise empty chunk.
const exactFloorGrid = new ChunkGrid()
exactFloorGrid.set(8, 16, 8, F.D, 1e-6)
assert.equal(exactFloorGrid.chunks.size, 0,
  'density exactly at the activity floor must not allocate a sparse chunk')
assert.equal(exactFloorGrid.stats.activeCells, 0,
  'density exactly at the activity floor must not count as an active cell')
const clearGrid = new ChunkGrid()
const clearedKey = chunkKey(3, 4, 2)
clearGrid.set(24, 32, 16, F.E, 10)
assert.ok(clearGrid.chunks.has(clearedKey), 'test chunk should exist before clear')
clearGrid.dirtyChunks.clear()

clearGrid.clear()
assert.equal(clearGrid.chunks.size, 0, 'clear should remove stored chunks')
assert.ok(clearGrid.dirtyChunks.has(clearedKey), 'clear must preserve a dirty tombstone for every removed chunk')

console.log('ChunkGrid clear dirty-payload regression: PASS')

const restoreGrid = new ChunkGrid()
const oldKey = chunkKey(2, 2, 2)
const newKey = chunkKey(4, 4, 1)
restoreGrid.set(16, 16, 16, F.E, 10)
restoreGrid.dirtyChunks.clear()
restoreGrid.restore([{ key: newKey, data: Array(CHUNK_FLOATS).fill(0) }])
assert.equal(restoreGrid.chunks.has(oldKey), false, 'snapshot restore should replace the prior chunk set')
assert.ok(restoreGrid.dirtyChunks.has(oldKey), 'snapshot restore must publish a tombstone for omitted old chunks')
assert.ok(restoreGrid.dirtyChunks.has(newKey), 'snapshot restore must publish the restored chunk')

console.log('ChunkGrid restore dirty-payload regression: PASS')
