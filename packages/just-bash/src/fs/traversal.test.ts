import { describe, expect, it } from "vitest";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "../interpreter/errors.js";
import { resolveLimits } from "../limits.js";
import { InMemoryFs } from "./in-memory-fs/in-memory-fs.js";
import type { FsStat } from "./interface.js";
import {
  canonicalizePath,
  compareCanonicalContainment,
  compareFileIdentity,
  FileSystemPolicyError,
  resolveFileIdentity,
  traverseFileTree,
} from "./traversal.js";

class IdentitylessFs extends InMemoryFs {
  override async stat(path: string): Promise<FsStat> {
    const {
      identity: _identity,
      dev: _dev,
      ino: _ino,
      ...stat
    } = await super.stat(path);
    return stat;
  }
}

class NoRealpathFs extends InMemoryFs {
  override async realpath(_path: string): Promise<string> {
    throw new Error("ENOTSUP: realpath unavailable");
  }
}

describe("filesystem traversal primitives", () => {
  it("walks deep trees iteratively in deterministic order", async () => {
    const fs = new InMemoryFs({
      "/root/z/file": "z",
      "/root/a/file": "a",
    });
    const paths: string[] = [];

    await traverseFileTree(
      { fs, root: "/root", limits: resolveLimits(), site: "test" },
      (entry) => {
        if (entry.phase === "enter") paths.push(entry.path);
      },
    );

    expect(paths).toEqual([
      "/root",
      "/root/a",
      "/root/a/file",
      "/root/z",
      "/root/z/file",
    ]);
  });

  it("detects a followed symlink cycle by stable directory identity", async () => {
    const fs = new InMemoryFs({ "/root/file": "ok" });
    await fs.symlink("/root", "/root/back");

    await expect(
      traverseFileTree(
        {
          fs,
          root: "/root",
          limits: resolveLimits(),
          site: "test",
          symlinks: "follow",
        },
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(FileSystemPolicyError);
  });

  it("fails before visiting beyond the configured entry budget", async () => {
    const fs = new InMemoryFs({
      "/root/a": "a",
      "/root/b": "b",
      "/root/c": "c",
    });
    let visits = 0;

    await expect(
      traverseFileTree(
        {
          fs,
          root: "/root",
          limits: resolveLimits({ maxTraversalEntries: 2 }),
          site: "test",
        },
        () => {
          visits++;
        },
      ),
    ).rejects.toBeInstanceOf(ExecutionLimitError);
    expect(visits).toBe(2);
  });

  it("observes cancellation between filesystem operations", async () => {
    const fs = new InMemoryFs({ "/root/a": "a" });
    const controller = new AbortController();
    controller.abort();

    await expect(
      traverseFileTree(
        {
          fs,
          root: "/root",
          limits: resolveLimits(),
          signal: controller.signal,
          site: "test",
        },
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(ExecutionAbortedError);
  });

  it("proves hard-link aliases and keeps unrelated files distinct", async () => {
    const fs = new InMemoryFs({ "/a": "same", "/other": "same" });
    await fs.link("/a", "/alias");

    await expect(compareFileIdentity(fs, "/a", "/alias")).resolves.toBe("same");
    await expect(compareFileIdentity(fs, "/a", "/other")).resolves.toBe(
      "different",
    );
  });

  it("detects a destination below a canonical directory alias", async () => {
    const fs = new InMemoryFs({ "/source/file": "same", "/other/file": "x" });
    await fs.symlink("/source", "/alias");

    await expect(
      compareCanonicalContainment(fs, "/source", "/alias/new"),
    ).resolves.toBe("inside");
    await expect(
      compareCanonicalContainment(fs, "/source", "/other/new"),
    ).resolves.toBe("outside");
  });

  it("canonicalizes every missing component below the nearest existing parent", async () => {
    const fs = new InMemoryFs({ "/real/anchor": "x" });
    await fs.symlink("/real", "/alias");

    await expect(
      resolveFileIdentity(fs, "/alias/new/deep/file"),
    ).resolves.toMatchObject({
      existence: "missing",
      canonicalPath: "/real/new/deep/file",
    });
  });

  it("distinguishes a missing destination from unknown existing identity", async () => {
    const fs = new IdentitylessFs({ "/source": "a", "/target": "b" });

    await expect(compareFileIdentity(fs, "/source", "/new")).resolves.toBe(
      "different",
    );
    await expect(compareFileIdentity(fs, "/source", "/target")).resolves.toBe(
      "unknown",
    );
  });

  it("uses stable identity when a backend has no realpath support", async () => {
    const fs = new NoRealpathFs({ "/source": "a" });
    await fs.link("/source", "/alias");

    await expect(compareFileIdentity(fs, "/source", "/alias")).resolves.toBe(
      "same",
    );
    await expect(compareFileIdentity(fs, "/source", "/new")).resolves.toBe(
      "different",
    );
    await expect(compareCanonicalContainment(fs, "/", "/new")).resolves.toBe(
      "unknown",
    );
  });

  it("brands only canonical paths inside the policy root", async () => {
    const fs = new InMemoryFs({
      "/allowed/file": "ok",
      "/outside/file": "no",
    });
    await expect(
      canonicalizePath(fs, "/allowed/file", {
        name: "fixture",
        root: "/allowed",
      }),
    ).resolves.toBe("/allowed/file");
    await expect(
      canonicalizePath(fs, "/outside/file", {
        name: "fixture",
        root: "/allowed",
      }),
    ).rejects.toBeInstanceOf(FileSystemPolicyError);
  });
});
