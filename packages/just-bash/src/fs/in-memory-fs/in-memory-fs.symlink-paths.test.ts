import { describe, expect, it } from "vitest";
import { InMemoryFs } from "./in-memory-fs.js";

/**
 * /real/dir/f.txt   regular file ("old")
 * /lnk              -> /real/dir
 * /flnk             -> /real/dir/f.txt
 */
async function setup(): Promise<InMemoryFs> {
  const fs = new InMemoryFs();
  await fs.mkdir("/real/dir", { recursive: true });
  await fs.writeFile("/real/dir/f.txt", "old");
  await fs.symlink("/real/dir", "/lnk");
  await fs.symlink("/real/dir/f.txt", "/flnk");
  return fs;
}

// Nothing may be stored under the link's own path: lookups resolve the link,
// so such an entry could never be found again.
function orphans(fs: InMemoryFs): string[] {
  return fs.getAllPaths().filter((path) => path.startsWith("/lnk/"));
}

describe("InMemoryFs paths through a symlinked directory", () => {
  it("writeFile creates the file in the real directory", async () => {
    const fs = await setup();

    await fs.writeFile("/lnk/a.txt", "a");

    expect(await fs.readFile("/real/dir/a.txt")).toBe("a");
    expect(await fs.readdir("/real/dir")).toEqual(["a.txt", "f.txt"]);
    expect(orphans(fs)).toEqual([]);
  });

  it("appendFile creates and extends the file in the real directory", async () => {
    const fs = await setup();

    await fs.appendFile("/lnk/a.txt", "a");
    await fs.appendFile("/lnk/f.txt", "+more");

    expect(await fs.readFile("/real/dir/a.txt")).toBe("a");
    expect(await fs.readFile("/real/dir/f.txt")).toBe("old+more");
    expect(orphans(fs)).toEqual([]);
  });

  it("mkdir creates the directory in the real directory", async () => {
    const fs = await setup();

    await fs.mkdir("/lnk/sub");
    await fs.mkdir("/lnk/deep/er", { recursive: true });

    expect((await fs.stat("/real/dir/sub")).isDirectory).toBe(true);
    expect((await fs.stat("/real/dir/deep/er")).isDirectory).toBe(true);
    expect(orphans(fs)).toEqual([]);
  });

  it("rm removes the real file", async () => {
    const fs = await setup();

    await fs.rm("/lnk/f.txt");

    expect(await fs.exists("/real/dir/f.txt")).toBe(false);
    expect(await fs.readdir("/real/dir")).toEqual([]);
  });

  it("mv renames within and into the real directory", async () => {
    const fs = await setup();
    await fs.writeFile("/outside.txt", "outside");

    await fs.mv("/lnk/f.txt", "/lnk/g.txt");
    await fs.mv("/outside.txt", "/lnk/moved.txt");

    expect(await fs.readdir("/real/dir")).toEqual(["g.txt", "moved.txt"]);
    expect(await fs.readFile("/real/dir/g.txt")).toBe("old");
    expect(await fs.readFile("/real/dir/moved.txt")).toBe("outside");
    expect(orphans(fs)).toEqual([]);
  });

  it("cp copies into the real directory", async () => {
    const fs = await setup();

    await fs.cp("/lnk/f.txt", "/lnk/copy.txt");

    expect(await fs.readFile("/real/dir/copy.txt")).toBe("old");
    expect(orphans(fs)).toEqual([]);
  });

  it("chmod changes the real file", async () => {
    const fs = await setup();

    await fs.chmod("/lnk/f.txt", 0o600);

    expect((await fs.stat("/real/dir/f.txt")).mode).toBe(0o600);
  });

  it("symlink and link create their entry in the real directory", async () => {
    const fs = await setup();

    await fs.symlink("f.txt", "/lnk/soft");
    await fs.link("/lnk/f.txt", "/lnk/hard");

    expect(await fs.readlink("/real/dir/soft")).toBe("f.txt");
    expect(await fs.readFile("/real/dir/hard")).toBe("old");
    expect(orphans(fs)).toEqual([]);
  });

  it("readdir and readlink resolve the directory", async () => {
    const fs = await setup();
    await fs.mkdir("/real/dir/sub");
    await fs.writeFile("/real/dir/sub/x.txt", "x");
    await fs.symlink("x.txt", "/real/dir/sub/inner");

    expect(await fs.readdir("/lnk/sub")).toEqual(["inner", "x.txt"]);
    expect(await fs.readlink("/lnk/sub/inner")).toBe("x.txt");
  });
});

describe("InMemoryFs paths that end in a symlink", () => {
  it("rm and mv act on the link itself", async () => {
    const fs = await setup();

    await fs.mv("/flnk", "/renamed");
    await fs.rm("/lnk");

    expect(await fs.readlink("/renamed")).toBe("/real/dir/f.txt");
    expect(await fs.exists("/lnk")).toBe(false);
    expect(await fs.readFile("/real/dir/f.txt")).toBe("old");
  });
});
