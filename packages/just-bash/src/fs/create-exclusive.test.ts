import { describe, expect, it } from "vitest";
import { createExclusiveOn } from "./create-exclusive.js";
import { InMemoryFs } from "./in-memory-fs/in-memory-fs.js";
import type { IFileSystem } from "./interface.js";
import { MountableFs } from "./mountable-fs/mountable-fs.js";
import { OverlayFs } from "./overlay-fs/overlay-fs.js";

describe("createExclusiveOn", () => {
  it("uses the filesystem's own exclusive create when available", async () => {
    const fs = new InMemoryFs();
    await createExclusiveOn(fs, "/file.txt", { mode: 0o600 });
    expect((await fs.stat("/file.txt")).mode & 0o777).toBe(0o600);
  });

  it("falls back when the filesystem predates createExclusive", async () => {
    const backing = new InMemoryFs();
    // An external IFileSystem written before the method existed.
    const legacy = Object.create(backing) as IFileSystem;
    legacy.createExclusive = undefined;

    await createExclusiveOn(legacy, "/legacy.txt", { mode: 0o600 });

    expect(await backing.exists("/legacy.txt")).toBe(true);
    expect((await backing.stat("/legacy.txt")).mode & 0o777).toBe(0o600);
  });

  it("refuses a name an lstat shows as taken in the fallback", async () => {
    const backing = new InMemoryFs();
    await backing.writeFile("/taken.txt", "original");
    const legacy = Object.create(backing) as IFileSystem;
    legacy.createExclusive = undefined;

    await expect(
      createExclusiveOn(legacy, "/taken.txt", { mode: 0o600 }),
    ).rejects.toThrow("EEXIST");
    expect(await backing.readFile("/taken.txt")).toBe("original");
  });

  it("degrades instead of failing when a mount reports ENOSYS", async () => {
    // MountableFs always defines createExclusive but reports ENOSYS when the
    // backend it routes to lacks it. Callers must fall back, not hard-fail.
    const backing = new InMemoryFs();
    const legacy = Object.create(backing) as IFileSystem;
    legacy.createExclusive = undefined;
    const mounted = new MountableFs({ base: legacy, mounts: [] });

    await createExclusiveOn(mounted, "/mounted.txt", { mode: 0o600 });

    expect(await backing.exists("/mounted.txt")).toBe(true);
  });
});

it("does not mistake a path containing ENOSYS for an unsupported backend", async () => {
  // Diagnostics embed the caller-supplied path, so message matching would
  // turn this genuine collision into a silent downgrade to the weaker path.
  const fs = new InMemoryFs();
  await fs.writeFile("/ENOSYS-name.txt", "original");

  await expect(
    createExclusiveOn(fs, "/ENOSYS-name.txt", { mode: 0o600 }),
  ).rejects.toThrow("EEXIST");
  expect(await fs.readFile("/ENOSYS-name.txt")).toBe("original");
});

it("refuses to report a symlink as the entry it created in the fallback", async () => {
  const backing = new InMemoryFs();
  await backing.writeFile("/victim.txt", "untouched");
  const legacy = Object.create(backing) as IFileSystem;
  legacy.createExclusive = undefined;
  // Simulate a link appearing between the probe and the create.
  const originalWriteFile = backing.writeFile.bind(backing);
  legacy.writeFile = async (p: string) => {
    await originalWriteFile(p, "");
    await backing.rm(p as string);
    await backing.symlink("/victim.txt", p as string);
  };

  await expect(
    createExclusiveOn(legacy, "/racy.txt", { mode: 0o600 }),
  ).rejects.toThrow("EEXIST");
  expect(await backing.readFile("/victim.txt")).toBe("untouched");
});

describe("OverlayFs createExclusive", () => {
  it("clears a tombstone so the new entry is visible", async () => {
    const fs = new OverlayFs({ root: process.cwd() });
    await fs.writeFile("/tomb.txt", "first");
    await fs.rm("/tomb.txt");
    expect(await fs.exists("/tomb.txt")).toBe(false);

    await fs.createExclusive("/tomb.txt", { mode: 0o600 });

    // Without clearing this.deleted the entry exists but is invisible.
    expect(await fs.exists("/tomb.txt")).toBe(true);
    expect((await fs.stat("/tomb.txt")).mode & 0o777).toBe(0o600);
    expect(await fs.readFile("/tomb.txt")).toBe("");
  });

  it("rejects a parent that is not a directory", async () => {
    const fs = new OverlayFs({ root: process.cwd() });
    await fs.writeFile("/afile", "data");

    await expect(
      fs.createExclusive("/afile/child", { mode: 0o600 }),
    ).rejects.toThrow("ENOTDIR");
  });

  it("resolves a symlinked parent instead of creating beside it", async () => {
    // Symlinks are blocked by default, so this only arises for embedders that
    // opt in; it still must not produce an entry nothing can look up.
    const fs = new OverlayFs({ root: process.cwd(), allowSymlinks: true });
    await fs.mkdir("/real", { recursive: true });
    await fs.symlink("/real", "/link");

    await fs.createExclusive("/link/file.txt", { mode: 0o600 });

    expect(await fs.exists("/real/file.txt")).toBe(true);
    expect(await fs.readdir("/real")).toContain("file.txt");
  });

  it("is exclusive between interleaved concurrent calls", async () => {
    const fs = new OverlayFs({ root: process.cwd() });
    const results = await Promise.allSettled([
      fs.createExclusive("/race.txt", { mode: 0o600 }),
      fs.createExclusive("/race.txt", { mode: 0o600 }),
      fs.createExclusive("/race.txt", { mode: 0o600 }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
  });
});
