import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { MountableFs } from "../../fs/mountable-fs/mountable-fs.js";

/** An InMemoryFs whose `lstat` is refused for one name. */
class DeniedLstatFs extends InMemoryFs {
  constructor(
    files: Record<string, string>,
    private readonly denied: string,
  ) {
    super(files);
  }

  override async lstat(path: string) {
    if (path === this.denied) {
      throw new Error(`EACCES: permission denied, lstat '${path}'`);
    }
    return super.lstat(path);
  }
}

describe("realpath across filesystems", () => {
  describe("MountableFs", () => {
    /**
     * A mounted filesystem stores its own absolute symlink targets relative to
     * its root, so `/secret.txt` inside the mount is `/data/secret.txt` in the
     * shell. Resolution has to stay inside the mount and agree with what
     * reading the link actually opens.
     */
    async function mounted(): Promise<Bash> {
      const mount = new InMemoryFs({ "/secret.txt": "mounted\n" });
      await mount.symlink("/secret.txt", "/link");
      await mount.symlink("/nowhere.txt", "/dangling");
      const fs = new MountableFs({
        base: new InMemoryFs({ "/secret.txt": "base\n" }),
      });
      fs.mount("/data", mount);
      return new Bash({ fs, cwd: "/" });
    }

    it("keeps an absolute symlink target inside the mount", async () => {
      const env = await mounted();
      const result = await env.exec("realpath /data/link");
      expect(result.stdout).toBe("/data/secret.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("names the file that reading the link opens", async () => {
      const env = await mounted();
      const result = await env.exec(
        'cat /data/link && cat "$(realpath /data/link)"',
      );
      expect(result.stdout).toBe("mounted\nmounted\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("resolves a name below the mounted symlink target", async () => {
      const env = await mounted();
      const result = await env.exec("realpath -m /data/link/deeper");
      expect(result.stdout).toBe("/data/secret.txt/deeper\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("rejects a name below a mounted symlink to a regular file", async () => {
      const env = await mounted();
      const result = await env.exec("realpath /data/link/deeper");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "realpath: /data/link/deeper: Not a directory\n",
      );
      expect(result.exitCode).toBe(1);
    });

    /**
     * A dangling absolute target cannot be resolved through the filesystem, and
     * `IFileSystem` exposes no way to ask which mount a path belongs to, so the
     * name falls back to the global root. Documented here so the behaviour is a
     * decision rather than a surprise.
     */
    it("falls back to the global root for a dangling mounted symlink", async () => {
      const env = await mounted();
      const result = await env.exec("realpath /data/dangling");
      expect(result.stdout).toBe("/nowhere.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("filesystem errors", () => {
    it("reports a refused component instead of calling it missing", async () => {
      const fs = new DeniedLstatFs({ "/work/f.txt": "hi\n" }, "/work/denied");
      const env = new Bash({ fs, cwd: "/work" });
      const result = await env.exec("realpath denied");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("realpath: denied: Permission denied\n");
      expect(result.exitCode).toBe(1);
    });

    it("reports a refused component under -e too", async () => {
      const fs = new DeniedLstatFs({ "/work/f.txt": "hi\n" }, "/work/denied");
      const env = new Bash({ fs, cwd: "/work" });
      const result = await env.exec("realpath -e denied/x");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("realpath: denied/x: Permission denied\n");
      expect(result.exitCode).toBe(1);
    });

    it("ignores a refused component under -m, which never fails", async () => {
      const fs = new DeniedLstatFs({ "/work/f.txt": "hi\n" }, "/work/denied");
      const env = new Bash({ fs, cwd: "/work" });
      const result = await env.exec("realpath -m denied/x");
      expect(result.stdout).toBe("/work/denied/x\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("limits", () => {
    it("charges an oversized symlink target before expanding it", async () => {
      const fs = new InMemoryFs({ "/work/f.txt": "hi\n" });
      await fs.symlink(`${"a/".repeat(5000)}f.txt`, "/work/link");
      const env = new Bash({
        fs,
        cwd: "/work",
        executionLimits: { maxTraversalWork: 1000 },
      });
      const result = await env.exec("realpath link");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "bash: realpath: path resolution limit exceeded (1000)\n",
      );
      expect(result.exitCode).toBe(126);
    });

    it("bounds the diagnostics of many failing operands", async () => {
      const env = new Bash({
        files: { "/work/f.txt": "hi\n" },
        cwd: "/work",
        executionLimits: { maxOutputSize: 120 },
      });
      // Every empty operand fails without touching the filesystem, so only the
      // output accounting can stop the diagnostics from growing.
      const result = await env.exec("realpath '' '' '' '' '' '' '' '' '' ''");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "bash: realpath: output size limit exceeded (120 bytes)\n",
      );
      expect(result.exitCode).toBe(126);
    });
  });
});
