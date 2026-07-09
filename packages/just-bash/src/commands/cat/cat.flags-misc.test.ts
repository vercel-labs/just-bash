import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("cat combined and long options", () => {
  it("combined -An expands to number + show-all", async () => {
    const env = new Bash();
    const r = await env.exec('printf "a\\tb\\n" | cat -An');
    expect(r.stdout).toBe("     1\ta^Ib$\n");
    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(0);
  });

  it("combined -bE numbers non-blank and shows ends", async () => {
    const env = new Bash();
    const r = await env.exec('printf "a\\n\\nb\\n" | cat -bE');
    expect(r.stdout).toBe("     1\ta$\n$\n     2\tb$\n");
    expect(r.stderr).toBe("");
  });

  it("--number long option works", async () => {
    const env = new Bash();
    const r = await env.exec('printf "a\\nb\\n" | cat --number');
    expect(r.stdout).toBe("     1\ta\n     2\tb\n");
  });

  it("--show-nonprinting long option works", async () => {
    const env = new Bash();
    const r = await env.exec('printf "a\\001b\\n" | cat --show-nonprinting');
    expect(r.stdout).toBe("a^Ab\n");
  });
});

describe("cat -u (ignored no-op)", () => {
  it("-u alone does not change output", async () => {
    const env = new Bash();
    const r = await env.exec('printf "a\\nb\\n" | cat -u');
    expect(r.stdout).toBe("a\nb\n");
    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(0);
  });

  it("-u combined with -n still numbers", async () => {
    const env = new Bash();
    const r = await env.exec('printf "a\\n" | cat -un');
    expect(r.stdout).toBe("     1\ta\n");
    expect(r.stderr).toBe("");
  });
});

describe("cat unknown flags", () => {
  it("errors on an unknown short flag", async () => {
    const env = new Bash();
    const r = await env.exec("cat -Z");
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("cat: invalid option -- 'Z'\n");
    expect(r.exitCode).toBe(1);
  });

  it("errors on an unknown long flag", async () => {
    const env = new Bash();
    const r = await env.exec("cat --bogus");
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("cat: unrecognized option '--bogus'\n");
    expect(r.exitCode).toBe(1);
  });
});

describe("cat multi-file numbering with display flags", () => {
  it("continues line numbers across files with -n", async () => {
    const env = new Bash({
      files: { "/a.txt": "a1\na2\n", "/b.txt": "b1\nb2\n" },
    });
    const r = await env.exec("cat -n /a.txt /b.txt");
    expect(r.stdout).toBe("     1\ta1\n     2\ta2\n     3\tb1\n     4\tb2\n");
    expect(r.stderr).toBe("");
  });

  it("squeezes blank lines across the file boundary", async () => {
    const env = new Bash({
      files: { "/a.txt": "a\n\n", "/b.txt": "\n\nb\n" },
    });
    const r = await env.exec("cat -s /a.txt /b.txt");
    expect(r.stdout).toBe("a\n\nb\n");
    expect(r.stderr).toBe("");
  });

  it("applies -E across a file that does not end in newline", async () => {
    const env = new Bash({
      files: { "/a.txt": "a", "/b.txt": "b\n" },
    });
    const r = await env.exec("cat -E /a.txt /b.txt");
    expect(r.stdout).toBe("ab$\n");
    expect(r.stderr).toBe("");
  });
});

describe("cat --help lists display flags", () => {
  it("mentions each supported flag", async () => {
    const env = new Bash();
    const r = await env.exec("cat --help");
    expect(r.exitCode).toBe(0);
    for (const opt of [
      "--show-all",
      "--number-nonblank",
      "--show-ends",
      "--number",
      "--squeeze-blank",
      "--show-tabs",
      "--show-nonprinting",
      "-e",
      "-t",
      "-u",
    ]) {
      expect(r.stdout).toContain(opt);
    }
  });
});
