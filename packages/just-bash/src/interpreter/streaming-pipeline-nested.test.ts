import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { defineCommand } from "../custom-commands.js";
import { ExecutionLimitError } from "./errors.js";

describe("nested execution in streaming pipelines", () => {
  it("cancels nested commands when another stage fails", async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: () => void;
    const stopped = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let cancelled = false;
    const child = defineCommand("child", async (_args, ctx) => {
      ctx.signal?.addEventListener(
        "abort",
        () => {
          cancelled = true;
          finish();
        },
        { once: true },
      );
      started();
      await stopped;
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const nested = defineCommand(
      "nested",
      async (_args, ctx) => {
        if (!ctx.exec) throw new Error("Expected exec");
        return ctx.exec("child", { cwd: ctx.cwd });
      },
      { streaming: true },
    );
    const fail = defineCommand(
      "fail",
      async () => {
        await ready;
        throw new ExecutionLimitError("stage failed", "iterations");
      },
      { streaming: true },
    );
    try {
      const result = await new Bash({
        customCommands: [child, nested, fail],
        executionLimits: { maxExtensionCleanupTimeMs: 20 },
      }).exec("nested | fail");
      expect(result.exitCode).toBe(126);
      expect(cancelled).toBe(true);
    } finally {
      finish();
    }
  });

  it("falls back when sibling pipelines fill the remaining stage capacity", async () => {
    const nested = defineCommand(
      "nested",
      async (_args, ctx) => {
        if (!ctx.exec) throw new Error("Expected exec");
        return ctx.exec("seq 0 | cat", { cwd: ctx.cwd });
      },
      { streaming: true },
    );
    const result = await new Bash({ customCommands: [nested] }).exec(
      Array(40).fill("nested").join(" | "),
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
  it.each([
    false,
    true,
  ])("charges nested output once (frozen: %s)", async (frozen) => {
    const producer = defineCommand(
      "producer",
      async (_args, ctx) => {
        if (!ctx.exec) throw new Error("Expected exec");
        const result = await ctx.exec("printf hello", { cwd: ctx.cwd });
        return frozen ? Object.freeze(result) : result;
      },
      { streaming: true },
    );
    const result = await new Bash({
      customCommands: [producer],
      executionLimits: { maxOutputSize: 8 },
    }).exec("producer | cat");
    expect(result.stdout).toBe("hello");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("does not credit fabricated accounting beyond nested output", async () => {
    const producer = defineCommand(
      "producer",
      async (_args, ctx) => {
        if (!ctx.exec) throw new Error("Expected exec");
        await ctx.exec("printf x", { cwd: ctx.cwd });
        return {
          stdout: "x".repeat(20),
          stderr: "",
          exitCode: 0,
          internalOutputAccounting: { stdout: 20, stderr: 0 },
        };
      },
      { streaming: true },
    );
    const result = await new Bash({
      customCommands: [producer],
      executionLimits: { maxOutputSize: 8 },
    }).exec("producer | cat");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("total output size exceeded");
  });

  it.each([
    false,
    true,
  ])("counts original-command output once (forged: %s)", async (forged) => {
    const find = defineCommand(
      "find",
      async (_args, ctx) => {
        if (!ctx.origCommand) throw new Error("Expected original command");
        const result = await ctx.origCommand([
          "/file",
          "-exec",
          "printf",
          "hello",
          ";",
        ]);
        return forged
          ? {
              ...result,
              stdout: "helloworld",
              internalOutputAccounting: { stdout: 10, stderr: 0 },
            }
          : result;
      },
      { streaming: true },
    );
    const result = await new Bash({
      files: { "/file": "" },
      customCommands: [find],
      executionLimits: { maxOutputSize: 8 },
    }).exec("find | cat");
    if (forged) {
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("total output size exceeded");
    } else {
      expect(result.stdout).toBe("hello");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    }
  });

  it("preserves nested stderr without charging it twice", async () => {
    const producer = defineCommand(
      "producer",
      async (_args, ctx) => {
        if (!ctx.exec) throw new Error("Expected exec");
        return ctx.exec("printf hi; printf err >&2", { cwd: ctx.cwd });
      },
      { streaming: true },
    );
    const result = await new Bash({
      customCommands: [producer],
      executionLimits: { maxOutputSize: 5 },
    }).exec("producer | cat");
    expect(result.stdout).toBe("hi");
    expect(result.stderr).toBe("err");
    expect(result.exitCode).toBe(0);
  });
});
