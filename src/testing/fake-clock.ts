/**
 * FakeClock — synctest-style fake clock for deterministic testing of concurrent code.
 *
 * Inspired by Go's synctest package: virtual time auto-advances when all tasks
 * are blocked on timers. No real sleeps in tests.
 *
 * Usage:
 *   const clock = new FakeClock();
 *   const bash = new Bash({ sleep: clock.sleep });
 *   // ... run background jobs that call sleep ...
 *   // Time auto-advances when all tasks are waiting on timers.
 */
export class FakeClock {
  private currentTime = 0;
  private pending: Array<{ resolve: () => void; triggerAt: number }> = [];
  private activeTaskCount = 0;

  /**
   * Injectable sleep function. Registers a timer and blocks until
   * virtual time reaches the trigger point.
   *
   * Automatically tracks task blocked/unblocked state:
   * - Decrements active count when the caller yields (via microtask)
   * - Increments active count when the timer resolves
   */
  sleep = (ms: number): Promise<void> => {
    return new Promise<void>((resolve) => {
      const triggerAt = this.currentTime + ms;
      this.pending.push({
        resolve: () => {
          // Timer resolved — task is about to resume
          this.activeTaskCount++;
          resolve();
        },
        triggerAt,
      });
      // The caller is about to await this promise, so they're blocked.
      // Use queueMicrotask to decrement activeTaskCount after the caller yields.
      queueMicrotask(() => {
        this.activeTaskCount--;
        this.tryAdvance();
      });
    });
  };

  /**
   * Call when a task starts doing work (e.g., a new background job begins).
   */
  taskUnblocked(): void {
    this.activeTaskCount++;
  }

  /**
   * Call when a task is about to block on something other than sleep
   * (e.g., before awaiting wait()). Triggers auto-advance check.
   */
  taskBlocked(): void {
    this.activeTaskCount--;
    this.tryAdvance();
  }

  /**
   * Auto-advance: when all tasks are blocked and there are pending timers,
   * advance to the next timer. This may unblock tasks whose microtask
   * continuations will increment activeTaskCount.
   */
  private tryAdvance(): void {
    if (this.activeTaskCount > 0) return;
    if (this.pending.length === 0) return;

    // Sort by triggerAt, resolve earliest
    this.pending.sort((a, b) => a.triggerAt - b.triggerAt);
    const next = this.pending.shift();
    if (!next) return;
    this.currentTime = next.triggerAt;
    // Resolving increments activeTaskCount inside the resolve wrapper
    next.resolve();
  }

  /** Current virtual time in milliseconds. */
  get time(): number {
    return this.currentTime;
  }

  /** Number of pending (unresolved) timers. */
  get pendingCount(): number {
    return this.pending.length;
  }
}
