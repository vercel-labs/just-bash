// Automa modifications: migrated patch-output-order/output-sink regression cases.
import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("Automa ordered terminal output", () => {
  it.each([
    [
      "f(){ printf a; printf b >&2; printf c; } 2>&1; f | cat",
      "abc",
      "",
      "abc",
    ],
    [
      "f(){ printf a; printf b >&2; printf c; return; } 2>&1; f | cat",
      "abc",
      "",
      "abc",
    ],
    [
      "f(){ printf a; printf b >&2; printf c; return; } 2>&1; f",
      "abc",
      "",
      "abc",
    ],
    [
      "f(){ printf a; printf b >&2; printf c; return; } 1>&2; f | cat",
      "",
      "abc",
      "abc",
    ],
    [
      "f(){ printf a; printf b >&2; printf c; return; } > /tmp/captured 2>&1; f; cat /tmp/captured",
      "abc",
      "",
      "abc",
    ],
    [
      "f(){ printf a; printf b >&2; printf c; return; } 2>&1; f > /dev/null; printf X",
      "X",
      "",
      "X",
    ],
  ])("defers definition redirects until final routing: %s", async (script, stdout, stderr, ordered) => {
    let observed = "";
    const result = await new Bash().exec(script, {
      onOutput: (text) => {
        observed += text;
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe(stderr);
    expect(result.output).toBe(ordered);
    expect(observed).toBe(ordered);
  });
  it.each([
    ["f(){ { printf a; printf b >&2; printf c; return; } 2>&1; }; f | cat", 0],
    ["{ printf a; printf b >&2; printf c; exit 7; } 2>&1", 7],
  ])("retains routed segments through a control-flow error: %s", async (script, status) => {
    const result = await new Bash().exec(script);
    expect(result.stdout).toBe("abc");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(status);
    expect(result.output).toBe("abc");
  });

  it.each([
    ["printf a; printf b >&2; printf c", "abc"],
    ["{ printf a; printf b >&2; printf c; } 2>&1", "abc"],
    ["{ printf a; printf b >&2; printf c; } > /out 2>&1; cat /out", "abc"],
    ["{ printf a; printf b >&2; printf c; } |& cat", "abc"],
    ["for x in a b; do printf $x; printf E >&2; done", "aEbE"],
    ["f() { printf a; printf b >&2; return; }; f; printf c", "abc"],
    ["x=$(printf a; printf b >&2); printf '<%s>' \"$x\"", "b<a>"],
    ["printf a >/file; printf b >&2; cat /file", "ba"],
    ["printf '\\342'; printf '\\202'; printf '\\254'", "€"],
    ["printf '\\357\\273\\277x'", "\uFEFFx"],
  ])("streams %s once", async (script, expected) => {
    const parts: string[] = [];
    const result = await new Bash().exec(script, {
      onOutput: (text) => {
        parts.push(text);
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe(expected);
    expect(parts.join("")).toBe(expected);
  });

  it("publishes a completed command before a later command finishes", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const parts: string[] = [];
    const bash = new Bash({
      customCommands: [
        {
          name: "waiter",
          async execute() {
            expect(parts.join("")).toBe("before");
            release();
            return { stdout: "after", stderr: "", exitCode: 0 };
          },
        },
      ],
    });
    const result = bash.exec("printf before; waiter", {
      onOutput: (text) => {
        parts.push(text);
      },
    });
    await pending;
    expect((await result).output).toBe("beforeafter");
  });

  it("resource exhaustion survives ordinary shell recovery", async () => {
    const result = await new Bash({
      executionLimits: { maxCommandCount: 3 },
    }).exec("bash -c 'while :; do :; done' || true; echo hidden");
    expect(result.executionFailure?.kind).toBe("resource-limit");
    expect(result.exitCode).toBe(126);
    expect(result.stdout).not.toContain("hidden");
  });
});

describe("command descriptor writes", () => {
  const result = { stdout: "", stderr: "", exitCode: 0 };

  it("publishes a write before exit and revokes the writer", async () => {
    let sawFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      sawFirst = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let late!: () => Promise<void>;
    const bash = new Bash({
      customCommands: [
        {
          name: "live",
          async execute(_args, ctx) {
            const write = ctx.writeOutput;
            if (!write) throw new Error("No command output writer");
            late = () => write("late", "stdout");
            await write("one", "stdout");
            await gate;
            await write("two", "stderr");
            return { ...result, stdout: "three" };
          },
        },
      ],
    });
    const output: string[] = [];
    const pending = bash.exec("live 2>&1", {
      onOutput: (text, stream) => {
        output.push(`${stream}:${text}`);
        sawFirst();
      },
    });
    await first;
    expect(output).toEqual(["stdout:one"]);
    release();
    expect(await pending).toMatchObject({
      stdout: "onetwothree",
      stderr: "",
      output: "onetwothree",
    });
    expect(output).toEqual(["stdout:one", "stdout:two", "stdout:three"]);
    expect(late).toThrow();
  });

  it("routes pipe, merged, and file descriptors once", async () => {
    const bash = new Bash({
      customCommands: [
        {
          name: "live",
          async execute(_args, ctx) {
            if (!ctx.writeOutput) throw new Error("No command output writer");
            await ctx.writeOutput("a", "stdout");
            await ctx.writeOutput("b", "stderr");
            await ctx.writeOutput("c", "stdout");
            return result;
          },
        },
      ],
    });
    for (const [script, visible, stdout] of [
      ["live | cat", "bac", "ac"],
      ["live 2>&1 | cat", "abc", "abc"],
      ["exec 3>&1 >/out; live; exec 1>&3; cat /out", "bac", "ac"],
      ["live > /out; cat /out", "bac", "ac"],
      ["x=$(live); printf '<%s>' \"$x\"", "b<ac>", "<ac>"],
    ]) {
      const chunks: string[] = [];
      const actual = await bash.exec(script, {
        onOutput: (text) => {
          chunks.push(text);
        },
      });
      expect(actual.stdout).toBe(stdout);
      expect(actual.output).toBe(visible);
      expect(chunks.join("")).toBe(visible);
    }
  });

  it("counts UTF-8 output before delivery and only once", async () => {
    const bash = new Bash({
      executionLimits: { maxOutputSize: 4 },
      customCommands: [
        {
          name: "live",
          async execute(args, ctx) {
            if (!ctx.writeOutput) throw new Error("No command output writer");
            await ctx.writeOutput("é", "stdout");
            await ctx.writeOutput(args[0], "stdout");
            return result;
          },
        },
      ],
    });
    expect(await bash.exec("live é")).toMatchObject({
      exitCode: 0,
      stdout: "éé",
    });
    const output: string[] = [];
    const failed = await bash.exec("live xxx", {
      onOutput: (text) => {
        output.push(text);
      },
    });
    expect(failed.executionFailure?.kind).toBe("resource-limit");
    expect(output).toContain("é");
    expect(output).not.toContain("xxx");
  });
});
