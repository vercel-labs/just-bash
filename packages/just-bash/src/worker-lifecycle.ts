import { _clearFiniteTimeout, _setTimeoutIfFinite } from "./timers.js";

type CancelReason = "abort" | "timeout";

interface WorkerLifecycleOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Shared deadline, cancellation, and termination lifecycle for Node and browser workers. */
export class WorkerLifecycle {
  readonly deadline: number;
  private readonly cleanups: Array<() => void> = [];
  private cancelHandler: ((reason: CancelReason) => void) | undefined;
  private canceledReason: CancelReason | undefined;
  private closed = false;

  constructor(private readonly lifecycleOptions: WorkerLifecycleOptions) {
    this.deadline = Date.now() + lifecycleOptions.timeoutMs;
  }

  /** Arm cancellation before the caller makes the request visible in a queue. */
  arm(onCancel: (reason: CancelReason) => void): void {
    if (this.cancelHandler) throw new Error("worker request is already armed");
    this.cancelHandler = onCancel;

    const signal = this.lifecycleOptions.signal;
    if (signal) {
      const abort = () => this.cancel("abort");
      signal.addEventListener("abort", abort, { once: true });
      this.cleanups.push(() => signal.removeEventListener("abort", abort));
      if (signal.aborted) this.cancel("abort");
    }

    if (!this.canceledReason) {
      const timer = _setTimeoutIfFinite(
        () => this.cancel("timeout"),
        Math.max(0, this.lifecycleOptions.timeoutMs),
      );
      if (timer !== undefined) {
        this.cleanups.push(() => _clearFiniteTimeout(timer));
      }
    }
  }

  get isCanceled(): boolean {
    return this.canceledReason !== undefined;
  }

  remainingTimeMs(): number {
    return Math.max(0, this.deadline - Date.now());
  }

  timeoutMessage(noun = "Execution"): string {
    return `${noun} timeout: exceeded ${this.lifecycleOptions.timeoutMs}ms limit`;
  }

  abortMessage(): string {
    return "Execution aborted";
  }

  async terminate(
    worker: { terminate(): unknown } | null | undefined,
  ): Promise<boolean> {
    if (!worker) return true;
    try {
      await worker.terminate();
      return true;
    } catch {
      // Rejection is not an acknowledgement that stale worker authority ended.
      return false;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (let index = this.cleanups.length - 1; index >= 0; index--) {
      this.cleanups[index]();
    }
    this.cleanups.length = 0;
    this.cancelHandler = undefined;
  }

  private cancel(reason: CancelReason): void {
    if (this.closed || this.canceledReason) return;
    this.canceledReason = reason;
    this.cancelHandler?.(reason);
  }
}
