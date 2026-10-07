import type { MutableWorldFieldProvider, WorldFieldMutation } from './MutableWorldFieldProvider'

type FieldState = ReturnType<MutableWorldFieldProvider['serialize']>

export type AuthoritativeSculptTransaction = {
  transactionId: number
  mutationId: number
  mutation: WorldFieldMutation
  before: FieldState
  after: FieldState
}

export class AuthoritativeSculptTransactionCoordinator {
  private nextTransactionId = 1
  private undoStack: AuthoritativeSculptTransaction[] = []
  private redoStack: AuthoritativeSculptTransaction[] = []
  private readonly maxHistory: number

  constructor(
    private readonly field: MutableWorldFieldProvider,
    maxHistory = 50,
  ) {
    if (!Number.isInteger(maxHistory) || maxHistory < 1) {
      throw new Error('Authoritative sculpt history size must be a positive integer')
    }
    this.maxHistory = maxHistory
  }

  commit(apply: () => WorldFieldMutation): AuthoritativeSculptTransaction {
    const before = this.field.serialize()
    const mutation = apply()
    const after = this.field.serialize()

    const transaction: AuthoritativeSculptTransaction = {
      transactionId: this.nextTransactionId++,
      mutationId: mutation.id,
      mutation,
      before,
      after,
    }

    this.undoStack.push(transaction)
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift()
    this.redoStack = []
    return transaction
  }

  undo(): AuthoritativeSculptTransaction | null {
    const transaction = this.undoStack.pop()
    if (!transaction) return null
    this.field.restore(transaction.before)
    this.redoStack.push(transaction)
    return transaction
  }

  redo(): AuthoritativeSculptTransaction | null {
    const transaction = this.redoStack.pop()
    if (!transaction) return null
    this.field.restore(transaction.after)
    this.undoStack.push(transaction)
    return transaction
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }

  get historyLength(): number {
    return this.undoStack.length
  }

  get redoLength(): number {
    return this.redoStack.length
  }
}
