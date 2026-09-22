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
    await expect(
      fs.realpathFromCwd({ cwd: "/target", path: "docs/file.txt" }),
    ).resolves.toBe("/target/docs/file.txt");
  });

  it("resolves dot segments after following a symlink", async () => {
    const fs = new InMemoryFs({
      "/target/file.txt": "content\n",
      "/target/dir/keep": "",
    });
    await fs.symlink("/target/dir", "/work-link");

    await expect(fs.realpath("/work-link/..")).resolves.toBe("/target");
    await expect(fs.realpath("/work-link/../file.txt")).resolves.toBe(
      "/target/file.txt",
    );
    await expect(fs.realpath("/missing/../target/file.txt")).rejects.toThrow(
      "ENOENT",
    );
  });

  it("allows symlink revisits with a different suffix across operations", async () => {
    const fs = new InMemoryFs({
      "/real/sub": "content\n",
    });
    await fs.symlink("/real", "/link");
    await fs.symlink("/link/sub", "/real/hop");

    await expect(fs.realpath("/link/hop")).resolves.toBe("/real/sub");
    await expect(fs.readFile("/link/hop")).resolves.toBe("content\n");
    await expect(fs.stat("/link/hop")).resolves.toMatchObject({
      isFile: true,
    });
    await expect(fs.exists("/link/hop")).resolves.toBe(true);
    await expect(
      fs.utimes("/link/hop", new Date(), new Date()),
    ).resolves.toBeUndefined();
  });
});
