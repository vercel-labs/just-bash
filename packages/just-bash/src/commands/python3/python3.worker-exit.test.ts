import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_BYTES } from "../../encoding.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { resolveLimits } from "../../limits.js";
import type { RuntimeCommandContext } from "../../types.js";

// A worker that dies without ever sending the bridge its EXIT: one that fails
// to load, crashes, or exits early. The bridge here is the real one, so a run
// that is not told the worker is gone waits out the whole script timeout.
const mockState = vi.hoisted(() => ({
  death: "exit" as "exit" | "error",
}));

vi.mock("node:worker_threads", () => {
  class MockWorker {
    private handlers = new Map<string, Array<(payload?: unknown) => void>>();

    constructor() {
      queueMicrotask(() => {
        const payload =
          mockState.death === "error"
            ? new Error("Cannot find module worker.js")
            : 1;
        for (const cb of this.handlers.get(mockState.death) ?? []) {
          cb(payload);
        }
      });
    }

    on(event: string, cb: (payload?: unknown) => void): this {
      const list = this.handlers.get(event) ?? [];
      list.push(cb);
      this.handlers.set(event, list);
      return this;
    }

    removeListener(event: string, cb: (payload?: unknown) => void): this {
      const list = this.handlers.get(event) ?? [];
      this.handlers.set(
        event,
        list.filter((handler) => handler !== cb),
      );
      return this;
    }

    terminate(): Promise<number> {
      return Promise.resolve(0);
    }
  }

  return { Worker: MockWorker };
});

import { _resetExecutionQueue, python3Command } from "./python3.js";

function context(): RuntimeCommandContext {
  return {
    fs: new InMemoryFs(),
    cwd: "/home/user",
    env: new Map(),
    stdin: EMPTY_BYTES,
    limits: resolveLimits({ maxPythonTimeoutMs: 30_000 }),
  };
}

describe("python3 worker that dies before its bridge EXIT", () => {
  beforeEach(() => {
    _resetExecutionQueue();
  });

  it.each(["exit", "error"] as const)(
    "fails at once on %s instead of waiting out the timeout",
    { timeout: 5_000 },
    async (death) => {
      mockState.death = death;
      const result = await python3Command.execute(
        ["-c", "print(1)"],
        context(),
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).not.toContain("timeout");
    },
  );
});
