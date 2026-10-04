import { describe, expect, it, vi } from "vitest";
import { InMemoryFs } from "./in-memory-fs.js";

describe("InMemoryFs file permissions", () => {
  it("rejects all read APIs for files without owner read permission", async () => {
    const fs = new InMemoryFs({
      "/secret": { content: "hidden", mode: 0o000 },
    });

    await expect(fs.readFile("/secret")).rejects.toThrow(
      "EACCES: permission denied, open '/secret'",
    );
    await expect(fs.readFileBuffer("/secret")).rejects.toThrow(
      "EACCES: permission denied, open '/secret'",
    );
    await expect(fs.readFileBytes("/secret")).rejects.toThrow(
      "EACCES: permission denied, open '/secret'",
    );
  });

  it("checks read permission after resolving a symlink", async () => {
    const fs = new InMemoryFs({
      "/secret": { content: "hidden", mode: 0o000 },
    });
    await fs.symlink("/secret", "/link");

    await expect(fs.readFile("/link")).rejects.toThrow(
      "EACCES: permission denied, open '/link'",
    );
  });

  it("does not materialize unreadable lazy files", async () => {
    const provider = vi.fn(() => "hidden");
    const fs = new InMemoryFs();
    fs.writeFileLazy("/secret", provider, { mode: 0o000 });

    await expect(fs.readFileBuffer("/secret")).rejects.toThrow("EACCES");
    expect(provider).not.toHaveBeenCalled();
  });

  it("rejects writes and appends without changing a read-only file", async () => {
    const fs = new InMemoryFs({
      "/readonly": { content: "original", mode: 0o444 },
    });

    await expect(fs.writeFile("/readonly", "replacement")).rejects.toThrow(
      "EACCES: permission denied, open '/readonly'",
    );
    await expect(fs.appendFile("/readonly", " appended")).rejects.toThrow(
      "EACCES: permission denied, open '/readonly'",
    );
    expect(await fs.readFile("/readonly")).toBe("original");
  });

  it("allows writes to new files and restores access after chmod", async () => {
    const fs = new InMemoryFs({
      "/data": { content: "original", mode: 0o000 },
    });

    await fs.writeFile("/new", "created");
    expect(await fs.readFile("/new")).toBe("created");

    await fs.chmod("/data", 0o644);
    expect(await fs.readFile("/data")).toBe("original");
    await fs.writeFile("/data", "updated");
    expect(await fs.readFile("/data")).toBe("updated");
  });
});
