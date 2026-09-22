import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import type { DirentEntry } from "../../fs/interface.js";

/** Twenty small directories: none near the limit alone, all of them over it. */
function manySmallDirectories(): Record<string, string> {
  const files: Record<string, string> = {};
  for (let d = 0; d < 20; d++) {
    for (let f = 0; f < 5; f++) {
      files[`/t/d${String(d).padStart(2, "0")}/file-${f}.txt`] = "";
    }
  }
  return files;
}

/**
 * A directory that lists by name but cannot be read for the descent, the way a
 * directory removed or locked between the two reads `ls -R` makes behaves.
 */
class UnreadableForDescentFs extends InMemoryFs {
  constructor(
    files: Record<string, string>,
    private readonly failing: string,
  ) {
    super(files);
  }

  override async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    if (this.resolvePath("/", path) === this.failing) {
      throw new Error(`EACCES: permission denied, scandir '${path}'`);
    }
    return super.readdirWithFileTypes(path);
  }
}

describe("ls output", () => {
  it("bounds a recursive listing as a whole, not directory by directory", async () => {
    const bash = new Bash({
      files: manySmallDirectories(),
      executionLimits: { maxOutputSize: 400 },
    });

    const result = await bash.exec("ls -R /t");

    expect(result.exitCode).toBe(126);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: ls: output size limit exceeded (400 bytes)\n",
    );
  });

  it("writes nothing for a directory that fails part way, and keeps going", async () => {
    const fs = new UnreadableForDescentFs(
      {
        "/t/a/one.txt": "",
        "/t/b/two.txt": "",
        "/t/b/inner/three.txt": "",
        "/t/c/four.txt": "",
      },
      "/t/b",
    );
    const bash = new Bash({ fs });

    const result = await bash.exec("ls -R /t");

    expect(result.stdout).toBe(
      "/t:\na\nb\nc\n\n/t/a:\none.txt\n\n\n/t/c:\nfour.txt\n",
    );
    expect(result.stderr).toBe("ls: /t/b: No such file or directory\n");
    expect(result.exitCode).toBe(2);
  });

  it("lists a large directory in long format in linear time", async () => {
    // Guarded by the test timeout: re-measuring the accumulated output on
    // every line made this about 30 seconds, and it runs in well under one.
    const files: Record<string, string> = {};
    for (let i = 0; i < 10_000; i++) {
      files[`/big/file-${String(i).padStart(5, "0")}.txt`] = "";
    }
    const bash = new Bash({ files });

    const result = await bash.exec("ls -l /big");

    expect(result.exitCode).toBe(0);
    expect(result.stdout.split("\n")).toHaveLength(10_002);
  });
});
