import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DestinationParentError } from "./destination-parent.js";
import { InMemoryFs } from "./in-memory-fs/in-memory-fs.js";
import type { IFileSystem } from "./interface.js";
import { MountableFs } from "./mountable-fs/mountable-fs.js";
import { OverlayFs } from "./overlay-fs/overlay-fs.js";
import { ReadWriteFs } from "./read-write-fs/read-write-fs.js";

interface FilesystemHarness {
  filesystem: IFileSystem;
  destinationParentPath: string;
  cleanup: () => void;
}

interface FilesystemCase {
  name: string;
  createHarness: () => FilesystemHarness;
}

function createInitialFiles(rootPath: string): void {
  fs.writeFileSync(path.join(rootPath, "source.txt"), "file content");
  fs.writeFileSync(path.join(rootPath, "not-a-directory"), "blocking file");
  fs.mkdirSync(path.join(rootPath, "source-directory"));
  fs.writeFileSync(
    path.join(rootPath, "source-directory", "nested.txt"),
    "nested content",
  );
}

function createHostFilesystemHarness(
  filesystemVariant: "overlay" | "read-write",
): FilesystemHarness {
  const rootPath = fs.mkdtempSync(
    path.join(os.tmpdir(), `destination-parent-${filesystemVariant}-`),
  );
  createInitialFiles(rootPath);
  const filesystem =
    filesystemVariant === "overlay"
      ? new OverlayFs({ root: rootPath, mountPoint: "/" })
      : new ReadWriteFs({ root: rootPath });
  return {
    filesystem,
    destinationParentPath: "/missing",
    cleanup: () => fs.rmSync(rootPath, { recursive: true, force: true }),
  };
}

const filesystemCases: FilesystemCase[] = [
  {
    name: "InMemoryFs",
    createHarness: () => ({
      filesystem: new InMemoryFs({
        "/not-a-directory": "blocking file",
        "/source.txt": "file content",
        "/source-directory/nested.txt": "nested content",
      }),
      destinationParentPath: "/missing",
      cleanup: () => undefined,
    }),
  },
  {
    name: "OverlayFs",
    createHarness: () => createHostFilesystemHarness("overlay"),
  },
  {
    name: "ReadWriteFs",
    createHarness: () => createHostFilesystemHarness("read-write"),
  },
  {
    name: "MountableFs same filesystem",
    createHarness: () => ({
      filesystem: new MountableFs({
        base: new InMemoryFs({
          "/not-a-directory": "blocking file",
          "/source.txt": "file content",
          "/source-directory/nested.txt": "nested content",
        }),
      }),
      destinationParentPath: "/missing",
      cleanup: () => undefined,
    }),
  },
  {
    name: "MountableFs cross filesystem",
    createHarness: () => ({
      filesystem: new MountableFs({
        base: new InMemoryFs({
          "/source.txt": "file content",
          "/source-directory/nested.txt": "nested content",
        }),
        mounts: [
          {
            mountPoint: "/mnt",
            filesystem: new InMemoryFs({
              "/not-a-directory": "blocking file",
            }),
          },
        ],
      }),
      destinationParentPath: "/mnt/missing",
      cleanup: () => undefined,
    }),
  },
];

