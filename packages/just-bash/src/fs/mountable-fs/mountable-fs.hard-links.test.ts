import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryFs } from "../in-memory-fs/in-memory-fs.js";
import { ReadWriteFs } from "../read-write-fs/read-write-fs.js";
import { MountableFs } from "./mountable-fs.js";

describe("MountableFs host-planted hard-link containment", () => {
  let parentDir: string;
  let sandboxDir: string;
  let outsideFile: string;
  let linkedFile: string;
  let mounted: MountableFs;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "mount-hard-link-"));
    sandboxDir = path.join(parentDir, "sandbox");
    const outsideDir = path.join(parentDir, "outside");
    fs.mkdirSync(sandboxDir);
    fs.mkdirSync(outsideDir);
    outsideFile = path.join(outsideDir, "victim.txt");
    linkedFile = path.join(sandboxDir, "linked.txt");
    fs.writeFileSync(outsideFile, "outside");
    fs.linkSync(outsideFile, linkedFile);
    mounted = new MountableFs({
      base: new InMemoryFs({ "/source.txt": "cross-mount" }),
      mounts: [
        {
          mountPoint: "/workspace",
          filesystem: new ReadWriteFs({ root: sandboxDir }),
        },
      ],
    });
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("preserves containment through delegated content operations", async () => {
    await mounted.writeFile("/workspace/linked.txt", "sandbox");
    // writeFile detached the entry, so append no longer reads a shared inode.
    await mounted.appendFile("/workspace/linked.txt", "-appended");

    expect(fs.readFileSync(linkedFile, "utf8")).toBe("sandbox-appended");
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside");
  });

  it("preserves containment during cross-mount copy", async () => {
    await mounted.cp("/source.txt", "/workspace/linked.txt");

    expect(fs.readFileSync(linkedFile, "utf8")).toBe("cross-mount");
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside");
  });

  it("delegates metadata copy-on-write to the real filesystem", async () => {
    const originalAtime = new Date("2020-04-01T00:00:00.000Z");
    const originalMtimeDate = new Date("2020-04-02T00:00:00.000Z");
    fs.utimesSync(outsideFile, originalAtime, originalMtimeDate);
    const originalMode = fs.statSync(outsideFile).mode & 0o777;
    const originalMtime = fs.statSync(outsideFile).mtimeMs;
    const changed = new Date("2020-04-03T00:00:00.000Z");

    await mounted.chmod("/workspace/linked.txt", 0o700);
    await mounted.utimes("/workspace/linked.txt", changed, changed);

    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside");
    expect(fs.statSync(outsideFile).mode & 0o777).toBe(originalMode);
    expect(fs.statSync(outsideFile).mtimeMs).toBe(originalMtime);
    expect(fs.statSync(linkedFile).mode & 0o777).toBe(0o700);
    expect(fs.statSync(linkedFile).mtimeMs).toBe(changed.getTime());
  });
});
