import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";

describe("sed file permissions", () => {
  it.each([
    "",
    "-i",
  ])("processes later operands after a denied read (%s)", async (flag) => {
    const fs = new InMemoryFs({
      "/a": { content: "aaa\n", mode: 0o000 },
      "/b": "bbb\n",
    });
    const bash = new Bash({ fs, cwd: "/" });

    expect(await bash.exec(`sed ${flag} 's/b/B/' a b`)).toMatchObject({
      stdout: flag ? "" : "Bbb\n",
      stderr: "sed: can't read a: Permission denied\n",
      exitCode: 2,
    });
    expect(await fs.readFile("/b")).toBe(flag ? "Bbb\n" : "bbb\n");
  });

  it("fails explicitly when exclusive creation is unavailable", async () => {
    const fs = new InMemoryFs({ "/target": "old\n" });
    const legacy: { createExclusive?: InMemoryFs["createExclusive"] } = fs;
    legacy.createExclusive = undefined;
    await fs.symlink("/target", "/link");
    const bash = new Bash({ fs, cwd: "/" });

    expect(await bash.exec("sed -i 's/old/new/' link")).toMatchObject({
      stdout: "",
      stderr: "sed: link: filesystem does not support exclusive creation\n",
      exitCode: 1,
    });
    expect(await fs.readFile("/target")).toBe("old\n");
    expect((await fs.lstat("/link")).isSymbolicLink).toBe(true);
  });

  it("retries an exclusive-create collision in a symlinked directory", async () => {
    class CollisionFs extends InMemoryFs {
      attempts = 0;

      override async createExclusive(
        ...args: Parameters<InMemoryFs["createExclusive"]>
      ) {
        this.attempts++;
        if (this.attempts === 1) throw new Error("EEXIST: collision");
        return super.createExclusive(...args);
      }
    }
    const fs = new CollisionFs({
      "/dir/file": { content: "old\n", mode: 0o400 },
    });
    await fs.symlink("/dir", "/alias");
    const bash = new Bash({ fs, cwd: "/" });

    expect(await bash.exec("sed -i 's/old/new/' alias/file")).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(fs.attempts).toBe(2);
    expect(await fs.readFile("/dir/file")).toBe("new\n");
    expect((await fs.stat("/dir/file")).mode).toBe(0o400);
    expect(await fs.readdir("/dir")).toEqual(["file"]);
  });
});
