// Automa modifications: N00b source regression port of jqInput.test.ts.
import assert from "node:assert/strict";
import { test } from "vitest";
import { Bash } from "../../Bash.js";

// Fixed outputs independently checked with native jq 1.7. No external process
// or network is available to these package-export regressions.
const cases = [
  ["jq -nc input", "1\n2\n", "1\n"],
  ["jq -nc '[input,input]'", "1\n2\n3\n", "[1,2]\n"],
  ["jq -c '[.,input]'", "1\n2\n3\n4\n", "[1,2]\n[3,4]\n"],
  ["jq -Rnc '[input,input]'", "甲\n乙\n丙\n", '["甲","乙"]\n'],
  ["jq -snc input a.json b.json", "", "[1,2,3,4]\n"],
  ["jq -Rsnc input raw.txt", "", '"甲\\n乙\\n"\n'],
  [
    "jq -nc '[input,input_filename,input_line_number,input,input_filename,input_line_number]' a.json",
    "",
    '[1,"a.json",1,2,"a.json",2]\n',
  ],
  [
    "jq -nc '[input_filename,input,input_filename,input_line_number]'",
    "1\n2\n",
    '[null,1,"<stdin>",1]\n',
  ],
  ["jq -nc 'try input catch .'", "", '"break"\n'],
  ["jq -nc input partial.json", "", "1\n"],
  ["jq -nc input a.json missing.json", "", "1\n"],
  ["jq -nc 'if false then input else 42 end' missing.json", "", "42\n"],
  ["jq -nc '[first(7,8),input]'", "1\n2\n", "[7,1]\n"],
  ["jq -nc '[limit(1;(7,8)),input]'", "1\n2\n", "[7,1]\n"],
  ["jq -nc '[first(input),input]'", "1\n2\n", "[1,2]\n"],
  ["jq -nc 'def input:42;input'", "1\n2\n", "42\n"],
  ["jq -nc 'def inputs:42;inputs'", "1\n2\n", "42\n"],
] as const;

const files = {
  "/workspace/a.json": "1\n2\n",
  "/workspace/b.json": "3\n4\n",
  "/workspace/partial.json": "1\n{",
  "/workspace/one.json": "1\n",
  "/workspace/two.json": "2\n",
  "/workspace/large.json": `"${"a".repeat(100)}"\n`,
  "/workspace/raw.txt": "甲\n乙\n",
  "/workspace/note.txt": "Release checklist approved",
  "/workspace/receipt.txt": "CONF-TEST",
  "/workspace/workflow.json": '{"value":"{{variables.accessCode}}"}',
};
const create = (executionLimits = {}) =>
  new Bash({
    cwd: "/workspace",
    files,
    executionLimits,
  });

test(`jq explicit input shares original stream and source metadata in source`, async () => {
  for (const [command, stdin, stdout] of cases) {
    const result = await create().exec(command, { stdin });
    assert.deepEqual(
      {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      },
      { exitCode: 0, stdout, stderr: "" },
      command,
    );
  }
  const actual = await create().exec(
    `jq -nc --rawfile note note.txt --rawfile receipt receipt.txt '{note:($note|length),receipt:($receipt|length),noteExact:($note=="Release checklist approved"),receiptExact:($receipt=="CONF-TEST"),accessHardcoded:(input|tostring|contains("sample-code"))}' workflow.json`,
  );
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.deepEqual(JSON.parse(actual.stdout), {
    note: 26,
    receipt: 9,
    noteExact: true,
    receiptExact: true,
    accessHardcoded: false,
  });
  const eof = await create().exec("jq -nc input");
  assert.equal(eof.exitCode, 5);
  assert.match(eof.stderr, /error \(at <stdin>:0\): break/);
  const unsupported = await create().exec("jq -nc inputs", {
    stdin: "1\n2\n",
  });
  assert.notEqual(unsupported.exitCode, 0);
  assert.match(unsupported.stderr, /Unknown function: inputs/);
});

