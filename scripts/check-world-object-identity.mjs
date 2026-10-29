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
const managerSource = await readFile(new URL('src/infinity/ObjectManager.ts', root), 'utf8')
let managerJs = ts.transpileModule(managerSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
managerJs = managerJs
  .replaceAll("'./WorldObject'", `'${objectModuleUrl}'`)
  .replaceAll("'./WorldSeed'", `'${seedModuleUrl}'`)
const { WorldObjectManager } = await import(
  `data:text/javascript;base64,${Buffer.from(managerJs).toString('base64')}`
)

const manager = new WorldObjectManager()
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
console.log('World object identity/lifecycle regression: PASS')
