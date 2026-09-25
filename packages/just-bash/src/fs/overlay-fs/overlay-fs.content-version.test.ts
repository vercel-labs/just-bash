import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { OverlayFs } from "./overlay-fs.js";

describe("OverlayFs content versions", () => {
  it("changes on overwrite and append but stays stable across a move", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-version-"));
    try {
      const overlay = new OverlayFs({ root, mountPoint: "/" });
      await overlay.writeFile("/source", "a");
      const initial = (await overlay.stat("/source")).contentVersion;

      await overlay.writeFile("/source", "b");
      const overwritten = (await overlay.stat("/source")).contentVersion;
      expect(overwritten).not.toBe(initial);

      await overlay.appendFile("/source", "c");
      const appended = (await overlay.stat("/source")).contentVersion;
      expect(appended).not.toBe(overwritten);

      await overlay.mv("/source", "/destination");
      expect((await overlay.stat("/destination")).contentVersion).toBe(
        appended,
      );

      overlay.writeFileSync("/destination", "d");
      expect((await overlay.stat("/destination")).contentVersion).not.toBe(
        appended,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
