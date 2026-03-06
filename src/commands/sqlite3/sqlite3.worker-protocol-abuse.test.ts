import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import type { CommandContext } from "../../types.js";

type WorkerScript = (worker: {
  emit: (event: string, payload?: unknown) => void;
}) => void;

const mockState = vi.hoisted(() => ({
  script: null as WorkerScript | null,
}));

vi.mock("node:worker_threads", () => {
  class MockWorker {
    private handlers = new Map<string, Array<(payload?: unknown) => void>>();

    constructor(_path: string, _opts: unknown) {
      queueMicrotask(() => {
        mockState.script?.({
          emit: (event: string, payload?: unknown) => this.emit(event, payload),
        });
      });
    }

    on(event: string, cb: (payload?: unknown) => void): this {
      const list = this.handlers.get(event) ?? [];
      list.push(cb);
      this.handlers.set(event, list);
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

import { sqlite3Command } from "./sqlite3.js";

function createContext(): CommandContext {
  return {
    fs: new InMemoryFs(),
    cwd: "/",
    env: new Map([
      ["HOME", "/home/user"],
      ["PATH", "/usr/bin:/bin"],
      ["IFS", " \t\n"],
    ]),
    stdin: "",
  };
}

describe("sqlite3 worker protocol abuse", () => {
  beforeEach(() => {
    mockState.script = null;
  });

  it("surfaces security-violation as explicit error with violation type", async () => {
    mockState.script = (worker) => {
      worker.emit("message", {
        type: "security-violation",
        violation: { type: "module_load" },
      });
    };

    const result = await sqlite3Command.execute(
      [":memory:", "SELECT 1"],
      createContext(),
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Security violation: module_load");
    expect(result.exitCode).toBe(1);
  });

  it("throws when worker sends success without required result payload", async () => {
    mockState.script = (worker) => {
      worker.emit("message", { success: true });
    };

    await expect(
      sqlite3Command.execute([":memory:", "SELECT 1"], createContext()),
    ).rejects.toThrow("result.results is not iterable");
  });
});
