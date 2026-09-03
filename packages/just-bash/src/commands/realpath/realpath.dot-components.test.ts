import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * `.` and `..` are not free: GNU requires whatever precedes them to be a
 * directory, so `file/.` fails exactly like `file/x` does. A trailing slash
 * asserts the same thing, but tolerates a name that is not there at all.
 */
async function setup(): Promise<Bash> {
  const env = new Bash({
    files: { "/work/sub/f.txt": "hi\n", "/work/real/deep/g.txt": "there\n" },
    cwd: "/work",
  });
  const created = await env.exec(
    [
      "ln -s sub/f.txt link",
      "ln -s real slink",
      // A target that names a regular file as a directory.
      "ln -s 'sub/f.txt/' fileslash",
      // A target that names a missing directory.
      "ln -s 'nosuch/' missingslash",
    ].join(" && "),
  );
  expect(created.exitCode).toBe(0);
  return env;
}

describe("realpath . and .. components", () => {
  describe("through a regular file", () => {
    it("rejects file/.", async () => {
      const env = await setup();
      const result = await env.exec("realpath sub/f.txt/.");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("realpath: sub/f.txt/.: Not a directory\n");
      expect(result.exitCode).toBe(1);
    });

    it("rejects file/..", async () => {
      const env = await setup();
      const result = await env.exec("realpath sub/f.txt/..");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("realpath: sub/f.txt/..: Not a directory\n");
      expect(result.exitCode).toBe(1);
    });

    it("rejects a symlink to a file named with a trailing slash", async () => {
      const env = await setup();
      const result = await env.exec("realpath link/");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("realpath: link/: Not a directory\n");
      expect(result.exitCode).toBe(1);
    });

    it("accepts file/. under -m", async () => {
      const env = await setup();
      const result = await env.exec("realpath -m sub/f.txt/.");
      expect(result.stdout).toBe("/work/sub/f.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("through a missing name", () => {
    it("rejects nosuch/.", async () => {
      const env = await setup();
      const result = await env.exec("realpath nosuch/.");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "realpath: nosuch/.: No such file or directory\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("rejects nosuch/..", async () => {
      const env = await setup();
      const result = await env.exec("realpath nosuch/..");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "realpath: nosuch/..: No such file or directory\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("still accepts a missing name with a trailing slash", async () => {
      const env = await setup();
      const result = await env.exec("realpath nosuchdir/");
      expect(result.stdout).toBe("/work/nosuchdir\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("through a directory", () => {
    it("accepts dir/.", async () => {
      const env = await setup();
      const result = await env.exec("realpath -e sub/.");
      expect(result.stdout).toBe("/work/sub\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("accepts dir/.. through a symlinked directory", async () => {
      const env = await setup();
      const result = await env.exec("realpath slink/deep/..");
      expect(result.stdout).toBe("/work/real\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("keeps . in the middle of a path harmless", async () => {
      const env = await setup();
      const result = await env.exec("realpath sub/./f.txt");
      expect(result.stdout).toBe("/work/sub/f.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("symlink targets ending in a slash", () => {
    it("rejects a target that names a regular file as a directory", async () => {
      const env = await setup();
      const result = await env.exec("realpath fileslash");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("realpath: fileslash: Not a directory\n");
      expect(result.exitCode).toBe(1);
    });

    it("tolerates a target that names a missing directory", async () => {
      const env = await setup();
      const result = await env.exec("realpath missingslash");
      expect(result.stdout).toBe("/work/nosuch\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("ignores the requirement under -m", async () => {
      const env = await setup();
      const result = await env.exec("realpath -m fileslash");
      expect(result.stdout).toBe("/work/sub/f.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-s keeps the directory requirement", () => {
    it("rejects an unexpanded path through a regular file", async () => {
      const env = await setup();
      const result = await env.exec("realpath -s sub/f.txt/x");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("realpath: sub/f.txt/x: Not a directory\n");
      expect(result.exitCode).toBe(1);
    });

    it("rejects a trailing slash on a regular file", async () => {
      const env = await setup();
      const result = await env.exec("realpath -s -e sub/f.txt/");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("realpath: sub/f.txt/: Not a directory\n");
      expect(result.exitCode).toBe(1);
    });

    it("follows a symlink for the directory test only", async () => {
      const env = await setup();
      const result = await env.exec("realpath -s link/..");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("realpath: link/..: Not a directory\n");
      expect(result.exitCode).toBe(1);
    });

    it("accepts an unexpanded path through a symlinked directory", async () => {
      const env = await setup();
      const result = await env.exec("realpath -s slink/deep");
      expect(result.stdout).toBe("/work/slink/deep\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("checks no intermediate component for existence", async () => {
      const env = await setup();
      const result = await env.exec("realpath -s nosuch/x/y");
      expect(result.stdout).toBe("/work/nosuch/x/y\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("checks the finished name under -e", async () => {
      const env = await setup();
      const result = await env.exec("realpath -s -e nosuch/x");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "realpath: nosuch/x: No such file or directory\n",
      );
      expect(result.exitCode).toBe(1);
    });
  });

  describe("-L validates what it cancels", () => {
    it("rejects a link to a regular file before ..", async () => {
      const env = await setup();
      const result = await env.exec("realpath -L link/..");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("realpath: link/..: Not a directory\n");
      expect(result.exitCode).toBe(1);
    });

    it("rejects a missing name before ..", async () => {
      const env = await setup();
      const result = await env.exec("realpath -L nosuch/..");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "realpath: nosuch/..: No such file or directory\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("cancels a missing name under -m", async () => {
      const env = await setup();
      const result = await env.exec("realpath -L -m nosuch/..");
      expect(result.stdout).toBe("/work\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("rejects a regular file before .", async () => {
      const env = await setup();
      const result = await env.exec("realpath -L sub/f.txt/.");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("realpath: sub/f.txt/.: Not a directory\n");
      expect(result.exitCode).toBe(1);
    });

    it("leaves .. at the root at the root", async () => {
      const env = await setup();
      const result = await env.exec("realpath -L /..");
      expect(result.stdout).toBe("/\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("cancels a symlinked directory and resolves the rest", async () => {
      const env = await setup();
      const result = await env.exec("realpath -L slink/../sub/f.txt");
      expect(result.stdout).toBe("/work/sub/f.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });
});
