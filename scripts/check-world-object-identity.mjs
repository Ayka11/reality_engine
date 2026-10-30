import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const root = new URL('../', import.meta.url)

async function transpiledModuleUrl(path) {
  const source = await readFile(new URL(path, root), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
}

const objectModuleUrl = await transpiledModuleUrl('src/infinity/WorldObject.ts')
const seedModuleUrl = await transpiledModuleUrl('src/infinity/WorldSeed.ts')
const coordinateModuleUrl = await transpiledModuleUrl('src/infinity/WorldCoordinate.ts')

const spatialIndexSource = await readFile(new URL('src/infinity/WorldObjectSpatialIndex.ts', root), 'utf8')
let spatialIndexJs = ts.transpileModule(spatialIndexSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
spatialIndexJs = spatialIndexJs
  .replaceAll("'./WorldObject'", `'${objectModuleUrl}'`)
  .replaceAll("'./WorldCoordinate'", `'${coordinateModuleUrl}'`)
const spatialIndexModuleUrl = `data:text/javascript;base64,${Buffer.from(spatialIndexJs).toString('base64')}`
const { WorldObjectSpatialIndex } = await import(spatialIndexModuleUrl)
const managerSource = await readFile(new URL('src/infinity/ObjectManager.ts', root), 'utf8')
let managerJs = ts.transpileModule(managerSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
managerJs = managerJs
  .replaceAll("'./WorldObject'", `'${objectModuleUrl}'`)
  .replaceAll("'./WorldSeed'", `'${seedModuleUrl}'`)
  .replaceAll("'./WorldObjectSpatialIndex'", `'${spatialIndexModuleUrl}'`)
const { WorldObjectManager } = await import(
  `data:text/javascript;base64,${Buffer.from(managerJs).toString('base64')}`
)

const spatialIndex = new WorldObjectSpatialIndex()
const manager = new WorldObjectManager(spatialIndex)
const placement = {
  kind: 'building', x: 4, y: 2, z: -8,
  rotationY: 0, scale: 1, seed: 0, properties: {},
}

const first = manager.add(placement)
const second = manager.add(placement)
assert.notEqual(first.id, second.id, 'two new objects at identical coordinates must not overwrite each other')
assert.equal(manager.size, 2)
assert.equal(manager.get(first.id)?.id, first.id)
assert.equal(manager.get(second.id)?.id, second.id)

const moved = { ...first, x: 40, y: 7, z: -20 }
assert.throws(
  () => manager.add(moved),
  /World object ID collision/,
  'restoring an ID already owned by a different live object must fail closed',
)

assert.equal(manager.remove(first.id), true)
const movedRestored = manager.add(moved)
assert.equal(movedRestored.id, first.id, 'moving/restoring an object must preserve its original identity')
assert.equal(manager.get(first.id)?.x, 40)
assert.equal(manager.get(first.id)?.z, -20)

assert.equal(manager.remove(first.id), true)
const undoRestored = manager.add(first)
assert.equal(undoRestored.id, first.id, 'undo/redo payloads must retain the object ID')
assert.equal(manager.size, 2, 'restoring one object must not remove a colocated object')

const ids = manager.values().map(object => object.id)
assert.equal(new Set(ids).size, ids.length, 'live object IDs must remain unique')

// Every public read path must return a detached value, including nested metadata.
const beforeDetachedReads = manager.get(second.id)
assert.ok(beforeDetachedReads)
const exposedAddResult = second
exposedAddResult.x = 900
exposedAddResult.properties.injected = true
const exposedGetResult = manager.get(second.id)
assert.ok(exposedGetResult)
exposedGetResult.y = 901
exposedGetResult.properties.injected = true
const exposedQueryResult = manager.query({ kind: 'building' })[0]
assert.ok(exposedQueryResult)
exposedQueryResult.z = 902
exposedQueryResult.properties.injected = true
const exposedValuesResult = manager.values()[0]
exposedValuesResult.scale = 99
exposedValuesResult.properties.injected = true
assert.deepEqual(manager.get(second.id), beforeDetachedReads,
  'add/get/query/values results must not expose authoritative object references')

// Manager updates are the sole transform path and move index membership atomically.
const secondOriginal = manager.get(second.id)
assert.ok(secondOriginal)
assert.equal(spatialIndex.queryRadius(secondOriginal.x, secondOriginal.y, secondOriginal.z, 0).some(o => o.id === second.id), true)
const movedSecond = manager.updateTransform(second.id, { x: 96, y: 70, z: -96, rotationY: 1.25, scale: 2 })
assert.ok(movedSecond)
assert.equal(movedSecond.x, 96)
assert.equal(spatialIndex.queryRadius(96, 70, -96, 0).some(o => o.id === second.id), true,
  'manager transform updates must move the spatial index entry')
assert.equal(spatialIndex.queryRadius(secondOriginal.x, secondOriginal.y, secondOriginal.z, 0).some(o => o.id === second.id), false,
  'previous spatial bucket must no longer return the moved object')

// Direct spatial-index reads must also be detached.
const indexedRead = spatialIndex.queryRadius(96, 70, -96, 0)[0]
assert.ok(indexedRead)
indexedRead.x = -500
indexedRead.properties.injected = true
assert.equal(spatialIndex.queryRadius(96, 70, -96, 0)[0]?.x, 96)
assert.equal(manager.get(second.id)?.properties.injected, undefined)

assert.throws(() => manager.updateTransform(second.id, { x: Number.NaN }), /finite transform/,
  'invalid transforms must be rejected before authoritative manager/index state changes')
assert.equal(manager.get(second.id)?.x, 96)
assert.equal(spatialIndex.queryRadius(96, 70, -96, 0).some(o => o.id === second.id), true)

assert.equal(manager.remove(second.id), true)
assert.equal(spatialIndex.size, 1, 'manager removal must clear only the removed object index entry')
assert.equal(spatialIndex.queryRadius(4, 2, -8, 0).some(o => o.id === first.id), true,
  'unrelated object index entries must survive removal')
manager.clear()
assert.equal(spatialIndex.size, 0, 'manager clear must clear spatial-index membership')
const rendererSource = await readFile(new URL('src/render/InfiniteWorldRenderer.ts', root), 'utf8')
assert.match(rendererSource, /readonly objects = new WorldObjectManager\(this\.objectSpatialIndex\)/,
  'renderer-owned object manager must update its spatial index as one transaction')
assert.match(rendererSource, /this\.objects\.updateTransform\(this\.selectedObjectId,\s*\{/,
  'gizmo transforms must commit through the object manager')
assert.match(rendererSource, /const object = this\.objects\.updateTransform\(this\.selectedObjectId, patch\)/,
  'programmatic object transforms must commit through the object manager')
assert.doesNotMatch(rendererSource, /object\.x\s*=\s*entry\.group\.position/,
  'gizmo updates must not mutate detached manager read snapshots')

console.log('World object identity, detached reads, and spatial-index ownership regression: PASS')
