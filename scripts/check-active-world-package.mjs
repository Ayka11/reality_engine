import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const root = new URL('../', import.meta.url)
const cache = new Map()

async function load(path) {
  if (cache.has(path)) return cache.get(path)
  const source = await readFile(new URL(path, root), 'utf8')
  let js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const imports = [...js.matchAll(/from\s+["'](\.\/?[^"']+)["']/g)]
  for (const match of imports) {
    const specifier = match[1]
    const target = specifier.endsWith('.ts') ? specifier : specifier + '.ts'
    const childPath = path.split('/').slice(0, -1).concat(target).join('/')
    const child = await load(childPath)
    js = js.replace(match[0], match[0].replace(specifier, child))
  }
  const url = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
  cache.set(path, url)
  return url
}

const { encodeActiveWorldPackage, decodeActiveWorldPackage } =
  await import(await load('src/infinity/ActiveWorldPackage.ts'))

const dimensions = { width: 3, height: 2, fieldsPerCell: 3 }
const buffer = new Float32Array([
  0, 0, 0,
  1.25, 2, 3,
  0, 0, 0,
  -4, 0, 0,
  0, 0, 0,
  5, 6, 7,
])
const manifest = {
  version: '1.0',
  generatedAt: '2026-11-03T12:00:00.000Z',
  project: 'active-world-package-test',
  entries: [{
    id: 'asset.provider-oak.01',
    providerId: 'polyhaven',
    sourceUrl: 'https://polyhaven.com/a/oak',
    sourceAssetId: 'oak',
    name: 'Oak',
    license: 'CC0',
    attribution: 'Poly Haven',
    semanticEntryId: 'flora.tree',
    tags: ['tree', 'flora'],
  }],
}
const worldEditor = {
  version: 1,
  generator: { seed: 'package-seed', seaLevel: 16, maxElevation: 52 },
  surfaceProvider: {
    version: 1, kind: 'world-generator-surface', seed: 'package-seed',
    seaLevel: 16, maxElevation: 52,
  },
  assetManifest: manifest,
  objects: [],
  terrainDeformations: { version: 1, seed: 'package-seed', deltas: [] },
  authoritativeField: {
    schemaVersion: 'world-field-state-v2',
    providerId: 'authoritative-world-field',
    providerVersion: 'world-field-mutation-v1',
    version: 0,
    nextId: 1,
    mutations: [],
    globalOverlays: [],
  },
  provenance: {
    schemaVersion: 'reality-runtime-provenance-v1',
    traceId: 'trace-package-test',
    events: [],
  },
}

const encoded = encodeActiveWorldPackage({
  ...dimensions,
  tick: 17,
  buffer,
  causal: [{ tick: 12, x: 1, y: 0, delta: 2.5 }],
}, worldEditor)
const parsed = JSON.parse(encoded)
assert.equal(parsed.format, 're_v6')
assert.equal(parsed.version, 6)
assert.equal(parsed.tick, 17)
assert.equal(parsed.cells.length, 3, 'zero-only cells should be omitted from sparse package storage')
assert.deepEqual(parsed.worldEditor.assetManifest, manifest)

const decoded = decodeActiveWorldPackage(parsed, dimensions)
assert.equal(decoded.legacy, false)
assert.equal(decoded.tick, 17)
assert.deepEqual(decoded.buffer, buffer,
  'unified active package must restore every finite-grid value exactly')
assert.deepEqual(decoded.causal, [{ tick: 12, x: 1, y: 0, delta: 2.5 }],
  'unified active package must preserve finite-grid causal history')
assert.deepEqual(decoded.worldEditor, worldEditor,
  'unified active package must preserve the separate Infinite World editor snapshot')

const legacy = decodeActiveWorldPackage({
  format: 're_v5',
  W: dimensions.width,
  H: dimensions.height,
  NF: dimensions.fieldsPerCell,
  tick: 8,
  cells: [{ i: 1, d: [7, 8] }],
}, dimensions)
assert.equal(legacy.legacy, true)
assert.equal(legacy.tick, 8)
assert.deepEqual(Array.from(legacy.buffer.slice(3, 6)), [7, 8, 0],
  'legacy re_v5 partial cell fields must remain readable and pad new fields with zero')
assert.equal(legacy.worldEditor, undefined,
  'legacy finite-only packages must be explicitly identified as lacking Infinite World editor state')
assert.deepEqual(legacy.causal, [],
  'legacy finite-only packages must start with an empty causal history rather than inherit another world')

const invalidPackages = [
  [{ ...parsed, W: dimensions.width + 1 }, /dimensions/],
  [{ ...parsed, NF: dimensions.fieldsPerCell + 1 }, /field layout/],
  [{ ...parsed, tick: Number.MAX_SAFE_INTEGER + 1 }, /tick/],
  [{ ...parsed, tick: -1 }, /tick/],
  [{ ...parsed, cells: [...parsed.cells, parsed.cells[0]] }, /duplicate cell/],
  [{ ...parsed, cells: [{ i: dimensions.width * dimensions.height, d: [1, 2, 3] }] }, /invalid or duplicate cell/],
  [{ ...parsed, cells: [{ i: 0, d: [1, Number.NaN, 3] }] }, /invalid field vector/],
  [{ ...parsed, cells: [{ i: 0, d: [1, 2] }] }, /invalid field vector/],
  [{ ...parsed, worldEditor: undefined }, /missing its Infinite World editor snapshot/],
  [{ ...parsed, causal: [{ tick: 1, x: 999, y: 0, delta: 1 }] }, /causal history contains an invalid event/],
  [{ ...parsed, causal: [{ tick: 1, x: 1, y: 0, delta: Number.NaN }] }, /causal history contains an invalid event/],
  [{ ...parsed, worldEditor: { ...worldEditor, assetManifest: {
    ...manifest, entries: [{ ...manifest.entries[0], sourceUrl: 'javascript:alert(1)' }],
  } } }, /asset manifest is invalid/],
]
for (const [candidate, pattern] of invalidPackages) {
  assert.throws(() => decodeActiveWorldPackage(candidate, dimensions), pattern,
    'malformed active world package must be rejected before any live mutation')
}

assert.throws(() => decodeActiveWorldPackage({ ...parsed, H: 1 }, dimensions), /dimensions/)
assert.throws(() => encodeActiveWorldPackage({
  ...dimensions, tick: Number.MAX_SAFE_INTEGER + 1, buffer,
}, worldEditor), /tick/)
assert.throws(() => encodeActiveWorldPackage({
  ...dimensions, tick: 1, buffer: new Float32Array([Number.NaN, ...buffer.slice(1)]),
}, worldEditor), /non-finite/)
assert.throws(() => encodeActiveWorldPackage({
  ...dimensions, tick: 1, buffer: new Float32Array(1),
}, worldEditor), /buffer/)
assert.throws(() => encodeActiveWorldPackage({
  ...dimensions, tick: 1, buffer,
}, { ...worldEditor, assetManifest: {
  ...manifest, entries: [{ ...manifest.entries[0], license: 'UNKNOWN' }],
} }), /asset manifest is invalid/)

console.log('Active world package regression: PASS')
console.log('PASS: unified re_v6 grid + Infinite World snapshot round-trip')
console.log('PASS: legacy re_v5 finite-grid compatibility')
console.log('PASS: malformed dimensions, cells, ticks and asset provenance fail closed')