describe.each(
  filesystemCases,
)("$name destination parents", (filesystemCase) => {
  let filesystemHarness: FilesystemHarness;

  beforeEach(() => {
    filesystemHarness = filesystemCase.createHarness();
  });

  afterEach(() => {
    filesystemHarness.cleanup();
  });

  it("rejects copying a file without creating its destination parent", async () => {
    const destinationPath = `${filesystemHarness.destinationParentPath}/copied.txt`;

    const copyError = await filesystemHarness.filesystem
      .cp("/source.txt", destinationPath)
      .catch((error: unknown) => error);

    expect(copyError).toBeInstanceOf(DestinationParentError);
    expect(copyError).toMatchObject({ code: "ENOENT", destinationPath });
    expect(await filesystemHarness.filesystem.exists("/source.txt")).toBe(true);
    expect(
      await filesystemHarness.filesystem.exists(
        filesystemHarness.destinationParentPath,
      ),
    ).toBe(false);
  });

  it("rejects recursively copying a directory without creating its destination parent", async () => {
    const destinationPath = `${filesystemHarness.destinationParentPath}/copied-directory`;

    const copyError = await filesystemHarness.filesystem
      .cp("/source-directory", destinationPath, { recursive: true })
      .catch((error: unknown) => error);

    expect(copyError).toBeInstanceOf(DestinationParentError);
    expect(copyError).toMatchObject({ code: "ENOENT", destinationPath });
    expect(
      await filesystemHarness.filesystem.exists("/source-directory/nested.txt"),
    ).toBe(true);
    expect(
      await filesystemHarness.filesystem.exists(
        filesystemHarness.destinationParentPath,
      ),
    ).toBe(false);
  });

  it("rejects moving a file without removing its source", async () => {
    const destinationPath = `${filesystemHarness.destinationParentPath}/moved.txt`;

    const moveError = await filesystemHarness.filesystem
      .mv("/source.txt", destinationPath)
      .catch((error: unknown) => error);

    expect(moveError).toBeInstanceOf(DestinationParentError);
    expect(moveError).toMatchObject({ code: "ENOENT", destinationPath });
    expect(await filesystemHarness.filesystem.exists("/source.txt")).toBe(true);
    expect(
      await filesystemHarness.filesystem.exists(
        filesystemHarness.destinationParentPath,
      ),
    ).toBe(false);
  });

  it("rejects moving a directory without removing its source", async () => {
    const destinationPath = `${filesystemHarness.destinationParentPath}/moved-directory`;

    const moveError = await filesystemHarness.filesystem
      .mv("/source-directory", destinationPath)
      .catch((error: unknown) => error);

    expect(moveError).toBeInstanceOf(DestinationParentError);
    expect(moveError).toMatchObject({ code: "ENOENT", destinationPath });
    expect(
      await filesystemHarness.filesystem.exists("/source-directory/nested.txt"),
    ).toBe(true);
    expect(
      await filesystemHarness.filesystem.exists(
        filesystemHarness.destinationParentPath,
      ),
    ).toBe(false);
  });

  it("rejects copying when the destination parent is not a directory", async () => {
    const nonDirectoryParentPath =
      filesystemHarness.destinationParentPath.replace(
        "/missing",
        "/not-a-directory",
      );
    const destinationPath = `${nonDirectoryParentPath}/nested/copied.txt`;

    const copyError = await filesystemHarness.filesystem
      .cp("/source.txt", destinationPath)
      .catch((error: unknown) => error);

    expect(copyError).toBeInstanceOf(DestinationParentError);
    expect(copyError).toMatchObject({ code: "ENOTDIR", destinationPath });
    expect(await filesystemHarness.filesystem.exists("/source.txt")).toBe(true);
  });

  it("rejects moving when the destination parent is not a directory", async () => {
    const nonDirectoryParentPath =
      filesystemHarness.destinationParentPath.replace(
        "/missing",
        "/not-a-directory",
      );
    const destinationPath = `${nonDirectoryParentPath}/nested/moved.txt`;

    const moveError = await filesystemHarness.filesystem
      .mv("/source.txt", destinationPath)
      .catch((error: unknown) => error);

    expect(moveError).toBeInstanceOf(DestinationParentError);
    expect(moveError).toMatchObject({ code: "ENOTDIR", destinationPath });
    expect(await filesystemHarness.filesystem.exists("/source.txt")).toBe(true);
  });

  it("rejects a non-recursive directory copy before checking its destination parent", async () => {
    const destinationPath = `${filesystemHarness.destinationParentPath}/copied-directory`;

    const copyError = await filesystemHarness.filesystem
      .cp("/source-directory", destinationPath)
      .catch((error: unknown) => error);

    expect(copyError).toBeInstanceOf(Error);
    expect((copyError as Error).message).toContain("EISDIR");
    expect(
      await filesystemHarness.filesystem.exists("/source-directory/nested.txt"),
    ).toBe(true);
  });

  it("rejects a recursive self-copy before checking its destination parent", async () => {
    const destinationPath = "/source-directory/missing/copied-directory";

    const copyError = await filesystemHarness.filesystem
      .cp("/source-directory", destinationPath, { recursive: true })
      .catch((error: unknown) => error);

    expect(copyError).toBeInstanceOf(Error);
    expect((copyError as Error).message).toContain("EINVAL");
    expect(
      await filesystemHarness.filesystem.exists("/source-directory/nested.txt"),
    ).toBe(true);
    expect(
      await filesystemHarness.filesystem.exists("/source-directory/missing"),
    ).toBe(false);
  });

  it("allows recursive copies to create the final destination directory", async () => {
    const existingParentPath = filesystemHarness.destinationParentPath.replace(
      "/missing",
      "/existing",
    );
    await filesystemHarness.filesystem.mkdir(existingParentPath, {
      recursive: true,
    });
    const destinationPath = `${existingParentPath}/copied-directory`;

    await filesystemHarness.filesystem.cp(
      "/source-directory",
      destinationPath,
      { recursive: true },
    );

    expect(
      await filesystemHarness.filesystem.readFile(
        `${destinationPath}/nested.txt`,
      ),
    ).toBe("nested content");
  });
});
