import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { defineCommand } from "../custom-commands.js";
import { latin1FromBytes } from "../encoding.js";
import { InMemoryFs } from "../fs/in-memory-fs/index.js";
import { readCommandStdin } from "../streams/command-stdio.js";

describe("streaming pipeline input reservations", () => {
  it("bounds buffered streaming command fallbacks by live bytes", async () => {
    const result = await new Bash({
      executionLimits: { maxLiveBytes: 64 },
    }).exec("seq 100 | cat -n | head -1");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toMatch(/live byte limit exceeded/);
  });

  it("keeps collected input reserved until its command finishes", async () => {
    const remaining: (number | undefined)[] = [];
    const collect = defineCommand(
      "collect",
      async (_args, ctx) => {
        const input = await readCommandStdin(ctx);
        remaining.push(ctx.executionScope?.remainingLiveBytes);
        expect(latin1FromBytes(input).length).toBe(10);
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      { streaming: true },
    );
    const result = await new Bash({
      customCommands: [collect],
      executionLimits: { maxLiveBytes: 64 },
    }).exec("seq 5 | collect; seq 5 | collect");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(remaining).toEqual([54, 54]);
  });
});

describe("streaming pipeline admission", () => {
  it("checks the command budget before starting any stages", async () => {
    let started = 0;
    const command = defineCommand(
      "stage",
      async () => {
        started++;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      { streaming: true },
    );
    const result = await new Bash({
      customCommands: [command],
      executionLimits: { maxCommandCount: 2 },
    }).exec("stage | stage | stage");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toMatch(/too many commands/);
    expect(started).toBe(0);
  });

  it("uses the buffered executor for oversized pipelines", async () => {
    let streaming = false;
    const command = defineCommand(
      "stage",
      async (_args, ctx) => {
        streaming ||= ctx.stdio !== undefined;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      { streaming: true },
    );
    const result = await new Bash({ customCommands: [command] }).exec(
      Array(65).fill("stage").join(" | "),
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(streaming).toBe(false);
  });

  it("falls back to buffered execution once nested stages reach the cap", async () => {
    const modes: boolean[] = [];
    const command = defineCommand(
      "nested",
      async (_args, ctx) => {
        modes.push(ctx.stdio !== undefined);
        if (modes.length >= 40) return { stdout: "", stderr: "", exitCode: 0 };
        if (!ctx.exec) throw new Error("Missing exec");
        return ctx.exec("nested | cat", { cwd: ctx.cwd });
      },
      { streaming: true },
    );
    const result = await new Bash({ customCommands: [command] }).exec(
      "nested | cat",
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(modes).toEqual([...Array(32).fill(true), ...Array(8).fill(false)]);
  });
});

describe("streaming command resolution", () => {
  it.each([
    "seq 5 | head -1",
    "wc -l /file | sort",
  ])("resolves each command once: %s", async (script) => {
    class CountingFs extends InMemoryFs {
      probes: string[] = [];
      override async exists(path: string) {
        if (path.startsWith("/usr/bin/")) this.probes.push(path);
        return super.exists(path);
      }
    }
    const fs = new CountingFs({ "/file": "hello\n" });
    const bash = new Bash({ fs });
    fs.probes.length = 0;
    const result = await bash.exec(script);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(fs.probes).toEqual(
      script.startsWith("seq")
        ? ["/usr/bin/seq", "/usr/bin/head"]
        : ["/usr/bin/wc", "/usr/bin/sort"],
    );
  });
});
