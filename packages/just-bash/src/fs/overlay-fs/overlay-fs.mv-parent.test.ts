import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OverlayFs } from "./overlay-fs.js";

// OverlayFs.mv delegates to cp(), whose write path creates missing parent
// directories. rename(2) requires the destination parent to exist, so mv has
// to reject that case itself (issue #690).
describe("OverlayFs mv destination parent", () => {
  let tempDir: string;
  let overlay: OverlayFs;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-mv-parent-"));
    overlay = new OverlayFs({
      root: tempDir,
      mountPoint: "/",
      allowSymlinks: true,
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("throws ENOENT when the destination parent is missing", async () => {
    await overlay.writeFile("/f.txt", "content");
    await expect(overlay.mv("/f.txt", "/missing/f.txt")).rejects.toThrow(
      "ENOENT: no such file or directory, mv '/f.txt' -> '/missing/f.txt'",
    );
    expect(await overlay.readFile("/f.txt")).toBe("content");
    await expect(overlay.stat("/missing")).rejects.toThrow();
  });

  it("throws ENOTDIR when the destination parent is a file", async () => {
    await overlay.writeFile("/f.txt", "content");
    await overlay.writeFile("/blocker", "not a dir");
    await expect(overlay.mv("/f.txt", "/blocker/f.txt")).rejects.toThrow(
      "ENOTDIR: not a directory, mv '/f.txt' -> '/blocker/f.txt'",
    );
  });

  it("still moves into an existing directory, including through a symlinked parent", async () => {
    await overlay.writeFile("/f.txt", "content");
    await overlay.mkdir("/real", { recursive: true });
    await overlay.symlink("/real", "/link");
    await overlay.mv("/f.txt", "/link/f.txt");
    // The file stays reachable through the path it was moved to, and the
    // source is gone. Unlike InMemoryFs, the overlay keeps the entry under the
    // unresolved virtual path rather than writing through the link, so it is
    // reachable via /link/f.txt but not via the canonical /real/f.txt.
    await expect(overlay.readFile("/link/f.txt")).resolves.toBe("content");
    await expect(overlay.readFile("/f.txt")).rejects.toThrow();
  });
});
