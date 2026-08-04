import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_BYTES } from "../../encoding.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { resolveLimits } from "../../limits.js";
import type { RuntimeCommandContext } from "../../types.js";
import type { JsExecWorkerInput } from "./js-exec-worker.js";

type MockWorkerController = {
  inputs: JsExecWorkerInput[];
  emit: (event: string, payload?: unknown) => void;
  terminated: boolean;
};

const mockState = vi.hoisted(() => ({
  workers: [] as MockWorkerController[],
  bridgeStops: 0,
  constructorThrows: 0,
  postMessageThrows: 0,
  holdTermination: false,
  terminationRejects: false,
  terminationResolvers: [] as Array<() => void>,
}));

const SharedBuffer = vi.hoisted(() => globalThis.SharedArrayBuffer);

vi.mock("node:worker_threads", () => {
  class MockWorker {
    private handlers = new Map<string, Array<(payload?: unknown) => void>>();
    private controller: MockWorkerController;

    constructor() {
      if (mockState.constructorThrows > 0) {
        mockState.constructorThrows--;
        throw new Error("mock worker constructor failed");
      }
      this.controller = {
        inputs: [],
        emit: (event, payload) => this.emit(event, payload),
        terminated: false,
      };
      mockState.workers.push(this.controller);
    }

    on(event: string, callback: (payload?: unknown) => void): this {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(callback);
      this.handlers.set(event, handlers);
      return this;
    }

    postMessage(input: JsExecWorkerInput): void {
      if (mockState.postMessageThrows > 0) {
        mockState.postMessageThrows--;
        throw new Error("mock worker postMessage failed");
      }
      this.controller.inputs.push(input);
    }

    terminate(): Promise<number> {
      this.controller.terminated = true;
      if (mockState.terminationRejects) {
        return Promise.reject(new Error("mock termination rejected"));
      }
      if (!mockState.holdTermination) {
        this.emit("exit", 0);
        return Promise.resolve(0);
      }
      return new Promise<number>((resolve) => {
        mockState.terminationResolvers.push(() => {
          this.emit("exit", 0);
          resolve(0);
        });
      });
    }

    private emit(event: string, payload?: unknown): void {
      for (const handler of this.handlers.get(event) ?? []) handler(payload);
    }
  }

  return { Worker: MockWorker };
});

