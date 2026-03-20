import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { OverlayFs } from "../fs/overlay-fs/overlay-fs.js";
import { seedOverlayFiles } from "./shell-files.js";

describe("seedOverlayFiles", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "just-bash-shell-files-"));
    fs.writeFileSync(path.join(tempDir, "real.txt"), "from-disk");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("seeds overlay-only files for shell startup", async () => {
    const overlayFs = new OverlayFs({ root: tempDir, mountPoint: "/" });
    seedOverlayFiles(overlayFs, {
      "/seeded.txt": "from-seed",
      "nested/seeded2.txt": "from-seed-2",
    });

    const env = new Bash({ fs: overlayFs, cwd: "/" });
    const one = await env.exec("cat /seeded.txt");
    const two = await env.exec("cat /nested/seeded2.txt");

    expect(one.exitCode).toBe(0);
    expect(one.stdout).toBe("from-seed");
    expect(two.exitCode).toBe(0);
    expect(two.stdout).toBe("from-seed-2");
  });

  it("does nothing when files are omitted", async () => {
    const overlayFs = new OverlayFs({ root: tempDir, mountPoint: "/" });
    seedOverlayFiles(overlayFs, undefined);

    const env = new Bash({ fs: overlayFs, cwd: "/" });
    const result = await env.exec("cat /seeded.txt");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No such file or directory");
  });
});
