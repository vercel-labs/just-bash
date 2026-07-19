import { utf8ByteLength } from "./encoding.js";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "./interpreter/errors.js";
import type { ExecutionLimits } from "./limits.js";
import type { ExecResult } from "./types.js";

export interface ResourceLease {
  release(): void;
}

type Cleanup = () => void | Promise<void>;

/**
 * Security-sensitive accounting shared by every interpreter descended from a
 * single public Bash.exec() call. This object is never accepted from callers;
 * nested exec functions capture it in a closure instead.
 *
 * Keep reservations centralized here so future output/byte/filesystem budgets
 * cannot accidentally be refreshed by starting a child interpreter.
 */
export class ExecutionScope {
  private commandCount = 0;
  private workUnits = 0;
  private liveBytes = 0;
  private inputBytes = 0;
  private outputBytes = 0;
  private readonly countersByKind = new Map<string, number>();
  private readonly bytesByKind = new Map<string, number>();
  private readonly depthByKind = new Map<string, number>();
  private readonly cleanupCallbacks: Cleanup[] = [];
  private poisoned: ExecutionLimitError | ExecutionAbortedError | undefined;
  private closed = false;
  private readonly startedAt = Date.now();

  constructor(
    private readonly limits: Required<ExecutionLimits>,
    private readonly signal: AbortSignal | undefined = undefined,
  ) {}

  private fail(error: ExecutionLimitError | ExecutionAbortedError): never {
    this.poisoned ??= error;
    throw this.poisoned;
  }

  private assertUsable(): void {
    if (this.poisoned) throw this.poisoned;
    if (this.closed) {
      throw new Error("execution budget is already closed");
    }
    this.throwIfAborted();
  }

  chargeCommand(): number {
    return this.consume("commands", 1, "execution");
  }

  consumeWork(units = 1, site = "execution"): number {
    return this.consume("work", units, site);
  }

