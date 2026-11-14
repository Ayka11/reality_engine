import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/infinity/WorldEditHistory.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { WorldEditHistory } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
)

const object = {
  id: 'building:1:2:3',
  kind: 'building',
  x: 1, y: 2, z: 3,
  rotationY: 0, scale: 1, seed: 7,
  properties: { owner: 'original', level: 1 },
}

const history = new WorldEditHistory()
const submitted = { type: 'add', object }
history.push(submitted)

// A caller retaining the edit or object passed to push must not mutate history.
object.properties.owner = 'mutated-after-push'
submitted.object.properties.level = 99

const undone = history.undo()
assert.ok(undone)
assert.equal(undone.object.properties.owner, 'original')
assert.equal(undone.object.properties.level, 1)

// undo() returns a detached edit; mutating its nested object must not poison redo.
undone.object.properties.owner = 'mutated-undo-result'
undone.object.x = 500

const redone = history.redo()
assert.ok(redone)
assert.equal(redone.object.properties.owner, 'original')
assert.equal(redone.object.x, 1)

// redo() also returns a detached value, not the object retained by the undo stack.
redone.object.properties.level = 777
const undoneAgain = history.undo()
assert.ok(undoneAgain)
assert.equal(undoneAgain.object.properties.level, 1)

// Transform edits detach both before/after snapshots and both returned branches.
const before = { ...object, properties: { nested: 'before' } }
const after = { ...object, x: 10, properties: { nested: 'after' } }
history.push({ type: 'transform', before, after })
before.properties.nested = 'changed-before-push'
after.properties.nested = 'changed-after-push'
const transformUndo = history.undo()
assert.ok(transformUndo)
assert.equal(transformUndo.before.properties.nested, 'before')
assert.equal(transformUndo.after.properties.nested, 'after')
transformUndo.before.properties.nested = 'mutated-return'
const transformRedo = history.redo()
assert.ok(transformRedo)
assert.equal(transformRedo.before.properties.nested, 'before')

// Checkpoint output and restored state must be detached in both directions.
const checkpoint = history.snapshotState()
checkpoint.undoStack[0].object.properties.owner = 'mutated-checkpoint'
const current = history.undo()
assert.ok(current)
assert.equal(current.object.properties.owner, 'original')
current.object.properties.owner = 'mutated-undo-again'
history.redo()

const restored = new WorldEditHistory()
restored.restoreState(checkpoint)
checkpoint.undoStack[0].object.properties.owner = 'mutated-after-restore'
const restoredUndo = restored.undo()
assert.ok(restoredUndo)
assert.equal(restoredUndo.object.properties.owner, 'mutated-checkpoint')

// Invalid entries are rejected without replacing the previously installed history.
const stable = restored.snapshotState()
assert.throws(() => restored.restoreState({
  undoStack: [{ type: 'unknown' }],
  redoStack: [],
}), /Invalid world edit history entry/)
assert.deepEqual(restored.snapshotState(), stable)

console.log('World edit history ownership and undo/redo alias regression: PASS')
