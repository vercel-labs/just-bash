import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "../interpreter/errors.js";
import { InMemoryFs } from "./in-memory-fs/in-memory-fs.js";
import type { FsStat, IFileSystem } from "./interface.js";
import { MountableFs } from "./mountable-fs/mountable-fs.js";
import { OverlayFs } from "./overlay-fs/overlay-fs.js";
import { MAX_SYMLINK_DEPTH } from "./path-utils.js";
import { resolvePhysicalPath } from "./physical-path.js";
import { ReadWriteFs } from "./read-write-fs/read-write-fs.js";

const roots: string[] = [];

function createRoot(): string {
  const root = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "realpath-"));
  roots.push(root);
  nodeFs.mkdirSync(nodePath.join(root, "target", "dir"), { recursive: true });
  nodeFs.writeFileSync(nodePath.join(root, "target", "dir", "keep"), "");
  return root;
}

function inMemoryFs(): IFileSystem {
  return new InMemoryFs({ "/target/dir/keep": "" });
}

interface FileSystemCase {
  name: string;
  create: () => { filesystem: IFileSystem; root: string };
}

const fileSystems: FileSystemCase[] = [
  {
    name: "InMemoryFs",
    create: () => ({ filesystem: inMemoryFs(), root: "/" }),
  },
  {
    name: "ReadWriteFs",
    create: () => ({
      filesystem: new ReadWriteFs({ root: createRoot(), allowSymlinks: true }),
      root: "/",
    }),
  },
  {
    name: "OverlayFs",
    create: () => ({
      filesystem: new OverlayFs({
        root: createRoot(),
        mountPoint: "/",
        allowSymlinks: true,
      }),
      root: "/",
    }),
  },
  {
    name: "MountableFs base",
    create: () => ({
      filesystem: new MountableFs({ base: inMemoryFs() }),
      root: "/",
    }),
  },
  {
    name: "MountableFs mount",
    create: () => {
      const filesystem = new MountableFs();
      filesystem.mount("/mnt", inMemoryFs());
      return { filesystem, root: "/mnt" };
    },
  },
];

function pathAt(options: { root: string; name: string }): string {
  return options.root === "/"
    ? `/${options.name}`
    : `${options.root}/${options.name}`;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    nodeFs.rmSync(root, { recursive: true, force: true });
  }
});

describe.each(fileSystems)("shared realpath resolver: $name", ({ create }) => {
  it("keeps strict and all-but-last resolution distinct", async () => {
    const { filesystem, root } = create();
    const missing = pathAt({ root, name: "missing" });
    const dangling = pathAt({ root, name: "dangling" });
    await filesystem.symlink("/missing-target", dangling);

    await expect(filesystem.realpath(missing)).rejects.toThrow("ENOENT");
    await expect(filesystem.realpath(dangling)).rejects.toThrow("ENOENT");
    await expect(
      filesystem.realpathFromCwd({ cwd: root, path: "missing" }),
    ).resolves.toBe(missing);
    await expect(
      filesystem.realpathFromCwd({ cwd: root, path: "missing/" }),
    ).resolves.toBe(missing);
    await expect(
      filesystem.realpathFromCwd({ cwd: root, path: "dangling" }),
    ).resolves.toBe(pathAt({ root, name: "missing-target" }));
    await expect(
      filesystem.realpathFromCwd({ cwd: root, path: "dangling/" }),
    ).resolves.toBe(pathAt({ root, name: "missing-target" }));
    await expect(
      filesystem.realpathFromCwd({ cwd: root, path: "missing/child" }),
    ).rejects.toThrow("ENOENT");
  });

  it("rejects an empty path", async () => {
    const { filesystem, root } = create();
    await expect(
      filesystem.realpathFromCwd({ cwd: root, path: "" }),
    ).rejects.toThrow("ENOENT");
  });

  it.each([
    "/",
    "/.",
    "/..",
    "/child",
  ])("rejects traversal through a regular file with suffix %s", async (suffix) => {
    const { filesystem, root } = create();
    const file = pathAt({ root, name: "target/dir/keep" });

    await expect(filesystem.realpath(`${file}${suffix}`)).rejects.toThrow(
      "ENOTDIR",
    );
  });

  it("supports symlink revisits and rejects loops", async () => {
    const { filesystem, root } = create();
    const real = pathAt({ root, name: "revisit" });
    const link = pathAt({ root, name: "revisit-link" });
    await filesystem.mkdir(real);
    await filesystem.writeFile(`${real}/sub`, "content");
    await filesystem.symlink("revisit", link);
    await filesystem.symlink("../revisit-link/sub", `${real}/hop`);
    await filesystem.symlink("loop-two", pathAt({ root, name: "loop-one" }));
    await filesystem.symlink("loop-one", pathAt({ root, name: "loop-two" }));

    await expect(filesystem.realpath(`${link}/hop`)).resolves.toBe(
      `${real}/sub`,
    );
    await expect(
      filesystem.realpath(pathAt({ root, name: "loop-one" })),
    ).rejects.toThrow("ELOOP");
  });

  it("enforces the shared symlink-depth boundary", async () => {
    const { filesystem, root } = create();
    for (let index = 0; index < MAX_SYMLINK_DEPTH - 1; index++) {
      const target =
        index === MAX_SYMLINK_DEPTH - 2
          ? "target/dir/keep"
          : `depth-${index + 1}`;
      await filesystem.symlink(
        target,
        pathAt({ root, name: `depth-${index}` }),
      );
    }

    await expect(
      filesystem.realpath(pathAt({ root, name: "depth-0" })),
    ).resolves.toBe(pathAt({ root, name: "target/dir/keep" }));
    await filesystem.symlink("depth-0", pathAt({ root, name: "too-deep" }));
    await expect(
      filesystem.realpath(pathAt({ root, name: "too-deep" })),
    ).rejects.toThrow("ELOOP");
  });
});

