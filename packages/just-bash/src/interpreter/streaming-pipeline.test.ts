import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { defineCommand } from "../custom-commands.js";
import { encodeUtf8ToBytes, unsafeBytesFromLatin1 } from "../encoding.js";
import type { RuntimeCommandContext } from "../types.js";

function stdio(ctx: RuntimeCommandContext) {
  if (!ctx.stdio) throw new Error("Expected streaming I/O");
  return ctx.stdio;
}

describe("streaming pipelines", () => {
  it("stops an unfinished producer when head has enough input", async () => {
    let produced = 0;
    let finished = false;
    const producer = defineCommand(
      "producer",
      async (_args, ctx) => {
        try {
          for (;;) {
            produced++;
            await stdio(ctx).write(encodeUtf8ToBytes("hello\n"));
          }
        } finally {
          finished = true;
        }
      },
      { streaming: true },
    );
    const result = await new Bash({ customCommands: [producer] }).exec(
      "producer | cat | head -n 1",
    );
    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(produced * 6).toBeLessThanOrEqual(4 * 64 * 1024 + 6);
    expect(finished).toBe(true);
  });

  it("does not materialize seq before running head", async () => {
    const result = await new Bash({
      executionLimits: { maxOutputSize: 32, maxLoopIterations: 20_000 },
    }).exec("seq 1000000000 | cat | head -n 1");
    expect(result.stdout).toBe("1\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("records broken pipe in PIPESTATUS and honors pipefail", async () => {
    const result = await new Bash().exec(
      "set -o pipefail; seq 1000000 | head -n 1; echo $?:${PIPESTATUS[*]}",
    );
    expect(result.stdout).toBe("1\n141:141 0\n");
    expect(result.stderr).toBe("");
  });

  it("preserves UTF-8 split across writes", async () => {
    const producer = defineCommand(
      "producer",
      async (_args, ctx) => {
        for (const byte of [0xc3, 0xa9, 10])
          await stdio(ctx).write(
            unsafeBytesFromLatin1(String.fromCharCode(byte)),
          );
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      { streaming: true },
    );
    const result = await new Bash({ customCommands: [producer] }).exec(
      "producer | cat",
    );
    expect(result.stdout).toBe("é\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("buffers input for a legacy command", async () => {
    const result = await new Bash().exec("seq 5 | sort -r | head -n 2");
    expect(result.stdout).toBe("5\n4\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("retains stderr and the rightmost failing status", async () => {
    const producer = defineCommand(
      "producer",
      async (_args, ctx) => {
        await stdio(ctx).write(encodeUtf8ToBytes("hello\n"));
        return { stdout: "", stderr: "warning\n", exitCode: 7 };
      },
      { streaming: true },
    );
    const result = await new Bash({ customCommands: [producer] }).exec(
      "set -o pipefail; producer | cat",
    );
    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("warning\n");
    expect(result.exitCode).toBe(7);
  });

  it("enforces the final output budget", async () => {
    const result = await new Bash({
      executionLimits: { maxOutputSize: 8 },
    }).exec("seq 100 | cat");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("total output size exceeded");
  });

  it("preserves formatting fallbacks", async () => {
    const result = await new Bash().exec("seq 3 | cat -n | head -n 2");
    expect(result.stdout).toBe("     1\t1\n     2\t2\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("retains the buffered path for redirections and groups", async () => {
    const result = await new Bash().exec(
      "seq 3 | { cat; } | head -n 2 > /out; cat /out",
    );
    expect(result.stdout).toBe("1\n2\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("cancels every stage when the execution is aborted", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finished = false;
    const producer = defineCommand(
      "producer",
      async (_args, ctx) => {
        started();
        try {
          for (;;) await stdio(ctx).write(encodeUtf8ToBytes("x"));
        } finally {
          finished = true;
        }
      },
      { streaming: true },
    );
    const execution = new Bash({ customCommands: [producer] }).exec(
      "producer | cat",
      { signal: controller.signal },
    );
    await ready;
    controller.abort();
    const result = await execution;
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("execution aborted");
    expect(finished).toBe(true);
  });

  it("isolates environment changes between concurrently running commands", async () => {
    const producer = defineCommand(
      "producer",
      async (_args, ctx) => {
        ctx.env.set("VALUE", "changed");
        await stdio(ctx).write(encodeUtf8ToBytes("x"));
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      { streaming: true },
    );
    const consumer = defineCommand(
      "consumer",
      async (_args, ctx) => {
        while ((await stdio(ctx).read()) !== null) {}
        await stdio(ctx).write(encodeUtf8ToBytes(ctx.env.get("VALUE") ?? ""));
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      { streaming: true },
    );
    const result = await new Bash({
      customCommands: [producer, consumer],
    }).exec('VALUE=original; producer | consumer; echo ":$VALUE"');
    expect(result.stdout).toBe("original:original\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("bounds the adapter for commands that need complete stdin", async () => {
    const result = await new Bash({
      executionLimits: { maxOutputSize: 8 },
    }).exec("seq 100 | sort | cat");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("buffered input size limit exceeded");
  });

  it("does not trust extension output accounting", async () => {
    const producer = defineCommand(
      "producer",
      async () => ({
        stdout: "x".repeat(100),
        stderr: "",
        exitCode: 0,
        internalOutputAccounting: { stdout: 100, stderr: 0 },
      }),
      { streaming: true },
    );
    const result = await new Bash({
      customCommands: [producer],
      executionLimits: { maxOutputSize: 8 },
    }).exec("producer | head -c 1");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("total output size exceeded");
  });

  it.each([
    ["seq -s , 5 | cat", "1,2,3,4,5\n"],
    ["seq 0.2 0.2 1 | cat", "0.2\n0.4\n0.6\n0.8\n1.0\n"],
    ["seq 5 | head -n 0", ""],
    ["seq 5 | head -c 0", ""],
    ["seq 3 -1 1 | cat", "3\n2\n1\n"],
    ["seq 5 | head -c 3", "1\n2"],
  ])("preserves existing command behavior for %s", async (command, stdout) => {
    const result = await new Bash().exec(command);
    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("preserves nested execution accounting for legacy extensions", async () => {
    const producer = defineCommand("producer", async (_args, ctx) => {
      if (!ctx.exec) throw new Error("Expected exec");
      return ctx.exec("printf hello", { cwd: ctx.cwd });
    });
    const result = await new Bash({
      customCommands: [producer],
      executionLimits: { maxOutputSize: 8 },
    }).exec("producer | cat");
    expect(result.stdout).toBe("hello");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("revokes streaming capabilities after the command returns", async () => {
    let saved: RuntimeCommandContext["stdio"];
    const producer = defineCommand(
      "producer",
      async (_args, ctx) => {
        saved = stdio(ctx);
        await saved.write(encodeUtf8ToBytes("x"));
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      { streaming: true },
    );
    const result = await new Bash({
      customCommands: [producer],
      defenseInDepth: false,
    }).exec("producer | cat");
    expect(result.stdout).toBe("x");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const write = async () => {
      if (!saved) throw new Error("Missing captured stdio");
      await saved.write(encodeUtf8ToBytes("late"));
    };
    await expect(write()).rejects.toMatchObject({
      stderr: "bash: producer used its context after cancellation\n",
    });
    const readAll = async () => {
      if (!saved) throw new Error("Missing captured stdio");
      return saved.readAll();
    };
    await expect(readAll()).rejects.toMatchObject({
      stderr: "bash: producer used its context after cancellation\n",
    });
  });
});
