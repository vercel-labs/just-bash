import { describe, expect, it } from "vitest";
import {
  createExclusiveOn,
  ExclusiveCreateUnsupportedError,
} from "./create-exclusive.js";
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

  it("fails loudly when the filesystem cannot create atomically", async () => {
    // No fallback: a caller that asked for an exclusive private entry must
    // not silently receive a racy one.
    const backing = new InMemoryFs();
    const legacy = Object.create(backing) as IFileSystem;
    legacy.createExclusive = undefined;

    await expect(
      createExclusiveOn(legacy, "/legacy.txt", { mode: 0o600 }),
    ).rejects.toThrow(ExclusiveCreateUnsupportedError);
    expect(await backing.exists("/legacy.txt")).toBe(false);
  });

  it("reports the same for a mount routed to such a filesystem", async () => {
    const backing = new InMemoryFs();
    const legacy = Object.create(backing) as IFileSystem;
    legacy.createExclusive = undefined;
    const mounted = new MountableFs({ base: legacy, mounts: [] });

    await expect(
      createExclusiveOn(mounted, "/mounted.txt", { mode: 0o600 }),
    ).rejects.toThrow(ExclusiveCreateUnsupportedError);
  });

  it("creates through a directory that exists only as a mount parent", async () => {
    // stat('/mnt') reports a directory because /mnt/data is mounted, and
    // writeFile creates through it, so an exclusive create must too.
    const mounted = new MountableFs({
      base: new InMemoryFs(),
      mounts: [{ mountPoint: "/mnt/data", filesystem: new InMemoryFs() }],
    });
    expect((await mounted.stat("/mnt")).isDirectory).toBe(true);

    await createExclusiveOn(mounted, "/mnt/file.txt", { mode: 0o600 });

    expect(await mounted.exists("/mnt/file.txt")).toBe(true);
    expect((await mounted.stat("/mnt/file.txt")).mode & 0o777).toBe(0o600);
  });
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
