import { describe, expect, it } from "vitest";
import { Bash } from "./Bash.js";
import { _promiseThen } from "./security/trusted-globals.js";
import { withUnhandledRejectionsTracked } from "./test-utils/unhandled-rejections.js";
import type { Command } from "./types.js";

/** A command whose body is never reached in these tests. */
function loadedCommand(name: string): Command {
  return {
    name,
    async execute() {
      return { stdout: "LOADED\n", stderr: "", exitCode: 0 };
    },
  };
}

/** A load gate the test releases explicitly, so no test relies on a sleep. */
function createLoadGate(): { gate: Promise<void>; release(): void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release: () => release() };
}

describe("lazy custom command loading", () => {
  it("shares one load between invocations", async () => {
    let loadCalls = 0;
    const bash = new Bash({
      customCommands: [
        {
          name: "shared-load",
          load: () => {
            loadCalls += 1;
            return new Promise<Command>(() => {});
          },
        },
      ],
    });

    const result = await bash.exec(`
      timeout 0.01 shared-load
      timeout 0.01 shared-load
      echo "EXIT=$?"
    `);

    expect(result.stdout).toBe("EXIT=124\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(loadCalls).toBe(1);
  });

  it("retries a load that rejected", async () => {
    let loadCalls = 0;
    const bash = new Bash({
      customCommands: [
        {
          name: "flaky-load",
          load: async () => {
            loadCalls += 1;
            if (loadCalls === 1) throw new Error("module unavailable");
            return loadedCommand("flaky-load");
          },
        },
      ],
    });

    const failed = await bash.exec("flaky-load");
    const retried = await bash.exec("flaky-load");

    expect(failed.stdout).toBe("");
    expect(failed.stderr).toBe("flaky-load: module unavailable\n");
    expect(failed.exitCode).toBe(1);
    expect(retried.stdout).toBe("LOADED\n");
    expect(retried.exitCode).toBe(0);
    expect(loadCalls).toBe(2);
  });

  it("retries a load that threw synchronously", async () => {
    let loadCalls = 0;
    const bash = new Bash({
      customCommands: [
        {
          name: "sync-throw-load",
          load: () => {
            loadCalls += 1;
            if (loadCalls === 1) throw new Error("sync failure");
            return Promise.resolve(loadedCommand("sync-throw-load"));
          },
        },
      ],
    });

    const failed = await bash.exec("sync-throw-load");
    const retried = await bash.exec("timeout 1 sync-throw-load");

    expect(failed.stdout).toBe("");
    expect(failed.stderr).toBe("sync-throw-load: sync failure\n");
    expect(failed.exitCode).toBe(1);
    expect(retried.stdout).toBe("LOADED\n");
    expect(retried.exitCode).toBe(0);
    expect(loadCalls).toBe(2);
  });

  it("uses a load that resolved after an untrusted invocation was cancelled", async () => {
    const { gate, release } = createLoadGate();
    let loadCalls = 0;
    const bash = new Bash({
      customCommands: [
        {
          name: "late-load",
          trusted: false,
          load: async () => {
            loadCalls += 1;
            await gate;
            return loadedCommand("late-load");
          },
        },
      ],
    });

    const cancelled = await bash.exec(`
      timeout 0.01 late-load
      echo "EXIT=$?"
    `);
    release();
    const later = await bash.exec("timeout 1 late-load");

    expect(cancelled.stdout).toBe("EXIT=124\n");
    expect(cancelled.exitCode).toBe(0);
    expect(later.stdout).toBe("LOADED\n");
    expect(later.exitCode).toBe(0);
    expect(loadCalls).toBe(1);
  });

  it("does not run a loader-controlled promise method", async () => {
    let thenCalls = 0;
    let blockedGlobalReachable: boolean | undefined;
    const bash = new Bash({
      customCommands: [
        {
          name: "custom-then",
          trusted: false,
          load: () => {
            const promise = Promise.resolve(loadedCommand("custom-then"));
            // The loader controls this method; whoever calls it runs loader code.
            // biome-ignore lint/suspicious/noThenProperty: the loader-controlled then is exactly what this test exercises
            Object.defineProperty(promise, "then", {
              value: (onFulfilled?: unknown, onRejected?: unknown) => {
                thenCalls += 1;
                try {
                  Function("return 42")();
                  blockedGlobalReachable = true;
                } catch {
                  blockedGlobalReachable = false;
                }
                return _promiseThen.call(
                  promise,
                  onFulfilled as () => unknown,
                  onRejected as () => unknown,
                );
              },
            });
            return promise;
          },
        },
      ],
    });

    const result = await bash.exec("custom-then");

    expect(result.stdout).toBe("LOADED\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    // Nothing the loader controls may run with blocking suspended.
    expect(blockedGlobalReachable).not.toBe(true);
    expect(thenCalls).toBe(0);
  });

  it("retries a load that failed after an untrusted invocation was cancelled", async () => {
    const { gate, release } = createLoadGate();
    let loadCalls = 0;
    const bash = new Bash({
      customCommands: [
        {
          name: "late-failure-load",
          trusted: false,
          load: async () => {
            loadCalls += 1;
            if (loadCalls === 1) {
              await gate;
              throw new Error("late rejection");
            }
            return loadedCommand("late-failure-load");
          },
        },
      ],
    });

    const { result: cancelled, rejections } =
      await withUnhandledRejectionsTracked(async () => {
        const outcome = await bash.exec(`
          timeout 0.01 late-failure-load
          echo "EXIT=$?"
        `);
        release();
        const retried = await bash.exec("timeout 1 late-failure-load");
        return { outcome, retried };
      });

    expect(cancelled.outcome.stdout).toBe("EXIT=124\n");
    expect(cancelled.outcome.exitCode).toBe(0);
    expect(cancelled.retried.stdout).toBe("LOADED\n");
    expect(cancelled.retried.exitCode).toBe(0);
    expect(loadCalls).toBe(2);
    expect(rejections).toEqual([]);
  });
});
