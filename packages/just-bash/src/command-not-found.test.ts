import { describe, expect, it } from "vitest";
import { Bash } from "./Bash.js";
import { defineCommand } from "./custom-commands.js";
import { decodeBytesToUtf8 } from "./encoding.js";

function forward(calls: string[] = []) {
  return defineCommand("forward", async ([name = "", ...args], ctx) => {
    calls.push(name);
    return {
      stdout: `${name} [${args.join(",")}] cwd=${ctx.cwd} in=${decodeBytesToUtf8(ctx.stdin)}\n`,
      stderr: "",
      exitCode: 7,
    };
  });
}

describe("commandNotFound option", () => {
  it("runs the command with the missing name and its arguments", async () => {
    const env = new Bash({ commandNotFound: forward(), cwd: "/home/user" });

    const result = await env.exec(
      'echo piped | node -e "1 + 1"; echo "status=$?"',
    );

    expect(result).toMatchObject({
      stdout: "node [-e,1 + 1] cwd=/home/user in=piped\n\nstatus=7\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("lets the command report the name as not found", async () => {
    const declined = defineCommand("declined", async ([name]) => ({
      stdout: "",
      stderr: `bash: ${name}: command not found\n`,
      exitCode: 127,
    }));
    const env = new Bash({ commandNotFound: declined });

    const result = await env.exec('missing; echo "status=$?"');

    expect(result).toMatchObject({
      stdout: "status=127\n",
      stderr: "bash: missing: command not found\n",
      exitCode: 0,
    });
  });

  it("is reached only by names that builtins, functions and commands do not cover", async () => {
    const calls: string[] = [];
    const env = new Bash({ commandNotFound: forward(calls) });

    const result = await env.exec(
      "f() { echo fn; }; f; echo hi; cat /dev/null; missing; missing",
    );

    expect(result).toMatchObject({
      stdout:
        "fn\nhi\nmissing [] cwd=/home/user in=\nmissing [] cwd=/home/user in=\n",
      stderr: "",
      exitCode: 7,
    });
    expect(calls).toEqual(["missing", "missing"]);
  });

  it("is not reached by names that contain a slash", async () => {
    const calls: string[] = [];
    const env = new Bash({ commandNotFound: forward(calls) });

    const result = await env.exec('./missing; echo "status=$?"');

    expect(result).toMatchObject({
      stdout: "status=127\n",
      stderr: "bash: ./missing: No such file or directory\n",
      exitCode: 0,
    });
    expect(calls).toEqual([]);
  });

  it("is not reached by names found in PATH without execute permission", async () => {
    const calls: string[] = [];
    const env = new Bash({
      commandNotFound: forward(calls),
      files: {
        "/home/user/a/tool": "echo a",
        "/home/user/b/tool": "echo b",
      },
    });

    const result = await env.exec(
      'PATH=/home/user/a tool; echo "status=$?"; chmod +x /home/user/b/tool; PATH=/home/user/a:/home/user/b tool',
    );

    expect(result).toMatchObject({
      stdout: "status=126\nb\n",
      stderr: "bash: /home/user/a/tool: Permission denied\n",
      exitCode: 0,
    });
    expect(calls).toEqual([]);
  });

  it("serves nested executions", async () => {
    const env = new Bash({ commandNotFound: forward() });

    const result = await env.exec(
      "bash -c 'missing a'; echo b | xargs missing; timeout 5 missing c",
    );

    expect(result).toMatchObject({
      stdout:
        "missing [a] cwd=/home/user in=\nmissing [b] cwd=/home/user in=\nmissing [c] cwd=/home/user in=\n",
      stderr: "",
      exitCode: 7,
    });
  });

  it("accepts a lazily loaded command", async () => {
    const env = new Bash({
      commandNotFound: { name: "forward", load: async () => forward() },
    });

    const result = await env.exec("missing x");

    expect(result).toMatchObject({
      stdout: "missing [x] cwd=/home/user in=\n",
      stderr: "",
      exitCode: 7,
    });
  });

  it.each([
    {
      script: "missing; hash",
      stdout: "missing [] cwd=/home/user in=\nhash: hash table empty\n",
      exitCode: 0,
    },
    {
      script: "command -p missing a; exec missing b",
      stdout:
        "missing [a] cwd=/home/user in=\nmissing [b] cwd=/home/user in=\n",
      exitCode: 7,
    },
    {
      script: 'missing | cat; echo "${PIPESTATUS[*]}"',
      stdout: "missing [] cwd=/home/user in=\n7 0\n",
      exitCode: 0,
    },
    {
      script: "set -e; missing; echo unreachable",
      stdout: "missing [] cwd=/home/user in=\n",
      exitCode: 7,
    },
  ])("handles `$script`", async ({ script, stdout, exitCode }) => {
    const env = new Bash({ commandNotFound: forward() });

    const result = await env.exec(script);

    expect(result).toMatchObject({ stdout, stderr: "", exitCode });
  });

  it("stops a command that outlives the execution deadline", async () => {
    const hang = defineCommand(
      "hang",
      (_args, ctx) =>
        new Promise((resolve) => {
          ctx.signal?.addEventListener("abort", () =>
            resolve({ stdout: "", stderr: "", exitCode: 0 }),
          );
        }),
    );
    const env = new Bash({
      commandNotFound: hang,
      executionLimits: { maxExecutionTimeMs: 200 },
    });

    const result = await env.exec("missing; echo after");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "bash: missing exceeded its execution deadline\n",
      exitCode: 124,
    });
  });

  it("reports a lazy command that fails to load", async () => {
    const env = new Bash({
      commandNotFound: {
        name: "forward",
        load: async () => {
          throw new Error("boom");
        },
      },
    });

    const result = await env.exec('missing; echo "status=$?"');

    expect(result).toMatchObject({
      stdout: "status=1\n",
      stderr: "missing: boom\n",
      exitCode: 0,
    });
  });

  it("runs a command marked as untrusted", async () => {
    const untrusted = defineCommand(
      "forward",
      async ([name = ""]) => ({
        stdout: `untrusted ${name}\n`,
        stderr: "",
        exitCode: 0,
      }),
      { trusted: false },
    );
    const env = new Bash({ commandNotFound: untrusted, defenseInDepth: true });

    const result = await env.exec("missing");

    expect(result).toMatchObject({
      stdout: "untrusted missing\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
