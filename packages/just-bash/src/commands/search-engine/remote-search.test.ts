import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { remoteFs } from "../../test-utils/remote-fs.js";

const files = {
  "/work/a.txt": "foo café\nbar\nFOO\n",
  "/work/b.txt": "other\n",
  "/work/c.txt": "bar\nfoo\n",
  "/work/.hidden": "foo\n",
  "/work/.gitignore": "ignored.txt\n",
  "/work/ignored.txt": "foo\n",
};
const commands = [
  "grep -rn foo /work",
  "grep -rE 'foo|bar' /work",
  "grep -rE '(longoptional)?foo' /work",
  "grep -ri foo /work",
  "grep -rv foo /work",
  "grep -rL foo /work",
  "grep -rc foo /work",
  "grep -rl foo /work",
  "grep -rq foo /work",
  "grep -r -A1 -B1 foo /work",
  "grep -r --include='a*' foo /work",
  "grep -r missing /work",
  "grep foo /work/a.txt /work/b.txt",
  "grep foo /work/a.txt /work/a.txt",
  "printf 'foo\n' | grep foo - /work/b.txt -",
  "grep foo /work /missing",
  "rg foo /work",
  "rg 'foo|bar' /work",
  "rg '(longoptional)?foo' /work",
  "rg -i foo /work",
  "rg -v foo /work",
  "rg --files-without-match foo /work",
  "rg -c --include-zero foo /work",
  "rg --count-matches foo /work",
  "rg --passthru foo /work",
  "rg --json foo /work",
  "rg --stats foo /work",
  "rg -l foo /work",
  "rg -q foo /work",
  "rg -A1 -B1 foo /work",
  "rg -g 'a*' foo /work",
  "rg missing /work",
  "rg -U 'foo.*bar' /work",
  "rg --pre cat foo /work",
  "rg café /work",
  "grep -r café /work",
];

