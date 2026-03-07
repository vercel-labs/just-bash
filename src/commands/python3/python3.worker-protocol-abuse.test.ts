import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import type { CommandContext } from "../../types.js";

type WorkerScript = (worker: {
  emit: (event: string, payload?: unknown) => void;
}) => void;

const mockState = vi.hoisted(() => ({
  script: null as WorkerScript | null,
}));

// Pre-capture SharedArrayBuffer before defense-in-depth patches it
const _SAB = vi.hoisted(() => globalThis.SharedArrayBuffer);

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

vi.mock("./fs-bridge-handler.js", () => {
  class MockFsBridgeHandler {
    async run(): Promise<{ stdout: string; stderr: string; exitCode: number }> {
      return { stdout: "BRIDGE_STDOUT\n", stderr: "", exitCode: 0 };
    }
  }

  return { FsBridgeHandler: MockFsBridgeHandler };
});

vi.mock("./protocol.js", () => {
  return {
    createSharedBuffer: () => new _SAB(4096),
  };
});

import { _resetExecutionQueue, python3Command } from "./python3.js";

function createContext(): CommandContext {
  return {
    fs: new InMemoryFs(),
    cwd: "/home/user",
    env: new Map([
      ["HOME", "/home/user"],
      ["PATH", "/usr/bin:/bin"],
      ["IFS", " \t\n"],
    ]),
    stdin: "",
  };
}

describe("python3 worker protocol abuse", { retry: 2 }, () => {
  beforeEach(async () => {
    mockState.script = null;
    _resetExecutionQueue();
    // Allow any in-flight workers from previous tests to settle
    await new Promise((r) => setTimeout(r, 10));
  });

  it("treats malformed worker message as explicit error", async () => {
    mockState.script = (worker) => {
      worker.emit("message", {});
    };

    const result = await python3Command.execute(
      ["-c", "print('ignored')"],
      createContext(),
    );

    expect(result.stdout).toBe("BRIDGE_STDOUT\n");
    expect(result.stderr).toContain("Malformed worker response");
    expect(result.exitCode).toBe(1);
  });

  it("surfaces security-violation as error with violation type", async () => {
    mockState.script = (worker) => {
      worker.emit("message", {
        type: "security-violation",
        violation: { type: "shared_array_buffer" },
      });
    };

    const result = await python3Command.execute(
      ["-c", "print('ignored')"],
      createContext(),
    );

    expect(result.stdout).toBe("BRIDGE_STDOUT\n");
    expect(result.stderr).toContain("Security violation: shared_array_buffer");
    expect(result.exitCode).toBe(1);
  });
});
