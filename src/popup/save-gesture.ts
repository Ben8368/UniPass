export type SaveGestureAction = "save" | "self-build";
type Timer = ReturnType<typeof setTimeout>;

export class SaveGestureStateMachine {
  private clickCount = 0;
  private timer: Timer | undefined;

  constructor(
    private readonly onSave: () => void,
    private readonly onSelfBuild: () => void,
    private readonly windowMs: number,
    private readonly schedule: (callback: () => void, delay: number) => Timer = setTimeout,
    private readonly cancel: (timer: Timer) => void = clearTimeout,
  ) {}

  click(): SaveGestureAction | null {
    this.clickCount += 1;
    if (this.clickCount === 3) {
      this.reset();
      this.onSelfBuild();
      return "self-build";
    }
    if (this.timer !== undefined) this.cancel(this.timer);
    this.timer = this.schedule(() => {
      this.timer = undefined;
      this.clickCount = 0;
      this.onSave();
    }, this.windowMs);
    return null;
  }

  reset(): void {
    if (this.timer !== undefined) this.cancel(this.timer);
    this.timer = undefined;
    this.clickCount = 0;
  }
}
