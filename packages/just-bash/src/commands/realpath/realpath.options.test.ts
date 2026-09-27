import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

function setup(): Bash {
  return new Bash({
    files: {
      "/work/sub/f.txt": "hi\n",
      "/work/other/deep/g.txt": "there\n",
    },
    cwd: "/work",
  });
}

describe("realpath options", () => {
  describe("-q / --quiet", () => {
    it("suppresses the diagnostic but keeps the exit status", async () => {
      const env = setup();
      const result = await env.exec("realpath -q nosuch/x");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    it("still prints resolvable operands", async () => {
      const env = setup();
      const result = await env.exec("realpath --quiet nosuch/x sub/f.txt");
      expect(result.stdout).toBe("/work/sub/f.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("-z / --zero", () => {
    it("terminates every name with NUL", async () => {
      const env = setup();
      const result = await env.exec("realpath -z sub/f.txt other | wc -c");
      // "/work/sub/f.txt\0" (16) + "/work/other\0" (12)
      expect(result.stdout).toBe("28\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("combines with other short flags", async () => {
      const env = setup();
      const result = await env.exec("realpath -zm nosuch");
      expect(result.stdout).toBe("/work/nosuch\0");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("--relative-to", () => {
    it("prints a name below the directory relative to it", async () => {
      const env = setup();
      const result = await env.exec("realpath --relative-to=/work sub/f.txt");
      expect(result.stdout).toBe("sub/f.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("accepts the value as a separate argument", async () => {
      const env = setup();
      const result = await env.exec("realpath --relative-to /work sub/f.txt");
      expect(result.stdout).toBe("sub/f.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("climbs out of the directory with ..", async () => {
      const env = setup();
      const result = await env.exec(
        "realpath --relative-to=/work/sub other/deep/g.txt",
      );
      expect(result.stdout).toBe("../other/deep/g.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("prints . when the name is the directory itself", async () => {
      const env = setup();
      const result = await env.exec(
        "realpath --relative-to=/work/sub /work/sub",
      );
      expect(result.stdout).toBe(".\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("applies to every operand", async () => {
      const env = setup();
      const result = await env.exec(
        "realpath --relative-to=/work sub/f.txt other/deep/g.txt",
      );
      expect(result.stdout).toBe("sub/f.txt\nother/deep/g.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("resolves the directory under the same existence policy", async () => {
      const env = setup();
      const result = await env.exec(
        "realpath --relative-to=/work/nosuch/deep sub/f.txt",
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "realpath: /work/nosuch/deep: No such file or directory\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("accepts a missing directory under -m", async () => {
      const env = setup();
      const result = await env.exec(
        "realpath -m --relative-to=/work/nosuch/deep sub/f.txt",
      );
      expect(result.stdout).toBe("../../sub/f.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("reports a missing value", async () => {
      const env = setup();
      const result = await env.exec("realpath --relative-to");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "realpath: option '--relative-to' requires an argument\n",
      );
      expect(result.exitCode).toBe(1);
    });
  });

  describe("--relative-base", () => {
    it("prints a relative name below the base", async () => {
      const env = setup();
      const result = await env.exec("realpath --relative-base=/work sub/f.txt");
      expect(result.stdout).toBe("sub/f.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("prints an absolute name outside the base", async () => {
      const env = setup();
      const result = await env.exec(
        "realpath --relative-base=/work/other sub/f.txt",
      );
      expect(result.stdout).toBe("/work/sub/f.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("anchors output at --relative-to while the name stays under the base", async () => {
      const env = setup();
      const result = await env.exec(
        "realpath --relative-base=/work --relative-to=/work/sub other/deep",
      );
      expect(result.stdout).toBe("../other/deep\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("drops both options when --relative-to is outside the base", async () => {
      const env = setup();
      const result = await env.exec(
        "realpath --relative-base=/work/other --relative-to=/work/sub other/deep",
      );
      expect(result.stdout).toBe("/work/other/deep\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("makes every name relative when the base is the root", async () => {
      const env = setup();
      const result = await env.exec("realpath --relative-base=/ sub/f.txt");
      expect(result.stdout).toBe("work/sub/f.txt\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("unknown options", () => {
    it("rejects an unknown short option", async () => {
      const env = setup();
      const result = await env.exec("realpath -x sub/f.txt");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("realpath: invalid option -- 'x'\n");
      expect(result.exitCode).toBe(1);
    });

    it("rejects an unknown short option inside a bundle", async () => {
      const env = setup();
      const result = await env.exec("realpath -ex sub/f.txt");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("realpath: invalid option -- 'x'\n");
      expect(result.exitCode).toBe(1);
    });

    it("rejects an unknown long option", async () => {
      const env = setup();
      const result = await env.exec("realpath --canonical sub/f.txt");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "realpath: unrecognized option '--canonical'\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("rejects a value given to a flag", async () => {
      const env = setup();
      const result = await env.exec("realpath --quiet=1 sub/f.txt");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("realpath: unrecognized option '--quiet'\n");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("--help", () => {
    it("describes the command", async () => {
      const env = setup();
      const result = await env.exec("realpath --help");
      expect(result.stdout).toContain(
        "realpath - print the resolved absolute file name",
      );
      expect(result.stdout).toContain("Usage: realpath [OPTION]... FILE...");
      expect(result.stdout).toContain("--relative-base=DIR");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("wins over other options", async () => {
      const env = setup();
      const result = await env.exec("realpath -e nosuch --help");
      expect(result.stdout).toContain("Usage: realpath [OPTION]... FILE...");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("integration", () => {
    it("is reported by which", async () => {
      const env = setup();
      const result = await env.exec("which realpath");
      expect(result.stdout).toBe("/usr/bin/realpath\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("feeds a command substitution", async () => {
      const env = setup();
      const result = await env.exec('cd sub && cat "$(realpath f.txt)"');
      expect(result.stdout).toBe("hi\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });
});
