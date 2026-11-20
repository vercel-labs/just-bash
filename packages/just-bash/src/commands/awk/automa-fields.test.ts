// Automa modifications: N00b migration of awkPatch.test.ts.
import assert from "node:assert/strict";
import { test } from "vitest";
import { Bash } from "../../Bash.js";

test(`awk FS preserves literal and ERE semantics in source`, async () => {
  const bash = new Bash({
    cwd: "/workspace",
    files: {
      "/workspace/rows.txt": "id-a|Alder Bay|52\nid-b|Birch Point|80\n",
    },
  });
  // Expectations checked independently with native awk. CI and the browser
  // need no external executable, and splitting retains upstream RE2 limits.
  for (const [command, expected] of [
    ["awk -F'|' '{print $1}' rows.txt", "id-a\nid-b\n"],
    [
      "diff <(awk -F'|' '{print $1}' rows.txt | sort) <(printf '%s\\n' id-a id-b)",
      "",
    ],
    [
      "awk 'BEGIN {FS=\"|\"} {print NF, $2}' rows.txt",
      "3 Alder Bay\n3 Birch Point\n",
    ],
    ["awk -v FS='|' '{print $3}' rows.txt", "52\n80\n"],
    ["printf 'a.b..c\\n' | awk -F. '{print NF, $2, $3, $4}'", "4 b  c\n"],
    ["printf 'a+b+c\\n' | awk 'BEGIN {FS=\"+\"} {print NF, $2}'", "3 b\n"],
    ["printf 'a[b[c\\n' | awk -F'[' '{print NF, $2}'", "3 b\n"],
    ["printf '  a\\tb   c  \\n' | awk '{print NF, $1, $3}'", "3 a c\n"],
    ["printf 'a|b.c\\n' | awk -F'[|.]' '{print NF, $2, $3}'", "3 b c\n"],
    ["printf 'a::b:::c\\n' | awk -F':+' '{print NF, $2, $3}'", "3 b c\n"],
    ['awk \'BEGIN {FS="."; $0="x.y.z"; print NF, $2}\'', "3 y\n"],
    ['awk \'BEGIN {FS="|"; print split("a|b|c", a), a[2]}\'', "3 b\n"],
    ["awk 'BEGIN {print split(\"a|b.c\", a, /[|.]/), a[2], a[3]}'", "3 b c\n"],
  ] as const) {
    const result = await bash.exec(command);
    assert.equal(result.exitCode, 0, `${command}: ${result.stderr}`);
    assert.equal(result.stderr, "", command);
    assert.equal(result.stdout, expected, command);
  }
  const bounded = new Bash({
    executionLimits: { maxAwkIterations: 2, maxArrayElements: 2 },
  });
  for (const [command, error] of [
    [
      'awk \'BEGIN {FS="|"; split("a|b|c", a)}\'',
      /array element limit exceeded/,
    ],
    [
      "awk 'BEGIN {FS=\".\"; while (1) {i++}}'",
      /while loop exceeded maximum iterations \(2\)/,
    ],
  ] as const) {
    const result = await bounded.exec(command);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, error);
  }
});