vi.mock("../worker-bridge/bridge-handler.js", () => {
  class MockBridgeHandler {
    async run(): Promise<{ stdout: string; stderr: string; exitCode: number }> {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    stop(): void {
      mockState.bridgeStops++;
    }
  }
  return { BridgeHandler: MockBridgeHandler };
});

vi.mock("../worker-bridge/protocol.js", () => ({
  createSharedBuffer: () => new SharedBuffer(4096),
}));

import { _resetJsExecWorkerForTests, jsExecCommand } from "./js-exec.js";

function context(signal?: AbortSignal): RuntimeCommandContext {
  return {
    fs: new InMemoryFs(),
    cwd: "/home/user",
    env: new Map(),
    stdin: EMPTY_BYTES,
    limits: resolveLimits({ maxJsTimeoutMs: 1_000 }),
    signal,
  };
}

describe("js-exec initialization failure", () => {
  beforeEach(() => {
    _resetJsExecWorkerForTests();
    mockState.workers = [];
    mockState.bridgeStops = 0;
    mockState.constructorThrows = 0;
    mockState.postMessageThrows = 0;
    mockState.holdTermination = false;
    mockState.terminationRejects = false;
    mockState.terminationResolvers = [];
  });

  it("correlates bootstrap failure and rejects queued and future execution", async () => {
    const first = jsExecCommand.execute(
      ["-c", "console.log('first')"],
      context(),
    );
    const second = jsExecCommand.execute(
      ["-c", "console.log('second')"],
      context(),
    );

    expect(mockState.workers).toHaveLength(1);
    const worker = mockState.workers[0];
    expect(worker.inputs).toHaveLength(1);
    const token = worker.inputs[0].protocolToken;
    worker.emit("message", {
      protocolToken: token,
      type: "initialization-failure",
      success: false,
      error: "QuickJS bootstrap failed",
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.stderr).toBe("js-exec: QuickJS bootstrap failed\n");
    expect(secondResult.stderr).toBe("js-exec: QuickJS bootstrap failed\n");
    expect(firstResult.exitCode).toBe(1);
    expect(secondResult.exitCode).toBe(1);
    expect(worker.terminated).toBe(true);
    expect(mockState.bridgeStops).toBe(2);

    const future = await jsExecCommand.execute(
      ["-c", "console.log('future')"],
      context(),
    );
    expect(future.stderr).toBe("js-exec: QuickJS bootstrap failed\n");
    expect(future.exitCode).toBe(1);
    expect(mockState.workers).toHaveLength(1);
  });

  it("does not accept an uncorrelated initialization failure", async () => {
    const execution = jsExecCommand.execute(["-c", "1"], context());
    const worker = mockState.workers[0];
    worker.emit("message", {
      protocolToken: "wrong-token",
      type: "initialization-failure",
      success: false,
      error: "forged startup failure",
    });

    const result = await execution;
    expect(result.stderr).toContain("invalid protocol token");
    expect(worker.terminated).toBe(false);
  });

  it("removes an aborted queued request without posting it", async () => {
    const first = jsExecCommand.execute(["-c", "1"], context());
    const abort = new AbortController();
    const second = jsExecCommand.execute(["-c", "2"], context(abort.signal));
    abort.abort();

    const secondResult = await second;
    expect(secondResult.stderr).toContain("Execution aborted");
    expect(mockState.workers[0].inputs).toHaveLength(1);

    const token = mockState.workers[0].inputs[0].protocolToken;
    mockState.workers[0].emit("message", {
      protocolToken: token,
      success: true,
    });
    await first;
    expect(mockState.workers[0].inputs).toHaveLength(1);
  });

  it("rolls back a constructor failure and dispatches a later request", async () => {
    mockState.constructorThrows = 1;
    const failed = await jsExecCommand.execute(["-c", "1"], context());
    expect(failed.stderr).toContain("mock worker constructor failed");

    const succeeding = jsExecCommand.execute(["-c", "2"], context());
    expect(mockState.workers).toHaveLength(1);
    const worker = mockState.workers[0];
    expect(worker.inputs).toHaveLength(1);
    worker.emit("message", {
      protocolToken: worker.inputs[0].protocolToken,
      success: true,
    });
    expect((await succeeding).exitCode).toBe(0);
  });

  it("tears down after postMessage throws before dispatching again", async () => {
    mockState.postMessageThrows = 1;
    mockState.holdTermination = true;
    let failedSettled = false;
    const failedPromise = jsExecCommand.execute(["-c", "1"], context());
    void failedPromise.then(() => {
      failedSettled = true;
    });
    expect(mockState.workers[0].terminated).toBe(true);

    const succeeding = jsExecCommand.execute(["-c", "2"], context());
    // The replacement must remain queued until teardown acknowledges; no two
    // workers may own bridge authority concurrently. The failed request also
    // remains live so its teardown callback cannot be suppressed on sandbox
    // deactivation.
    expect(mockState.workers).toHaveLength(1);
    expect(failedSettled).toBe(false);
    mockState.terminationResolvers.shift()?.();
    const failed = await failedPromise;
    expect(failed.stderr).toContain("mock worker postMessage failed");
    await vi.waitFor(() => expect(mockState.workers).toHaveLength(2));
    const worker = mockState.workers[1];
    expect(worker.inputs).toHaveLength(1);
    worker.emit("message", {
      protocolToken: worker.inputs[0].protocolToken,
      success: true,
    });
    expect((await succeeding).exitCode).toBe(0);
  });

  it("does not dispatch a replacement when worker termination rejects", async () => {
    mockState.postMessageThrows = 1;
    mockState.terminationRejects = true;
    const failed = await jsExecCommand.execute(["-c", "1"], context());
    expect(failed.stderr).toContain("mock worker postMessage failed");
    expect(mockState.workers).toHaveLength(1);

    // Allow the rejected termination promise to poison the singleton.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const next = await jsExecCommand.execute(["-c", "2"], context());
    expect(next.stderr).toContain("worker termination was not acknowledged");
    expect(next.exitCode).toBe(1);
    expect(mockState.workers).toHaveLength(1);
    expect(mockState.workers[0].inputs).toHaveLength(0);
  });
});
