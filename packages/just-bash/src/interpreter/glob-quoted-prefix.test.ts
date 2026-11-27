import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { InMemoryFs } from "../fs/in-memory-fs/index.js";
import type { DirentEntry } from "../fs/interface.js";

const DIR = "/locked/App Support (x) [y]";

/**
 * Refuses to list `/locked`, as a sandbox refuses a folder above the one it
 * reaches, and records every path it is asked to list.
 */
class LockedParentFs extends InMemoryFs {
  listed: string[] = [];

  override async readdir(path: string): Promise<string[]> {
    this.refuse(path);
    return super.readdir(path);
  }

  override async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    this.refuse(path);
    return super.readdirWithFileTypes(path);
  }

  private refuse(path: string): void {
    this.listed.push(path);
    if (path === "/locked") {
      throw new Error(`EACCES: permission denied, scandir '${path}'`);
    }
  }
}

async function run(script: string) {
  const fs = new LockedParentFs({
    [`${DIR}/a.txt`]: "a",
    [`${DIR}/b.txt`]: "b",
  });
  const bash = new Bash({ fs, cwd: "/" });
  const result = await bash.exec(script);
  return { ...result, listed: fs.listed };
}

describe("a glob after a quoted directory", () => {
  it("reads the quoted part as a literal path and lists only that directory", async () => {
    const result = await run(`d="${DIR}"; printf '[%s]\\n' "$d"/*.txt`);
    expect(result.stdout).toBe(`[${DIR}/a.txt]\n[${DIR}/b.txt]\n`);
    expect(result.listed).toEqual([DIR]);
  });

  it("passes no escaped path to the filesystem", async () => {
    const result = await run(
      `for f in "${DIR}"/*; do echo "[$f]"; done; ls "${DIR}"/*.md`,
    );
    expect(result.stdout).toBe(`[${DIR}/a.txt]\n[${DIR}/b.txt]\n`);
    expect(result.stderr).toBe(`ls: ${DIR}/*.md: No such file or directory\n`);
    expect(result.listed.filter((path) => path.includes("\\"))).toEqual([]);
  });

  it("reads the quoted part literally before a globstar", async () => {
    const result = await run(
      `shopt -s globstar; printf '[%s]\\n' "${DIR}"/**/*.txt`,
    );
    expect(result.stdout).toBe(`[${DIR}/a.txt]\n[${DIR}/b.txt]\n`);
    expect(result.listed).toEqual([DIR]);
  });

  it("keeps an unmatched word whole", async () => {
    const result = await run(`printf '[%s]\\n' "/no such (dir)"/*`);
    expect(result.stdout).toBe("[/no such (dir)/*]\n");
  });

  it("does not glob a word whose glob characters are all quoted", async () => {
    const result = await run(
      `shopt -s failglob; printf '[%s]\\n' a\\*b "s p"\\*; echo x > c\\?d; cat 'c?d'`,
    );
    expect(result.stdout).toBe("[a*b]\n[s p*]\nx\n");
    expect(result.exitCode).toBe(0);
  });
});
