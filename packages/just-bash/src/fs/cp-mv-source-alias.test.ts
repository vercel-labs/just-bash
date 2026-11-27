import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IFileSystem } from "./interface.js";
import { MountableFs } from "./mountable-fs/mountable-fs.js";
import { OverlayFs } from "./overlay-fs/overlay-fs.js";
import { ReadWriteFs } from "./read-write-fs/read-write-fs.js";

describe.each([
  "overlay",
  "read-write",
  "mounted-overlay",
  "mounted-read-write",
])("%s source containment", (filesystemVariant) => {
  let hostRoot: string;
  let filesystem: IFileSystem;

  beforeEach(() => {
    hostRoot = fs.mkdtempSync(path.join(os.tmpdir(), "source-alias-"));
    fs.mkdirSync(path.join(hostRoot, "real/source"), { recursive: true });
    fs.writeFileSync(path.join(hostRoot, "real/source/file"), "payload");
    fs.symlinkSync("real", path.join(hostRoot, "alias"));
    filesystem = filesystemVariant.endsWith("read-write")
      ? new ReadWriteFs({ root: hostRoot, allowSymlinks: true })
      : new OverlayFs({ root: hostRoot, mountPoint: "/", allowSymlinks: true });
    if (filesystemVariant.startsWith("mounted-")) {
      filesystem = new MountableFs({ base: filesystem });
    }
  });

  afterEach(() => {
    fs.rmSync(hostRoot, { recursive: true, force: true });
  });

  for (const operation of ["cp", "mv"] as const) {
    it(`${operation} rejects a destination inside an aliased source before mutation`, async () => {
      await expect(
        filesystem[operation]("/alias/source", "/alias/source/copied", {
          recursive: true,
        }),
      ).rejects.toThrow("EINVAL");
      expect(await filesystem.readFile("/real/source/file")).toBe("payload");
      expect(await filesystem.exists("/real/source/copied")).toBe(false);
    });
  }
});
