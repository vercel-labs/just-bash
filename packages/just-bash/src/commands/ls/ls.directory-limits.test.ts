import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import type { ReaddirOptions } from "../../fs/interface.js";

class CapturingReaddirFs extends InMemoryFs {
  seenOptions?: ReaddirOptions;

  override readdir(path: string, options?: ReaddirOptions): Promise<string[]> {
    if (this.resolvePath("/", path) === "/root") {
      this.seenOptions = options;
    }
    return super.readdir(path);
  }
}

describe("ls directory enumeration limits", () => {
  it("uses the traversal entry cap and shell output byte cap", async () => {
    const fs = new CapturingReaddirFs({ "/root/file.txt": "" });
    const bash = new Bash({
      fs,
      executionLimits: {
        maxTraversalEntries: 100_000,
        maxOutputSize: 1024 * 1024,
      },
    });

    const result = await bash.exec("ls /root");

    expect(result).toMatchObject({
      stdout: "file.txt\n",
      stderr: "",
      exitCode: 0,
    });
    expect(fs.seenOptions).toEqual({
      maxEntries: 100_000,
      maxNameBytes: 1024 * 1024,
    });
  });
});