test(`jq input keeps unconsumed source errors lazy and consumed read receipts visible in source`, async () => {
  for (const flags of ["-nc", "-snc", "-Rsnc"]) {
    const result = await create().exec(
      `jq ${flags} 'try input catch "caught"' missing.json a.json`,
    );
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /jq: missing\.json: No such file or directory/);
    assert.doesNotMatch(result.stdout, /caught/);
  }
  const directory = create();
  await directory.exec("mkdir dir");
  const originalReceipt = await directory.exec("jq '.' dir");
  const result = await directory.exec(
    "jq -Rsnc 'try input catch \"caught\"' dir",
  );
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, originalReceipt.stderr);
  assert.equal(result.stdout, '""\n');
});

test(`jq input rejects unproven eager I/O compositions without false success in source`, async () => {
  for (const filter of [
    "[first(input,input),input]",
    "limit(1;(input,input)),input",
    "(0,input)|input",
    "(if true then (0,input) else 0 end) as $x | input",
    "if (if true then (0,input) else 0 end) then input else input end",
    "([10,20,30] | .[(0,input)]) as $x | input",
    "def length: (0,input); length as $x | input",

    "(input,input)|[.,input]",
    "def f(x): x+x; f(input)",
    'try first(input,input) catch "false-success"',
    'try first(0,input) catch "false-success"',
    "first(0,input)?",
    'try limit(1;(0,input)) catch "false-success"',
    'try nth(0;(0,input)) catch "false-success"',
    'try ((try input catch .),input) catch "false-success"',

    'try (input,input) catch "false-success"',
  ]) {
    const result = await create().exec(`jq -nc '${filter}'`, {
      stdin: "1\n2\n3\n4\n",
    });
    assert.notEqual(result.exitCode, 0, filter);
    assert.match(result.stderr, /Unsupported jq input composition/, filter);
    assert.equal(result.stdout, "", filter);
  }
});

test(`jq explicit input retains cumulative parser, execution and byte limits in source`, async () => {
  for (const [executionLimits, command, stdin, diagnostic] of [
    [
      { maxQueryElements: 10 },
      "jq -nc 'until(input > 100; .)'",
      Array.from({ length: 20 }, (_, i) => `${i}\n`).join(""),
      /element limit/,
    ],
    [
      { maxJqIterations: 10 },
      "jq -nc 'until(input > 100; .)'",
      Array.from({ length: 20 }, (_, i) => `${i}\n`).join(""),
      /iterations/,
    ],
    [
      { maxInputBytes: 10 },
      "jq -nc 'input|empty' large.json",
      "",
      /input size limit/,
    ],
    [
      { maxInputBytes: 3 },
      "jq -nc '[input,input]' one.json two.json",
      "",
      /input size limit/,
    ],
    [
      { maxOutputSize: 4 },
      "jq -nc '[input,input]'",
      "10\n20\n",
      /size.*exceeded|size limit/,
    ],
  ] as const) {
    const result = await create(executionLimits).exec(command, { stdin });
    assert.notEqual(result.exitCode, 0, command);
    assert.match(result.stderr, diagnostic, command);
  }
});

test("input composition failures remain ordinary recoverable CLI status", async () => {
  const command =
    "printf '1\\n2\\n3\\n4\\n' | jq -nc '(input,input)|[.,input]'";
  const standalone = await create().exec(command);
  assert.equal(standalone.exitCode, 126);
  assert.equal(standalone.executionFailure, undefined);
  const recovered = await create().exec(
    `if ${command}; then echo WRONG; else echo handled; fi; echo after`,
  );
  assert.equal(recovered.exitCode, 0);
  assert.equal(recovered.stdout, "handled\nafter\n");
});

test("input stream metadata follows each comma, pipe and object emission", async () => {
  for (const filter of [
    "(input,input)|[input_line_number,.]",
    "{v:(input,input)}|[input_line_number,.v]",
    "(input,input)|.v|[input_line_number,.]",
  ]) {
    const input = filter.includes("|.v|") ? '{"v":1}\n{"v":2}\n' : "1\n2\n";
    const result = await create().exec(`jq -nc '${filter}'`, { stdin: input });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "[1,1]\n[2,2]\n");
  }
});
