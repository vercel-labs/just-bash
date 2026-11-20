import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("jq evaluates filter arguments by name", () => {
  it.each([
    [
      "a user function that uses its filter argument for each element",
      "def mymap(f): [.[] | f]; [1,2] | mymap(. + 1)",
      "[2,3]\n",
    ],
    [
      "a user function with a condition and an update",
      "def myuntil(cond; update): def u: if cond then . else (update | u) end; u; 1 | myuntil(. > 3; . + 1)",
      "4\n",
    ],
    [
      "a user function that recurses with a filter argument",
      "def myrecurse(f): def r: ., (f | r); r; 1 | [myrecurse(if . < 3 then . + 1 else empty end)]",
      "[1,2,3]\n",
    ],
    [
      "a user function with a condition that yields many values",
      "def mywhile(cond; update): def w: if cond then ., (update | w) else empty end; w; 1 | [mywhile(. < 20; . * 2)]",
      "[1,2,4,8,16]\n",
    ],
    [
      "a number parameter and a filter parameter",
      "def mylimit($n; f): [f][:$n][]; [mylimit(2; 1,2,3)]",
      "[1,2]\n",
    ],
    [
      "an argument that is not used is not evaluated",
      'def f(x): 1; f(error("x"))',
      "1\n",
    ],
    [
      "an argument that is used twice is evaluated twice",
      "def f(x): [x, x]; f(1,2)",
      "[1,2,1,2]\n",
    ],
    [
      "arguments that give many values",
      "def f(x; y): [x, y]; f(1,2; 3,4)",
      "[1,2,3,4]\n",
    ],
    [
      "an argument reads the input where it is used",
      "def f(x): 5 | x; 1 | f(.)",
      "5\n",
    ],
    [
      "an argument sees the variables of the caller",
      "def f(x): 2 as $v | x; 1 as $v | f($v)",
      "1\n",
    ],
    [
      "an argument sees the functions of the caller",
      "def f(x): def g: 9; x; def g: 1; f(g)",
      "1\n",
    ],
    [
      "a parameter and a variable with the same name",
      "def f(x): def g: x; 1 as $x | g; f(2)",
      "2\n",
    ],
    ["an argument with no output", "def f(x): [x]; f(select(false))", "[]\n"],
    [
      "a mix of number and filter parameters",
      "def f($a; g): [$a, g]; f(1,2; 3)",
      "[1,3]\n[2,3]\n",
    ],
    [
      "a recursive function that passes its filter argument",
      "def r(f): if . > 0 then (. - 1) | r(f) else f end; 3 | r(. + 10)",
      "10\n",
    ],
    [
      "a filter argument that is passed to another function",
      "def h(x): x; def f(g): h(g); 7 | f(. + 1)",
      "8\n",
    ],
    [
      "a function in a function that uses a parameter of the outer function",
      "def f(x): def g(y): [x, y]; g(x + 1); f(1)",
      "[1,2]\n",
    ],
    [
      "an error in an argument that is used",
      'def f(x): x; try f(error("boom")) catch .',
      '"boom"\n',
    ],
  ])("%s", async (_name, filter, expected) => {
    const env = new Bash();
    const result = await env.exec(`jq -n -c '${filter}'`);
    expect(result.stdout).toBe(expected);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
