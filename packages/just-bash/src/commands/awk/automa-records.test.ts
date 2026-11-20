// Automa modifications: N00b migration of awkRecords.test.ts.
import assert from "node:assert/strict";
import { test } from "vitest";
import { Bash } from "../../Bash.js";
import { cases } from "./automa-records-fixtures.js";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
test(`awk RS and getline use the same bounded record cursor in source`, async () => {
  for (const c of cases) {
    const shell = new Bash({
      cwd: "/workspace",
      files: Object.fromEntries(
        Object.entries(c.files ?? {}).map(([key, value]) => [
          `/workspace/${key}`,
          value,
        ]),
      ),
    });
    const command = ["awk", ...(c.options ?? []), c.program, ...(c.args ?? [])]
      .map(quote)
      .join(" ");
    const result = await shell.exec(command, { stdin: c.stdin });
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
});
test(`awk record changes preserve limits and fail visibly in source`, async () => {
  const cases = [
    {
      command: `awk 'BEGIN{RS="|"}{print $0}'`,
      stdin: "a|b|c|",
      limits: { maxArrayElements: 2 },
      error: /record array limit exceeded/,
    },
    {
      command: `awk 'BEGIN{RS="|"}{print $0}'`,
      stdin: "a|b|c|",
      limits: { maxAwkIterations: 2 },
      error: /record limit exceeded/,
    },
    {
      command: `awk 'BEGIN{RS="a*"}{print $0}'`,
      stdin: "zzzzzzzz",
      limits: { maxAwkIterations: 2 },
      error: /record separator scan limit exceeded/,
    },
    {
      command: `awk 'BEGIN{RS="|";while((getline x < "side.txt")>0)print x}'`,
      stdin: "",
      limits: { maxArrayElements: 2 },
      error: /record array limit exceeded/,
    },
    {
      command: `awk 'BEGIN{RS="|"}{print $0}'`,
      stdin: "123456789",
      limits: { maxInputBytes: 8 },
      error: /(?:input|stdin) size limit exceeded/,
    },
    {
      command: `awk 'BEGIN{RS="|";getline x < "side.txt";close("side.txt");getline x < "side.txt"}'`,
      stdin: "",
      limits: { maxInputBytes: 8 },
      error: /aggregate input size limit exceeded/,
    },
    {
      command: `awk 'BEGIN{RS="[invalid"}{print $0}'`,
      stdin: "x",
      limits: {},
      error: /./,
    },
  ];
  for (const c of cases) {
    const shell = new Bash({
      cwd: "/workspace",
      executionLimits: c.limits,
      files: { "/workspace/side.txt": "a|b|c|" },
    });
    const result = await shell.exec(
      `set -euo pipefail\n${c.command}\nprintf 'UNEXPECTED_SUCCESS'`,
      { stdin: c.stdin },
    );
    assert.notEqual(result.exitCode, 0, c.command);
    assert.match(result.stderr, c.error, c.command);
    assert.doesNotMatch(result.stdout, /UNEXPECTED_SUCCESS/, c.command);
  }
});
test(`awk pipe getline and changing separators preserve records in source`, async () => {
  const shell = new Bash({});
  for (const [command, stdin, expected] of [
    [
      `awk 'BEGIN{RS="|"}{print length(RT)}END{print "end",length(RT)}'`,
      "a|",
      "1\nend 1\n",
    ],
    [
      `awk 'BEGIN{RS="|";getline x;print length(RT);print getline x;print length(RT)}'`,
      "a|",
      "1\n0\n1\n",
    ],
    [
      `awk 'BEGIN{RS="|"}{print $0; if(NR==1){getline extra;print "extra:" extra}}'`,
      "a|b|c|",
      "a\nextra:b\nc\n",
    ],
    [
      `awk 'BEGIN{RS="|"}{print $0; RS=NR==1?"\\n":"|"}'`,
      "first|second\nthird|last",
      "first\nsecond\nthird\nlast\n",
    ],
    [
      `awk 'BEGIN{RS="|";cmd="printf \\"a|b|\\"";while((cmd | getline x)>0)print x;close(cmd);print (cmd|getline x),x}'`,
      "",
      "a\nb\n1 a\n",
    ],
  ]) {
    const result = await shell.exec(command, { stdin });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected, command);
  }
});
