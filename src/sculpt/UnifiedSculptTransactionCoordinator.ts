export interface UnifiedSculptTransactionPort {
  undoLegacy: () => unknown; redoLegacy: () => unknown;
  undoAuthoritative: () => unknown; redoAuthoritative: () => unknown;
  authoritativeCheckpoint?: () => string;
}
type UnifiedSculptRecord = { label: string };
function requireApplied(value: unknown, operation: string): void {
  if (value === null || value === undefined || value === false) throw new Error(`Unified sculpt transaction rejected ${operation}`);
}
function changed(port: UnifiedSculptTransactionPort, before: string | undefined): boolean {
  return before !== undefined && port.authoritativeCheckpoint?.() !== before;
}
/** Keeps legacy-grid and authoritative-field history in one user-visible stream. */
export class UnifiedSculptTransactionCoordinator {
  private undoStack: UnifiedSculptRecord[] = [];
  private redoStack: UnifiedSculptRecord[] = [];
  constructor(private readonly port: UnifiedSculptTransactionPort, private readonly maxHistory = 50) {
    if (!Number.isInteger(maxHistory) || maxHistory < 1) throw new Error('Unified sculpt history size must be a positive integer');
  }
  async commit<T>(label: string, applyLegacy: () => T | Promise<T>, applyAuthoritative: () => unknown | Promise<unknown>): Promise<T> {
    const legacyResult = await applyLegacy();
    const before = this.port.authoritativeCheckpoint?.();
    try { requireApplied(await applyAuthoritative(), 'commit'); }
    catch (error) {
      if (changed(this.port, before)) {
        const rollbackField = this.port.undoAuthoritative();
        if (rollbackField === null || rollbackField === undefined || rollbackField === false) {
          throw new Error(`Authoritative commit failed after changing the field; authoritative rollback failed: ${String(error)}`);
        }
      }
      const rollbackLegacy = this.port.undoLegacy();
      if (rollbackLegacy === null || rollbackLegacy === undefined || rollbackLegacy === false) {
        throw new Error(`Authoritative sculpt commit failed and legacy rollback failed: ${String(error)}`);
      }
      throw error;
    }
    this.undoStack.push({ label });
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    this.redoStack = [];
    return legacyResult;
  }
  undo(): string | null {
    const record = this.undoStack[this.undoStack.length - 1];
    if (!record) return null;
    const legacyResult = this.port.undoLegacy();
    if (legacyResult === null || legacyResult === undefined || legacyResult === false) return null;
    const before = this.port.authoritativeCheckpoint?.();
    try { requireApplied(this.port.undoAuthoritative(), 'undo'); }
    catch (error) {
      if (changed(this.port, before)) {
        const rollbackField = this.port.redoAuthoritative();
        if (rollbackField === null || rollbackField === undefined || rollbackField === false) throw new Error(`Undo failed and authoritative redo rollback failed: ${String(error)}`);
      }
      const rollbackLegacy = this.port.redoLegacy();
      if (rollbackLegacy === null || rollbackLegacy === undefined || rollbackLegacy === false) throw new Error(`Authoritative undo failed and legacy redo rollback failed: ${String(error)}`);
      throw error;
    }
    this.undoStack.pop(); this.redoStack.push(record); return record.label;
  }
  redo(): string | null {
    const record = this.redoStack[this.redoStack.length - 1];
    if (!record) return null;
    const legacyResult = this.port.redoLegacy();
    if (legacyResult === null || legacyResult === undefined || legacyResult === false) return null;
    const before = this.port.authoritativeCheckpoint?.();
    try { requireApplied(this.port.redoAuthoritative(), 'redo'); }
    catch (error) {
      if (changed(this.port, before)) {
        const rollbackField = this.port.undoAuthoritative();
        if (rollbackField === null || rollbackField === undefined || rollbackField === false) throw new Error(`Redo failed and authoritative undo rollback failed: ${String(error)}`);
      }
      const rollbackLegacy = this.port.undoLegacy();
      if (rollbackLegacy === null || rollbackLegacy === undefined || rollbackLegacy === false) throw new Error(`Authoritative redo failed and legacy undo rollback failed: ${String(error)}`);
      throw error;
    }
    this.redoStack.pop(); this.undoStack.push(record); return record.label;
  }
  getState() {
    return { undo: this.undoStack.length, redo: this.redoStack.length,
      undoLabels: this.undoStack.map(record => record.label), redoLabels: this.redoStack.map(record => record.label) };
  }
}
