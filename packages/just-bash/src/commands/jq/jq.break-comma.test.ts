import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// Expected output comes from jq 1.8.2. A break backtracks to its label, and
// the outputs that jq emitted before the break stay emitted.
async function runJq(filter: string) {
  const env = new Bash({ env: { FILTER: filter } });
  return env.exec('jq -nc "$FILTER"');
}

const MYFIRST = "def myfirst(f): label $out | f | ., break $out;";
// jq 1.8.2 src/builtin.jq limit($n; expr), with the $n parameter written as
// "n as $n". The name does not shadow the limit builtin.
const MYLIMIT =
  "def mylimit(n; expr): n as $n | if $n > 0 then label $out | " +
  "foreach expr as $item ($n; . - 1; $item, " +
  "if . <= 0 then break $out else empty end) " +
  'elif $n == 0 then empty else error("negative count") end;';

describe("jq break in a comma", () => {
  it.each([
    ["[label $l | (1,2), break $l, 3]", "[1,2]\n"],
    ["[label $l | range(5) | ., break $l]", "[0]\n"],
    ["[label $l | 1, (2, break $l), 3]", "[1,2]\n"],
    ["[label $l | (1, break $l), 2]", "[1]\n"],
    ["[label $l | ((1, break $l)), 2]", "[1]\n"],
    ["label $l | 1, 2, break $l, 3", "1\n2\n"],
  ])("keeps the outputs before the break: %s", async (filter, stdout) => {
    const result = await runJq(filter);
    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    ["[label $a | label $b | 1, break $a, 2]", "[1]\n"],
    ["[label $a | (label $b | 1, break $b, 2), 3]", "[1,3]\n"],
    ["[label $a | (label $a | 1, break $a, 2), 3]", "[1,3]\n"],
  ])("stops at the correct label: %s", async (filter, stdout) => {
    const result = await runJq(filter);
    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    [`${MYFIRST} [myfirst(range(5))]`, "[0]\n"],
    [`${MYFIRST} [myfirst(empty)]`, "[]\n"],
    [
      `${MYLIMIT} [mylimit(2; range(10))], [mylimit(0; 1, 2)], [mylimit(5; 1, 2)]`,
      "[0,1]\n[]\n[1,2]\n",
    ],
    ["[label $out | def f: 1, break $out, 2; f, 3]", "[1]\n"],
  ])("works in function definitions: %s", async (filter, stdout) => {
    const result = await runJq(filter);
    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    ["[label $l | 1, if true then (2, break $l) else 0 end, 3]", "[1,2]\n"],
    ["[label $l | (1,2) | if . == 1 then . else (., break $l) end]", "[1,2]\n"],
    [
      "[label $l | (1,2) as $x | $x, (select($x == 2) | break $l), 9]",
      "[1,9,2]\n",
    ],
    [
      "[label $l | 0, foreach (1,2,3) as $x (0; . + $x; ., if . > 2 then break $l else empty end)]",
      "[0,1,3]\n",
    ],
    [
      "[label $l | 1, reduce (1,2) as $x (0; if $x == 2 then break $l else . + $x end)]",
      "[1]\n",
    ],
    ["[label $l | [1,2,3] | .[]? | ., break $l]", "[1]\n"],
    ['[label $l | try error("x") catch (., break $l), 2]', '["x"]\n'],
    ["[label $l | null // (1, break $l), 2]", "[1]\n"],
    [
      "[label $l | (1,2,3,4) | if . == 3 then break $l else . end | select(. > 0)]",
      "[1,2]\n",
    ],
    [
      "[label $l | ((1,2,3,4) | if . == 3 then break $l else . end) as $x | $x]",
      "[1,2]\n",
    ],
    [
      "[label $l | ((1,2,3) | if . == 3 then break $l else . end) // 0]",
      "[1,2]\n",
    ],
    [
      "[label $l | foreach (1,2,3) as $x (0; . + $x; if . > 2 then break $l else . end) | select(. > 0)]",
      "[1]\n",
    ],
    [
      "[label $l | (1,2,3,4) | if . == 3 then break $l else . end | tostring]",
      '["1","2"]\n',
    ],
    [
      "[label $l | def f(g): g; f((1,2,3) | if . == 3 then break $l else . end)]",
      "[1,2]\n",
    ],
    ["[label $l | range(5) | ., break $l | . + 1]", "[1]\n"],
    [
      "[label $if | range(10) | ., (select(. == 5) | break $if), .]",
      "[0,0,1,1,2,2,3,3,4,4,5]\n",
    ],
  ])("keeps outputs from other generators: %s", async (filter, stdout) => {
    const result = await runJq(filter);
    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    ["[label $l | [1, break $l], 2]", "[]\n"],
    ["[label $l | ([1, break $l] | length), 2]", "[]\n"],
    ["[label $l | [(1,2) | ., break $l]]", "[]\n"],
  ])("does not output a partial array: %s", async (filter, stdout) => {
    const result = await runJq(filter);
    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  // A break in an argument leaves the array or reduce in the function body,
  // so the function gives no output.
  it.each([
    ["def f(g): [g]; [label $l | f(1,2,break $l)]", "[]\n"],
    [
      "def f(g): reduce g as $x (0; . + $x); [label $l | f(1, 2, break $l)]",
      "[]\n",
    ],
    ["def m(f): [.[] | f]; [label $l | [1,2] | m(., break $l)]", "[]\n"],
  ])("gives no output when a break leaves the function body: %s", async (filter, stdout) => {
    const result = await runJq(filter);
    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps limit and first unchanged", async () => {
    const result = await runJq(
      "[limit(0; 1, 2)], [first(empty)], [first(range(3))], [limit(2; 1, 2, 3)]",
    );
    expect(result.stdout).toBe("[]\n[]\n[0]\n[1,2]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
