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

// Metadata and elevation changes also go through the manager-owned index.
const scatteredUpdate = manager.update(second.id, {
  y: 71,
  properties: { origin: 'scatter', lawPenalty: 0.1 },
})
assert.ok(scatteredUpdate)
assert.equal(scatteredUpdate.properties.origin, 'scatter')
assert.equal(spatialIndex.queryRadius(96, 71, -96, 0).some(o => o.id === second.id), true,
  'metadata/elevation updates must refresh the index using the new position')
assert.equal(spatialIndex.queryRadius(96, 70, -96, 0).some(o => o.id === second.id), false)

// Manager AABB queries must use the spatial buckets and retain exact inclusive bounds.
const boundedObjects = manager.query({
  minX: 96, maxX: 96, minY: 71, maxY: 71, minZ: -96, maxZ: -96, kind: 'building',
})
assert.deepEqual(boundedObjects.map(object => object.id), [second.id],
  'AABB query must find the updated object at an exact positive/negative coordinate boundary')
assert.deepEqual(manager.query({ minX: 96, maxX: 96, minZ: -96, maxZ: -96 }).map(object => object.id), [second.id],
  'horizontal AABB queries must find objects across all vertical buckets in a selected column')
assert.equal(manager.query({ minX: secondOriginal.x, maxX: secondOriginal.x, minZ: secondOriginal.z, maxZ: secondOriginal.z })
  .some(object => object.id === second.id), false,
  'moving an object must remove its old horizontal-column membership')
const detachedBoundsResult = boundedObjects[0]
detachedBoundsResult.x = -123
assert.equal(manager.get(second.id)?.x, 96,
  'spatial-index-backed manager queries must continue returning detached snapshots')

const negativeChunkBoundary = manager.add({ ...placement, x: -32, y: -64, z: -32 })
assert.deepEqual(manager.query({
  minX: -32, maxX: -32, minY: -64, maxY: -64, minZ: -32, maxZ: -32,
}).map(object => object.id), [negativeChunkBoundary.id],
  'AABB query must preserve floor-based chunk mapping at negative chunk boundaries')
assert.deepEqual(manager.query({ minX: -32, maxX: -32, minZ: -32, maxZ: -32 }).map(object => object.id),
  [negativeChunkBoundary.id],
  'horizontal column lookup must retain negative chunk boundaries and ignore vertical partitioning')
const negativeOtherElevation = manager.add({ ...placement, x: -32, y: 0, z: -32 })
assert.deepEqual(manager.query({ minX: -32, maxX: -32, minZ: -32, maxZ: -32 })
  .map(object => object.id).sort(), [negativeChunkBoundary.id, negativeOtherElevation.id].sort(),
  'one horizontal column must return objects from multiple vertical chunks')
assert.equal(manager.remove(negativeChunkBoundary.id), true)
assert.deepEqual(manager.query({ minX: -32, maxX: -32, minZ: -32, maxZ: -32 }).map(object => object.id),
  [negativeOtherElevation.id],
  'removing the last object in one vertical bucket must not remove other buckets in the same column')
assert.equal(manager.remove(negativeOtherElevation.id), true)
assert.equal(manager.query({ minX: Number.NaN }).length, 0,
  'non-finite bounds must use the compatibility fallback and preserve comparison semantics')
assert.equal(manager.query({ minX: 1e308, maxX: 1e308, minZ: 1e308, maxZ: 1e308 }).length, 0,
  'finite but unsafe chunk coordinates must inspect occupied columns instead of incrementing an unrepresentable integer')

// Public index insertion must detach caller-owned inputs even though manager-owned snapshots are shared.
const externalIndexInput = {
  id: 'external-index-input', kind: 'rock', x: 12, y: 3, z: 14,
  rotationY: 0, scale: 1, seed: 0, properties: { source: 'caller' },
}
spatialIndex.upsert(externalIndexInput)
externalIndexInput.x = 1200
externalIndexInput.properties.source = 'mutated'
assert.equal(spatialIndex.queryRadius(12, 3, 14, 0).some(object => object.id === externalIndexInput.id), true,
  'public spatial-index insertion must detach mutable caller-owned input')
assert.equal(spatialIndex.queryRadius(1200, 3, 14, 0).some(object => object.id === externalIndexInput.id), false,
  'mutating a value passed to public upsert must not mutate the retained index snapshot')
spatialIndex.remove(externalIndexInput.id)

// Direct spatial-index reads must also be detached.
const indexedRead = spatialIndex.queryRadius(96, 71, -96, 0)[0]
assert.ok(indexedRead)
indexedRead.x = -500
indexedRead.properties.injected = true
assert.equal(spatialIndex.queryRadius(96, 71, -96, 0)[0]?.x, 96)
assert.equal(manager.get(second.id)?.properties.injected, undefined)

assert.throws(() => manager.updateTransform(second.id, { x: Number.NaN }), /finite transform/,
  'invalid transforms must be rejected before authoritative manager/index state changes')
assert.equal(manager.get(second.id)?.x, 96)
assert.equal(spatialIndex.queryRadius(96, 71, -96, 0).some(o => o.id === second.id), true)

assert.equal(manager.remove(second.id), true)
assert.equal(spatialIndex.size, 1, 'manager removal must clear only the removed object index entry')
assert.equal(spatialIndex.queryRadius(4, 2, -8, 0).some(o => o.id === first.id), true,
  'unrelated object index entries must survive removal')
manager.clear()
assert.equal(spatialIndex.size, 0, 'manager clear must clear spatial-index membership')
assert.equal(manager.query({ minX: 96, maxX: 96, minZ: -96, maxZ: -96 }).length, 0,
  'manager clear must also clear horizontal-column lookup state')
const rendererSource = await readFile(new URL('src/render/InfiniteWorldRenderer.ts', root), 'utf8')
assert.match(rendererSource, /readonly objects = new WorldObjectManager\(this\.objectSpatialIndex\)/,
  'renderer-owned object manager must update its spatial index as one transaction')
assert.match(managerSource, /this\.spatialIndex\.queryBounds\(query\)/,
  'manager AABB queries must use the shared spatial index instead of scanning all objects')
assert.match(managerSource, /this\.spatialIndex\?\.upsertManagedSnapshot\(object\)/,
  'manager add must share its private authoritative snapshot with the index without cloning it again')
assert.match(managerSource, /this\.spatialIndex\?\.upsertManagedSnapshot\(next\)/,
  'manager update must share its private authoritative snapshot with the index without cloning it again')

assert.doesNotMatch(rendererSource, /this\.objectSpatialIndex\.(?:upsert|remove|clear)\s*\(/,
  'renderer must not mutate spatial-index membership outside the manager-owned transaction path')
assert.match(rendererSource, /this\.objects\.updateTransform\(this\.selectedObjectId,\s*\{/,
  'gizmo transforms must commit through the object manager')
assert.match(rendererSource, /const object = this\.objects\.updateTransform\(this\.selectedObjectId, patch\)/,
  'programmatic object transforms must commit through the object manager')
assert.match(rendererSource, /const updated = this\.objects\.update\(object\.id,\s*\{/,
  'scattered object elevation/metadata must commit through the object manager');
assert.doesNotMatch(rendererSource, /object\.x\s*=\s*entry\.group\.position/,
  'gizmo updates must not mutate detached manager read snapshots')

console.log('World object identity, detached reads, and spatial-index ownership regression: PASS')
