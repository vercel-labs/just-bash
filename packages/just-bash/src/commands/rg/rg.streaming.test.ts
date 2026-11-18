import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { defineCommand } from "../../custom-commands.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";

const files = {
  "/src/a": "hello שלום\nother\nhello again\n",
  "/src/sub/b": "hello world\n",
  "/src/miss": "other\n",
};

describe("rg streaming pipelines", () => {
  it("uses the same matching work budget as the buffered file search", async () => {
    const bash = new Bash({
      files: { "/file": "other\n".repeat(600) },
      executionLimits: { maxLoopIterations: 1000 },
    });
    for (const suffix of ["", " | cat"]) {
      expect(
        await bash.exec(`set -o pipefail; rg missing /file${suffix}`),
      ).toMatchObject({
        stdout: "",
        stderr: "",
        exitCode: 1,
      });
    }
  });

  it("does not spend one pipeline write per nonmatching line", async () => {
    const bash = new Bash({
      files: { "/file": `needle\n${"other\n".repeat(6000)}` },
      executionLimits: { maxWorkUnits: 1000, maxLoopIterations: 10000 },
    });
    expect(
      await bash.exec("rg --no-line-number needle /file | cat"),
    ).toMatchObject({
      stdout: "needle\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("stops discovery and reading after head closes its pipe", async () => {
    const fs = new InMemoryFs({
      ...files,
      ...Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [`/src/b${i}`, "other\n"]),
      ),
      "/src/a": "hello שלום\n".repeat(10000),
    });
    const read = fs.readFileBuffer.bind(fs);
    const readPaths: string[] = [];
    fs.readFileBuffer = async (path) => {
      readPaths.push(path);
      return read(path);
    };
    const readdir = fs.readdirWithFileTypes.bind(fs);
    const directories: string[] = [];
    fs.readdirWithFileTypes = async (path) => {
      directories.push(path);
      return readdir(path);
    };
    const result = await new Bash({ fs }).exec("rg -n hello /src | head -n 1");
    expect(result).toMatchObject({
      stdout: "/src/a:1:hello שלום\n",
      stderr: "",
      exitCode: 0,
    });
    expect(readPaths).not.toContain("/src/sub/b");
    expect(directories).not.toContain("/src/sub");
  });

  it("searches the first file before traversing sparse nonmatching directories", async () => {
    const fs = new InMemoryFs({
      "/src/a.json": "needle\n".repeat(10000),
      "/src/z/file.txt": "other\n",
    });
    const visited: string[] = [];
    const readdir = fs.readdirWithFileTypes.bind(fs);
    fs.readdirWithFileTypes = async (path) => {
      visited.push(path);
      return readdir(path);
    };
    const result = await new Bash({ fs }).exec(
      "rg --no-line-number -g '*.json' needle /src | head -n 1",
    );
    expect(result).toMatchObject({
      stdout: "/src/a.json:needle\n",
      stderr: "",
      exitCode: 0,
    });
    expect(visited).not.toContain("/src/z");
  });

  it("reads ahead concurrently without searching files after the consumer closes", async () => {
    const input: Record<string, string> = Object.create(null);
    for (let i = 0; i < 120; i++)
      input[`/src/f${String(i).padStart(3, "0")}`] =
        i === 1 ? "needle\n" : "other\n".repeat(500);
    const fs = new InMemoryFs(input);
    const read = fs.readFileBuffer.bind(fs);
    let pending = 0;
    let peak = 0;
    let reads = 0;
    fs.readFileBuffer = async (path) => {
      if (!path.startsWith("/src/")) return read(path);
      pending++;
      reads++;
      peak = Math.max(peak, pending);
      await Promise.resolve();
      pending--;
      return read(path);
    };
    const result = await new Bash({ fs }).exec("rg -l needle /src | head -1");
    expect(result).toMatchObject({
      stdout: "/src/f001\n",
      stderr: "",
      exitCode: 0,
    });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(50);
    expect(reads).toBeLessThan(120);
    expect(pending).toBe(0);
  });

  it.each([
    "rg -n hello /src",
    "rg --heading hello /src",
    "rg -l hello /src",
    "rg --files-without-match hello /src",
    "rg --files-without-match -q hello /src",
    "rg -c --include-zero hello /src",
    "rg -A 1 hello /src",
    "rg -o hello /src",
    "rg -n hello /src/a",
    "rg --sort path hello /src",
    "rg --json hello /src",
    "rg --stats hello /src",
    "rg hello /missing",
    "rg --files /src",
    "rg hello /src/a /missing",
    "rg -g '*.js' hello /src/a",
  ])("preserves output and status: %s", async (command) => {
    const bash = new Bash({ files });
    const buffered = await bash.exec(command);
    const streamed = await bash.exec(`set -o pipefail; ${command} | cat`);
    expect(streamed).toMatchObject({
      stdout: buffered.stdout,
      stderr: buffered.stderr,
      exitCode: buffered.exitCode,
    });
  });

  it("preserves global path ordering while descending directories lazily", async () => {
    const bash = new Bash({
      files: {
        "/src/a/file": "hit\n",
        "/src/a.txt": "hit\n",
        "/src/a-/file": "hit\n",
        "/src/z": "hit\n",
      },
    });
    expect(await bash.exec("rg --no-line-number hit /src | cat")).toMatchObject(
      {
        stdout:
          "/src/a-/file:hit\n/src/a.txt:hit\n/src/a/file:hit\n/src/z:hit\n",
        stderr: "",
        exitCode: 0,
      },
    );
  });

  it("reads piped data and stdin pattern files through a custom command wrapper", async () => {
    const rg = defineCommand(
      "rg",
      async (args, ctx) => {
        if (!ctx.origCommand) throw new Error("Expected original rg");
        return ctx.origCommand(args);
      },
      { streaming: true },
    );
    const bash = new Bash({ files, customCommands: [rg] });
    expect(
      await bash.exec("seq 3 | rg --no-line-number 2 | cat"),
    ).toMatchObject({
      stdout: "2\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await bash.exec("seq 3 | rg -f - /src/a | cat")).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(await bash.exec("rg -n hello /src | head -n 1")).toMatchObject({
      stdout: "/src/a:1:hello שלום\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("distinguishes a producer from an empty upstream pipe", async () => {
    const contexts: boolean[] = [];
    const rg = defineCommand(
      "rg",
      async (args, ctx) => {
        contexts.push(ctx.stdio?.hasInput ?? false);
        if (!ctx.origCommand) throw new Error("Expected original rg");
        return ctx.origCommand(args);
      },
      { streaming: true },
    );
    const bash = new Bash({
      files: { "/src/a": "needle file\n" },
      cwd: "/src",
      customCommands: [rg],
    });
    expect(
      await bash.exec("rg --no-line-number needle | head -n 1"),
    ).toMatchObject({ stdout: "a:needle file\n", stderr: "", exitCode: 0 });
    expect(
      await bash.exec("set -o pipefail; seq 0 | rg needle | cat"),
    ).toMatchObject({ stdout: "", stderr: "", exitCode: 1 });
    expect(contexts).toEqual([false, true]);
  });
});
