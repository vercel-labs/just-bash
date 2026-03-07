import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import type { CommandContext } from "../../types.js";
import { _internals, sqlite3Command } from "./sqlite3.js";

type WorkerScript = (worker: {
  emit: (event: string, payload?: unknown) => void;
}) => void;

function createMockWorker(script: WorkerScript) {
  const handlers = new Map<string, Array<(payload?: unknown) => void>>();

  const worker = {
    on(event: string, cb: (payload?: unknown) => void) {
      const list = handlers.get(event) ?? [];
      list.push(cb);
      handlers.set(event, list);
      return worker;
    },
    terminate(): Promise<number> {
      const list = handlers.get("exit") ?? [];
      for (const cb of list) cb(0);
      return Promise.resolve(0);
    },
  };

  queueMicrotask(() => {
    script({
      emit: (event: string, payload?: unknown) => {
        const list = handlers.get(event) ?? [];
        for (const cb of list) cb(payload);
      },
    });
  });

  return worker;
}

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
    vi.restoreAllMocks();
  });

  it("surfaces security-violation as explicit error with violation type", async () => {
    vi.spyOn(_internals, "createWorker").mockImplementation(() => {
      return createMockWorker((worker) => {
        worker.emit("message", {
          type: "security-violation",
          violation: { type: "module_load" },
        });
      }) as never;
    });

    const result = await sqlite3Command.execute(
      [":memory:", "SELECT 1"],
      createContext(),
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Security violation: module_load");
    expect(result.exitCode).toBe(1);
  });

  it("surfaces malformed success payloads as explicit command errors", async () => {
    vi.spyOn(_internals, "createWorker").mockImplementation(() => {
      return createMockWorker((worker) => {
        worker.emit("message", { success: true });
      }) as never;
    });

    const result = await sqlite3Command.execute(
      [":memory:", "SELECT 1"],
      createContext(),
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "sqlite3: Malformed worker response: missing results array\n",
    );
    expect(result.exitCode).toBe(1);
  });
});
