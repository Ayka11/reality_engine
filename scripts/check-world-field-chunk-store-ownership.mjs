import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/infinity/WorldFieldChunkStore.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { WorldFieldChunkStore } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
)

const provider = {
  id: 'test-provider',
  version: 'test-v1',
  sample: () => ({ energy: 1, density: 0, information: 0, entropy: 0, temperature: 0, biology: 0, material: 0 }),
}
const evicted = []
const store = new WorldFieldChunkStore(2, chunk => evicted.push(chunk))

const inserted = store.set({ cx: 1, cy: 2, cz: 3 }, 'seed-a', provider, 7)
inserted.coord.cx = 900
inserted.coord.cy = 901
inserted.seed = 'caller-mutated'
inserted.version = 999
inserted.provider = { ...provider, id: 'replaced-provider' }

const afterSetMutation = store.get({ cx: 1, cy: 2, cz: 3 })
assert.ok(afterSetMutation)
assert.deepEqual(afterSetMutation.coord, { cx: 1, cy: 2, cz: 3 })
assert.equal(afterSetMutation.seed, 'seed-a')
assert.equal(afterSetMutation.version, 7)
assert.equal(afterSetMutation.provider, provider, 'provider service identity remains shared intentionally')

// A get() result must be detached too, including nested coordinates and record fields.
afterSetMutation.coord.cz = -500
afterSetMutation.seed = 'mutated-get'
afterSetMutation.version = 0
const afterGetMutation = store.get({ cx: 1, cy: 2, cz: 3 })
assert.ok(afterGetMutation)
assert.deepEqual(afterGetMutation.coord, { cx: 1, cy: 2, cz: 3 })
assert.equal(afterGetMutation.seed, 'seed-a')
assert.equal(afterGetMutation.version, 7)

// Mutating an eviction callback payload must not mutate another retained entry.
store.set({ cx: 4, cy: 5, cz: 6 }, 'seed-b', provider)
store.set({ cx: 7, cy: 8, cz: 9 }, 'seed-c', provider)
assert.equal(evicted.length, 1)
evicted[0].coord.cx = -1000
evicted[0].seed = 'mutated-eviction-payload'
const retained = store.get({ cx: 7, cy: 8, cz: 9 })
assert.ok(retained)
assert.deepEqual(retained.coord, { cx: 7, cy: 8, cz: 9 })
assert.equal(retained.seed, 'seed-c')
assert.equal(store.stats().loaded, 2)

console.log('World field chunk store detached-record ownership regression: PASS')
