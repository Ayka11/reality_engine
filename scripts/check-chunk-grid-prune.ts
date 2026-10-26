import assert from 'node:assert/strict'
import { ChunkGrid, F, chunkKey } from '../src/core/ChunkGrid.ts'

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
const clearGrid = new ChunkGrid()
const clearedKey = chunkKey(3, 4, 2)
clearGrid.set(24, 32, 16, F.E, 10)
assert.ok(clearGrid.chunks.has(clearedKey), 'test chunk should exist before clear')
clearGrid.dirtyChunks.clear()

clearGrid.clear()
assert.equal(clearGrid.chunks.size, 0, 'clear should remove stored chunks')
assert.ok(clearGrid.dirtyChunks.has(clearedKey), 'clear must preserve a dirty tombstone for every removed chunk')

console.log('ChunkGrid clear dirty-payload regression: PASS')
