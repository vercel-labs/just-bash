// Automa modifications: N00b regressions from patch-rg-sort and its parity cases.
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { parseArgs } from "./rg-parser.js";

const create = () =>
  new Bash({
    cwd: "/work",
    files: {
      "/work/z.txt": "hit\n",
      "/work/a/z.txt": "hit\n",
      "/work/a/a.txt": "hit\n",
      "/work/b.txt": "hit\n",
      "/work/a/u.js": "hit\n",
    },
  });
describe("Automa rg sorting", () => {
  it.each([
    "--sort",
    "--sort=",
    "--sortr=bogus",
    "--sort=mtime",
  ])("rejects %s", (flag) => {
    expect(parseArgs([flag])).toEqual({
      success: false,
      error: {
        stdout: "",
        stderr: "rg: invalid or missing sort value\n",
        exitCode: 2,
      },
    });
  });
  it("sorts per-directory traversal and preserves the default order", async () => {
    const shell = create();
    expect(await shell.exec("rg --files --sort=path")).toMatchObject({
      stdout: "a/a.txt\na/u.js\na/z.txt\nb.txt\nz.txt\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await shell.exec("rg --files --sortr path")).toMatchObject({
      stdout: "z.txt\nb.txt\na/z.txt\na/u.js\na/a.txt\n",
      stderr: "",
      exitCode: 0,
    });
    expect(
      await shell.exec("rg --files --sort=path z.txt a/a.txt"),
    ).toMatchObject({ stdout: "z.txt\na/a.txt\n", stderr: "", exitCode: 0 });
  });
  it("allows globstar to match zero directory components", async () => {
    expect(
      await create().exec("rg --files --sort path -g '**/*.txt'"),
    ).toMatchObject({
      stdout: "a/a.txt\na/z.txt\nb.txt\nz.txt\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it("sorts timestamps globally and keeps deterministic equal-time order", async () => {
    const shell = create();
    const stat = shell.fs.stat.bind(shell.fs);
    const times = new Map([
      ["/work/z.txt", 1],
      ["/work/a/z.txt", 2],
      ["/work/a/a.txt", 2],
      ["/work/b.txt", 3],
      ["/work/a/u.js", 4],
    ]);
    shell.fs.stat = async (path) => ({
      ...(await stat(path)),
      mtime: new Date(times.get(path) ?? 0),
      atime: new Date(10 - (times.get(path) ?? 0)),
      birthtime: new Date(times.get(path) ?? 0),
    });
    expect(await shell.exec("rg --files --sort modified")).toMatchObject({
      stdout: "z.txt\na/a.txt\na/z.txt\nb.txt\na/u.js\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await shell.exec("rg --files --sortr created")).toMatchObject({
      stdout: "a/u.js\nb.txt\na/a.txt\na/z.txt\nz.txt\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await shell.exec("rg --files --sort accessed")).toMatchObject({
      stdout: "a/u.js\nb.txt\na/a.txt\na/z.txt\nz.txt\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it("fails visibly when a requested backend timestamp is unavailable", async () => {
    const result = await create().exec("rg --files --sort accessed");
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("accessed timestamp is unavailable");
    expect(result.exitCode).not.toBe(0);
  });
  it("retains traversal resource failures", async () => {
    const shell = new Bash({
      files: { "/work/a": "x", "/work/b": "x" },
      cwd: "/work",
      executionLimits: { maxTraversalWork: 1 },
    });
    const result = await shell.exec("rg --files --sort path || true");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/limit|exceeded/i);
  });
});
