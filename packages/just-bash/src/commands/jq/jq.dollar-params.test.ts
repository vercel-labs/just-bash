import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// Expected values recorded from jq 1.8.2
describe("jq $name function parameters", () => {
  async function runJq(filter: string, input: string | null) {
    const env = new Bash();
    if (input === null) {
      return env.exec(`jq -n -c '${filter}'`);
    }
    return env.exec(`echo '${input}' | jq -c '${filter}'`);
  }

  it.each([
    [
      "a $name parameter",
      'def k($s): $s.a | length; {"a":[1,2,3,4]} as $x | k($x)',
      null,
      "4",
    ],
    ["two $name parameters", "def f($a; $b): $a + $b; f(1; 2)", null, "3"],
    [
      "a $name parameter used as a filter",
      "def f($a): a + $a; f(3)",
      null,
      "6",
    ],
    [
      "the filter of a $name parameter with two values",
      "def f($a): [a]; [f(1,2)]",
      null,
      "[[1,2],[1,2]]",
    ],
    [
      "an argument with two values",
      "def f($a): $a * 10; [f(1,2)]",
      null,
      "[10,20]",
    ],
    [
      "the values of two arguments, in order",
      "def f($a; $b): [$a,$b]; [f(1,2; 3,4)]",
      null,
      "[[1,3],[1,4],[2,3],[2,4]]",
    ],
    ["an argument with no values", "[def f($a): $a; f(empty)]", null, "[]"],
    [
      "an argument evaluated against the input",
      "def f($a): [$a, .]; f(.x)",
      '{"x":5}',
      '[5,{"x":5}]',
    ],
    [
      "a filter parameter and a $name parameter",
      "def f(g; $b): [g, $b]; f(. + 1; . + 2)",
      "1",
      "[2,3]",
    ],
    [
      "recursion with a $name parameter",
      "def f($n): if $n > 0 then f($n - 1) + 1 else 0 end; f(3)",
      null,
      "3",
    ],
    [
      "a $name parameter in reduce",
      "def s($n): reduce range($n) as $i (0; . + $i); s(4)",
      null,
      "6",
    ],
    [
      "a $name parameter as an index",
      'def f($k): .[$k]; [f("a", "b")]',
      '{"a":1,"b":2}',
      "[1,2]",
    ],
    [
      "an outer $name parameter in a nested function",
      "def f($a): def g($b): $a + $b; g(10); f(1)",
      null,
      "11",
    ],
    [
      "a nested $name parameter with the same name",
      "def f($a): def g($a): $a; [g(2), $a]; f(1)",
      null,
      "[2,1]",
    ],
    [
      "a $name parameter that shadows a variable",
      "5 as $a | def f($a): $a; f(1)",
      null,
      "1",
    ],
    ["a filter parameter", "def f(a): [a]; f(1,2)", null, "[1,2]"],
  ])("%s", async (_name, filter, input, expected) => {
    const result = await runJq(filter, input);
    expect(result.stdout).toBe(`${expected}\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
