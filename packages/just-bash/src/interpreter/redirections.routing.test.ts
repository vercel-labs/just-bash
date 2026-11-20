import { expect, it } from "vitest";
import { Bash } from "../Bash.js";

it.each([
  [
    "echo o 1>&-; echo rc=$?",
    "rc=1\n",
    "bash: echo: write error: Bad file descriptor\n",
  ],
  ["echo o 1>&2-; echo rc=$?", "rc=0\n", "o\n"],
  ["{ echo o >&2; } 2>&-; echo rc=$?", "rc=1\n", ""],
  ["{ echo o >&2; } 1>&2-; echo rc=$?", "rc=1\n", ""],
])("reports writes to closed standard descriptors: %s", async (script, stdout, stderr) => {
  expect(await new Bash().exec(script)).toMatchObject({
    stdout,
    stderr,
    exitCode: 0,
  });
});

it.each([
  ["echo hi &>>/dev/stdout", "hi\n", ""],
  ["echo hi &>/dev/stderr", "", "hi\n"],
  ["echo hi &>/dev/stdout", "hi\n", ""],
  ["echo hi &>>/dev/stderr", "", "hi\n"],
])("routes combined stream redirects: %s", async (script, stdout, stderr) => {
  const bash = new Bash();
  const before = await Promise.all([
    bash.fs.readFile("/dev/stdout"),
    bash.fs.readFile("/dev/stderr"),
  ]);
  expect(await bash.exec(script)).toMatchObject({
    stdout,
    stderr,
    exitCode: 0,
  });
  expect(
    await Promise.all([
      bash.fs.readFile("/dev/stdout"),
      bash.fs.readFile("/dev/stderr"),
    ]),
  ).toEqual(before);
});

it.each([
  "cat </dev/null 2<<<hi",
  "echo data >/tmp/d; cat </dev/null 1</tmp/d",
])("does not replace stdin when opening another descriptor: %s", async (script) => {
  expect(await new Bash().exec(script)).toMatchObject({
    stdout: "",
    stderr: "",
    exitCode: 0,
  });
});

it("shares a read-write sink with its standard descriptor duplicate", async () => {
  const bash = new Bash();
  expect(
    await bash.exec(
      "printf abcdef >f; { echo X; echo Y >&2; } 1<>f 2>&1; cat f",
    ),
  ).toMatchObject({ stdout: "X\nY\nef", stderr: "", exitCode: 0 });
});

it.each([
  "&>",
  "&>>",
])("captures the current stream destination with %s", async (operator) => {
  const bash = new Bash();
  expect(
    await bash.exec(`echo hi >/tmp/out ${operator}/dev/stdout 2>/tmp/error`),
  ).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
  expect(await bash.fs.readFile("/tmp/out")).toBe("hi\n");
  expect(await bash.fs.readFile("/tmp/error")).toBe("");
  expect(await bash.fs.readFile("/dev/stdout")).toBe("");
});

it("preserves stdout before a diagnostic on a shared read-write sink", async () => {
  const bash = new Bash();
  expect(await bash.exec("{ echo A; cat /nope; } 1<>f 2>&1")).toMatchObject({
    stdout: "",
    stderr: "",
    exitCode: 1,
  });
  expect(await bash.fs.readFile("/home/user/f")).toBe(
    "A\ncat: /nope: No such file or directory\n",
  );
});

it.each([
  "1</dev/null",
  "1<<<input",
  "1<<EOF",
  "1<<-EOF",
])("honors writable/read-only ordering with %s", async (input) => {
  const suffix =
    input.includes("<<EOF") || input.includes("<<-EOF") ? "\ninput\nEOF" : "";
  for (const output of ["1<>/tmp/out", "1>/tmp/out"]) {
    for (const readOnlyLast of [true, false]) {
      const bash = new Bash();
      const redirects = readOnlyLast
        ? `${output} ${input}`
        : `${input} ${output}`;
      expect(
        await bash.exec(`echo secret ${redirects}${suffix}`),
      ).toMatchObject({
        stdout: "",
        stderr: readOnlyLast
          ? "bash: echo: write error: Bad file descriptor\n"
          : "",
        exitCode: readOnlyLast ? 1 : 0,
      });
      expect(await bash.fs.readFile("/tmp/out")).toBe(
        readOnlyLast ? "" : "secret\n",
      );
    }
  }
});

it.each([
  ["cd /dev; { cd /tmp; echo hidden; } > null", undefined, undefined],
  ["cd /tmp; { cd /dev; echo kept; } > null", "kept\n", undefined],
  ["cd /tmp; { cd /dev; echo kept; } >> null", "seedkept\n", "seed"],
  ["cd /tmp; { cd /dev; echo kept; } >| null", "kept\n", undefined],
  ["cd /tmp; { cd /dev; echo kept; } &> null", "kept\n", undefined],
  ["cd /tmp; { cd /dev; echo kept; } &>> null", "seedkept\n", "seed"],
])("retains prepared destination: %s", async (script, content, initial) => {
  const bash = new Bash({ files: initial ? { "/tmp/null": initial } : {} });
  await bash.fs.mkdir("/tmp", { recursive: true });
  expect(await bash.exec(script)).toMatchObject({
    stdout: "",
    stderr: "",
    exitCode: 0,
  });
  expect(await bash.fs.exists("/tmp/null")).toBe(content !== undefined);
  if (content !== undefined)
    expect(await bash.fs.readFile("/tmp/null")).toBe(content);
});

it.each([
  [">/tmp/leak 1<>/dev/null", "", "seed"],
  ["1<>/dev/null >/tmp/leak", "secret\n", "seed"],
  [">/tmp/leak 1<>/tmp/other", "", "secret\n"],
  ["1<>/tmp/other >/tmp/leak", "secret\n", "seed"],
])("replays read-write opens in order: %s", async (redirects, leak, other) => {
  const bash = new Bash({ files: { "/tmp/other": "seed" } });
  expect(await bash.exec(`echo secret ${redirects}`)).toMatchObject({
    stdout: "",
    stderr: "",
    exitCode: 0,
  });
  expect(await bash.fs.readFile("/tmp/leak")).toBe(leak);
  expect(await bash.fs.readFile("/tmp/other")).toBe(other);
});

it("routes an open failure through preceding stderr redirection", async () => {
  const bash = new Bash();
  expect(await bash.exec("echo never 2>/tmp/error >/tmp")).toMatchObject({
    stdout: "",
    stderr: "",
    exitCode: 1,
  });
  expect(await bash.fs.readFile("/tmp/error")).toBe(
    "bash: /tmp: Is a directory\n",
  );
});

it("replays a read-write stderr destination after an output open", async () => {
  const bash = new Bash();
  expect(
    await bash.exec("echo secret 2>/tmp/leak 2<>/dev/null >&2"),
  ).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
  expect(await bash.fs.readFile("/tmp/leak")).toBe("");
});
