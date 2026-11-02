import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import type { FsStat } from "../../fs/interface.js";

function files(count: number, content = "foo\n"): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (let i = 0; i < count; i++)
    result[`/tree/f${String(i).padStart(3, "0")}`] = content;
  return result;
}

describe("grep bounded byte reads", () => {
  it("uses a bounded parallel byte window and preserves operand output order", async () => {
    class DelayedFs extends InMemoryFs {
      active = 0;
      peak = 0;
      reads = 0;
      override async readFileBuffer(path: string): Promise<Uint8Array> {
        this.active++;
        this.reads++;
        this.peak = Math.max(this.peak, this.active);
        try {
          await new Promise<void>((resolve) => queueMicrotask(resolve));
          return await super.readFileBuffer(path);
        } finally {
          this.active--;
        }
      }
    }
    const fs = new DelayedFs(files(120));
    const textReads = vi.spyOn(fs, "readFile");
    const result = await new Bash({ fs, cwd: "/tree" }).exec("grep -rn foo .");
    expect(result).toMatchObject({
      stdout: Array.from(
        { length: 120 },
        (_, i) => `./f${String(i).padStart(3, "0")}:1:foo\n`,
      ).join(""),
      stderr: "",
      exitCode: 0,
    });
    expect(textReads).not.toHaveBeenCalled();
    expect(fs.reads).toBe(120);
    expect(fs.peak).toBe(50);
  });

  it("preserves readFile UTF-8 decoding of BOM and malformed bytes", async () => {
    const fs = new InMemoryFs({
      "/bom": Uint8Array.from([0xef, 0xbb, 0xbf, 0x66, 0x6f, 0x6f, 10]),
      "/invalid": Uint8Array.from([0xff, 0x66, 0x6f, 0x6f, 10]),
      "/unicode": "한글 foo\n",
    });
    const expected = "/bom:1:foo\n/invalid:1:�foo\n/unicode:1:한글 foo\n";
    const result = await new Bash({ fs }).exec(
      "grep -n foo /bom /invalid /unicode",
    );
    expect(result).toMatchObject({ stdout: expected, stderr: "", exitCode: 0 });
  });

  it("keeps ordered matches and diagnostics when byte reads fail", async () => {
    const fs = new InMemoryFs({
      "/a": "foo a\n",
      "/b": "foo b\n",
      "/c": "foo c\n",
      "/d": "foo d\n",
    });
    const read = fs.readFileBuffer.bind(fs);
    vi.spyOn(fs, "readFileBuffer").mockImplementation(async (path) => {
      if (path === "/b" || path === "/d") throw new Error("denied");
      return read(path);
    });
    const result = await new Bash({ fs }).exec("grep foo /a /b /c /d");
    expect(result).toMatchObject({
      stdout: "/a:foo a\n/c:foo c\n",
      stderr:
        "grep: /b: No such file or directory\ngrep: /d: No such file or directory\n",
      exitCode: 2,
    });
  });

  it("releases every file reservation, including literal prefilter misses", async () => {
    const result = await new Bash({
      files: files(200, "irrelevant\n"),
      executionLimits: { maxLiveBytes: 2_000, maxInputBytes: 5_000 },
    }).exec("grep -r missing /tree");
    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 1 });
  });

  it("bounds simultaneous byte and decoded-text allocations before dispatch", async () => {
    const fs = new InMemoryFs({ "/a": "x".repeat(40) });
    const read = vi.spyOn(fs, "readFileBuffer");
    const result = await new Bash({
      fs,
      executionLimits: { maxLiveBytes: 100 },
    }).exec("grep x /a");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain(
      "grep: live byte limit exceeded (100 bytes)",
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("charges cumulative file bytes across batches once", async () => {
    const bash = new Bash({
      files: { "/a": "x\n", "/b": "x\n" },
      executionLimits: { maxInputBytes: 4 },
    });
    expect(await bash.exec("grep x /a /b")).toMatchObject({
      stdout: "/a:x\n/b:x\n",
      stderr: "",
      exitCode: 0,
    });
    const result = await new Bash({
      files: { "/a": "x\n", "/b": "x\n" },
      executionLimits: { maxInputBytes: 3 },
    }).exec("grep x /a /b");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain(
      "grep: aggregate input size limit exceeded (3 bytes)",
    );
  });

  it("fails visibly if a file grows beyond its reserved metadata", async () => {
    class GrowingFs extends InMemoryFs {
      override async stat(path: string): Promise<FsStat> {
        return { ...(await super.stat(path)), size: 1 };
      }
    }
    const result = await new Bash({
      fs: new GrowingFs({ "/a": "foo\n" }),
    }).exec("grep foo /a");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("grep: file grew while being read");
  });

  it("cancellation during a byte read remains a fatal stop", async () => {
    const controller = new AbortController();
    const fs = new InMemoryFs({ "/a": "foo\n" });
    const read = fs.readFileBuffer.bind(fs);
    vi.spyOn(fs, "readFileBuffer").mockImplementation(async (path) => {
      const bytes = await read(path);
      controller.abort();
      return bytes;
    });
    const result = await new Bash({ fs }).exec("grep foo /a", {
      signal: controller.signal,
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("No such file or directory");
  });
});
