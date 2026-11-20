import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { defineCommand } from "../../custom-commands.js";
import { ExecutionScope } from "../../execution-scope.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { DefenseInDepthBox } from "../../security/defense-in-depth-box.js";
import { jqCommand } from "./jq.js";

const input = JSON.stringify("x".repeat(98));

describe("jq file input budgets", () => {
  it("does not reserve directory metadata as file content", async () => {
    class DirectorySizeFs extends InMemoryFs {
      override async stat(path: string) {
        const stat = await super.stat(path);
        return stat.isDirectory ? { ...stat, size: 4096 } : stat;
      }
    }
    const bash = new Bash({
      fs: new DirectorySizeFs({ "/directory/a": input }),
      executionLimits: { maxLiveBytes: 300 },
    });
    const result = await bash.exec("jq empty /directory");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("jq: /directory: No such file or directory\n");
    expect(result.exitCode).toBe(2);
  });

  it("stops the execution after a single oversized file", async () => {
    const fs = new InMemoryFs({ "/a": input });
    const readFile = vi.spyOn(fs, "readFileBytes");
    const bash = new Bash({ fs, executionLimits: { maxInputBytes: 50 } });
    const result = await bash.exec("jq empty /a; jq empty /a; echo continued");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: jq: aggregate input size limit exceeded (50 bytes)\n",
    );
    expect(result.exitCode).toBe(126);
    expect(readFile).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true,
  ])("does not read a file larger than the remaining budget (extension: %s)", async (extension) => {
    const fs = new InMemoryFs({ "/a": input, "/b": input });
    const readFile = vi.spyOn(fs, "readFileBytes");
    let usedFacade = false;
    const bash = new Bash({
      fs,
      customCommands: extension
        ? [
            defineCommand("jq", async (args, ctx) => {
              usedFacade =
                ctx.executionScope !== undefined &&
                !(ctx.executionScope instanceof ExecutionScope);
              return jqCommand.execute(args, ctx);
            }),
          ]
        : undefined,
      executionLimits: { maxInputBytes: 150 },
    });
    const result = await bash.exec("jq empty /a; jq empty /b");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: jq: aggregate input size limit exceeded (150 bytes)\n",
    );
    expect(result.exitCode).toBe(126);
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith("/a");
    expect(usedFacade).toBe(extension);
  });

  it("charges actual file bytes when the stat size is stale", async () => {
    class AdvisorySizeFs extends InMemoryFs {
      override async stat(path: string) {
        return { ...(await super.stat(path)), size: 120 };
      }
    }
    const bash = new Bash({
      fs: new AdvisorySizeFs({ "/a": input }),
      executionLimits: { maxInputBytes: 230 },
    });
    const result = await bash.exec("jq empty /a; jq empty /a");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("charges bytes read beyond the stat size to the input budget", async () => {
    class AdvisorySizeFs extends InMemoryFs {
      override async stat(path: string) {
        return { ...(await super.stat(path)), size: 0 };
      }
    }
    const fs = new AdvisorySizeFs({ "/a": input });
    const readFile = vi.spyOn(fs, "readFileBytes");
    const bash = new Bash({
      fs,
      executionLimits: { maxInputBytes: 99 },
    });
    const result = await bash.exec("jq empty /a");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: jq: aggregate input size limit exceeded (99 bytes)\n",
    );
    expect(result.exitCode).toBe(126);
    expect(readFile).toHaveBeenCalledWith("/a");
  });

  it("accounts for bytes beyond an advisory stat size", async () => {
    class AdvisorySizeFs extends InMemoryFs {
      override async stat(path: string) {
        return { ...(await super.stat(path)), size: 0 };
      }
    }
    for (const maxLiveBytes of [200, 199]) {
      const bash = new Bash({
        fs: new AdvisorySizeFs({ "/a": input }),
        executionLimits: { maxLiveBytes },
      });
      const result = await bash.exec("jq empty /a");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        maxLiveBytes === 200
          ? ""
          : "bash: jq: live byte limit exceeded (199 bytes)\n",
      );
      expect(result.exitCode).toBe(maxLiveBytes === 200 ? 0 : 126);
    }
  });

  it("charges file operands and argument files to the aggregate input budget", async () => {
    for (const command of [
      "jq empty /a /b",
      "jq -n --rawfile a /a --rawfile b /b empty",
      "jq -n --slurpfile a /a --slurpfile b /b empty",
    ]) {
      const bash = new Bash({
        files: { "/a": input, "/b": input },
        executionLimits: { maxInputBytes: 150 },
      });
      const result = await bash.exec(command);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "bash: jq: aggregate input size limit exceeded (150 bytes)\n",
      );
      expect(result.exitCode).toBe(126);
    }
  });

  it("reserves retained file text across the input batch", async () => {
    const bash = new Bash({
      files: { "/a": input, "/b": input },
      executionLimits: { maxLiveBytes: 300 },
    });
    const result = await bash.exec("jq empty /a /b");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: jq: live byte limit exceeded (300 bytes)\n",
    );
    expect(result.exitCode).toBe(126);
  });

  it("releases file reservations after file errors and successful commands", async () => {
    const bash = new Bash({
      files: { "/a": input },
      executionLimits: { maxLiveBytes: 300 },
    });
    const result = await bash.exec(
      "jq empty /missing /a; jq empty /a; jq empty /a",
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("jq: /missing: No such file or directory\n");
    expect(result.exitCode).toBe(0);
  });

  it("releases a failed file read before a later file reserves its bytes", async () => {
    let failStarted!: () => void;
    const failedRead = new Promise<void>((resolve) => {
      failStarted = resolve;
    });
    let allowGoodStat!: () => void;
    const goodStat = new Promise<void>((resolve) => {
      allowGoodStat = resolve;
    });
    class ReadFailureFs extends InMemoryFs {
      override async stat(path: string) {
        if (path === "/good") await goodStat;
        return super.stat(path);
      }

      override async readFileBytes(path: string) {
        if (path === "/bad") {
          failStarted();
          throw new Error("read failed");
        }
        return super.readFileBytes(path);
      }
    }
    const bash = new Bash({
      fs: new ReadFailureFs({ "/bad": input, "/good": input }),
      executionLimits: { maxLiveBytes: 200 },
    });
    const execution = bash.exec("jq empty /bad /good");
    await failedRead;
    await setImmediate();
    allowGoodStat();
    const result = await execution;

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("jq: /bad: No such file or directory\n");
    expect(result.exitCode).toBe(2);
  });

  it.each([
    ["stat", "resolve", "jq empty /slow"],
    ["stat", "reject", "jq empty /slow"],
    ["read", "resolve", "jq empty /slow"],
    ["read", "reject", "jq empty /slow"],
    ["read", "resolve", "wc /slow"],
    ["read", "reject", "wc /slow"],
  ] as const)("handles a delayed %s that settles after cancellation: %s (%s)", async (phase, outcome, command) => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let resolveOperation!: () => void;
    let rejectOperation!: (error: Error) => void;
    const operationGate = new Promise<void>((resolve, reject) => {
      resolveOperation = resolve;
      rejectOperation = reject;
    });
    let executionId: string | undefined;
    let operationSettled = false;
    class DelayedFs extends InMemoryFs {
      override async stat(path: string) {
        if (path === "/slow" && phase === "stat") {
          const stat = await super.stat(path);
          executionId = DefenseInDepthBox.getCurrentExecutionId();
          markStarted();
          try {
            await operationGate;
          } finally {
            operationSettled = true;
          }
          return stat;
        }
        return super.stat(path);
      }

      override async readFileBytes(path: string) {
        if (path === "/slow" && phase === "read") {
          const content = await super.readFileBytes(path);
          executionId = DefenseInDepthBox.getCurrentExecutionId();
          markStarted();
          try {
            await operationGate;
          } finally {
            operationSettled = true;
          }
          return content;
        }
        return super.readFileBytes(path);
      }
    }
    const controller = new AbortController();
    const bash = new Bash({
      fs: new DelayedFs({ "/slow": input }),
      executionLimits: { maxExtensionCleanupTimeMs: 0 },
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const execution = bash.exec(command, {
        signal: controller.signal,
      });
      await started;
      controller.abort();
      const result = await execution;
      expect(result.exitCode).toBe(124);
      expect(executionId).toBeDefined();
      expect(DefenseInDepthBox.getInstance(true).isActive()).toBe(false);

      if (outcome === "resolve") resolveOperation();
      else rejectOperation(new Error("late filesystem failure"));
      await setImmediate();
      await setImmediate();
      expect(operationSettled).toBe(true);
      expect(unhandled).toStrictEqual([]);
    } finally {
      resolveOperation();
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
