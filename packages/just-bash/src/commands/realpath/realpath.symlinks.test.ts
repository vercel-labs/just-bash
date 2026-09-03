import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * /work/sub/f.txt      regular file
 * /work/real/deep/     regular directory
 * /work/link       ->  sub/f.txt      (relative)
 * /work/abs        ->  /work/sub/f.txt
 * /work/slink      ->  real           (directory link)
 * /work/deeplink   ->  /work/real/deep
 * /work/dangling   ->  nowhere
 * /work/hop        ->  link           (link to a link)
 */
async function setup(): Promise<Bash> {
  const env = new Bash({
    files: { "/work/sub/f.txt": "hi\n", "/work/real/deep/g.txt": "there\n" },
    cwd: "/work",
  });
  const setupResult = await env.exec(
    [
      "ln -s sub/f.txt link",
      "ln -s /work/sub/f.txt abs",
      "ln -s real slink",
      "ln -s /work/real/deep deeplink",
      "ln -s nowhere dangling",
      "ln -s link hop",
    ].join(" && "),
  );
  expect(setupResult.exitCode).toBe(0);
  return env;
}

describe("realpath symlinks", () => {
  describe("resolution", () => {
    it("follows a relative symlink", async () => {
      const env = await setup();
      const result = await env.exec("realpath link");
      expect(result.stdout).toBe("/work/sub/f.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("follows an absolute symlink", async () => {
      const env = await setup();
      const result = await env.exec("realpath abs");
      expect(result.stdout).toBe("/work/sub/f.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("follows a chain of symlinks", async () => {
      const env = await setup();
      const result = await env.exec("realpath hop");
      expect(result.stdout).toBe("/work/sub/f.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("follows a symlinked directory in the middle of a path", async () => {
      const env = await setup();
      const result = await env.exec("realpath slink/deep/g.txt");
      expect(result.stdout).toBe("/work/real/deep/g.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("resolves a missing name under a symlinked directory", async () => {
      const env = await setup();
      const result = await env.exec("realpath slink/deep/new.txt");
      expect(result.stdout).toBe("/work/real/deep/new.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("names the target of a dangling symlink by default", async () => {
      const env = await setup();
      const result = await env.exec("realpath dangling");
      expect(result.stdout).toBe("/work/nowhere\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("rejects a dangling symlink under -e", async () => {
      const env = await setup();
      const result = await env.exec("realpath -e dangling");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "realpath: dangling: No such file or directory\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("names the target of a dangling symlink under -m", async () => {
      const env = await setup();
      const result = await env.exec("realpath -m dangling");
      expect(result.stdout).toBe("/work/nowhere\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-s / --no-symlinks", () => {
    it("leaves a symlink unexpanded", async () => {
      const env = await setup();
      const result = await env.exec("realpath -s link");
      expect(result.stdout).toBe("/work/link\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("leaves a symlinked directory component unexpanded", async () => {
      const env = await setup();
      const result = await env.exec("realpath --no-symlinks slink/deep");
      expect(result.stdout).toBe("/work/slink/deep\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("still resolves . and .. textually", async () => {
      const env = await setup();
      const result = await env.exec("realpath --strip ./sub/../slink/deep");
      expect(result.stdout).toBe("/work/slink/deep\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("checks nothing for existence without -e", async () => {
      const env = await setup();
      const result = await env.exec("realpath -s nosuch/deep/x");
      expect(result.stdout).toBe("/work/nosuch/deep/x\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("checks the final name with -e, following the symlink", async () => {
      const env = await setup();
      const result = await env.exec("realpath -s -e link");
      expect(result.stdout).toBe("/work/link\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("rejects a dangling symlink with -s -e", async () => {
      const env = await setup();
      const result = await env.exec("realpath -se dangling");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "realpath: dangling: No such file or directory\n",
      );
      expect(result.exitCode).toBe(1);
    });
  });

  describe("-L / -P", () => {
    it("resolves .. after the symlink by default", async () => {
      const env = await setup();
      const result = await env.exec("realpath deeplink/..");
      expect(result.stdout).toBe("/work/real\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("resolves .. before the symlink with -L", async () => {
      const env = await setup();
      const result = await env.exec("realpath -L deeplink/..");
      expect(result.stdout).toBe("/work\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("takes the last of -L and -P", async () => {
      const env = await setup();
      const result = await env.exec("realpath -L -P deeplink/..");
      expect(result.stdout).toBe("/work/real\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("resolves the remainder of a logical path normally", async () => {
      const env = await setup();
      const result = await env.exec("realpath -L deeplink/../real/deep/g.txt");
      expect(result.stdout).toBe("/work/real/deep/g.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("reports a component that the logical path removed the link from", async () => {
      const env = await setup();
      // `deeplink/..` is /work logically, and /work has no `deep`.
      const result = await env.exec("realpath -L deeplink/../deep/g.txt");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "realpath: deeplink/../deep/g.txt: No such file or directory\n",
      );
      expect(result.exitCode).toBe(1);
    });
  });

  describe("loops", () => {
    it("reports a symlink loop", async () => {
      const env = await setup();
      await env.exec("ln -s loopb loopa && ln -s loopa loopb");
      const result = await env.exec("realpath loopa");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "realpath: loopa: Too many levels of symbolic links\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("reports a symlink pointing at itself", async () => {
      const env = await setup();
      await env.exec("ln -s self self");
      const result = await env.exec("realpath self");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "realpath: self: Too many levels of symbolic links\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("leaves a looping link unexpanded under -m", async () => {
      const env = await setup();
      await env.exec("ln -s loopb loopa && ln -s loopa loopb");
      const result = await env.exec("realpath -m loopa");
      expect(result.stdout).toBe("/work/loopa\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("resolves a long but finite chain", async () => {
      const env = await setup();
      const chain = await env.exec(
        'p=sub/f.txt; for i in $(seq 1 30); do ln -s "$p" "c$i"; p="c$i"; done',
      );
      expect(chain.exitCode).toBe(0);
      const result = await env.exec("realpath c30");
      expect(result.stdout).toBe("/work/sub/f.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });
});
