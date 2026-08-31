import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

const NAME = /^\/tmp\/tmp\.[0-9A-Za-z]{10}$/;

describe("mktemp", () => {
  describe("default template", () => {
    it("should create a file in /tmp and print its path", async () => {
      const env = new Bash();
      const result = await env.exec('f=$(mktemp); echo "$f"; test -f "$f"');
      expect(result.stdout.trim()).toMatch(NAME);
      expect(result.exitCode).toBe(0);
    });

    it("should print a different name each time", async () => {
      const env = new Bash();
      const result = await env.exec("mktemp; mktemp");
      const [first, second] = result.stdout.trim().split("\n");
      expect(first).not.toBe(second);
    });

    it("should honor $TMPDIR", async () => {
      const env = new Bash();
      const result = await env.exec(
        "mkdir -p /scratch && export TMPDIR=/scratch && mktemp",
      );
      expect(result.stdout.trim()).toMatch(/^\/scratch\/tmp\.[0-9A-Za-z]{10}$/);
      expect(result.exitCode).toBe(0);
    });

    // An empty value is unset, not the root directory. Checked against
    // coreutils 9.2, which prints /tmp/tmp.XXXXXXXXXX for all three.
    it.each([
      "TMPDIR= mktemp -u",
      "mktemp -u --tmpdir=",
      "mktemp -u -p ''",
    ])("should treat an empty temp dir in `%s` as unset", async (command) => {
      const env = new Bash();
      const result = await env.exec(command);
      expect(result.stdout.trim()).toMatch(NAME);
    });
  });

  describe("options", () => {
    it("should create a directory with -d", async () => {
      const env = new Bash();
      const result = await env.exec('d=$(mktemp -d); test -d "$d" && echo dir');
      expect(result.stdout.trim()).toBe("dir");
    });

    it("should not create anything with -u", async () => {
      const env = new Bash();
      const result = await env.exec(
        'u=$(mktemp -u); test -e "$u" && echo exists || echo absent',
      );
      expect(result.stdout.trim()).toBe("absent");
    });

    it("should place the file in -p DIR", async () => {
      const env = new Bash();
      const result = await env.exec("mkdir -p /work && mktemp -p /work");
      expect(result.stdout.trim()).toMatch(/^\/work\/tmp\.[0-9A-Za-z]{10}$/);
    });

    it("should accept an inline -pDIR", async () => {
      const env = new Bash();
      const result = await env.exec("mkdir -p /work && mktemp -p/work");
      expect(result.stdout.trim()).toMatch(/^\/work\/tmp\.[0-9A-Za-z]{10}$/);
    });

    it("should accept -p at the end of a cluster", async () => {
      const env = new Bash();
      const result = await env.exec(
        'mkdir -p /work && d=$(mktemp -dp /work); test -d "$d" && echo "$d"',
      );
      expect(result.stdout.trim()).toMatch(/^\/work\/tmp\.[0-9A-Za-z]{10}$/);
    });

    it("should report a missing -p argument", async () => {
      const env = new Bash();
      const result = await env.exec("mktemp -p");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("option requires an argument -- 'p'");
    });
  });

  describe("templates", () => {
    it("should resolve a bare template against the working directory", async () => {
      const env = new Bash();
      const result = await env.exec("cd /tmp && mktemp note.XXXXXX");
      expect(result.stdout.trim()).toMatch(/^\/tmp\/note\.[0-9A-Za-z]{6}$/);
    });

    it("should place a bare template in the temporary directory with -t", async () => {
      const env = new Bash();
      const result = await env.exec("mktemp -t note.XXXXXX");
      expect(result.stdout.trim()).toMatch(/^\/tmp\/note\.[0-9A-Za-z]{6}$/);
    });

    it("should use a template that names its own directory as written", async () => {
      const env = new Bash();
      const result = await env.exec("mkdir -p /work && mktemp /work/x.XXXX");
      expect(result.stdout.trim()).toMatch(/^\/work\/x\.[0-9A-Za-z]{4}$/);
    });

    it("should replace only the trailing run of X's", async () => {
      const env = new Bash();
      const result = await env.exec("mktemp -t XXXX.log.XXXX");
      expect(result.stdout.trim()).toMatch(
        /^\/tmp\/XXXX\.log\.[0-9A-Za-z]{4}$/,
      );
    });

    it("should reject a template with too few X's", async () => {
      const env = new Bash();
      const result = await env.exec("mktemp -t bad.XX");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("too few X's");
    });

    it("should reject more than one template", async () => {
      const env = new Bash();
      const result = await env.exec("mktemp -t a.XXXX b.XXXX");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("too many templates");
    });
  });

  describe("permissions", () => {
    it("should create files with mode 0600", async () => {
      const env = new Bash();
      const result = await env.exec("f=$(mktemp); stat -c '%a' \"$f\"");
      expect(result.stdout.trim()).toBe("600");
    });

    it("should create directories with mode 0700", async () => {
      const env = new Bash();
      const result = await env.exec("d=$(mktemp -d); stat -c '%a' \"$d\"");
      expect(result.stdout.trim()).toBe("700");
    });
  });

  describe("diagnostics", () => {
    // GNU's -q covers creation failure only, so a malformed template still
    // reports. Checked against coreutils 9.2.
    it("should still report a bad template under -q", async () => {
      const env = new Bash();
      const result = await env.exec("mktemp -q -t bad.XX");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("too few X's");
    });

    // Real mktemp fails here, but the virtual filesystem creates parents on
    // write, so `touch /nope/x` and `echo x > /nope/x` both succeed too.
    // Matching the shell around it beats matching GNU in isolation.
    it("should follow the filesystem into a directory that does not exist", async () => {
      const env = new Bash();
      const result = await env.exec("mktemp -p /nope/missing");
      expect(result.stdout.trim()).toMatch(
        /^\/nope\/missing\/tmp\.[0-9A-Za-z]{10}$/,
      );
      expect(result.exitCode).toBe(0);
    });

    it("should print help for --help", async () => {
      const env = new Bash();
      const result = await env.exec("mktemp --help");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Usage: mktemp [OPTION]... [TEMPLATE]");
    });

    it("should report an unknown short option", async () => {
      const env = new Bash();
      const result = await env.exec("mktemp -Z");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("invalid option -- 'Z'");
    });

    it("should report an unknown long option", async () => {
      const env = new Bash();
      const result = await env.exec("mktemp --nope");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unrecognized option '--nope'");
    });
  });
});
