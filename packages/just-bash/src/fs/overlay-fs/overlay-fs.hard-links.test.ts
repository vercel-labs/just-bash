import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OverlayFs } from "./overlay-fs.js";

describe("OverlayFs host-planted hard-link containment", () => {
  let parentDir: string;
  let sandboxDir: string;
  let outsideFile: string;
  let linkedFile: string;
  let overlay: OverlayFs;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-hard-link-"));
    sandboxDir = path.join(parentDir, "sandbox");
    const outsideDir = path.join(parentDir, "outside");
    fs.mkdirSync(sandboxDir);
    fs.mkdirSync(outsideDir);
    outsideFile = path.join(outsideDir, "victim.txt");
    linkedFile = path.join(sandboxDir, "linked.txt");
    fs.writeFileSync(outsideFile, "outside");
    fs.linkSync(outsideFile, linkedFile);
    overlay = new OverlayFs({ root: sandboxDir, mountPoint: "/" });
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("keeps overwrite and append in memory", async () => {
    await overlay.writeFile("/linked.txt", "sandbox");
    await overlay.appendFile("/linked.txt", "-appended");

    expect(await overlay.readFile("/linked.txt")).toBe("sandbox-appended");
    expect(fs.readFileSync(linkedFile, "utf8")).toBe("outside");
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside");
  });

  it("keeps metadata changes in memory", async () => {
    const originalStat = fs.statSync(outsideFile);
    const changed = new Date(originalStat.mtimeMs - 60_000);

    await overlay.chmod("/linked.txt", 0o700);
    await overlay.utimes("/linked.txt", changed, changed);

    expect((await overlay.stat("/linked.txt")).mode & 0o777).toBe(0o700);
    expect(fs.statSync(outsideFile).mode & 0o777).toBe(
      originalStat.mode & 0o777,
    );
    expect(fs.statSync(outsideFile).mtimeMs).toBe(originalStat.mtimeMs);
  });

  it("contains copy, move, and removal of the sandbox name", async () => {
    await overlay.writeFile("/source.txt", "replacement");
    await overlay.cp("/source.txt", "/linked.txt");
    expect(await overlay.readFile("/linked.txt")).toBe("replacement");

    await overlay.mv("/source.txt", "/linked.txt");
    await overlay.rm("/linked.txt");

    expect(await overlay.exists("/linked.txt")).toBe(false);
    expect(fs.readFileSync(linkedFile, "utf8")).toBe("outside");
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside");
  });
});
