import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

function tree(count: number, size: number): Record<string, string> {
  const files: Record<string, string> = Object.create(null);
  for (let index = 0; index < count; index++) {
    files[`/a/${index}`] = "a".repeat(size);
    files[`/b/${index}`] = "b".repeat(size);
  }
  return files;
}

describe("diff recursive admission", () => {
  it("keeps only one pair of input buffers live", async () => {
    const shell = new Bash({
      files: tree(30, 1024),
      executionLimits: { maxLiveBytes: 64 * 1024 },
    });
    const result = await shell.exec("diff -qr /a /b");
    expect(result).toMatchObject({
      stderr: "",
      exitCode: 1,
      stdout: Object.keys(tree(30, 1))
        .filter((name) => name.startsWith("/a/"))
        .sort()
        .map(
          (name) => `Files ${name} and ${name.replace("/a/", "/b/")} differ\n`,
        )
        .join(""),
    });
  });

  it("bounds the pending directory work before descending", async () => {
    const shell = new Bash({
      files: tree(20, 1),
      executionLimits: { maxTraversalEntries: 10 },
    });
    const result = await shell.exec("diff -qr /a /b");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("entry limit exceeded");
  });

  it("rejects oversized line arrays before diffing", async () => {
    const shell = new Bash({
      files: { "/a": "a\nb\nc\n", "/b": "b\nb\nc\n" },
      executionLimits: { maxArrayElements: 4 },
    });
    const result = await shell.exec("diff /a /b");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("line array limit exceeded");
  });

  it("rejects expensive edit searches before exhausting the worker", async () => {
    const shell = new Bash({
      files: { "/a": "a\n".repeat(100), "/b": "b\n".repeat(100) },
      executionLimits: { maxTraversalWork: 1000 },
    });
    const result = await shell.exec("diff /a /b");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("comparison work limit exceeded");
  });

  it("follows directory aliases while detecting ancestor cycles", async () => {
    const shell = new Bash({ files: tree(1, 1) });
    expect(
      await shell.exec("ln -s /a /alias; diff -qr /alias /b"),
    ).toMatchObject({
      stdout: "Files /alias/0 and /b/0 differ\n",
      stderr: "",
      exitCode: 1,
    });
    const cycle = await shell.exec(
      "ln -s /a /a/loop; ln -s /b /b/loop; diff -qr /a /b",
    );
    expect(cycle.exitCode).toBe(2);
    expect(cycle.stderr).toContain("recursive loop");
  });

  it("compares a file with the corresponding entry in a directory once", async () => {
    const shell = new Bash({ files: { "/a/file": "a\n", "/b/file": "b\n" } });
    expect(await shell.exec("diff -q /a/file /b")).toMatchObject({
      stdout: "Files /a/file and /b/file differ\n",
      stderr: "",
      exitCode: 1,
    });
  });
});