  consumeInput(bytes: number, site = "execution"): number {
    this.assertUsable();
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > this.limits.maxInputBytes - this.inputBytes
    ) {
      this.fail(
        new ExecutionLimitError(
          `${site}: aggregate input size limit exceeded (${this.limits.maxInputBytes} bytes)`,
          "string_length",
        ),
      );
    }
    this.inputBytes += bytes;
    return this.inputBytes;
  }

  consume(kind: string, count: number = 1, site: string = kind): number {
    this.assertUsable();
    const kindCurrent = this.countersByKind.get(kind) ?? 0;
    const current = kind === "commands" ? this.commandCount : this.workUnits;
    const maximum =
      kind === "commands"
        ? this.limits.maxCommandCount
        : this.limits.maxWorkUnits;
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > maximum - current
    ) {
      this.fail(
        new ExecutionLimitError(
          kind === "commands"
            ? `too many commands executed (>${maximum}), increase executionLimits.maxCommandCount`
            : `${site}: ${kind} work limit exceeded (${maximum})`,
          kind === "commands" ? "commands" : "iterations",
        ),
      );
    }
    const next = current + count;
    if (kind === "commands") this.commandCount = next;
    else this.workUnits = next;
    this.countersByKind.set(kind, kindCurrent + count);
    return next;
  }

  reserveBytes(bytes: number, site?: string): ResourceLease;
  reserveBytes(kind: string, bytes: number, site?: string): ResourceLease;
  reserveBytes(
    kindOrBytes: string | number,
    bytesOrSite?: number | string,
    maybeSite?: string,
  ): ResourceLease {
    this.assertUsable();
    const kind = typeof kindOrBytes === "string" ? kindOrBytes : "live";
    const bytes =
      typeof kindOrBytes === "string" ? (bytesOrSite as number) : kindOrBytes;
    const site =
      typeof kindOrBytes === "string"
        ? (maybeSite ?? kind)
        : ((bytesOrSite as string | undefined) ?? "execution");
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > this.limits.maxLiveBytes - this.liveBytes
    ) {
      this.fail(
        new ExecutionLimitError(
          `${site}: live byte limit exceeded (${this.limits.maxLiveBytes} bytes)`,
          "string_length",
        ),
      );
    }
    this.liveBytes += bytes;
    this.bytesByKind.set(kind, (this.bytesByKind.get(kind) ?? 0) + bytes);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.liveBytes -= bytes;
        const next = (this.bytesByKind.get(kind) ?? bytes) - bytes;
        if (next <= 0) this.bytesByKind.delete(kind);
        else this.bytesByKind.set(kind, next);
      },
    };
  }

  appendOutput(
    stream: "stdout" | "stderr",
    chunk: string,
    site = "execution",
    alreadyAccountedBytes = 0,
  ): number {
    this.assertUsable();
    const bytes = utf8ByteLength(chunk);
    if (
      !Number.isSafeInteger(alreadyAccountedBytes) ||
      alreadyAccountedBytes < 0 ||
      alreadyAccountedBytes > bytes
    ) {
      this.fail(
        new ExecutionLimitError(
          `${site}: invalid ${stream} accounting`,
          "output_size",
        ),
      );
    }
    const unaccounted = bytes - alreadyAccountedBytes;
    if (unaccounted > this.limits.maxOutputSize - this.outputBytes) {
      this.fail(
        new ExecutionLimitError(
          `${site}: total output size exceeded (>${this.limits.maxOutputSize} bytes), increase executionLimits.maxOutputSize`,
          "output_size",
        ),
      );
    }
    this.outputBytes += unaccounted;
    return bytes;
  }

  accountResult(result: ExecResult, site = "execution"): ExecResult {
    const prior = result.internalOutputAccounting;
    const stdout = this.appendOutput(
      "stdout",
      result.stdout,
      site,
      prior?.stdout ?? 0,
    );
    const stderr = this.appendOutput(
      "stderr",
      result.stderr,
      site,
      prior?.stderr ?? 0,
    );
    if (Object.isExtensible(result)) {
      result.internalOutputAccounting = { stdout, stderr };
      return result;
    }
    if (stdout === 0 && stderr === 0) return result;
    return {
      ...result,
      internalOutputAccounting: { stdout, stderr },
    };
  }

  enterDepth(kind: string, site?: string): ResourceLease;
  enterDepth(kind: string, maximum: number, site?: string): ResourceLease;
  enterDepth(
    kind: string,
    maximumOrSite: number | string = this.limits.maxCallDepth,
    maybeSite?: string,
  ): ResourceLease {
    this.assertUsable();
    const maximum =
      typeof maximumOrSite === "number"
        ? maximumOrSite
        : this.limits.maxCallDepth;
    const site =
      typeof maximumOrSite === "string" ? maximumOrSite : (maybeSite ?? kind);
    const current = this.depthByKind.get(kind) ?? 0;
    if (current >= maximum) {
      this.fail(
        new ExecutionLimitError(
          `${site}: maximum depth (${maximum}) exceeded`,
          "recursion",
        ),
      );
    }
    this.depthByKind.set(kind, current + 1);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const next = (this.depthByKind.get(kind) ?? 1) - 1;
        if (next <= 0) this.depthByKind.delete(kind);
        else this.depthByKind.set(kind, next);
      },
    };
  }

  throwIfAborted(site = "execution"): void {
    if (this.signal?.aborted) {
      this.fail(new ExecutionAbortedError("", `bash: ${site} aborted\n`));
    }
    if (Date.now() - this.startedAt > this.limits.maxExecutionTimeMs) {
      this.fail(
        new ExecutionAbortedError(
          "",
          `bash: ${site} exceeded execution deadline (${this.limits.maxExecutionTimeMs}ms)\n`,
        ),
      );
    }
  }

  remainingTimeMs(): number {
    return Math.max(
      0,
      this.limits.maxExecutionTimeMs - (Date.now() - this.startedAt),
    );
  }

  registerCleanup(cleanup: Cleanup): () => void {
    this.assertUsable();
    this.cleanupCallbacks.push(cleanup);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const index = this.cleanupCallbacks.indexOf(cleanup);
      if (index >= 0) this.cleanupCallbacks.splice(index, 1);
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (let index = this.cleanupCallbacks.length - 1; index >= 0; index--) {
      try {
        await this.cleanupCallbacks[index]();
      } catch (error) {
        errors.push(error);
      }
    }
    this.cleanupCallbacks.length = 0;
    this.depthByKind.clear();
    this.bytesByKind.clear();
    this.liveBytes = 0;
    if (errors.length > 0) {
      throw new AggregateError(errors, "execution cleanup failed");
    }
  }

  assertExecDepth(depth: number): void {
    this.assertUsable();
    if (depth > this.limits.maxExecDepth) {
      this.fail(
        new ExecutionLimitError(
          `maximum nested execution depth (${this.limits.maxExecDepth}) exceeded`,
          "recursion",
        ),
      );
    }
  }
}
