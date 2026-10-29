import type { MutableWorldFieldProvider, WorldFieldMutation } from './MutableWorldFieldProvider'

type FieldState = ReturnType<MutableWorldFieldProvider['serialize']>

function assertSynchronousCallback(callback: () => unknown): void {
  const prototype = Object.getPrototypeOf(callback) as { constructor?: { name?: string } } | null
  const constructorName = prototype?.constructor?.name ?? ''
  const source = Function.prototype.toString.call(callback)
  const asyncSource = /^\s*async\b/.test(source)
  const generatorSource = /^\s*(?:function\s*\*|\*\s*[\w$]*\s*\()/.test(source)
  if (
    constructorName === 'AsyncFunction' ||
    constructorName === 'AsyncGeneratorFunction' ||
    constructorName === 'GeneratorFunction' ||
    asyncSource ||
    generatorSource
  ) {
    throw new TypeError('Authoritative sculpt transaction callback must remain synchronous')
  }
}

function isThenable(value: unknown): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
  return typeof (value as { then?: unknown }).then === 'function'
}

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
    let mutation: WorldFieldMutation
    let after: FieldState
    try {
      if (typeof apply !== 'function') {
        throw new TypeError('Authoritative sculpt transaction requires a synchronous callback')
      }
      assertSynchronousCallback(apply)
      const result: unknown = apply()
      if (isThenable(result)) {
        throw new TypeError('Authoritative sculpt transaction callback must remain synchronous')
      }
      if (!result || typeof result !== 'object' ||
          !Number.isInteger((result as { id?: unknown }).id) ||
          (result as { id: number }).id < 1) {
        throw new TypeError('Authoritative sculpt transaction callback must return the newly committed mutation')
      }

      after = this.field.serialize()
      const latest = after.mutations[after.mutations.length - 1]
      const previousLatest = before.mutations[before.mutations.length - 1]
      if (!latest || latest.id <= (previousLatest?.id ?? 0) ||
          latest.id !== (result as { id: number }).id) {
        throw new TypeError('Authoritative sculpt transaction callback must return the newly committed mutation')
      }
      // Retain the authoritative committed record, not a caller-owned result object.
      mutation = structuredClone(latest)
    } catch (error) {
      // Roll back synchronous partial writes for throws, invalid returns, and thenables.
      try {
        if (JSON.stringify(this.field.serialize()) !== JSON.stringify(before)) {
          this.field.restore(before)
        }
      } catch (rollbackError) {
        const originalMessage = error instanceof Error ? error.message : String(error)
        const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        throw new AggregateError(
          [error, rollbackError],
          `Sculpt commit failed (${originalMessage}) and rollback failed (${rollbackMessage})`,
        )
      }
      throw error
    }

    const transaction: AuthoritativeSculptTransaction = structuredClone({
      transactionId: this.nextTransactionId,
      mutationId: mutation.id,
      mutation,
      before,
      after,
    })
    this.nextTransactionId++
    this.undoStack.push(transaction)
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift()
    this.redoStack = []
    // Never expose the same object stored in undo history to callers.
    return structuredClone(transaction)
  }

  undo(): AuthoritativeSculptTransaction | null {
    const transaction = this.undoStack[this.undoStack.length - 1]
    if (!transaction) return null
    // Do not restore a stale snapshot over mutations made outside this coordinator.
    if (JSON.stringify(this.field.serialize()) !== JSON.stringify(transaction.after)) return null
    this.undoStack.pop()
    this.field.restore(transaction.before)
    this.redoStack.push(transaction)
    return structuredClone(transaction)
  }

  redo(): AuthoritativeSculptTransaction | null {
    const transaction = this.redoStack[this.redoStack.length - 1]
    if (!transaction) return null
    // Redo is safe only while the field still matches the transaction's before-state.
    if (JSON.stringify(this.field.serialize()) !== JSON.stringify(transaction.before)) return null
    this.redoStack.pop()
    this.field.restore(transaction.after)
    this.undoStack.push(transaction)
    return structuredClone(transaction)
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
