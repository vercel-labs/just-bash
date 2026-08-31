import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../in-memory-fs/in-memory-fs.js";
import { MountableFs } from "./mountable-fs.js";

describe.each([
  "/copied",
  "/mnt/copied",
])("symlink destination %s", (destinationPath) => {
  it.each([
    "/directory",
    "/missing",
  ])("copies the %s symlink entry without recursion", async (targetPath) => {
    const baseFilesystem = new InMemoryFs({ "/directory/file": "payload" });
    await baseFilesystem.symlink(targetPath, "/link");
    const filesystem = new MountableFs({
      base: baseFilesystem,
      mounts: [{ mountPoint: "/mnt", filesystem: new InMemoryFs() }],
    });

    await filesystem.cp("/link", destinationPath);

    expect((await filesystem.lstat(destinationPath)).isSymbolicLink).toBe(true);
    expect(await filesystem.readlink(destinationPath)).toBe(targetPath);
    expect(await filesystem.readlink("/link")).toBe(targetPath);
    expect(await filesystem.readFile("/directory/file")).toBe("payload");
  });
});