function customFilesystem(lstat: IFileSystem["lstat"]): IFileSystem {
  return { lstat } as IFileSystem;
}

function stat(type: "file" | "directory" | "symlink"): FsStat {
  return {
    isFile: type === "file",
    isDirectory: type === "directory",
    isSymbolicLink: type === "symlink",
    mode: 0o644,
    size: 0,
    mtime: new Date(0),
  };
}

function errorWithCode(code: string): Error {
  return Object.assign(new Error(`host detail for ${code}`), { code });
}

describe("custom filesystem fallback", () => {
  it("resolves regular entries in a custom base and mount", async () => {
    const custom = customFilesystem(async (path) => {
      if (path === "/file") return stat("file");
      throw errorWithCode("ENOENT");
    });
    const base = new MountableFs({ base: custom });
    const mounted = new MountableFs();
    mounted.mount("/custom", custom);

    await expect(base.realpath("/file")).resolves.toBe("/file");
    await expect(mounted.realpath("/custom/file")).resolves.toBe(
      "/custom/file",
    );
  });

  it("fails closed for custom symlinks in a base and mount", async () => {
    const custom = customFilesystem(async () => stat("symlink"));
    const base = new MountableFs({ base: custom });
    const mounted = new MountableFs();
    mounted.mount("/custom", custom);

    await expect(base.realpath("/link")).rejects.toThrow("ENOENT");
    await expect(mounted.realpath("/custom/link")).rejects.toThrow("ENOENT");
  });

  it.each([
    "ENOENT",
    "ELOOP",
    "ENOTDIR",
    "EACCES",
    "EPERM",
    "EIO",
  ])("sanitizes custom %s errors", async (code) => {
    const custom = customFilesystem(async () => {
      throw errorWithCode(code);
    });
    const filesystem = new MountableFs({ base: custom });
    const error = await filesystem.realpath("/file").catch((value) => value);

    expect(String(error)).toBe(
      "Error: ENOENT: no such file or directory, realpath '/file'",
    );
  });

  it("propagates fatal execution errors", async () => {
    const custom = customFilesystem(async () => {
      throw new ExecutionLimitError("limit", "iterations");
    });
    const filesystem = new MountableFs({ base: custom });

    await expect(filesystem.realpath("/file")).rejects.toBeInstanceOf(
      ExecutionLimitError,
    );
  });

  it("fails closed for malformed stat results", async () => {
    const custom = customFilesystem(async () => ({}) as FsStat);
    const filesystem = new MountableFs({ base: custom });

    await expect(filesystem.realpath("/file")).rejects.toThrow("ENOENT");
  });

  it("sanitizes unknown thrown errors", async () => {
    const custom = customFilesystem(async () => {
      throw new Error("private host detail");
    });
    const filesystem = new MountableFs({ base: custom });

    await expect(filesystem.realpath("/file")).rejects.toThrow(
      "ENOENT: no such file or directory, realpath '/file'",
    );
  });

  it("performs one custom lookup per ordinary component", async () => {
    const paths: string[] = [];
    const custom = customFilesystem(async (path) => {
      paths.push(path);
      if (path === "/a" || path === "/a/b") return stat("directory");
      if (path === "/a/b/file") return stat("file");
      throw errorWithCode("ENOENT");
    });
    const filesystem = new MountableFs({ base: custom });

    await expect(filesystem.realpath("/a/b/file")).resolves.toBe("/a/b/file");
    expect(paths).toEqual(["/a", "/a/b", "/a/b/file"]);
  });
});

