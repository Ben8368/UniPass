export class AdvancedModeUnlock {
  private restoreDeadline = 0;
  private saveClicks = 0;
  private unlockReady = false;
  private entered = false;

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  markRestoreDefault(): void {
    if (this.unlockReady || this.entered) return;
    this.restoreDeadline = this.now() + this.windowMs;
    this.saveClicks = 0;
  }

  recordSaveClick(): boolean {
    if (this.unlockReady || this.entered || this.restoreDeadline === 0 || this.now() > this.restoreDeadline) {
      this.restoreDeadline = 0;
      this.saveClicks = 0;
      return false;
    }
    this.saveClicks += 1;
    if (this.saveClicks !== 2) return false;
    this.restoreDeadline = 0;
    this.saveClicks = 0;
    this.unlockReady = true;
    return true;
  }

  enter(): boolean {
    if (!this.unlockReady) return false;
    this.unlockReady = false;
    this.entered = true;
    return true;
  }

  reset(): void {
    this.restoreDeadline = 0;
    this.saveClicks = 0;
    this.unlockReady = false;
    this.entered = false;
  }

  get isUnlockReady(): boolean {
    return this.unlockReady;
  }

  get isEntered(): boolean {
    return this.entered;
  }
}
