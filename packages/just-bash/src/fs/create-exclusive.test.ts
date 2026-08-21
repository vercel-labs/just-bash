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