describe("mount routing", () => {
  it("moves between the base and sibling mounts after dot segments", async () => {
    const filesystem = new MountableFs({
      base: new InMemoryFs({ "/base": "base" }),
    });
    filesystem.mount("/mount/left", new InMemoryFs({ "/left": "left" }));
    filesystem.mount("/mount/right", new InMemoryFs({ "/right": "right" }));

    await expect(
      filesystem.realpath("/mount/left/../right/right"),
    ).resolves.toBe("/mount/right/right");
    await expect(filesystem.realpath("/mount/left/../../base")).resolves.toBe(
      "/base",
    );
    await expect(
      filesystem.realpathFromCwd({
        cwd: "/mount/left",
        path: "../right/right",
      }),
    ).resolves.toBe("/mount/right/right");
  });
});

describe.each([
  {
    name: "ReadWriteFs",
    create: () => new ReadWriteFs({ root: createRoot(), allowSymlinks: true }),
  },
  {
    name: "OverlayFs",
    create: () =>
      new OverlayFs({
        root: createRoot(),
        mountPoint: "/",
        allowSymlinks: true,
      }),
  },
])("host path integration: $name", ({ create }) => {
  it("preserves missing suffixes for writes and recursive creation", async () => {
    const filesystem = create();

    await filesystem.writeFile("/created", "content");
    await filesystem.mkdir("/new/nested/directory", { recursive: true });
    await filesystem.writeFile("/new/nested/directory/file", "content");

    await expect(filesystem.realpath("/created")).resolves.toBe("/created");
    await expect(
      filesystem.realpath("/new/nested/directory/file"),
    ).resolves.toBe("/new/nested/directory/file");
  });
});

describe("realpath work bounds", () => {
  it("counts leading, trailing, and repeated separators", async () => {
    const filesystem = new InMemoryFs();

    await expect(filesystem.realpath("/".repeat(100_000))).resolves.toBe("/");
    await expect(
      filesystem.realpath("/".repeat(100_001)),
    ).rejects.toBeInstanceOf(ExecutionLimitError);
  });

  it("propagates the work limit through exists", async () => {
    const filesystem = new InMemoryFs();

    await expect(filesystem.exists("/".repeat(100_001))).rejects.toBeInstanceOf(
      ExecutionLimitError,
    );
  });

  it("rejects empty symlink targets", async () => {
    const filesystem = new InMemoryFs();
    await filesystem.symlink("", "/empty-target");

    await expect(filesystem.realpath("/empty-target")).rejects.toThrow(
      "ENOENT",
    );
    await expect(
      filesystem.realpathFromCwd({ cwd: "/", path: "empty-target" }),
    ).rejects.toThrow("ENOENT");
  });

  it("rejects a pre-aborted traversal", async () => {
    const filesystem = new InMemoryFs({ "/target": "content" });
    const controller = new AbortController();
    controller.abort();

    await expect(
      filesystem.realpathFromCwd({
        cwd: "/",
        path: "target",
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(ExecutionAbortedError);
  });

  it("bounds the reported 800,001-byte redundant operand", async () => {
    const filesystem = new InMemoryFs();
    const operand = `${"./".repeat(400_000)}x`;
    const started = performance.now();

    expect(operand.length).toBe(800_001);
    await expect(
      filesystem.realpathFromCwd({ cwd: "/", path: operand }),
    ).rejects.toBeInstanceOf(ExecutionLimitError);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("scales redundant 5k, 10k, and 20k component walks below 3x", async () => {
    const filesystem = new InMemoryFs({ "/target": "content" });
    const measure = async (components: number): Promise<number> => {
      const path = `${"./".repeat(components)}target`;
      const started = performance.now();
      for (let run = 0; run < 5; run++) {
        await filesystem.realpathFromCwd({ cwd: "/", path });
      }
      return performance.now() - started;
    };

    await measure(1_000);
    const fiveThousand = await measure(5_000);
    const tenThousand = await measure(10_000);
    const twentyThousand = await measure(20_000);

    expect(tenThousand).toBeLessThan(fiveThousand * 3);
    expect(twentyThousand).toBeLessThan(tenThousand * 3);
  });

  it("looks up each ordinary component once", async () => {
    let lookups = 0;
    const result = await resolvePhysicalPath({
      path: "/one/two/three",
      mode: "existing",
      lookup: async ({ path }) => {
        lookups++;
        return { kind: path === "/one/two/three" ? "file" : "directory" };
      },
    });

    expect(result).toBe("/one/two/three");
    expect(lookups).toBe(3);
  });
});
