import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_BYTES } from "../../encoding.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { resolveLimits } from "../../limits.js";
import { DefenseInDepthBox } from "../../security/defense-in-depth-box.js";
import type { RuntimeCommandContext } from "../../types.js";

type WorkerScript = (worker: {
  emit: (event: string, payload?: unknown) => void;
  emitAuthenticated: (event: string, payload: Record<string, unknown>) => void;
}) => void;

const mockState = vi.hoisted(() => ({
  script: null as WorkerScript | null,
  throwOnConstruct: false,
}));

// Pre-capture SharedArrayBuffer before defense-in-depth patches it
const _SAB = vi.hoisted(() => globalThis.SharedArrayBuffer);

vi.mock("node:worker_threads", () => {
  class MockWorker {
    private handlers = new Map<string, Array<(payload?: unknown) => void>>();

    constructor(_path: string, opts: unknown) {
      if (mockState.throwOnConstruct) {
        mockState.throwOnConstruct = false;
        throw new Error("worker construction failed");
      }
      const protocolToken =
        typeof (opts as { workerData?: { protocolToken?: unknown } })
          ?.workerData?.protocolToken === "string"
          ? ((opts as { workerData: { protocolToken: string } }).workerData
              .protocolToken as string)
          : "";
      queueMicrotask(() => {
        mockState.script?.({
          emit: (event: string, payload?: unknown) => this.emit(event, payload),
          emitAuthenticated: (
            event: string,
            payload: Record<string, unknown>,
          ) => {
            const message = Object.create(null) as Record<string, unknown>;
            for (const [key, value] of Object.entries(payload)) {
              message[key] = value;
            }
            message.protocolToken = protocolToken;
            this.emit(event, message);
          },
        });
      });
    }

    on(event: string, cb: (payload?: unknown) => void): this {
      const list = this.handlers.get(event) ?? [];
      list.push(cb);
      this.handlers.set(event, list);
      return this;
    }

    removeListener(event: string, cb: (payload?: unknown) => void): this {
      this.handlers.set(
        event,
        (this.handlers.get(event) ?? []).filter((handler) => handler !== cb),
      );
      return this;
    }

    terminate(): Promise<number> {
      this.emit("exit", 0);
      return Promise.resolve(0);
    }

    private emit(event: string, payload?: unknown): void {
      const list = this.handlers.get(event) ?? [];
      for (const cb of list) cb(payload);
    }
  }

  return { Worker: MockWorker };
});

// The real BridgeHandler and protocol are used, so the bridge loop must be
// released by the settlement path instead of waiting for a bridge EXIT that
// never comes.

import { _resetExecutionQueue, python3Command } from "./python3.js";

function createContext(
  overrides: Partial<RuntimeCommandContext> = {},
): RuntimeCommandContext {
  return {
    fs: new InMemoryFs(),
    cwd: "/home/user",
    env: new Map([
      ["HOME", "/home/user"],
      ["PATH", "/usr/bin:/bin"],
      ["IFS", " \t\n"],
    ]),
    stdin: EMPTY_BYTES,
    ...overrides,
    limits: overrides.limits ?? resolveLimits(),
  };
}

describe("python3 under node --watch", { retry: 2 }, () => {
  beforeEach(async () => {
    mockState.script = null;
    mockState.throwOnConstruct = false;
    _resetExecutionQueue();
    // Allow any in-flight workers from previous tests to settle
    await new Promise((r) => setTimeout(r, 10));
  });

  it("ignores watch-mode dependency reports and completes the run", {
    timeout: 5000,
  }, async () => {
    mockState.script = (worker) => {
      // Node's --watch mode relays every module the worker imports as a
      // "watch:import" message before the command produces any output.
      worker.emit("message", {
        "watch:import": ["file:///just-bash/dist/bundle/chunks/worker.js"],
      });
      worker.emit("message", { "watch:require": ["node:fs"] });
      worker.emitAuthenticated("message", { success: true });
    };

    const result = await python3Command.execute(
      ["-c", "print('ignored')"],
      createContext(),
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("releases the bridge when the run settles without a bridge EXIT", {
    timeout: 5000,
  }, async () => {
    mockState.script = (worker) => {
      worker.emit("message", {
        "watch:import": ["file:///just-bash/dist/bundle/chunks/worker.js"],
      });
      worker.emitAuthenticated("message", {
        success: false,
        error: "watch-mode boom",
      });
    };

    const result = await python3Command.execute(
      ["-c", "print('ignored')"],
      createContext(),
    );

    // The failure is surfaced immediately; without releasing the bridge the
    // command reports the execution deadline instead (exit code 124).
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("python3: watch-mode boom\n");
    expect(result.exitCode).toBe(1);
  });

  it("releases the bridge when worker construction fails", {
    timeout: 5000,
  }, async () => {
    mockState.throwOnConstruct = true;

    const result = await python3Command.execute(
      ["-c", "print('ignored')"],
      createContext(),
    );

    // The construction error is surfaced immediately; without releasing the
    // bridge the command reports the execution deadline instead (exit 124).
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("python3: worker construction failed\n");
    expect(result.exitCode).toBe(1);
  });

  it("does not swallow a payload that carries a watch key with extra fields", {
    timeout: 5000,
  }, async () => {
    mockState.script = (worker) => {
      // Only Node's exact relay shape is ignored: a single reserved key with
      // an array of strings. A payload with extra fields (here, a protocol
      // token) is a malformed response and must fail the run.
      worker.emit("message", {
        "watch:import": ["file:///just-bash/dist/bundle/chunks/worker.js"],
        protocolToken: "forged",
      });
      worker.emitAuthenticated("message", { success: true });
    };

    const result = await python3Command.execute(
      ["-c", "print('ignored')"],
      createContext(),
    );

    expect(result.stderr).toBe(
      "python3: Malformed worker response: invalid protocol token\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it("does not swallow a watch key with a non-array value", {
    timeout: 5000,
  }, async () => {
    mockState.script = (worker) => {
      worker.emit("message", { "watch:import": "file:///not-an-array" });
      worker.emitAuthenticated("message", { success: true });
    };

    const result = await python3Command.execute(
      ["-c", "print('ignored')"],
      createContext(),
    );

    expect(result.stderr).toBe(
      "python3: Malformed worker response: invalid protocol token\n",
    );
    expect(result.exitCode).toBe(1);
  });
});
