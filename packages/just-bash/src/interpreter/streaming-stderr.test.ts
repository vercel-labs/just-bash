import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { defineCommand } from "../custom-commands.js";
import { encodeUtf8ToBytes } from "../encoding.js";
import { InMemoryFs } from "../fs/in-memory-fs/index.js";

describe("streaming pipeline stderr redirection", () => {
  it("keeps descriptor aliases on the same path as descriptor duplication", async () => {
    const delegate = defineCommand(
      "delegate",
      async (_args, ctx) => {
        if (!ctx.execWithInheritedStdin) throw new Error("Expected exec");
        return ctx.execWithInheritedStdin("wc -c", { cwd: ctx.cwd });
      },
      { streaming: true },
    );
    const bash = new Bash({ customCommands: [delegate] });
    for (const [target, fd] of [
      ["/dev/stdout", 1],
      ["/dev/stderr", 2],
    ] as const) {
      const expected = await bash.exec(`seq 3 | delegate 2>&${fd} | cat`);
      const actual = await bash.exec(`seq 3 | delegate 2>'${target}' | cat`);
      expect(actual.stdout).toBe(expected.stdout);
      expect(actual.stderr).toBe(expected.stderr);
      expect(actual.exitCode).toBe(expected.exitCode);
    }
  });

  it("preserves ordered writes when stages redirect stderr to the same file", async () => {
    let appended!: () => void;
    const ready = new Promise<void>((resolve) => {
      appended = resolve;
    });
    class ObservedFs extends InMemoryFs {
      override async appendFile(...args: Parameters<InMemoryFs["appendFile"]>) {
        await super.appendFile(...args);
        if (args[1] === "second\n") appended();
      }
    }
    const first = defineCommand(
      "first",
      async (_args, ctx) => {
        if (ctx.stdio) await ready;
        return { stdout: "", stderr: "first\n", exitCode: 0 };
      },
      { streaming: true },
    );
    const second = defineCommand(
      "second",
      async () => ({ stdout: "", stderr: "second\n", exitCode: 0 }),
      { streaming: true },
    );
    const bash = new Bash({
      fs: new ObservedFs(),
      customCommands: [first, second],
    });
    expect(await bash.exec("first 2>/err | second 2>>/err")).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(await bash.fs.readFile("/err")).toBe("first\nsecond\n");
  });

  it("keeps downstream early termination with stderr redirected", async () => {
    const bash = new Bash({ executionLimits: { maxOutputSize: 32 } });
    expect(
      await bash.exec("seq 1000000 2>/dev/null | head -n 1"),
    ).toMatchObject({
      stdout: "1\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it.each([">", ">>", ">|"])("routes stderr with 2%s", async (operator) => {
    const producer = defineCommand(
      "producer",
      async (_args, ctx) => {
        if (!ctx.stdio) throw new Error("Expected streaming I/O");
        await ctx.stdio.write(encodeUtf8ToBytes("result\n"));
        return { stdout: "", stderr: "warning\n", exitCode: 7 };
      },
      { streaming: true },
    );
    const bash = new Bash({
      files: { "/err": "previous\n" },
      customCommands: [producer],
    });
    expect(
      await bash.exec(`set -o pipefail; producer 2${operator}/err | cat`),
    ).toMatchObject({
      stdout: "result\n",
      stderr: "",
      exitCode: 7,
    });
    expect(await bash.fs.readFile("/err")).toBe(
      operator === ">>" ? "previous\nwarning\n" : "warning\n",
    );
  });
});
