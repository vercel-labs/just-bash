import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "../interpreter/errors.js";
import { resolveLimits } from "../limits.js";
import { InMemoryFs } from "./in-memory-fs/in-memory-fs.js";
import type { IFileSystem } from "./interface.js";
import { MountableFs } from "./mountable-fs/mountable-fs.js";
import { OverlayFs } from "./overlay-fs/overlay-fs.js";
import { ReadWriteFs } from "./read-write-fs/read-write-fs.js";
import { FileTraversalBudget } from "./traversal.js";

it("does not apply the single-path work ceiling to an entire ordinary tree", async () => {
  const filesystem = new InMemoryFs();
  for (let index = 0; index < 800; index++) {
    await filesystem.writeFile(`/source/file${index}`, "payload");
  }

  await filesystem.cp("/source", "/copied", { recursive: true });

  expect(await filesystem.readdir("/copied")).toHaveLength(800);
  expect(await filesystem.readFile("/copied/file799")).toBe("payload");
});

describe.each([
  "memory",
  "overlay",
  "read-write",
  "same-mount",
  "cross-mount",
])("%s operation budget", (filesystemVariant) => {
  let filesystem: IFileSystem;
  let hostRoot: string;
  let destinationPath: string;

  beforeEach(async () => {
    hostRoot = fs.mkdtempSync(path.join(os.tmpdir(), "operation-budget-"));
    destinationPath = "/copied";
    if (filesystemVariant === "overlay") {
      filesystem = new OverlayFs({ root: hostRoot, mountPoint: "/" });
    } else if (filesystemVariant === "read-write") {
      filesystem = new ReadWriteFs({ root: hostRoot });
    } else if (filesystemVariant.endsWith("mount")) {
      filesystem = new MountableFs({
        base: new InMemoryFs(),
        mounts: [{ mountPoint: "/mnt", filesystem: new InMemoryFs() }],
      });
      if (filesystemVariant === "cross-mount") destinationPath = "/mnt/copied";
    } else {
      filesystem = new InMemoryFs();
    }
    await filesystem.mkdir("/source");
    for (let index = 0; index < 40; index++) {
      await filesystem.writeFile(`/source/file${index}`, `payload${index}`);
    }
  });

  afterEach(() => {
    fs.rmSync(hostRoot, { recursive: true, force: true });
  });

  it("shares the work limit across recursive copies and preserves the source on failure", async () => {
    const traversalBudget = new FileTraversalBudget({
      limits: resolveLimits({ maxTraversalWork: 30 }),
      site: "cp",
    });

    await expect(
      filesystem.cp("/source", destinationPath, {
        recursive: true,
        traversalBudget,
      }),
    ).rejects.toBeInstanceOf(ExecutionLimitError);
    expect(await filesystem.readdir("/source")).toHaveLength(40);
    expect(await filesystem.readFile("/source/file39")).toBe("payload39");

    await filesystem.cp("/source", `${destinationPath}-retry`, {
      recursive: true,
    });
    expect(await filesystem.readFile(`${destinationPath}-retry/file39`)).toBe(
      "payload39",
    );
  });

  for (const operation of ["cp", "mv"] as const) {
    it(`${operation} observes cancellation after starting and permits a fresh retry`, async () => {
      const abortController = new AbortController();
      const traversalBudget = new FileTraversalBudget({
        limits: resolveLimits(),
        signal: abortController.signal,
        site: operation,
      });
      const pendingOperation = filesystem[operation](
        "/source",
        destinationPath,
        {
          recursive: true,
          traversalBudget,
        },
      );
      abortController.abort();

      await expect(pendingOperation).rejects.toBeInstanceOf(
        ExecutionAbortedError,
      );
      expect(await filesystem.exists(destinationPath)).toBe(false);
      expect(await filesystem.readFile("/source/file39")).toBe("payload39");

      await filesystem[operation]("/source", destinationPath, {
        recursive: true,
      });
      expect(await filesystem.readFile(`${destinationPath}/file39`)).toBe(
        "payload39",
      );
    });
  }
});
