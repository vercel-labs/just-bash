import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_BYTES } from "../../encoding.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { resolveLimits } from "../../limits.js";
import type { RuntimeCommandContext } from "../../types.js";
import { _internals, sqlite3Command } from "./sqlite3.js";

// `findWorkerPath` probes the compiled dist worker on disk; unit tests run
// from source and replace the worker itself, so report the probe as found.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: () => true };
});

type WorkerScript = (worker: {
  emit: (event: string, payload?: unknown) => void;
  emitAuthenticated: (event: string, payload: Record<string, unknown>) => void;
}) => void;

function createMockWorker(
  script: WorkerScript,
  protocolToken: string,
) {
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
      emitAuthenticated: (event: string, payload: Record<string, unknown>) => {
        const message = Object.create(null) as Record<string, unknown>;
        for (const [key, value] of Object.entries(payload)) {
          message[key] = value;
        }
        message.protocolToken = protocolToken;
        const list = handlers.get(event) ?? [];
        for (const cb of list) cb(message);
      },
    });
  });

  return worker;
}

function createContext(
  overrides: Partial<RuntimeCommandContext> = {},
): RuntimeCommandContext {
  return {
    fs: new InMemoryFs(),
    cwd: "/",
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

describe("sqlite3 under node --watch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("ignores watch-mode dependency reports and completes the run", {
    timeout: 5000,
  }, async () => {
    vi.spyOn(_internals, "createWorker").mockImplementation((_path, input) => {
      return createMockWorker((worker) => {
        // Node's --watch mode relays every module the worker imports as a
        // "watch:import" message before the command produces any output.
        worker.emit("message", {
          "watch:import": ["file:///just-bash/dist/bundle/chunks/worker.js"],
        });
        worker.emit("message", { "watch:require": ["node:fs"] });
        worker.emitAuthenticated("message", {
          success: true,
          results: [],
          hasModifications: false,
          dbBuffer: null,
        });
      }, input.protocolToken) as never;
    });

    const result = await sqlite3Command.execute(
      [":memory:", "SELECT 1"],
      createContext(),
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
