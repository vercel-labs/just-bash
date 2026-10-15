import { describe, expect, it } from "vitest";
import { InMemoryFs } from "../in-memory-fs/in-memory-fs.js";
import type { DirentEntry, FsStat, IFileSystem } from "../interface.js";
import { MountableFs } from "./mountable-fs.js";

/** A filesystem that answers no listing with file types, so each entry is stat'd. */
function withoutDirents(delegate: IFileSystem): IFileSystem {
  return new Proxy(delegate, {
    get(target, key, receiver) {
      if (key === "readdirWithFileTypes") {
        return undefined;
      }
      const value: unknown = Reflect.get(target, key, receiver);
      return typeof value === "function"
        ? (...args: unknown[]): unknown => Reflect.apply(value, target, args)
        : value;
    },
  });
}

/** A filesystem that answers every entry with no type, as a host does for DT_UNKNOWN. */
function typeless(delegate: IFileSystem): IFileSystem {
  return new Proxy(delegate, {
    get(target, key, receiver) {
      if (key === "readdirWithFileTypes") {
        return async (path: string): Promise<DirentEntry[]> =>
          (await delegate.readdir(path)).map((name) => ({
            name,
            isFile: false,
            isDirectory: false,
            isSymbolicLink: false,
          }));
      }
      const value: unknown = Reflect.get(target, key, receiver);
      return typeof value === "function"
        ? (...args: unknown[]): unknown => Reflect.apply(value, target, args)
        : value;
    },
  });
}

/** A filesystem whose lstat refuses one path, as a raced removal does. */
function lstatFailing(delegate: IFileSystem, refused: string): IFileSystem {
  return new Proxy(withoutDirents(delegate), {
    get(target, key, receiver) {
      if (key === "lstat") {
        return async (path: string): Promise<FsStat> => {
          if (path === refused) {
            throw Object.assign(new Error("ENOENT: no such file"), {
              code: "ENOENT",
            });
          }
          return delegate.lstat(path);
        };
      }
      const value: unknown = Reflect.get(target, key, receiver);
      return typeof value === "function"
        ? (...args: unknown[]): unknown => Reflect.apply(value, target, args)
        : value;
    },
  });
}

const named = (entries: DirentEntry[]) => entries.map((entry) => entry.name);
const typed = (entries: DirentEntry[], name: string) =>
  entries.find((entry) => entry.name === name);

