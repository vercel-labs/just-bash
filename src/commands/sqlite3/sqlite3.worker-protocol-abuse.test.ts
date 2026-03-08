import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { DefenseInDepthBox } from "../../security/defense-in-depth-box.js";
import type { CommandContext } from "../../types.js";
import { _internals, sqlite3Command } from "./sqlite3.js";

type WorkerScript = (worker: {
  emit: (event: string, payload?: unknown) => void;
  emitAuthenticated: (event: string, payload: Record<string, unknown>) => void;
}) => void;

function createMockWorker(script: WorkerScript, protocolToken: string) {
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
  overrides: Partial<CommandContext> = {},
): CommandContext {
  return {
    fs: new InMemoryFs(),
    cwd: "/",
    env: new Map([
      ["HOME", "/home/user"],
      ["PATH", "/usr/bin:/bin"],
      ["IFS", " \t\n"],
    ]),
    stdin: "",
    ...overrides,
  };
}

describe("sqlite3 worker protocol abuse", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("surfaces security-violation as explicit error with violation type", async () => {
    vi.spyOn(_internals, "createWorker").mockImplementation((_path, input) => {
      return createMockWorker((worker) => {
        worker.emitAuthenticated("message", {
          type: "security-violation",
          violation: { type: "module_load" },
        });
      }, input.protocolToken) as never;
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
    vi.spyOn(_internals, "createWorker").mockImplementation((_path, input) => {
      return createMockWorker((worker) => {
        worker.emitAuthenticated("message", { success: true });
      }, input.protocolToken) as never;
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

  it("sanitizes worker errors before forwarding to stderr", async () => {
    vi.spyOn(_internals, "createWorker").mockImplementation((_path, input) => {
      return createMockWorker((worker) => {
        worker.emitAuthenticated("message", {
          success: false,
          error:
            "sqlite crash near /Users/attacker/private.db at node:internal/modules/run_main:99",
        });
      }, input.protocolToken) as never;
    });

    const result = await sqlite3Command.execute(
      [":memory:", "SELECT 1"],
      createContext(),
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "sqlite3: sqlite crash near <path> at <internal>:99\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it("sanitizes worker-bootstrap exception strings before forwarding to stderr", async () => {
    vi.spyOn(_internals, "createWorker").mockImplementation(() => {
      throw new Error(
        "bootstrap fault at /Users/attacker/.cache/sqlite/worker.js via node:internal/modules/cjs/loader:1234",
      );
    });

    const result = await sqlite3Command.execute(
      [":memory:", "SELECT 1"],
      createContext(),
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "sqlite3: worker error: sqlite3 worker failed to load: bootstrap fault at <path> via <internal>:1234\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it("fails closed if worker callback runs without defense async context", async () => {
    vi.spyOn(DefenseInDepthBox, "isInSandboxedContext").mockReturnValue(false);
    vi.spyOn(_internals, "createWorker").mockImplementation((_path, input) => {
      return createMockWorker((worker) => {
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
      createContext({ requireDefenseContext: true }),
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "sqlite3: sqlite3 worker message callback attempted outside defense context\n\nThis is a defense-in-depth measure and indicates a bug in just-bash. Please report this at security@vercel.com\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it("rejects forged worker messages with invalid protocol token", async () => {
    vi.spyOn(_internals, "createWorker").mockImplementation((_path, input) => {
      return createMockWorker((worker) => {
        worker.emit("message", {
          protocolToken: `${input.protocolToken}-forged`,
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
    expect(result.stderr).toBe(
      "sqlite3: Malformed worker response: invalid protocol token\n",
    );
    expect(result.exitCode).toBe(1);
  });
});
