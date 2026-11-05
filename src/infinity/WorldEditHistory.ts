import type { WorldObject } from './WorldObject'

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
    this.undoStack.push(edit)
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack = []
  }

  undo(): WorldEdit | null {
    const edit = this.undoStack.pop()
    if (!edit) return null
    this.redoStack.push(edit)
    return edit
  }

  redo(): WorldEdit | null {
    const edit = this.redoStack.pop()
    if (!edit) return null
    this.undoStack.push(edit)
    return edit
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
    const undoStack = structuredClone(snapshot.undoStack)
    const redoStack = structuredClone(snapshot.redoStack)
    this.undoStack = undoStack
    this.redoStack = redoStack
  }

  get canUndo() { return this.undoStack.length > 0 }
  get canRedo() { return this.redoStack.length > 0 }
}
