import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/index.js";

function tree(count: number) {
  const files: Record<string, string> = Object.create(null);
  for (let i = 0; i < count; i++) {
    files[`/src/D${String(i).padStart(4, "0")}/a.txt`] = "MATCH\n".repeat(30);
  }
  return files;
}

describe("grep streaming file search", () => {
  it.each([
    "grep -rn",
    "egrep -rn",
    "fgrep -rn",
  ])("%s stops reading and descending when head closes the pipe", async (command) => {
    const fs = new InMemoryFs(tree(2000));
    const reads = new Set<string>();
    const directories = new Set<string>();
    const readFile = fs.readFile.bind(fs);
    fs.readFile = async (path, options) => {
      reads.add(path);
      return readFile(path, options);
    };
    const readdir = fs.readdirWithFileTypes.bind(fs);
    fs.readdirWithFileTypes = async (path) => {
      directories.add(path);
      return readdir(path);
    };
    const result = await new Bash({ fs }).exec(
      `${command} MATCH /src | head -40`,
    );
    const expected = `${[
      ...Array.from(
        { length: 30 },
        (_, i) => `/src/D0000/a.txt:${i + 1}:MATCH`,
      ),
      ...Array.from(
        { length: 10 },
        (_, i) => `/src/D0001/a.txt:${i + 1}:MATCH`,
      ),
    ].join("\n")}\n`;
    expect(result).toMatchObject({ stdout: expected, stderr: "", exitCode: 0 });
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(reads.size).toBeLessThan(200);
    expect(directories.size).toBeLessThan(200);
  });

  it("keeps independent file reads parallel in a fully consumed pipeline", async () => {
    const fs = new InMemoryFs(tree(10));
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    const readFile = fs.readFile.bind(fs);
    fs.readFile = async (...args) => {
      started++;
      if (started > 1) await gate;
      return readFile(...args);
    };
    const result = new Bash({ fs }).exec("grep -rc MATCH /src | cat");
    try {
      await vi.waitFor(() => expect(started).toBe(10));
    } finally {
      release();
      await result;
    }
    expect((await result).stdout).toBe(
      Array.from(
        { length: 10 },
        (_, i) => `/src/D${String(i).padStart(4, "0")}/a.txt:30\n`,
      ).join(""),
    );
  });

  const files = {
    "/src/a.txt": "before\nMATCH café\nafter\nno\nMATCH 二\n",
    "/src/b.txt": "no match\n",
    "/src/sub/c.txt": "MATCH last\n",
    "/patterns": "MATCH\n",
  };
  it.each([
    "grep -rn MATCH /src",
    "grep -rnc MATCH /src",
    "grep -rnl MATCH /src",
    "grep -rnL MATCH /src",
    "grep -rnv MATCH /src",
    "grep -rno MATCH /src",
    "grep -rnh MATCH /src",
    "grep -rn -C 1 MATCH /src",
    "grep -rn -m 1 MATCH /src",
    "grep -rn MATCH /src/sub /src/a.txt /src/sub",
    "grep -rn MATCH /src --include=*.txt --exclude=b.txt --exclude-dir=sub",
    "grep MATCH /src/a.txt",
    "grep -n MATCH /src/a.txt /missing /src/b.txt",
    "grep -rn nomatch /src",
    "grep -rnq MATCH /src",
    "grep -n -f /patterns /src/a.txt /src/b.txt",
    "grep -n MATCH '/src/*.txt'",
    "grep -rn MATCH '/src/*'",
  ])("preserves complete output and status: %s", async (command) => {
    const expected = await new Bash({ files }).exec(command);
    const actual = await new Bash({ files }).exec(
      `set -o pipefail; ${command} | cat`,
    );
    expect(actual.stdout).toBe(expected.stdout);
    expect(actual.stderr).toBe(expected.stderr);
    expect(actual.exitCode).toBe(expected.exitCode);
  });

  it("preserves complete results across many batches", async () => {
    const bash = new Bash({ files: tree(200) });
    const result = await bash.exec("grep -rc MATCH /src | cat");
    expect(result.stdout).toBe(
      Array.from(
        { length: 200 },
        (_, i) => `/src/D${String(i).padStart(4, "0")}/a.txt:30\n`,
      ).join(""),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    ["printf 'MATCH café\\nno\\n' | grep MATCH | cat", "MATCH café\n"],
    [
      "printf 'MATCH\\n' | grep -f - /src/a.txt | cat",
      "MATCH café\nMATCH 二\n",
    ],
    [
      "printf 'MATCH stdin\\n' | grep -n MATCH - /src/a.txt - | cat",
      "(standard input):1:MATCH stdin\n/src/a.txt:2:MATCH café\n/src/a.txt:5:MATCH 二\n",
    ],
    ["printf '' | grep MATCH | cat", ""],
  ])("retains stdin consumption: %s", async (command, stdout) => {
    const result = await new Bash({ files }).exec(command);
    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("retains errors already encountered before downstream closes", async () => {
    const result = await new Bash({ files: tree(2000) }).exec(
      "grep -n MATCH /missing /src/*/a.txt | head -1",
    );
    expect(result.stdout).toBe("/src/D0000/a.txt:1:MATCH\n");
    expect(result.stderr).toBe("grep: /missing: No such file or directory\n");
    expect(result.exitCode).toBe(0);
  });

  it("records downstream closure through pipefail", async () => {
    const result = await new Bash({ files: tree(2000) }).exec(
      "set -o pipefail; grep -rn MATCH /src | head -1; echo $?:${PIPESTATUS[*]}",
    );
    expect(result.stdout).toBe("/src/D0000/a.txt:1:MATCH\n141:141 0\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("emits an earlier file before reading a later stdin operand", async () => {
    const result = await new Bash({
      files: { "/hit": "MATCH\n".repeat(12000) },
      executionLimits: { maxInputBytes: 65536 },
    }).exec("seq 1000000000 | grep MATCH /hit - | head -n 1");
    expect(result).toMatchObject({
      stdout: "/hit:MATCH\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("emits the first recursive file before looking for a second match", async () => {
    const fs = new InMemoryFs({ "/src/a": "MATCH\n".repeat(12000) });
    for (let i = 0; i < 30; i++) await fs.mkdir(`/src/z${i}`);
    const result = await new Bash({
      fs,
      executionLimits: { maxGlobOperations: 10 },
    }).exec("grep -r MATCH /src | head -n 1");
    expect(result).toMatchObject({
      stdout: "/src/a:MATCH\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