describe("remote filesystem search", () => {
  it.each(commands)("preserves results: %s", async (command) => {
    const remote = remoteFs(files);
    const actual = await new Bash({ fs: remote.fs }).exec(command);
    const expected = await new Bash({ files }).exec(command);
    expect({
      stdout: actual.stdout,
      stderr: actual.stderr,
      exitCode: actual.exitCode,
    }).toEqual({
      stdout: expected.stdout,
      stderr: expected.stderr,
      exitCode: expected.exitCode,
    });
  });

  it.each([
    "grep -rn",
    "rg -s",
  ])("filters before reading through the command wrapper: %s", async (command) => {
    const remote = remoteFs({ "/a": "foo\n", "/b": "miss\n" });
    const result = await new Bash({
      fs: remote.fs,
      defenseInDepth: { enabled: true },
    }).exec(`${command} foo /a /b`);
    expect(result.stdout).toBe("/a:1:foo\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(remote.batches).toEqual([["/a"]]);
    expect(remote.searches.map((request) => request.anyOf)).toEqual([["foo"]]);
  });

  it.each([
    "grep -rn",
    "rg -s",
  ])("verifies false positives: %s", async (command) => {
    const remote = remoteFs(
      { "/a": "foo\n", "/b": "miss\n" },
      { falsePositives: true },
    );
    const result = await new Bash({ fs: remote.fs }).exec(
      `${command} foo /a /b`,
    );
    expect(result.stdout).toBe("/a:1:foo\n");
    expect(remote.batches).toEqual([["/a", "/b"]]);
  });

  it.each([
    "grep -rn",
    "rg -s",
  ])("decline still uses bulk reads: %s", async (command) => {
    const remote = remoteFs(
      { "/a": "foo\n", "/b": "miss\n" },
      { decline: true },
    );
    const result = await new Bash({ fs: remote.fs }).exec(
      `${command} foo /a /b`,
    );
    expect(result.stdout).toBe("/a:1:foo\n");
    expect(remote.batches).toEqual([["/a", "/b"]]);
  });

  it.each([
    "grep -rn",
    "rg -sn",
  ])("filters without requiring bulk reads: %s", async (command) => {
    const remote = remoteFs({ "/a": "foo\n", "/b": "miss\n" });
    remote.fs.readMany = undefined;
    const result = await new Bash({ fs: remote.fs }).exec(
      `${command} foo /a /b`,
    );
    expect(result.stdout).toBe("/a:1:foo\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(remote.searches.map((request) => request.paths)).toEqual([
      ["/a", "/b"],
    ]);
    expect(remote.batches).toEqual([]);
  });

  it("retains per-file read errors among nonmatches", async () => {
    const remote = remoteFs(
      { "/a": "foo\n", "/b": "miss\n" },
      { unreadable: "/b" },
    );
    const actual = await new Bash({ fs: remote.fs }).exec("grep -n foo /a /b");
    remote.fs.readMany = undefined;
    remote.fs.searchCandidates = undefined;
    const expected = await new Bash({ fs: remote.fs }).exec(
      "grep -n foo /a /b",
    );
    expect(actual.stdout).toBe(expected.stdout);
    expect(actual.stderr).toBe(expected.stderr);
    expect(actual.exitCode).toBe(expected.exitCode);
    expect(actual.exitCode).toBe(2);
  });

  it.each([
    "grep -rn",
    "rg -s",
  ])("does not scan after a backend failure: %s", async (command) => {
    const remote = remoteFs({ "/a": "foo\n" });
    remote.fs.searchCandidates = async () => {
      throw new Error("backend unavailable");
    };
    const result = await new Bash({ fs: remote.fs }).exec(`${command} foo /a`);
    expect(result.exitCode).not.toBe(0);
    expect(remote.batches).toEqual([]);
  });

  it.each([
    "grep -rn",
    "rg -s",
  ])("reads all batches without truncation: %s", async (command) => {
    const many = Object.fromEntries(
      Array.from({ length: 123 }, (_, i) => [
        `/work/${String(i).padStart(3, "0")}`,
        "foo\n",
      ]),
    );
    const remote = remoteFs(many);
    const result = await new Bash({ fs: remote.fs }).exec(
      `${command} foo /work`,
    );
    expect(result.stdout).toBe(
      Object.keys(many)
        .map((path) => `${path}:1:foo\n`)
        .join(""),
    );
    expect(remote.batches.map((batch) => batch.length)).toEqual([50, 50, 23]);
  });

  it.each([
    "grep -n",
    "rg -sn",
  ])("keeps duplicate read results associated with their operands: %s", async (command) => {
    const remote = remoteFs({ "/a": "foo first\n" });
    remote.fs.searchCandidates = undefined;
    remote.fs.readMany = async () => [
      { status: "fulfilled", value: new TextEncoder().encode("foo first\n") },
      { status: "fulfilled", value: new TextEncoder().encode("foo next!\n") },
    ];
    const result = await new Bash({ fs: remote.fs }).exec(
      `${command} foo /a /a`,
    );
    expect(result.stdout).toBe("/a:1:foo first\n/a:1:foo next!\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("reserves rg bulk memory before reading", async () => {
    const remote = remoteFs({ "/a": "foo".repeat(100) });
    const result = await new Bash({
      fs: remote.fs,
      executionLimits: { maxLiveBytes: 100 },
    }).exec("rg foo /a");
    expect(result.exitCode).not.toBe(0);
    expect(remote.batches).toEqual([]);
  });

  it("releases successful and failed bulk reads before the next command", async () => {
    const remote = remoteFs(
      { "/a": "foo".repeat(10), "/b": "foo".repeat(10) },
      { unreadable: "/b" },
    );
    const result = await new Bash({
      fs: remote.fs,
      executionLimits: { maxLiveBytes: 250 },
    }).exec("rg -sq foo /a /b; rg -sq foo /a /b");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(remote.batches).toEqual([
      ["/a", "/b"],
      ["/a", "/b"],
    ]);
  });

  it("preserves rg matching for non-UTF8 bytes", async () => {
    const bytes = { "/a": new Uint8Array([0xe9, 10]) };
    const remote = remoteFs(bytes);
    const actual = await new Bash({ fs: remote.fs }).exec("rg é /a");
    const expected = await new Bash({ files: bytes }).exec("rg é /a");
    expect(actual.stdout).toBe(expected.stdout);
    expect(actual.exitCode).toBe(expected.exitCode);
    expect(remote.searches).toEqual([]);
    expect(remote.batches).toEqual([["/a"]]);
  });
});
