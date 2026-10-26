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
