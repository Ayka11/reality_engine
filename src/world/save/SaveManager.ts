import type { WorldSaveSystem } from './WorldSaveSystem';

export class SaveManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private autoSaveInFlight = false;

  constructor(
    private saveSystem: WorldSaveSystem,
    private onAutoSaveError?: (error: unknown) => void,
  ) {}

  startAutoSave(intervalMs = 120000): void {
    this.stopAutoSave();
    this.timer = setInterval(() => {
      // A slow snapshot must not overlap with another autosave tick. Capturing
      // the same mutable world concurrently wastes memory and can enqueue
      // competing IndexedDB writes for identical simulation state.
      if (this.autoSaveInFlight) return;
      this.autoSaveInFlight = true;
      const name = `Autosave_${Date.now()}`;
      void Promise.resolve()
        .then(() => this.saveSystem.quickSave(name))
        .catch(error => {
          console.error('[SaveManager] Autosave failed', error);
          try {
            this.onAutoSaveError?.(error);
          } catch (reportError) {
            console.error('[SaveManager] Could not report autosave failure', reportError);
          }
        })
        .finally(() => {
          this.autoSaveInFlight = false;
        });
    }, intervalMs);
  }

  stopAutoSave(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  get enabled(): boolean {
    return this.timer !== null;
  }
}
