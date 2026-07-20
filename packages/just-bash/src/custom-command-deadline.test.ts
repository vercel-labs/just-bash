import { describe, expect, it } from "vitest";
import { Bash } from "./Bash.js";
import { type CustomCommand, defineCommand } from "./custom-commands.js";

function never(): Promise<never> {
  return new Promise(() => {});
}

describe("custom command deadline boundary", () => {
  it("exposes an inert stable filesystem identity instead of the filesystem", async () => {
    const identities: object[] = [];
    let mutationError: unknown;
    const bash = new Bash({
      defenseInDepth: false,
      customCommands: [
        defineCommand("identity", async (_args, ctx) => {
          const identity = ctx.fsIdentity;
          if (!identity) throw new Error("missing filesystem identity");
          identities.push(identity);
          expect(identity).not.toBe(ctx.fs);
          expect(Object.getPrototypeOf(identity)).toBeNull();
          expect(Object.isFrozen(identity)).toBe(true);
          return { stdout: "", stderr: "", exitCode: 0 };
        }),
      ],
    });

    await bash.exec("identity");
    await bash.exec("identity");
    try {
      Object.defineProperty(identities[0], "writeFile", { value: () => {} });
    } catch (error) {
      mutationError = error;
    }

    expect(identities[0]).toBe(identities[1]);
    expect(mutationError).toBeInstanceOf(TypeError);
    expect("writeFile" in identities[0]).toBe(false);
  });

  it("does not expose execution lifecycle or result-accounting authority", async () => {
    let exposedKeys: string[] = [];
    const bash = new Bash({
      defenseInDepth: false,
      customCommands: [
        defineCommand("budget", async (_args, ctx) => {
          const budget = ctx.executionScope as unknown as Record<
            string,
            unknown
          >;
          exposedKeys = [
            "close",
            "poisonAfterAbort",
            "relinquishOutput",
            "accountResult",
            "appendOutput",
            "chargeCommand",
          ].filter((name) => typeof budget[name] === "function");
          return { stdout: "", stderr: "", exitCode: 0 };
        }),
      ],
    });

    const result = await bash.exec("budget; echo still-running");
    expect(result.stdout).toBe("still-running\n");
    expect(exposedKeys).toEqual([]);
  });

  it("does not retain the host AbortSignal or mutable filesystem identity after abort", async () => {
    const controller = new AbortController();
    let markReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    let retainedSignal: AbortSignal | undefined;
    let retainedIdentity: object | undefined;
    const bash = new Bash({
      defenseInDepth: false,
      customCommands: [
        defineCommand("retain", async (_args, ctx) => {
          retainedSignal = ctx.signal;
          retainedIdentity = ctx.fsIdentity;
          markReady();
          return never();
        }),
      ],
      executionLimits: {
        maxExecutionTimeMs: 1_000,
        maxExtensionCleanupTimeMs: 5,
      },
    });

    const execution = bash.exec("retain", { signal: controller.signal });
    await ready;
    controller.abort();
    await execution;

    expect(retainedSignal).not.toBe(controller.signal);
    expect(retainedSignal?.aborted).toBe(true);
    expect(() =>
      Object.defineProperty(retainedIdentity, "writeFile", { value: () => {} }),
    ).toThrow(TypeError);
    expect("writeFile" in (retainedIdentity ?? {})).toBe(false);
  });

  it.each([
    "direct",
    "helper",
    "lazy",
  ] as const)("bounds a never-settling %s command", async (kind) => {
    const execute = async () => never();
    const command: CustomCommand =
      kind === "direct"
        ? { name: kind, execute }
        : kind === "helper"
          ? defineCommand(kind, execute)
          : { name: kind, load: async () => ({ name: kind, execute }) };
    const bash = new Bash({
      defenseInDepth: false,
      customCommands: [command],
      executionLimits: {
        maxExecutionTimeMs: 15,
        maxExtensionCleanupTimeMs: 5,
      },
    });
    const started = Date.now();

    const result = await bash.exec(kind);

    expect(Date.now() - started).toBeLessThan(250);
    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain("execution deadline");
  });

  it("makes timeout binding for an abort-ignorant custom command", async () => {
    const bash = new Bash({
      defenseInDepth: false,
      customCommands: [{ name: "never", execute: async () => never() }],
      executionLimits: {
        maxExecutionTimeMs: 1_000,
        maxExtensionCleanupTimeMs: 5,
      },
    });
    const started = Date.now();

    const result = await bash.exec("timeout 0.01 never");

    expect(Date.now() - started).toBeLessThan(250);
    expect(result.exitCode).toBe(124);
  });

  it("bounds an abort-ignorant sleep hook", async () => {
    const bash = new Bash({
      defenseInDepth: false,
      sleep: async () => never(),
      executionLimits: {
        maxExecutionTimeMs: 1_000,
        maxExtensionCleanupTimeMs: 5,
      },
    });

    const result = await bash.exec("timeout 0.01 sleep 60");

    expect(result.exitCode).toBe(124);
  });

  it("bounds an abort-ignorant fetch hook", async () => {
    const bash = new Bash({
      defenseInDepth: false,
      fetch: async () => never(),
      executionLimits: {
        maxExecutionTimeMs: 1_000,
        maxExtensionCleanupTimeMs: 5,
      },
    });

    const result = await bash.exec("timeout 0.01 curl https://example.com");

    expect(result.exitCode).toBe(124);
  });

  it("revokes shell capabilities from a late continuation", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let lateError: unknown;
    const bash = new Bash({
      defenseInDepth: false,
      customCommands: [
        defineCommand("late", async (_args, ctx) => {
          await gate;
          try {
            await ctx.fs.writeFile("/late", "accepted");
          } catch (error) {
            lateError = error;
          }
          return { stdout: "late\n", stderr: "", exitCode: 0 };
        }),
      ],
      executionLimits: {
        maxExecutionTimeMs: 10,
        maxExtensionCleanupTimeMs: 5,
      },
    });

    const result = await bash.exec("late");
    release();
    await Promise.resolve();
    await Promise.resolve();

    expect(result.exitCode).toBe(124);
    await expect(bash.fs.exists("/late")).resolves.toBe(false);
    expect(lateError).toMatchObject({ name: "ExecutionAbortedError" });
  });

  it("revokes descriptor and accounting capabilities before abort grace", async () => {
    let descriptorError: unknown;
    let accountingError: unknown;
    const controller = new AbortController();
    const bash = new Bash({
      defenseInDepth: false,
      customCommands: [
        defineCommand("during-grace", async (_args, ctx) => {
          await new Promise<void>((resolve) => {
            ctx.signal?.addEventListener("abort", () => resolve(), {
              once: true,
            });
          });
          try {
            ctx.fileDescriptors?.set(9, "late");
          } catch (error) {
            descriptorError = error;
          }
          try {
            ctx.executionScope?.consumeWork(1, "late extension");
          } catch (error) {
            accountingError = error;
          }
          return never();
        }),
      ],
      executionLimits: {
        maxExecutionTimeMs: 1_000,
        maxExtensionCleanupTimeMs: 20,
      },
    });

    const execution = bash.exec("during-grace 9<<<x", {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    const result = await execution;

    expect(result.exitCode).toBe(124);
    expect(descriptorError).toMatchObject({ name: "ExecutionAbortedError" });
    expect(accountingError).toMatchObject({ name: "ExecutionAbortedError" });
  });

  it("revokes capabilities returned by context methods before abort cleanup", async () => {
    let markReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    let unregisterError: unknown;
    let releaseError: unknown;
    let cleanupRuns = 0;
    const controller = new AbortController();
    const bash = new Bash({
      defenseInDepth: false,
      customCommands: [
        defineCommand("returned-capability", async (_args, ctx) => {
          const unregister = ctx.executionScope?.registerCleanup(() => {
            cleanupRuns++;
          });
          const depthLease = ctx.executionScope?.enterDepth(
            "extension-test",
            "returned capability",
          );
          ctx.signal?.addEventListener(
            "abort",
            () => {
              try {
                unregister?.();
              } catch (error) {
                unregisterError = error;
              }
              try {
                depthLease?.release();
              } catch (error) {
                releaseError = error;
              }
            },
            { once: true },
          );
          markReady();
          return never();
        }),
      ],
      executionLimits: {
        maxExecutionTimeMs: 1_000,
        maxExtensionCleanupTimeMs: 20,
      },
    });

    const execution = bash.exec("returned-capability", {
      signal: controller.signal,
    });
    await ready;
    controller.abort();
    const result = await execution;

    expect(result.exitCode).toBe(124);
    expect(unregisterError).toMatchObject({ name: "ExecutionAbortedError" });
    expect(releaseError).toMatchObject({ name: "ExecutionAbortedError" });
    expect(cleanupRuns).toBe(1);
  });
});