describe("MountableFs readdirWithFileTypes", () => {
  it("reads the owning filesystem's own types", async () => {
    const fs = new MountableFs({
      base: new InMemoryFs({ "/a.txt": "a", "/dir/b.txt": "b" }),
    });

    const entries = await fs.readdirWithFileTypes("/");

    expect(named(entries)).toEqual(["a.txt", "dir"]);
    expect(typed(entries, "a.txt")).toMatchObject({
      isDirectory: false,
      isFile: true,
    });
    expect(typed(entries, "dir")).toMatchObject({
      isDirectory: true,
      isFile: false,
    });
  });

  it("lists a mount point as a directory of its own", async () => {
    const fs = new MountableFs({ base: new InMemoryFs({ "/a.txt": "a" }) });
    fs.mount("/mnt", new InMemoryFs({ "/inside.txt": "in" }));

    const entries = await fs.readdirWithFileTypes("/");

    expect(named(entries)).toEqual(["a.txt", "mnt"]);
    expect(typed(entries, "mnt")).toMatchObject({
      isDirectory: true,
      isFile: false,
      isSymbolicLink: false,
    });
  });

  it("reads through a mount to the filesystem under it", async () => {
    const fs = new MountableFs({ base: new InMemoryFs({}) });
    fs.mount(
      "/mnt",
      new InMemoryFs({ "/inside.txt": "in", "/sub/c.txt": "c" }),
    );

    const entries = await fs.readdirWithFileTypes("/mnt");

    expect(named(entries)).toEqual(["inside.txt", "sub"]);
    expect(typed(entries, "sub")?.isDirectory).toBe(true);
  });

  it("asks a filesystem with no listing of its own about each entry", async () => {
    const fs = new MountableFs({
      base: withoutDirents(
        new InMemoryFs({ "/a.txt": "a", "/dir/b.txt": "b" }),
      ),
    });

    const entries = await fs.readdirWithFileTypes("/");

    expect(named(entries)).toEqual(["a.txt", "dir"]);
    expect(typed(entries, "dir")?.isDirectory).toBe(true);
    expect(typed(entries, "a.txt")?.isFile).toBe(true);
  });

  it("leaves out an entry it cannot ask about, as ls and tree do", async () => {
    const backing = new InMemoryFs({ "/a.txt": "a", "/gone": "" });
    const fs = new MountableFs({ base: lstatFailing(backing, "/gone") });

    const entries = await fs.readdirWithFileTypes("/");

    expect(named(entries)).toEqual(["a.txt"]);
  });

  it("asks about an entry a host gave no type for", async () => {
    // What Node reports for DT_UNKNOWN, which NFS and FUSE answer with: a
    // dirent whose three predicates are all false.
    const backing = new InMemoryFs({ "/dir/b.txt": "b", "/f.txt": "f" });
    const fs = new MountableFs({ base: typeless(backing) });

    const entries = await fs.readdirWithFileTypes("/");

    expect(typed(entries, "dir")?.isDirectory).toBe(true);
    expect(typed(entries, "f.txt")?.isFile).toBe(true);
  });

  it("keeps an entry that is none of the three without asking twice", async () => {
    // A FIFO or a socket answers false to all three, and asking again says
    // the same, so the listing keeps it rather than dropping it.
    const backing = new InMemoryFs({ "/pipe": "" });
    let asked = 0;
    const base = new Proxy(typeless(backing), {
      get(target, key, receiver) {
        if (key === "lstat") {
          return async (path: string): Promise<FsStat> => {
            asked += 1;
            return {
              ...(await backing.lstat(path)),
              isFile: false,
              isDirectory: false,
              isSymbolicLink: false,
            };
          };
        }
        const value: unknown = Reflect.get(target, key, receiver);
        return typeof value === "function"
          ? (...args: unknown[]): unknown => Reflect.apply(value, target, args)
          : value;
      },
    });
    const fs = new MountableFs({ base });

    const entries = await fs.readdirWithFileTypes("/");

    expect(named(entries)).toEqual(["pipe"]);
    expect(asked).toBe(1);
  });

  it("asks about entries in parallel rather than one at a time", async () => {
    const names = Array.from({ length: 250 }, (_, at) => `f${at}`);
    const backing = new InMemoryFs(
      Object.fromEntries(names.map((name) => [`/${name}`, ""])),
    );
    let open = 0;
    let mostOpenAtOnce = 0;
    const base = new Proxy(typeless(backing), {
      get(target, key, receiver) {
        if (key === "lstat") {
          return async (path: string): Promise<FsStat> => {
            open += 1;
            mostOpenAtOnce = Math.max(mostOpenAtOnce, open);
            await new Promise((resume) => setTimeout(resume, 0));
            open -= 1;
            return backing.lstat(path);
          };
        }
        const value: unknown = Reflect.get(target, key, receiver);
        return typeof value === "function"
          ? (...args: unknown[]): unknown => Reflect.apply(value, target, args)
          : value;
      },
    });
    const fs = new MountableFs({ base });

    expect(named(await fs.readdirWithFileTypes("/")).length).toBe(250);

    expect(mostOpenAtOnce).toBeGreaterThan(1);
  });
  it("answers mount points for a directory the base does not hold", async () => {
    const fs = new MountableFs({ base: new InMemoryFs({}) });
    fs.mount("/mnt/data", new InMemoryFs({ "/d.txt": "d" }));

    expect(named(await fs.readdirWithFileTypes("/mnt"))).toEqual(["data"]);
  });

  it("throws what readdir throws for a directory nothing holds", async () => {
    const fs = new MountableFs({ base: new InMemoryFs({}) });

    await expect(fs.readdirWithFileTypes("/nope")).rejects.toThrow();
    await expect(fs.readdir("/nope")).rejects.toThrow();
  });

  it("names the same entries readdir does", async () => {
    const fs = new MountableFs({
      base: new InMemoryFs({ "/a.txt": "a", "/b/c.txt": "c" }),
    });
    fs.mount("/mnt", new InMemoryFs({}));

    expect(named(await fs.readdirWithFileTypes("/"))).toEqual(
      await fs.readdir("/"),
    );
  });
});
