import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createCommandContext } from "../../custom-commands.js";
import { ExecutionScope } from "../../execution-scope.js";
import { InMemoryFs } from "../../fs/in-memory-fs/index.js";
import type { FsStat } from "../../fs/interface.js";
import { OverlayFs } from "../../fs/overlay-fs/overlay-fs.js";
import { resolveLimits } from "../../limits.js";
import * as WASI from "./abi.js";
import { WasiFileSystem } from "./filesystem.js";

const decoder = new TextDecoder();
const limits = {
  timeoutMs: 1000,
  maxFileBytes: 1024,
  maxMemoryBytes: 65536,
  maxModuleBytes: 1024,
  maxTableElements: 100,
};

interface InodeStat {
  dev: string;
  ino: string;
}

class IdentityOnlyFs extends InMemoryFs {
  override async stat(path: string): Promise<FsStat> {
    const { dev: _dev, ino: _ino, ...stat } = await super.stat(path);
    return stat;
  }

  override async lstat(path: string): Promise<FsStat> {
    const { dev: _dev, ino: _ino, ...stat } = await super.lstat(path);
    return stat;
  }
}

async function pathStat(
  bridge: WasiFileSystem,
  path: string,
  flags = 0,
): Promise<InodeStat> {
  return JSON.parse(
    decoder.decode(
      await bridge.request({
        type: "request",
        op: "pathstat",
        fd: 3,
        path,
        flags,
      }),
    ),
  ) as InodeStat;
}

describe("WASI inode metadata", () => {
  it("distinguishes files and symlinks while preserving hard-link identity", async () => {
    const fs = new InMemoryFs({ "/a": "one", "/b": "two" });
    await fs.link("/a", "/alias");
    await fs.symlink("a", "/symlink");
    const bridge = new WasiFileSystem(createCommandContext({ fs }), limits);
    try {
      const a = await pathStat(bridge, "a");
      const b = await pathStat(bridge, "b");
      const alias = await pathStat(bridge, "alias");
      const symlink = await pathStat(bridge, "symlink");
      const followed = await pathStat(bridge, "symlink", 1);
      expect(a.ino).not.toBe("0");
      expect(a.dev).toBe(b.dev);
      expect(a.ino).not.toBe(b.ino);
      expect(alias).toEqual(a);
      expect(symlink.ino).not.toBe(a.ino);
      expect(followed).toEqual(a);

      const opened = JSON.parse(
        decoder.decode(
          await bridge.request({
            type: "request",
            op: "open",
            fd: 3,
            path: "a",
            lookupFlags: 1,
            openFlags: 0,
            rights: String(WASI.RIGHTS_FD_FILESTAT_GET),
            inheritingRights: "0",
            flags: 0,
          }),
        ),
      ) as number;
      const fdStat = JSON.parse(
        decoder.decode(
          await bridge.request({ type: "request", op: "stat", fd: opened }),
        ),
      ) as InodeStat;
      expect([fdStat.dev, fdStat.ino]).toEqual([a.dev, a.ino]);

      const firstDirent = JSON.parse(
        decoder.decode(
          await bridge.request({
            type: "request",
            op: "readdir",
            fd: 3,
            cookie: 0,
          }),
        ),
      ) as InodeStat & { name: string };
      expect(firstDirent.name).toBe("a");
      expect([firstDirent.dev, firstDirent.ino]).toEqual([a.dev, a.ino]);
    } finally {
      bridge.close();
    }
  });

  it("reports distinct overlay memory entries and preserves IDs across moves", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wasi-inodes-"));
    const overlay = new OverlayFs({
      root,
      mountPoint: "/",
      allowSymlinks: true,
    });
    const bridge = new WasiFileSystem(
      createCommandContext({ fs: overlay }),
      limits,
    );
    try {
      await overlay.writeFile("/a", "one");
      await overlay.writeFile("/b", "two");
      await overlay.link("/a", "/copy");
      await overlay.symlink("a", "/symlink");
      const a = await pathStat(bridge, "a");
      const b = await pathStat(bridge, "b");
      const copy = await pathStat(bridge, "copy");
      const symlink = await pathStat(bridge, "symlink");
      expect(a.ino).not.toBe("0");
      expect(a.dev).toBe(b.dev);
      expect(a.ino).not.toBe(b.ino);
      expect(copy.ino).not.toBe(a.ino);
      expect(symlink.ino).not.toBe(a.ino);
      expect(await pathStat(bridge, "symlink", 1)).toEqual(a);

      await bridge.request({
        type: "request",
        op: "rename",
        fd: 3,
        path: "a",
        targetFd: 3,
        targetPath: "moved",
      });
      expect(await pathStat(bridge, "moved")).toEqual(a);
      expect(await pathStat(bridge, "b")).toEqual(b);
    } finally {
      bridge.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses stable identities from custom filesystems without numeric inodes", async () => {
    const fs = new IdentityOnlyFs({ "/a": "one", "/b": "two" });
    await fs.link("/a", "/alias");
    const maxLiveBytes = 1024;
    const scope = new ExecutionScope(resolveLimits({ maxLiveBytes }));
    const bridge = new WasiFileSystem(
      createCommandContext({ fs, executionScope: scope }),
      limits,
    );
    try {
      const a = await pathStat(bridge, "a");
      const b = await pathStat(bridge, "b");
      const alias = await pathStat(bridge, "alias");
      expect(a.ino).not.toBe("0");
      expect(a.dev).toBe(b.dev);
      expect(a.ino).not.toBe(b.ino);
      expect(alias).toEqual(a);
      expect(scope.remainingLiveBytes).toBeLessThan(maxLiveBytes);
    } finally {
      bridge.close();
    }
    expect(scope.remainingLiveBytes).toBe(maxLiveBytes);
  });

  it("bounds the fallback inode table for identity-only filesystems", async () => {
    const fs = new IdentityOnlyFs({ "/a": "one", "/b": "two" });
    const bridge = new WasiFileSystem(
      createCommandContext({ fs, executionLimits: { maxTraversalEntries: 1 } }),
      limits,
    );
    try {
      expect((await pathStat(bridge, "a")).ino).not.toBe("0");
      await expect(pathStat(bridge, "b")).rejects.toMatchObject({
        errno: WASI.ERRNO_NOSPC,
      });
    } finally {
      bridge.close();
    }
  });
});
