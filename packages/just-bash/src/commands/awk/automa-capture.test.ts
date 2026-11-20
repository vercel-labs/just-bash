// Automa modifications: N00b migration of awkCapture.test.ts.
import assert from "node:assert/strict";
import { test } from "vitest";
import { Bash } from "../../Bash.js";
import { cases } from "./automa-capture-fixtures.js";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
test(`awk match captures preserve exact GNU group offsets in source`, async () => {
  const shell = new Bash({});
  for (const c of cases) {
    const result = await shell.exec(`awk ${quote(c.program)}`);
    assert.deepEqual(
      {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      },
      c.expected,
      c.id,
    );
  }
  for (const [program, expected] of [
    [
      'function f(a){match("ab",/(a)(b)/,a);print a[0],a[1],a[2]}BEGIN{f()}',
      "ab a b\n",
    ],
    [
      'function size(x){return length(x)} BEGIN{match("ab",/(a)(b)/,a);print length(a),size(a);match("z",/(a)(b)/,a);print length(a);print length("abc"),length(123);$0="abc";print length()}',
      "9 9\n0\n3 3\n3\n",
    ],
    [
      'function extract(x,a){match(x,/(a)(a)/,a)} BEGIN{extract("xaa",b);print b[0],b[1,"start"],b[2,"start"]}',
      "aa 2 3\n",
    ],
    [
      'BEGIN{a["old"]=1;for(i=0;i<10;i++){match("ab",/(a)(b)/,a);match("z",/nomatch/,a)}print length(a)}',
      "0\n",
    ],
    [
      'BEGIN{match("ab",/(a)(b)/);print RSTART,RLENGTH;match("z",/(a)(b)/);print RSTART,RLENGTH}',
      "1 2\n0 -1\n",
    ],
  ]) {
    const result = await shell.exec(`awk ${quote(program)}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected, program);
  }
});
test(`awk capture limits and invalid destinations fail visibly in source`, async () => {
  for (const program of [
    'BEGIN{match("ab",/(a)(b)/,a)}',
    'BEGIN{match("ab",/(a)(b)/,1)}',
    'BEGIN{a=1;match("ab",/(a)(b)/,a)}',
  ]) {
    const shell = new Bash({
      executionLimits: {
        maxArrayElements: program === 'BEGIN{match("ab",/(a)(b)/,a)}' ? 8 : 30,
      },
    });
    const result = await shell.exec(
      "set -euo pipefail\nawk " +
        quote(program) +
        "\nprintf 'UNEXPECTED_SUCCESS'",
    );
    assert.notEqual(result.exitCode, 0, program);
    assert.match(
      result.stderr,
      /array element limit exceeded|third argument must be an array/,
    );
    assert.doesNotMatch(result.stdout, /UNEXPECTED_SUCCESS/);
  }
  const shell = new Bash({
    executionLimits: { maxArrayElements: 9 },
  });
  const result = await shell.exec(
    "awk " +
      quote(
        'BEGIN{for(i=0;i<10;i++)match("ab",/(a)(b)/,a);n=0;for(k in a)n++;print n}',
      ),
  );
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "9\n");
});
