import type { WorldSaveSystem } from './WorldSaveSystem';

export class SaveManager {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private saveSystem: WorldSaveSystem) {}

  startAutoSave(intervalMs = 120000): void {
    this.stopAutoSave();
    this.timer = setInterval(() => {
      void this.saveSystem.quickSave(`Autosave_${Date.now()}`);
    }, intervalMs);
  }

  stopAutoSave(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get enabled(): boolean {
    return this.timer !== null;
  }
}
