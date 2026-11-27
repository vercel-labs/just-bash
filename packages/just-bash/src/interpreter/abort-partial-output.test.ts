import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { defineCommand } from "../custom-commands.js";

/**
 * Run `script` with an AbortSignal that the `stop` command aborts, so every
 * case is cancelled at a known point instead of after a timer.
 */
async function execUntilStop(script: string) {
  const controller = new AbortController();
  const bash = new Bash({
    customCommands: [
      defineCommand("stop", async () => {
        controller.abort();
        return { stdout: "", stderr: "", exitCode: 0 };
      }),
    ],
  });
  return bash.exec(script, { signal: controller.signal });
}

describe("aborted exec keeps the output printed before the abort", () => {
  it.each([
    ["a statement list", "echo a; echo b; stop; echo c", "a\nb\n"],
    [
      "a finished for loop",
      "echo first; for i in 1 2; do echo $i; done; stop",
      "first\n1\n2\n",
    ],
    [
      "a for body",
      "for i in 1 2 3; do echo $i; [ $i = 2 ] && stop; done",
      "1\n2\n",
    ],
    [
      "a C-style for body",
      "for ((i = 0; i < 3; i++)); do echo $i; ((i == 1)) && stop; done",
      "0\n1\n",
    ],
    ["a while body", "while true; do echo w; stop; done", "w\n"],
    ["an until body", "until false; do echo u; stop; done", "u\n"],
    ["an if body", "echo a; if true; then echo t; stop; fi", "a\nt\n"],
    ["a case body", "case x in x) echo c; stop;; esac", "c\n"],
    [
      "a nested loop",
      "for i in 1 2; do echo o$i; for j in a b; do echo $i$j; stop; done; done",
      "o1\n1a\n",
    ],
    [
      "a function body",
      "f() { for i in 1 2; do echo f$i; stop; done; }; f",
      "f1\n",
    ],
    ["a group", "{ echo g; for i in 1; do echo $i; stop; done; }", "g\n1\n"],
    ["a subshell", "( echo s; for i in 1; do echo $i; stop; done )", "s\n1\n"],
    [
      "a while condition",
      'seen=; while echo c; [ -z "$seen" ] || stop; do echo b; seen=1; done',
      "c\nb\nc\n",
    ],
    [
      "an until condition",
      'seen=; until echo c; [ -n "$seen" ] && stop; do echo b; seen=1; done',
      "c\nb\nc\n",
    ],
    [
      "an elif condition",
      "if echo c1; false; then :; elif echo c2; stop; then :; fi",
      "c1\nc2\n",
    ],
  ])("in %s", async (_name, script, stdout) => {
    const result = await execUntilStop(script);

    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe("bash: execution aborted\n");
    expect(result.exitCode).toBe(124);
  });

  it("keeps stderr printed before the abort", async () => {
    const result = await execUntilStop(
      "echo a >&2; for i in 1; do echo e >&2; stop; done",
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("a\ne\nbash: execution aborted\n");
    expect(result.exitCode).toBe(124);
  });
});
