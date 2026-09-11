export type SaveGestureAction = "save" | "self-build";
type Timer = ReturnType<typeof setTimeout>;

export class SaveGestureStateMachine {
  private clickCount = 0;
  private deadline = 0;
  private timer: Timer | undefined;

  constructor(
    private readonly onSave: () => void,
    private readonly onSelfBuild: () => void,
    private readonly windowMs: number,
    private readonly schedule: (callback: () => void, delay: number) => Timer = setTimeout,
    private readonly cancel: (timer: Timer) => void = clearTimeout,
    private readonly now: () => number = Date.now,
  ) {}

  click(): SaveGestureAction | null {
    if (this.clickCount > 0 && this.now() > this.deadline) {
      this.expire();
    }
    if (this.clickCount === 0) {
      this.deadline = this.now() + this.windowMs;
      this.timer = this.schedule(() => this.expire(), this.windowMs);
    }
    this.clickCount += 1;
    if (this.clickCount === 3) {
      this.reset();
      this.onSelfBuild();
      return "self-build";
    }
    return null;
  }

  flushPendingSave(): void {
    if (this.clickCount === 0) return;
    this.reset();
    this.onSave();
  }

  reset(): void {
    if (this.timer !== undefined) this.cancel(this.timer);
    this.timer = undefined;
    this.clickCount = 0;
    this.deadline = 0;
  }

  private expire(): void {
    if (this.clickCount === 0) return;
    this.reset();
    this.onSave();
  }
}
