import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { EMPTY_BYTES } from "../../encoding.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { resolveLimits } from "../../limits.js";
import type { RuntimeCommandContext } from "../../types.js";

// A worker that dies without ever sending the bridge its EXIT: one that fails
// to load, crashes, or exits early. The bridge here is the real one, so a run
// that is not told the worker is gone waits out the whole script timeout.
const mockState = vi.hoisted(() => ({
  death: "exit" as "exit" | "error" | "construct" | "mid-operation",
}));

vi.mock("node:worker_threads", async () => {
  const { OpCode, ProtocolBuffer, Status } = await import(
    "../worker-bridge/protocol.js"
  );

  class MockWorker {
    private handlers = new Map<string, Array<(payload?: unknown) => void>>();

    constructor(
      _path: string,
      options: { workerData: { sharedBuffer: SharedArrayBuffer } },
    ) {
      if (mockState.death === "construct") {
        throw new Error("Cannot find module worker.js");
      }
      if (mockState.death === "mid-operation") {
        // Ask the bridge to read a file whose read is still pending, then die
        // while the bridge is awaiting it.
        const protocol = new ProtocolBuffer(options.workerData.sharedBuffer);
        protocol.setOpCode(OpCode.READ_FILE);
        protocol.setPath("/pending");
        protocol.setStatus(Status.READY);
        protocol.notify();
        setTimeout(() => {
          for (const cb of this.handlers.get("error") ?? []) {
            cb(new Error("worker crashed"));
          }
        }, 50);
        return;
      }
      queueMicrotask(() => {
        const payload =
          mockState.death !== "exit"
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

// Test files share one module graph (isolate: false) and their vi.mock
// registrations, so python3.js may already be loaded against another file's
// mock worker and mock bridge. Load it afresh against this file's mock and the
// real bridge, and leave nothing bound to this mock for the next file.
let python3: typeof import("./python3.js");
beforeAll(async () => {
  vi.doUnmock("../worker-bridge/bridge-handler.js");
  vi.doUnmock("../worker-bridge/protocol.js");
  vi.resetModules();
  python3 = await import("./python3.js");
});
afterAll(() => {
  vi.doUnmock("node:worker_threads");
  vi.resetModules();
});

function context(fs = new InMemoryFs()): RuntimeCommandContext {
  return {
    fs,
    cwd: "/home/user",
    env: new Map(),
    stdin: EMPTY_BYTES,
    limits: resolveLimits({ maxPythonTimeoutMs: 30_000 }),
  };
}

describe("python3 worker that dies before its bridge EXIT", () => {
  beforeEach(() => {
    python3._resetExecutionQueue();
  });

  it.each(["exit", "error", "construct"] as const)(
    "fails at once on %s instead of waiting out the timeout",
    { timeout: 5_000 },
    async (death) => {
      mockState.death = death;
      const result = await python3.python3Command.execute(
        ["-c", "print(1)"],
        context(),
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).not.toContain("timeout");
    },
  );

  it(
    "finishes the bridge operation in flight, then fails without the timeout",
    { timeout: 5_000 },
    async () => {
      mockState.death = "mid-operation";
      const fs = new InMemoryFs();
      let readSettled = false;
      const readFileBuffer = vi.spyOn(fs, "readFileBuffer").mockReturnValue(
        new Promise((resolve) => {
          // Settles after the worker has died.
          setTimeout(() => {
            readSettled = true;
            resolve(new Uint8Array());
          }, 200);
        }),
      );
      const result = await python3.python3Command.execute(
        ["-c", "print(1)"],
        context(fs),
      );
      expect(readFileBuffer).toHaveBeenCalledWith("/pending");
      expect(readSettled).toBe(true);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("worker crashed");
      expect(result.stderr).not.toContain("timeout");
    },
  );
});
