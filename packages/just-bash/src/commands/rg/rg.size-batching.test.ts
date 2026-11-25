import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { defineCommand } from "../../custom-commands.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";

describe("rg file-size admission", () => {
  it("batches cold file metadata before reading a lazy filesystem", async () => {
    const files: Record<string, string> = Object.create(null);
    for (let i = 0; i < 61; i++)
      files[`/src/sub/f${String(i).padStart(3, "0")}.json`] =
        '{"label":"שלום"}\n';
    const fs = new InMemoryFs(files);
    const stat = fs.stat.bind(fs);
    const hydrated = new Set<string>();
    let pending = 0;
    let peak = 0;
    fs.stat = async (path) => {
      if (path.endsWith(".json") && !hydrated.has(path)) {
        hydrated.add(path);
        pending++;
        peak = Math.max(peak, pending);
        await Promise.resolve();
        pending--;
      }
      return stat(path);
    };
    const result = await new Bash({ fs }).exec(
      "rg --no-line-number -l שלום /src",
    );
    expect(result).toMatchObject({
      stdout: `${Object.keys(files).join("\n")}\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(50);
    expect(pending).toBe(0);
  });

  it.each([
    ["hit", "/src/b:hit\n", 0],
    ["--files", "/src/b\n/src/sub/c\n", 0],
    ["-l hit", "/src/b\n", 0],
    ["--files-without-match hit", "/src/sub/c\n", 0],
    ["-c --include-zero hit", "/src/b:1\n/src/sub/c:0\n", 0],
  ])("preserves size filtering for %s", async (flags, stdout, exitCode) => {
    const bash = new Bash({
      files: {
        "/src/a": "hit🙂\n",
        "/src/b": "hit\n",
        "/src/sub/c": "no\n",
      },
    });
    expect(
      await bash.exec(`rg --no-line-number --max-filesize 4 ${flags} /src`),
    ).toMatchObject({
      stdout,
      stderr: "",
      exitCode,
    });
  });

  it("retains explicit operands, duplicates, ordering and unlimited size", async () => {
    const bash = new Bash({
      files: { "/src/a": "hit🙂\n", "/src/b": "hit\n" },
    });
    expect(
      await bash.exec(
        "rg --no-line-number --sort path --max-filesize 4 hit /src /src/b",
      ),
    ).toMatchObject({
      stdout: "/src/b:hit\n/src/b:hit\n",
      stderr: "",
      exitCode: 0,
    });
    expect(
      await bash.exec("rg --no-line-number --max-filesize 4 hit /src/a"),
    ).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 1,
    });
    expect(
      await bash.exec("rg --no-line-number --max-filesize 0 -l hit /src"),
    ).toMatchObject({
      stdout: "/src/a\n/src/b\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("retains an admitted explicit file if a redundant metadata read would fail", async () => {
    const fs = new InMemoryFs({ "/src/a": "hit\n", "/explicit": "hit\n" });
    const stat = fs.stat.bind(fs);
    let admitted = false;
    fs.stat = async (path) => {
      if (path === "/explicit") {
        if (admitted) throw new Error("metadata temporarily unavailable");
        admitted = true;
      }
      return stat(path);
    };
    expect(
      await new Bash({ fs }).exec("rg --files --max-filesize 4 /src /explicit"),
    ).toMatchObject({
      stdout: "/explicit\n/src/a\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("never invokes the preprocessor for an oversized file", async () => {
    const paths: string[] = [];
    const bash = new Bash({
      files: { "/src/a": "oversized\n", "/src/b": "hit\n" },
      customCommands: [
        defineCommand("pre", async (args) => {
          paths.push(...args);
          return { stdout: "hit\n", stderr: "", exitCode: 0 };
        }),
      ],
    });
    expect(
      await bash.exec(
        "rg --no-line-number --max-filesize 4 --pre pre hit /src",
      ),
    ).toMatchObject({
      stdout: "/src/b:hit\n",
      stderr: "",
      exitCode: 0,
    });
    expect(paths).toEqual(["/src/b"]);
  });

  it("counts only admitted files in text and JSON statistics", async () => {
    const bash = new Bash({
      files: { "/src/a": "hit🙂\n", "/src/b": "hit\n" },
    });
    expect(
      await bash.exec("rg --no-line-number --max-filesize 4 --stats hit /src"),
    ).toMatchObject({
      stdout:
        "/src/b:hit\n\n1 matches\n1 matched lines\n1 files contained matches\n1 files searched\n4 bytes searched\n",
      stderr: "",
      exitCode: 0,
    });
    expect(
      await bash.exec(
        "rg --no-line-number --max-filesize 4 --json -q hit /src",
      ),
    ).toMatchObject({
      stdout: `${JSON.stringify({
        type: "summary",
        data: {
          elapsed_total: { secs: 0, nanos: 0, human: "0s" },
          stats: {
            elapsed: { secs: 0, nanos: 0, human: "0s" },
            searches: 1,
            searches_with_match: 1,
            bytes_searched: 4,
            bytes_printed: 0,
            matched_lines: 1,
            matches: 1,
          },
        },
      })}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  it("filters compressed size before reading or expanding gzip contents", async () => {
    const fs = new InMemoryFs({ "/src/b": "hit\n" });
    await fs.writeFile("/src/a.gz", gzipSync("hit\n"));
    const read = fs.readFileBuffer.bind(fs);
    const reads: string[] = [];
    fs.readFileBuffer = async (path) => {
      reads.push(path);
      return read(path);
    };
    expect(
      await new Bash({ fs }).exec(
        "rg --no-line-number -z --max-filesize 4 hit /src",
      ),
    ).toMatchObject({
      stdout: "/src/b:hit\n",
      stderr: "",
      exitCode: 0,
    });
    expect(reads).not.toContain("/src/a.gz");
  });

  it("bounds sorted discovery across roots before an early pipe close", async () => {
    const files: Record<string, string> = Object.create(null);
    for (const root of ["a", "b"])
      for (let i = 0; i < 100; i++)
        files[`/${root}/f${String(i).padStart(3, "0")}`] = "needle\n";
    files["/a/f000"] = "needle\n".repeat(10000);
    const bash = new Bash({
      files,
      executionLimits: { maxTraversalEntries: 80 },
    });
    expect(
      await bash.exec(
        "rg --no-line-number --sort path needle /a /b | head -n 1",
      ),
    ).toMatchObject({
      stdout: "/a/f000:needle\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
