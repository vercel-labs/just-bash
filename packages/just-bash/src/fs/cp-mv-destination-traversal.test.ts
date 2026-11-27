import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryFs } from "./in-memory-fs/in-memory-fs.js";
import type { IFileSystem } from "./interface.js";
import { MountableFs } from "./mountable-fs/mountable-fs.js";
import { OverlayFs } from "./overlay-fs/overlay-fs.js";
import { ReadWriteFs } from "./read-write-fs/read-write-fs.js";

describe.each([
  "memory",
  "overlay",
  "read-write",
  "same-mount",
  "cross-mount",
])("%s destination traversal", (filesystemVariant) => {
  let filesystem: IFileSystem;
  let hostRoot: string;
  let destinationRoot: string;

  beforeEach(async () => {
    hostRoot = fs.mkdtempSync(path.join(os.tmpdir(), "destination-traversal-"));
    destinationRoot = "/";
    if (filesystemVariant === "overlay") {
      filesystem = new OverlayFs({
        root: hostRoot,
        mountPoint: "/",
        allowSymlinks: true,
      });
    } else if (filesystemVariant === "read-write") {
      filesystem = new ReadWriteFs({ root: hostRoot, allowSymlinks: true });
    } else if (
      filesystemVariant === "same-mount" ||
      filesystemVariant === "cross-mount"
    ) {
      filesystem = new MountableFs({
        base: new InMemoryFs(),
        mounts: [{ mountPoint: "/mnt", filesystem: new InMemoryFs() }],
      });
      if (filesystemVariant === "cross-mount") destinationRoot = "/mnt/";
    } else {
      filesystem = new InMemoryFs();
    }
    await filesystem.writeFile("/source", "payload");
    await filesystem.writeFile(`${destinationRoot}blocking`, "original");
    await filesystem.mkdir(`${destinationRoot}real/dir`, { recursive: true });
    await filesystem.symlink("real/dir", `${destinationRoot}link`);
  });

  afterEach(() => {
    fs.rmSync(hostRoot, { recursive: true, force: true });
  });

  for (const operation of ["cp", "mv"] as const) {
    it(`${operation} rejects an empty destination without changing the source`, async () => {
      await expect(filesystem[operation]("/source", "")).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await filesystem.readFile("/source")).toBe("payload");
    });

    it(`${operation} allows a directory destination that leaves the source through a symlink`, async () => {
      const sourcePath = `${destinationRoot}source-directory`;
      await filesystem.mkdir(sourcePath);
      await filesystem.writeFile(`${sourcePath}/nested`, "payload");
      await filesystem.symlink("../../../real/dir", `${sourcePath}/link`);

      await filesystem[operation](sourcePath, `${sourcePath}/link/../copied`, {
        recursive: true,
      });

      expect(
        await filesystem.readFile(`${destinationRoot}real/copied/nested`),
      ).toBe("payload");
      expect(await filesystem.exists(sourcePath)).toBe(operation === "cp");
    });

    for (const destination of [
      "missing/",
      "blocking/",
      "blocking/../copied",
      "missing/.",
    ]) {
      it(`${operation} rejects ${destination} without losing the source`, async () => {
        await expect(
          filesystem[operation]("/source", `${destinationRoot}${destination}`),
        ).rejects.toMatchObject({
          code: destination.startsWith("blocking") ? "ENOTDIR" : "ENOENT",
        });
        expect(await filesystem.readFile("/source")).toBe("payload");
        expect(await filesystem.readFile(`${destinationRoot}blocking`)).toBe(
          "original",
        );
        expect(await filesystem.exists(`${destinationRoot}missing`)).toBe(
          false,
        );
        expect(await filesystem.exists(`${destinationRoot}copied`)).toBe(false);
      });
    }

    it(`${operation} uses the symlink's physical parent for dot-dot`, async () => {
      await filesystem.writeFile(`${destinationRoot}copied`, "original");
      await filesystem[operation](
        "/source",
        `${destinationRoot}link/../copied`,
      );
      expect(await filesystem.readFile(`${destinationRoot}real/copied`)).toBe(
        "payload",
      );
      expect(await filesystem.readFile(`${destinationRoot}copied`)).toBe(
        "original",
      );
      expect(await filesystem.exists("/source")).toBe(operation === "cp");
    });

    it(`${operation} rejects an alias back into the source directory`, async () => {
      await filesystem.mkdir("/source-directory/child", { recursive: true });
      await filesystem.symlink("source-directory/child", "/source-link");
      await expect(
        filesystem[operation]("/source-directory", "/source-link/../copied", {
          recursive: true,
        }),
      ).rejects.toThrow("EINVAL");
      expect(await filesystem.exists("/source-directory/child")).toBe(true);
      expect(await filesystem.exists("/source-directory/copied")).toBe(false);
    });

    it(`${operation} bounds direct filesystem traversal`, async () => {
      await expect(
        filesystem[operation](
          "/source",
          `${destinationRoot}${"real/../".repeat(5000)}copied`,
        ),
      ).rejects.toThrow("filesystem traversal work");
      expect(await filesystem.readFile("/source")).toBe("payload");
      expect(await filesystem.exists(`${destinationRoot}copied`)).toBe(false);
    });
  }

  it("allows a directory copy to create a final directory with a trailing slash", async () => {
    await filesystem.mkdir("/source-directory");
    await filesystem.writeFile("/source-directory/nested", "nested");
    await filesystem.cp("/source-directory", `${destinationRoot}copied/`, {
      recursive: true,
    });
    expect(await filesystem.readFile(`${destinationRoot}copied/nested`)).toBe(
      "nested",
    );
  });

  if (filesystemVariant === "overlay" || filesystemVariant === "read-write") {
    it("resolves a host-backed directory symlink before dot-dot", async () => {
      fs.mkdirSync(path.join(hostRoot, "host/dir"), { recursive: true });
      fs.symlinkSync("host/dir", path.join(hostRoot, "host-link"));
      await filesystem.cp("/source", "/host-link/../copied");
      expect(await filesystem.readFile("/host/copied")).toBe("payload");
      expect(await filesystem.exists("/copied")).toBe(false);
    });
  }
});

describe("mount namespace destination traversal", () => {
  for (const operation of ["cp", "mv"] as const) {
    it(`${operation} resolves dot-dot before selecting the destination mount`, async () => {
      const mountedFilesystem = new InMemoryFs({
        "/source": "payload",
        "/real/dir/keep": "keep",
      });
      await mountedFilesystem.symlink("/real/dir", "/link");
      const filesystem = new MountableFs({
        mounts: [{ mountPoint: "/mnt", filesystem: mountedFilesystem }],
      });
      await filesystem[operation]("/mnt/source", "/mnt/link/../copied");
      expect(await mountedFilesystem.readFile("/real/copied")).toBe("payload");
      expect(await mountedFilesystem.exists("/copied")).toBe(false);
    });

    it(`${operation} can traverse out of a mount into a synthetic parent`, async () => {
      const mountedFilesystem = new InMemoryFs({ "/source": "payload" });
      const filesystem = new MountableFs({
        mounts: [{ mountPoint: "/virtual/mnt", filesystem: mountedFilesystem }],
      });
      await filesystem[operation](
        "/virtual/mnt/source",
        "/virtual/mnt/../copied",
      );
      expect(await filesystem.readFile("/virtual/copied")).toBe("payload");
      expect(await mountedFilesystem.exists("/copied")).toBe(false);
    });
  }
});
