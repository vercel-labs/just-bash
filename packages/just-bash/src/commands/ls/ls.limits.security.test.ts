import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import type { DirentEntry, FsStat } from "../../fs/interface.js";

/**
 * A backend whose `readdir()` reports far more children than the directory
 * actually holds. Stands in for a host-provided `IFileSystem` that fronts a
 * directory too large to materialize, which `ls` must refuse before it sorts,
 * stats, classifies or formats the entries.
 */
class HugeDirectoryFs extends InMemoryFs {
  /** Paths under /large that were statted, i.e. per-entry work that ran. */
  readonly childStats: string[] = [];

  constructor(private readonly entryCount: number) {
    super({ "/large/.keep": "" });
  }

  private syntheticEntries(): string[] {
    const entries: string[] = [];
    for (let i = 0; i < this.entryCount; i++) entries.push(`f${i}`);
    return entries;
  }

  private recordChildAccess(path: string): void {
    const resolved = this.resolvePath("/", path);
    if (resolved.startsWith("/large/")) this.childStats.push(resolved);
  }

  override async readdir(path: string): Promise<string[]> {
    if (this.resolvePath("/", path) === "/large") {
      return this.syntheticEntries();
    }
    return super.readdir(path);
  }

  override async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    if (this.resolvePath("/", path) === "/large") {
      return this.syntheticEntries().map((name) => ({
        name,
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false,
      }));
    }
    return super.readdirWithFileTypes(path);
  }

  override async stat(path: string): Promise<FsStat> {
    this.recordChildAccess(path);
    return super.stat(path);
  }

  override async lstat(path: string): Promise<FsStat> {
    this.recordChildAccess(path);
    return super.lstat(path);
  }
}

const LIMIT = 8;
const ENTRIES = 64;

function hugeDirBash(limits: {
  maxArrayElements?: number;
  maxTraversalEntries?: number;
}): { bash: Bash; fs: HugeDirectoryFs } {
  const fs = new HugeDirectoryFs(ENTRIES);
  return {
    bash: new Bash({ fs, cwd: "/", executionLimits: limits }),
    fs,
  };
}

describe("ls directory collection limits", () => {
  const commands = [
    "ls /large",
    "ls -l /large",
    "ls -F /large",
    "ls -S /large",
    "ls -R /large",
    "ls -a /large",
    "ls -l /large | head -1",
  ];

  it.each(
    commands,
  )("rejects an oversized directory result for `%s`", async (command) => {
    const { bash } = hugeDirBash({ maxArrayElements: LIMIT });
    const result = await bash.exec(command);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `bash: ls: array element limit exceeded (${LIMIT})\n`,
    );
    expect(result.exitCode).toBe(126);
  });

  it.each(
    commands,
  )("charges the traversal entry budget for `%s`", async (command) => {
    const { bash } = hugeDirBash({ maxTraversalEntries: LIMIT });
    const result = await bash.exec(command);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `bash: ls: filesystem traversal entry limit exceeded (${LIMIT})\n`,
    );
    expect(result.exitCode).toBe(126);
  });

  it("fails before any per-entry stat or classify work runs", async () => {
    const { bash, fs } = hugeDirBash({ maxArrayElements: LIMIT });
    const result = await bash.exec("ls -lF /large");
    expect(result.exitCode).toBe(126);
    expect(fs.childStats).toEqual([]);
  });

  it("bounds a directory reached through shell pathname expansion", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < ENTRIES; i++) files[`/large/f${i}`] = "";
    const bash = new Bash({
      files,
      cwd: "/",
      executionLimits: { maxArrayElements: LIMIT },
    });
    // The shell expands the pattern and hands `ls` the directory operand.
    const result = await bash.exec("ls /larg*");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `bash: ls: array element limit exceeded (${LIMIT})\n`,
    );
    expect(result.exitCode).toBe(126);
  });

  it("still lists a directory that fits inside the limits", async () => {
    const fs = new HugeDirectoryFs(3);
    const bash = new Bash({
      fs,
      cwd: "/",
      executionLimits: { maxArrayElements: LIMIT, maxTraversalEntries: LIMIT },
    });
    const result = await bash.exec("ls /large");
    expect(result.stdout).toBe("f0\nf1\nf2\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("counts the synthetic -a entries against the array limit", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < LIMIT; i++) files[`/d/f${i}`] = "";
    const bash = new Bash({
      files,
      cwd: "/",
      executionLimits: { maxArrayElements: LIMIT },
    });
    // Exactly `LIMIT` real entries, but `-a` prepends "." and ".." for a
    // listing of LIMIT + 2.
    const result = await bash.exec("ls -a /d");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `bash: ls: array element limit exceeded (${LIMIT})\n`,
    );
    expect(result.exitCode).toBe(126);
  });

  it("charges every operand of a multi-directory listing", async () => {
    const bash = new Bash({
      files: { "/a/f1": "", "/a/f2": "", "/b/f1": "", "/b/f2": "" },
      cwd: "/",
      executionLimits: { maxTraversalEntries: 5 },
    });
    // Two roots plus four children is six entries against a budget of five.
    const result = await bash.exec("ls /a /b");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: ls: filesystem traversal entry limit exceeded (5)\n",
    );
    expect(result.exitCode).toBe(126);
  });

  it("does not materialize sibling directories before admitting them", async () => {
    let materialized = 0;
    class ConcurrencySpyFs extends InMemoryFs {
      override async readdir(path: string): Promise<string[]> {
        const entries = await super.readdir(path);
        if (/^\/root\/d\d+$/.test(this.resolvePath("/", path))) {
          // Yield across microtasks so a batched fan-out would overlap here.
          for (let i = 0; i < 3; i++) await Promise.resolve();
          materialized += entries.length;
        }
        return entries;
      }
    }
    const files: Record<string, string> = {};
    for (let d = 0; d < 20; d++) {
      for (let f = 0; f < 10; f++) files[`/root/d${d}/f${f}`] = "";
    }
    const bash = new Bash({
      fs: new ConcurrencySpyFs(files),
      cwd: "/",
      executionLimits: { maxTraversalEntries: 30 },
    });
    const result = await bash.exec("ls -R /root");
    expect(result.stderr).toBe(
      "bash: ls: filesystem traversal entry limit exceeded (30)\n",
    );
    expect(result.exitCode).toBe(126);
    // Recursion stops at the first subdirectory that overruns the budget
    // instead of reading a whole batch of siblings up front.
    expect(materialized).toBe(10);
  });
});
