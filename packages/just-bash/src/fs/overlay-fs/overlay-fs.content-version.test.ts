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

  it("isolates stored bytes from write, append, and read buffers", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-version-"));
    try {
      const overlay = new OverlayFs({ root, mountPoint: "/" });
      const input = Uint8Array.of(65);
      await overlay.writeFile("/file", input);
      const initial = (await overlay.stat("/file")).contentVersion;

      input[0] = 88;
      const read = await overlay.readFileBuffer("/file");
      read[0] = 89;
      expect(await overlay.readFile("/file")).toBe("A");
      expect((await overlay.stat("/file")).contentVersion).toBe(initial);

      const append = Uint8Array.of(66);
      await overlay.appendFile("/file", append);
      const appended = (await overlay.stat("/file")).contentVersion;
      append[0] = 90;
      const combined = await overlay.readFileBuffer("/file");
      combined[0] = 89;
      expect(await overlay.readFile("/file")).toBe("AB");
      expect((await overlay.stat("/file")).contentVersion).toBe(appended);
      expect(appended).not.toBe(initial);

      const syncInput = Uint8Array.of(67);
      overlay.writeFileSync("/sync", syncInput);
      syncInput[0] = 90;
      expect(await overlay.readFile("/sync")).toBe("C");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
