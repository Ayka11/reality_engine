import { cloneWorldObject, type WorldObject } from './WorldObject'

function cloneEdit(edit: WorldEdit): WorldEdit {
  if (!edit || typeof edit !== 'object') {
    throw new TypeError('Invalid world edit history entry')
  }
  switch (edit.type) {
    case 'add':
    case 'remove':
      return { type: edit.type, object: cloneWorldObject(edit.object) }
    case 'transform':
      return {
        type: 'transform',
        before: cloneWorldObject(edit.before),
        after: cloneWorldObject(edit.after),
      }
    default:
      throw new TypeError('Invalid world edit history entry type')
  }
}

export type WorldEdit =
  | { type: 'add'; object: WorldObject }
  | { type: 'remove'; object: WorldObject }
  | { type: 'transform'; before: WorldObject; after: WorldObject }

export type WorldEditHistorySnapshot = {
  undoStack: WorldEdit[]
  redoStack: WorldEdit[]
}

export class WorldEditHistory {
  private undoStack: WorldEdit[] = []
  private redoStack: WorldEdit[] = []
  private readonly limit: number

  constructor(limit = 200) {
    this.limit = Math.max(1, limit)
  }

  push(edit: WorldEdit) {
    this.undoStack.push(cloneEdit(edit))
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack = []
  }

  undo(): WorldEdit | null {
    const edit = this.undoStack.pop()
    if (!edit) return null
    this.redoStack.push(edit)
    return cloneEdit(edit)
  }

  redo(): WorldEdit | null {
    const edit = this.redoStack.pop()
    if (!edit) return null
    this.undoStack.push(edit)
    return cloneEdit(edit)
  }

  clear() {
    this.undoStack = []
    this.redoStack = []
  }

  snapshotState(): WorldEditHistorySnapshot {
    return structuredClone({
      undoStack: this.undoStack,
      redoStack: this.redoStack,
    })
  }

  restoreState(snapshot: WorldEditHistorySnapshot): void {
    if (!snapshot || !Array.isArray(snapshot.undoStack) || !Array.isArray(snapshot.redoStack) ||
        snapshot.undoStack.length > this.limit || snapshot.redoStack.length > this.limit) {
      throw new TypeError('Invalid world edit history checkpoint')
    }
    const undoStack = snapshot.undoStack.map(cloneEdit)
    const redoStack = snapshot.redoStack.map(cloneEdit)
    this.undoStack = undoStack
    this.redoStack = redoStack
  }

  get canUndo() { return this.undoStack.length > 0 }
  get canRedo() { return this.redoStack.length > 0 }
}
