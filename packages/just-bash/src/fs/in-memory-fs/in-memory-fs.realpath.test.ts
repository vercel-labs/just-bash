import { describe, expect, it } from "vitest";
import { InMemoryFs } from "./in-memory-fs.js";

describe("InMemoryFs realpath", () => {
  it("resolves symlinks in multiple intermediate path components", async () => {
    const fs = new InMemoryFs({
      "/target/docs/file.txt": "content\n",
    });
    await fs.symlink("target", "/intermediate");
    await fs.symlink("/intermediate/docs", "/linked-docs");

    await expect(fs.realpath("/linked-docs/file.txt")).resolves.toBe(
      "/target/docs/file.txt",
    );
    await expect(fs.readFile("/linked-docs/file.txt")).resolves.toBe(
      "content\n",
    );
  });
});
