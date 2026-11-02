import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import type { CpOptions, FsStat } from "../../fs/interface.js";

class DeviceFs extends InMemoryFs {
  async stat(path: string): Promise<FsStat> {
    if (path === "/dev") throw new Error("EPERM: device parent unavailable");
    if (path === "/dev/null")
      return {
        isFile: false,
        isDirectory: false,
        isSymbolicLink: false,
        mode: 0o20666,
        size: 0,
        mtime: new Date(0),
        identity: "virtual:null",
      };
    return super.stat(path);
  }
  async lstat(path: string): Promise<FsStat> {
    return path === "/dev/null" ? this.stat(path) : super.lstat(path);
  }
  async realpath(path: string): Promise<string> {
    if (path === "/dev") throw new Error("EPERM: device parent unavailable");
    return path === "/dev/null" ? path : super.realpath(path);
  }
  async cp(source: string, target: string, options?: CpOptions): Promise<void> {
    if (target === "/dev/null") {
      await this.readFileBuffer(source);
      return;
    }
    await super.cp(source, target, options);
  }
  async chmod(path: string, mode: number): Promise<void> {
    if (path === "/dev/null")
      throw new Error("EPERM: device metadata unavailable");
    await super.chmod(path, mode);
  }
}

describe("cp to an existing virtual device", () => {
  it.each([
    "022",
    "077",
  ])("does not request device parent or mode authority under mask %s", async (mask) => {
    const fs = new DeviceFs({ "/input": "bytes" });
    const bash = new Bash({ fs });
    expect(await bash.exec(`umask ${mask}; cp /input /dev/null`)).toMatchObject(
      { stdout: "", stderr: "", exitCode: 0 },
    );
    expect(await fs.readFile("/input")).toBe("bytes");
  });
  it("still rejects missing source input", async () => {
    const result = await new Bash({ fs: new DeviceFs() }).exec(
      "cp /missing /dev/null",
    );
    expect(result).toMatchObject({
      stdout: "",
      stderr: "cp: cannot stat '/missing': No such file or directory\n",
      exitCode: 1,
    });
  });
});
