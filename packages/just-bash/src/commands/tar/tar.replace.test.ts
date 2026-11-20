import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { MountableFs } from "../../fs/mountable-fs/mountable-fs.js";
import { ReadWriteFs } from "../../fs/read-write-fs/read-write-fs.js";
import { createArchive } from "./archive.js";

describe("tar extraction over existing files", () => {
  it("preserves the old content when a writable replacement exceeds the quota", async () => {
    const archive = await createArchive([
      { name: "data", content: "12345678" },
    ]);
    const destination = new InMemoryFs(
      { "/data": "old" },
      { maxTotalBytes: 3 },
    );
    const fs = new MountableFs({
      base: new InMemoryFs({ "/archive.tar": archive }),
    });
    fs.mount("/dest", destination);
    const bash = new Bash({ fs, cwd: "/" });

    const result = await bash.exec("tar -xf /archive.tar -C /dest");

    expect(result.exitCode).toBe(2);
    expect(await destination.readFile("/data")).toBe("old");
  });

  it("overwrites a writable host file without changing its mode", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tar-replace-"));
    try {
      fs.writeFileSync(path.join(root, "data"), "old", { mode: 0o600 });
      const archive = await createArchive([{ name: "data", content: "new" }]);
      const base = new InMemoryFs({ "/archive.tar": archive });
      const mounted = new MountableFs({ base });
      mounted.mount("/dest", new ReadWriteFs({ root }));
      const bash = new Bash({ fs: mounted, cwd: "/" });

      const result = await bash.exec("tar -xf /archive.tar -C /dest");

      expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
      expect(fs.readFileSync(path.join(root, "data"), "utf8")).toBe("new");
      expect(fs.statSync(path.join(root, "data")).mode & 0o777).toBe(0o600);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("overwrites a lazy destination without materializing it", async () => {
    let reads = 0;
    const archive = await createArchive([{ name: "data", content: "new" }]);
    const fs = new InMemoryFs({
      "/archive.tar": archive,
      "/data": () => {
        reads++;
        return "old";
      },
    });
    const bash = new Bash({ fs, cwd: "/" });

    const result = await bash.exec("tar -xf /archive.tar");

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(reads).toBe(0);
    expect(await fs.readFile("/data")).toBe("new");
  });

  it("creates a missing destination when lstat would throw a code-only ENOENT", async () => {
    class MissingCodeFs extends InMemoryFs {
      override async lstat(path: string) {
        if (path === "/data")
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        return super.lstat(path);
      }
    }
    const archive = await createArchive([{ name: "data", content: "new" }]);
    const fs = new MissingCodeFs({ "/archive.tar": archive });
    const bash = new Bash({ fs, cwd: "/" });

    const result = await bash.exec("tar -xf /archive.tar");

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await fs.readFile("/data")).toBe("new");
  });

  it("replaces a read-only regular file", async () => {
    const archive = await createArchive([{ name: "data", content: "new" }]);
    const fs = new InMemoryFs({
      "/archive.tar": archive,
      "/data": { content: "old", mode: 0o444 },
    });
    const bash = new Bash({ fs, cwd: "/" });

    const result = await bash.exec("tar -xf /archive.tar");

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await fs.readFile("/data")).toBe("new");
  });

  it("replaces a regular file when the backend reports EACCES only by code", async () => {
    class CodeOnlyDeniedFs extends InMemoryFs {
      override async writeFile(...args: Parameters<InMemoryFs["writeFile"]>) {
        if (args[0] === "/data" && (await this.exists("/data"))) {
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        }
        return super.writeFile(...args);
      }
    }
    const archive = await createArchive([{ name: "data", content: "new" }]);
    const fs = new CodeOnlyDeniedFs({
      "/archive.tar": archive,
      "/data": "old",
    });
    const bash = new Bash({ fs, cwd: "/" });

    const result = await bash.exec("tar -xf /archive.tar");

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await fs.readFile("/data")).toBe("new");
  });

  it("does not remove a non-regular destination after a write is denied", async () => {
    class DenyingFs extends InMemoryFs {
      override async writeFile(...args: Parameters<InMemoryFs["writeFile"]>) {
        if (args[0] === "/data") throw new Error("EACCES: permission denied");
        return super.writeFile(...args);
      }
    }
    const archive = await createArchive([{ name: "data", content: "new" }]);
    const fs = new DenyingFs({ "/archive.tar": archive, "/target": "old" });
    await fs.symlink("/target", "/data");
    const bash = new Bash({ fs, cwd: "/" });

    const result = await bash.exec("tar -xf /archive.tar");

    expect(result.exitCode).toBe(2);
    expect((await fs.lstat("/data")).isSymbolicLink).toBe(true);
    expect(await fs.readFile("/target")).toBe("old");
  });
});
