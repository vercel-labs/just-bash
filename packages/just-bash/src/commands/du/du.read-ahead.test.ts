import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { DEFAULT_BATCH_SIZE } from "../../utils/constants.js";

class DeferredMetadataFs extends InMemoryFs {
  pending = 0;
  peak = 0;
  completed = 0;
  fail = false;
  override async lstat(path: string) {
    if (!path.startsWith("/tree/")) return super.lstat(path);
    this.pending++;
    this.peak = Math.max(this.peak, this.pending);
    await Promise.resolve();
    this.pending--;
    this.completed++;
    if (this.fail && path.endsWith("/a")) throw new Error("unreadable");
    return super.lstat(path);
  }
}

describe("du metadata read-ahead", () => {
  it("bounds concurrent reads and keeps complete output in traversal order", async () => {
    const files: Record<string, string> = Object.create(null);
    for (let i = 0; i < 205; i++)
      files[`/tree/${String(i).padStart(3, "0")}`] = "x".repeat(1024);
    files["/tree/sub/z"] = "x".repeat(2048);
    const fs = new DeferredMetadataFs(files);
    const result = await new Bash({ fs }).exec("du -a /tree");
    expect(result).toMatchObject({
      stdout: `${Array.from({ length: 205 }, (_, i) => `1\t/tree/${String(i).padStart(3, "0")}\n`).join("")}2\t/tree/sub/z\n2\t/tree/sub\n207\t/tree\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(fs.peak).toBeGreaterThan(1);
    expect(fs.peak).toBeLessThanOrEqual(DEFAULT_BATCH_SIZE);
    expect(fs.pending).toBe(0);
  });
  it("settles the batch before returning an error", async () => {
    const fs = new DeferredMetadataFs({ "/tree/a": "x", "/tree/b": "y" });
    fs.fail = true;
    expect(await new Bash({ fs }).exec("du /tree")).toMatchObject({
      stdout: "",
      stderr: "du: cannot access '/tree': No such file or directory\n",
      exitCode: 1,
    });
    expect(fs.completed).toBe(2);
    expect(fs.pending).toBe(0);
  });
});
