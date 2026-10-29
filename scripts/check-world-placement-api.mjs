import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const renderer = await readFile(new URL('src/render/InfiniteWorldRenderer.ts', root), 'utf8')
const bootstrap = await readFile(new URL('src/infinityBootstrap.ts', root), 'utf8')

assert.match(
  renderer,
  /placeScaled\(kind: WorldObjectKind, x: number, z: number, scale = 1\)\s*\{\s*return this\.place\(kind, x, z, undefined, scale\)\s*\}/,
  'placeScaled must forward scale as argument five and leave terrain Y implicit',
)

const allowedLegacyCalls = new Set([
  'return this.place(kind, x, z, undefined, scale)',
  'return point ? this.place(kind, point.x, point.z, point.y, scale) : null',
])
const ambiguousRendererCalls = renderer
  .split('\n')
  .map(line => line.trim())
  .filter(line => line.includes('this.place(') && !allowedLegacyCalls.has(line))
assert.deepEqual(
  ambiguousRendererCalls,
  [],
  'internal generated placements must use placeScaled; only the wrapper and screen-picked Y may call place directly',
)

assert.ok(bootstrap.includes('world.placeScaled('), 'bootstrap-generated objects must use explicit scale semantics')
assert.equal(
  bootstrap.split('\n').filter(line => line.includes('world.place(')).length,
  0,
  'bootstrap must not pass scale as the legacy place() Y argument',
)

console.log('World placement API semantics regression: PASS')
