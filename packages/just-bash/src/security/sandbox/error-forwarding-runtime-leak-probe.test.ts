import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ReadWriteFs } from "../../fs/read-write-fs/read-write-fs.js";

describe("runtime error-forwarding leak probes", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jb-runtime-leak-"));
    fs.mkdirSync(path.join(tempDir, "dir"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "pkg"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "dbdir"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "target.txt"), "ok\n");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("ln hard-link directory failure does not expose host/internal markers", async () => {
    const bash = new Bash({
      fs: new ReadWriteFs({ root: tempDir, allowSymlinks: true }),
      cwd: "/",
      python: true,
    });

    const result = await bash.exec("ln /dir /dirlink");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "ln: '/dir': hard link not allowed for directory\n",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain(tempDir);
    expect(result.stderr).not.toContain("/Users/");
    expect(result.stderr).not.toContain("node:internal");
    expect(result.stderr).not.toContain("file://");
  });

  it("python3 script-open directory error does not expose host/internal markers", async () => {
    const bash = new Bash({
      fs: new ReadWriteFs({ root: tempDir, allowSymlinks: true }),
      cwd: "/",
      python: true,
    });

    const result = await bash.exec("python3 /pkg");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "python3: can't open file '/pkg': EISDIR: illegal operation on a directory, read '/pkg'\n",
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).not.toContain(tempDir);
    expect(result.stderr).not.toContain("/Users/");
    expect(result.stderr).not.toContain("node:internal");
    expect(result.stderr).not.toContain("file://");
  });

  it("sqlite3 open-directory error does not expose host/internal markers", async () => {
    const bash = new Bash({
      fs: new ReadWriteFs({ root: tempDir, allowSymlinks: true }),
      cwd: "/",
      python: true,
    });

    const result = await bash.exec("sqlite3 /dbdir 'select 1;'");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "sqlite3: unable to open database \"/dbdir\": EISDIR: illegal operation on a directory, read '/dbdir'\n",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain(tempDir);
    expect(result.stderr).not.toContain("/Users/");
    expect(result.stderr).not.toContain("node:internal");
    expect(result.stderr).not.toContain("file://");
  });
});
