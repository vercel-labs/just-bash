import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";

describe("rg incremental discovery and stdin", () => {
  it("charges traversal entries once when preparing sorted output", async () => {
    const result = await new Bash({
      files: { "/src/a": "", "/src/b": "", "/src/c": "" },
      executionLimits: { maxTraversalWork: 8 },
    }).exec("rg --files /src");
    expect(result.stdout).toBe("/src/a\n/src/b\n/src/c\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("stops quiet files-without-match searches on a nonmatching file", async () => {
    const bash = new Bash({ files: { "/a": "match\n", "/b": "other\n" } });
    const result = await bash.exec(
      "set -o pipefail; rg -q --files-without-match match /a /b | cat",
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  // Exceed the 64 KiB pipe even if the consumer is still loading.
  const directory = (i: number) =>
    `z${String(i).padStart(3, "0")}${"x".repeat(220)}`;
  it.each([
    "rg --files /a | head -n 1",
    "rg --no-line-number needle /a /b | head -n 1",
  ])("stops traversal after the consumer closes: %s", async (command) => {
    const fs = new InMemoryFs({
      ...Object.fromEntries(
        ["a", "b"].flatMap((root) =>
          Array.from({ length: 300 }, (_, i) => [
            `/${root}/${directory(i)}/file`,
            "needle\n",
          ]),
        ),
      ),
      "/a/first": "needle\n".repeat(10000),
      "/a/later/file": "needle\n",
      "/b/first": "needle\n",
      "/b/later/file": "needle\n",
    });
    const readdir = fs.readdirWithFileTypes.bind(fs);
    const visited: string[] = [];
    fs.readdirWithFileTypes = async (path) => {
      visited.push(path);
      return readdir(path);
    };
    const result = await new Bash({ fs }).exec(command);
    expect(result).toMatchObject({
      stdout: command.startsWith("rg --files")
        ? "/a/first\n"
        : "/a/first:needle\n",
      stderr: "",
      exitCode: 0,
    });
    expect(visited).not.toContain(`/a/${directory(299)}`);
    expect(visited).not.toContain(`/b/${directory(299)}`);
  });

  it.each([
    "",
    "--sort none",
    "-0",
    "--hidden",
    "-g '*.txt'",
  ])("preserves complete file listing across overlapping roots: %s", async (flags) => {
    const bash = new Bash({
      files: {
        "/a/z.txt": "hit\n",
        "/a/sub/b.txt": "hit\n",
        "/a/sub/a.txt": "hit\n",
        "/a/.hidden": "hit\n",
        "/b/a.txt": "hit\n",
        "/a/.gitignore": "z.txt\n",
        "/a/sub/.ignore": "b.txt\n",
      },
    });
    const command = `rg --files ${flags} /b /a/sub /a /a/sub/a.txt`;
    const full = await bash.exec(command);
    expect(await bash.exec(`set -o pipefail; ${command} | cat`)).toMatchObject({
      stdout: full.stdout,
      stderr: full.stderr,
      exitCode: full.exitCode,
    });
    if (flags === "")
      expect(full.stdout).toBe(
        "/a/sub/a.txt\n/a/sub/a.txt\n/a/sub/a.txt\n/b/a.txt\n",
      );
  });

  it("merges roots in global path order without dropping duplicates", async () => {
    const bash = new Bash({
      files: {
        "/a/z": "hit\n",
        "/b/a": "hit\n",
        "/a/sub/a": "hit\n",
      },
    });
    expect(
      await bash.exec("rg --no-line-number hit /b /a/sub /a | cat"),
    ).toMatchObject({
      stdout: "/a/sub/a:hit\n/a/sub/a:hit\n/a/z:hit\n/b/a:hit\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
