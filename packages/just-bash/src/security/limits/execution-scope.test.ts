import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { defineCommand } from "../../custom-commands.js";
import { ExecutionScope } from "../../execution-scope.js";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "../../interpreter/errors.js";
import { resolveLimits } from "../../limits.js";

describe("shared nested execution scope", () => {
  it("poisons the whole scope after aggregate work exhaustion", () => {
    const scope = new ExecutionScope(resolveLimits({ maxWorkUnits: 2 }));

    expect(scope.consumeWork(2, "test")).toBe(2);
    expect(() => scope.consumeWork(1, "test")).toThrow(ExecutionLimitError);
    expect(() => scope.chargeCommand()).toThrow(ExecutionLimitError);
  });

  it("shares work across named accounting categories", () => {
    const scope = new ExecutionScope(resolveLimits({ maxWorkUnits: 3 }));

    expect(scope.consume("filesystem", 2, "walk")).toBe(2);
    expect(scope.consume("network", 1, "request")).toBe(3);
    expect(() => scope.consume("queue", 1, "worker")).toThrow(
      ExecutionLimitError,
    );
  });

  it("reserves and releases live bytes without double release", () => {
    const scope = new ExecutionScope(resolveLimits({ maxLiveBytes: 5 }));
    const lease = scope.reserveBytes(5, "test");

    expect(() => scope.reserveBytes(1, "test")).toThrow(ExecutionLimitError);
    // Exhaustion intentionally poisons a scope, so use a fresh scope to verify release.
    const releasable = new ExecutionScope(resolveLimits({ maxLiveBytes: 5 }));
    const releasedLease = releasable.reserveBytes(5, "test");
    releasedLease.release();
    releasedLease.release();
    expect(() => releasable.reserveBytes(5, "test")).not.toThrow();
    lease.release();
  });

  it("runs registered cleanup once in reverse ownership order", async () => {
    const scope = new ExecutionScope(resolveLimits());
    const calls: string[] = [];
    scope.registerCleanup(() => {
      calls.push("first");
    });
    scope.registerCleanup(async () => {
      calls.push("second");
    });

    await scope.close();
    await scope.close();

    expect(calls).toEqual(["second", "first"]);
  });

  it("observes the top-level abort signal", () => {
    const controller = new AbortController();
    const scope = new ExecutionScope(resolveLimits(), controller.signal);
    controller.abort();

    expect(() => scope.throwIfAborted("test")).toThrow(ExecutionAbortedError);
  });

  it("shares maxCommandCount with bash -c descendants", async () => {
    const bash = new Bash({ executionLimits: { maxCommandCount: 2 } });

    const result = await bash.exec("bash -c 'echo one; echo two'");

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("too many commands executed");
  });

  it.each([
    ["bash", "bash -c 'echo child'", undefined],
    ["env", "env echo child", undefined],
    ["time", "/usr/bin/time echo child", undefined],
    ["timeout", "timeout 60 echo child", undefined],
    ["xargs", "xargs echo", "child\n"],
  ])("does not refresh the command budget through %s", async (_name, script, stdin) => {
    const bash = new Bash({ executionLimits: { maxCommandCount: 1 } });

    const result = await bash.exec(script, { stdin });

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("too many commands executed");
  });

  it("does not charge an empty child script as a command", async () => {
    const bash = new Bash({ executionLimits: { maxCommandCount: 1 } });

    const result = await bash.exec("bash -c ''");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("starts a fresh command budget for the next public exec", async () => {
    const bash = new Bash({ executionLimits: { maxCommandCount: 2 } });
    const exhausted = await bash.exec("bash -c 'echo one; echo two'");
    expect(exhausted.exitCode).toBe(126);

    const next = await bash.exec("echo fresh");
    expect(next).toMatchObject({
      stdout: "fresh\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("stops direct ctx.exec recursion before parsing another interpreter", async () => {
    const recurse = defineCommand("recurse", async (_args, ctx) => {
      if (!ctx.exec) throw new Error("exec unavailable");
      return ctx.exec("recurse", { cwd: ctx.cwd, signal: ctx.signal });
    });
    const bash = new Bash({
      customCommands: [recurse],
      executionLimits: { maxCommandCount: 100, maxExecDepth: 3 },
    });

    const result = await bash.exec("recurse");

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("maximum nested execution depth (3)");
  });

  it("does not let timeout detach a host abort signal", async () => {
    let childWasAborted = false;
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const waitForAbort = defineCommand("wait-for-abort", async (_args, ctx) => {
      markStarted();
      await new Promise<void>((resolve) => {
        if (ctx.signal?.aborted) {
          childWasAborted = true;
          resolve();
          return;
        }
        ctx.signal?.addEventListener(
          "abort",
          () => {
            childWasAborted = true;
            resolve();
          },
          { once: true },
        );
      });
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const bash = new Bash({ customCommands: [waitForAbort] });
    const controller = new AbortController();
    const execution = bash.exec("timeout 60 wait-for-abort", {
      signal: controller.signal,
    });

    await started;
    controller.abort(new Error("host canceled"));
    const result = await execution;

    expect(childWasAborted).toBe(true);
    expect(result.exitCode).toBe(124);
  });
});
