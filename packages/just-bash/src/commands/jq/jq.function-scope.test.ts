import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// Expected values recorded from jq 1.8.2
describe("jq function bodies see the variables in scope where the function is defined", () => {
  async function runJq(filter: string, input: string | null) {
    const env = new Bash();
    if (input === null) {
      return env.exec(`jq -n -c '${filter}'`);
    }
    return env.exec(`echo '${input}' | jq -c '${filter}'`);
  }

  it.each([
    [
      "a variable shadowed after the definition",
      "1 as $x | def f: $x; 2 as $x | f",
      null,
      "1",
    ],
    [
      "a function called from another function",
      "1 as $x | def f: $x; def g: 2 as $x | f; g",
      null,
      "1",
    ],
    [
      "a function defined in a function body",
      "def f: 1 as $y | def g: $y; 2 as $y | g; f",
      null,
      "1",
    ],
    [
      "a recursive function",
      "1 as $x | def f(n): if n > 0 then f(n - 1) + $x else 0 end; 10 as $x | f(3)",
      null,
      "3",
    ],
    [
      "a variable in reduce",
      "10 as $base | def total: reduce .[] as $i ($base; . + $i); 0 as $base | total",
      "[1,2]",
      "13",
    ],
    [
      "a destructured variable",
      '{"a":1} as {a:$v} | def f: $v; {"a":2} as {a:$v} | f',
      null,
      "1",
    ],
    [
      "an argument that reads a variable of the caller",
      "def f(g): 2 as $x | g; 1 as $x | f($x)",
      null,
      "1",
    ],
    [
      "a variable bound in the body",
      "def f: 3 as $x | $x; 1 as $x | [f, $x]",
      null,
      "[3,1]",
    ],
  ])("%s", async (_name, filter, input, expected) => {
    const result = await runJq(filter, input);
    expect(result.stdout).toBe(`${expected}\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("a named argument from --arg", async () => {
    const env = new Bash();
    const result = await env.exec(
      `jq -n -c --arg v top 'def f: $v; "local" as $v | f'`,
    );
    expect(result.stdout).toBe('"top"\n');
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
