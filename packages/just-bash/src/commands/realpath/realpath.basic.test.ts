import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/** A tree with a file, a nested directory and no symlinks. */
async function setup(): Promise<Bash> {
  const env = new Bash({
    files: {
      "/work/sub/f.txt": "hi\n",
      "/work/other/g.txt": "there\n",
    },
    cwd: "/work",
  });
  return env;
}

describe("realpath", () => {
  describe("default mode", () => {
    it("resolves a relative operand against the working directory", async () => {
      const env = await setup();
      const result = await env.exec("realpath sub/f.txt");
      expect(result.stdout).toBe("/work/sub/f.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("keeps an absolute operand absolute", async () => {
      const env = await setup();
      const result = await env.exec("realpath /work/sub/f.txt");
      expect(result.stdout).toBe("/work/sub/f.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("collapses . and .. and duplicate slashes", async () => {
      const env = await setup();
      const result = await env.exec("realpath ./sub/..//other/./g.txt");
      expect(result.stdout).toBe("/work/other/g.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("resolves . to the working directory and / to itself", async () => {
      const env = await setup();
      const result = await env.exec("realpath . /");
      expect(result.stdout).toBe("/work\n/\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("strips a trailing slash from a directory", async () => {
      const env = await setup();
      const result = await env.exec("realpath sub/");
      expect(result.stdout).toBe("/work/sub\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("stops .. at the root", async () => {
      const env = await setup();
      const result = await env.exec("realpath /../../work/sub");
      expect(result.stdout).toBe("/work/sub\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("accepts a missing last component", async () => {
      const env = await setup();
      const result = await env.exec("realpath sub/new.txt");
      expect(result.stdout).toBe("/work/sub/new.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("accepts a missing last component with a trailing slash", async () => {
      const env = await setup();
      const result = await env.exec("realpath sub/newdir/");
      expect(result.stdout).toBe("/work/sub/newdir\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("rejects a missing intermediate component", async () => {
      const env = await setup();
      const result = await env.exec("realpath nosuch/f.txt");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "realpath: nosuch/f.txt: No such file or directory\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("rejects a path that descends through a regular file", async () => {
      const env = await setup();
      const result = await env.exec("realpath sub/f.txt/x");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("realpath: sub/f.txt/x: Not a directory\n");
      expect(result.exitCode).toBe(1);
    });

    it("rejects a regular file named with a trailing slash", async () => {
      const env = await setup();
      const result = await env.exec("realpath sub/f.txt/");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("realpath: sub/f.txt/: Not a directory\n");
      expect(result.exitCode).toBe(1);
    });

    it("rejects the empty operand, quoting it like GNU", async () => {
      const env = await setup();
      const result = await env.exec("realpath ''");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("realpath: '': No such file or directory\n");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("-e / --canonicalize-existing", () => {
    it("prints an existing path", async () => {
      const env = await setup();
      const result = await env.exec("realpath -e sub/f.txt");
      expect(result.stdout).toBe("/work/sub/f.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("rejects a missing last component", async () => {
      const env = await setup();
      const result = await env.exec("realpath --canonicalize-existing new.txt");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "realpath: new.txt: No such file or directory\n",
      );
      expect(result.exitCode).toBe(1);
    });
  });

  describe("-m / --canonicalize-missing", () => {
    it("prints a fully missing path", async () => {
      const env = await setup();
      const result = await env.exec("realpath -m nosuch/deep/x");
      expect(result.stdout).toBe("/work/nosuch/deep/x\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("still cancels .. inside a missing path", async () => {
      const env = await setup();
      const result = await env.exec("realpath -m nosuch/../x");
      expect(result.stdout).toBe("/work/x\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("does not mind descending through a regular file", async () => {
      const env = await setup();
      const result = await env.exec("realpath -m sub/f.txt/x");
      expect(result.stdout).toBe("/work/sub/f.txt/x\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("takes the last of -e and -m", async () => {
      const env = await setup();
      const result = await env.exec("realpath -e -m x && realpath -m -e x");
      expect(result.stdout).toBe("/work/x\n");
      expect(result.stderr).toBe("realpath: x: No such file or directory\n");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("operands", () => {
    it("requires at least one operand", async () => {
      const env = await setup();
      const result = await env.exec("realpath");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("realpath: missing operand\n");
      expect(result.exitCode).toBe(1);
    });

    it("prints every resolvable operand and fails once", async () => {
      const env = await setup();
      const result = await env.exec("realpath sub/f.txt nosuch/y other/g.txt");
      expect(result.stdout).toBe("/work/sub/f.txt\n/work/other/g.txt\n");
      expect(result.stderr).toBe(
        "realpath: nosuch/y: No such file or directory\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("treats operands after -- literally", async () => {
      const env = await setup();
      const result = await env.exec("realpath -m -- -e");
      expect(result.stdout).toBe("/work/-e\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("treats a lone dash as an operand", async () => {
      const env = await setup();
      const result = await env.exec("realpath -m -");
      expect(result.stdout).toBe("/work/-\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });
});
