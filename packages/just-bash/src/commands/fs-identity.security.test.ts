import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { InMemoryFs } from "../fs/in-memory-fs/in-memory-fs.js";
import type { FsStat } from "../fs/interface.js";

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

describe("destructive command filesystem identity policy", () => {
  it.each([
    "cp",
    "mv",
  ])("%s permits an ordinary nonexistent file destination without realpath", async (command) => {
    const fs = new NoRealpathFs({ "/source": "content" });
    const bash = new Bash({ fs });

    const result = await bash.exec(`${command} /source /new`);

    expect(result.exitCode).toBe(0);
    expect(await fs.readFile("/new")).toBe("content");
  });

  it.each([
    "cp",
    "mv",
  ])("%s fails closed before replacing an existing file with unknown identity", async (command) => {
    const fs = new IdentitylessFs({
      "/source": "new",
      "/destination": "old",
    });
    const bash = new Bash({ fs });

    const result = await bash.exec(`${command} /source /destination`);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("cannot safely determine");
    expect(await fs.readFile("/source")).toBe("new");
    expect(await fs.readFile("/destination")).toBe("old");
  });

  it.each([
    "cp -r",
    "mv",
  ])("%s fails closed when recursive containment cannot be canonicalized", async (command) => {
    const fs = new NoRealpathFs({ "/source/file": "content" });
    const bash = new Bash({ fs });

    const result = await bash.exec(`${command} /source /destination`);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("cannot safely determine");
    expect(await fs.readFile("/source/file")).toBe("content");
    await expect(fs.stat("/destination")).rejects.toThrow("ENOENT");
  });
});
