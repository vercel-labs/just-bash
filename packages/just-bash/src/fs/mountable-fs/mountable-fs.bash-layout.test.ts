import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { defineCommand } from "../../custom-commands.js";
import { InMemoryFs } from "../in-memory-fs/in-memory-fs.js";
import { initFilesystem } from "../init.js";
import type { IFileSystem } from "../interface.js";
import { ReadWriteFs } from "../read-write-fs/read-write-fs.js";
import { MountableFs } from "./mountable-fs.js";

const hello = defineCommand("hello", async () => ({
  stdout: "hello\n",
  stderr: "",
  exitCode: 0,
}));

describe("MountableFs standard layout under Bash", () => {
  let hostDir: string;

  beforeEach(() => {
    hostDir = fs.mkdtempSync(path.join(os.tmpdir(), "mount-layout-"));
  });

  afterEach(() => {
    fs.rmSync(hostDir, { recursive: true, force: true });
  });

  it("sets up /dev, /proc and command stubs in its base", async () => {
    const bash = new Bash({
      fs: new MountableFs({ base: new InMemoryFs() }),
      customCommands: [hello],
    });

    const result = await bash.exec(
      "ls /dev /proc/self; which hello; cat <(echo substituted)",
    );

    expect(result.stdout).toBe(
      "/dev:\nfd\nnull\nstderr\nstdin\nstdout\nzero\n\n" +
        "/proc/self:\ncmdline\ncomm\nexe\nfd\nstatus\n" +
        "/usr/bin/hello\nsubstituted\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("lists the same /bin and /usr/bin as its base alone", async () => {
    const script = "ls /bin /usr/bin";
    const direct = await new Bash({ fs: new InMemoryFs() }).exec(script);
    const mounted = await new Bash({
      fs: new MountableFs({ base: new InMemoryFs() }),
    }).exec(script);

    expect(mounted.stdout).toBe(direct.stdout);
    expect(mounted.stderr).toBe("");
    expect(mounted.exitCode).toBe(0);
  });

  it("routes sync writes to the filesystem that owns the path", async () => {
    const data = new InMemoryFs();
    const mounted = new MountableFs({ base: new InMemoryFs() });
    mounted.mount("/data", data);

    mounted.mkdirSync("/data/dir", { recursive: true });
    mounted.writeFileSync("/data/dir/a.txt", "a");
    mounted.writeFileSync("/b.txt", "b");

    expect(await data.readFile("/dir/a.txt")).toBe("a");
    expect(await mounted.readFile("/b.txt")).toBe("b");
    expect(await mounted.exists("/b.txt")).toBe(true);
    expect(await data.exists("/b.txt")).toBe(false);
  });

  it("throws ENOSYS for sync writes to a filesystem without them", () => {
    const mounted = new MountableFs({ base: new InMemoryFs() });
    mounted.mount("/data", new ReadWriteFs({ root: hostDir }));

    expect(() => mounted.writeFileSync("/data/a.txt", "a")).toThrow(
      "ENOSYS: function not implemented, write '/data/a.txt'",
    );
    expect(() => mounted.mkdirSync("/data/dir")).toThrow(
      "ENOSYS: function not implemented, mkdir '/data/dir'",
    );
    expect(fs.readdirSync(hostDir)).toEqual([]);
  });

  it("leaves a mounted ReadWriteFs out of the layout", async () => {
    const mounted = new MountableFs({ base: new InMemoryFs() });
    mounted.mount("/usr", new ReadWriteFs({ root: hostDir }));

    const bash = new Bash({ fs: mounted, customCommands: [hello] });
    const result = await bash.exec("ls -d /bin/hello /tmp");

    expect(result.stdout).toBe("/bin/hello\n/tmp\n");
    expect(result.stderr).toBe("");
    expect(fs.readdirSync(hostDir)).toEqual([]);
  });

  it("writes nothing to a ReadWriteFs base", async () => {
    const bash = new Bash({
      fs: new MountableFs({ base: new ReadWriteFs({ root: hostDir }) }),
    });

    const result = await bash.exec("echo ok");

    expect(result.stdout).toBe("ok\n");
    expect(fs.readdirSync(hostDir)).toEqual([]);
  });

  it("still fails on layout errors other than ENOSYS", () => {
    const failing = {
      mkdirSync() {
        throw new Error("EACCES: permission denied, mkdir '/bin'");
      },
      writeFileSync() {},
    } as unknown as IFileSystem;

    expect(() => initFilesystem(failing, true)).toThrow("EACCES");
  });

  it("creates a custom working directory", async () => {
    const bash = new Bash({
      fs: new MountableFs({ base: new InMemoryFs() }),
      cwd: "/work",
    });

    const result = await bash.exec("pwd; ls");

    expect(result.stdout).toBe("/work\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
