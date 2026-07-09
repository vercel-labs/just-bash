import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("cat -E / -T (show ends and tabs)", () => {
  it("-E appends $ before each newline", async () => {
    const env = new Bash();
    const r = await env.exec('printf "a\\nb\\n" | cat -E');
    expect(r.stdout).toBe("a$\nb$\n");
    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(0);
  });

  it("-E does not append $ to a final unterminated line", async () => {
    const env = new Bash();
    const r = await env.exec('printf "a\\nb" | cat -E');
    expect(r.stdout).toBe("a$\nb");
    expect(r.stderr).toBe("");
  });

  it("-T renders TAB as ^I", async () => {
    const env = new Bash();
    const r = await env.exec('printf "a\\tb\\n" | cat -T');
    expect(r.stdout).toBe("a^Ib\n");
    expect(r.stderr).toBe("");
  });

  it("long options --show-ends and --show-tabs work", async () => {
    const env = new Bash();
    const r = await env.exec('printf "a\\tb\\n" | cat --show-ends --show-tabs');
    expect(r.stdout).toBe("a^Ib$\n");
    expect(r.stderr).toBe("");
  });
});

describe("cat flag aliases (-A/-e/-t)", () => {
  it("-A is equivalent to -vET", async () => {
    const env = new Bash();
    const a = await env.exec('printf "a\\tb\\n" | cat -A');
    const vet = await env.exec('printf "a\\tb\\n" | cat -vET');
    expect(a.stdout).toBe("a^Ib$\n");
    expect(a.stdout).toBe(vet.stdout);
    expect(a.stderr).toBe("");
  });

  it("-e is equivalent to -vE (does not expand tabs)", async () => {
    const env = new Bash();
    const e = await env.exec('printf "a\\tb\\n" | cat -e');
    const vE = await env.exec('printf "a\\tb\\n" | cat -vE');
    expect(e.stdout).toBe("a\tb$\n");
    expect(e.stdout).toBe(vE.stdout);
  });

  it("-t is equivalent to -vT (no $ at end)", async () => {
    const env = new Bash();
    const t = await env.exec('printf "a\\tb\\n" | cat -t');
    const vT = await env.exec('printf "a\\tb\\n" | cat -vT');
    expect(t.stdout).toBe("a^Ib\n");
    expect(t.stdout).toBe(vT.stdout);
  });

  it("--show-all is equivalent to -vET", async () => {
    const env = new Bash();
    const r = await env.exec('printf "a\\tb\\n" | cat --show-all');
    expect(r.stdout).toBe("a^Ib$\n");
  });
});

describe("cat -n / -b numbering", () => {
  it("-n numbers every line including blank lines", async () => {
    const env = new Bash();
    const r = await env.exec('printf "a\\n\\nb\\n" | cat -n');
    expect(r.stdout).toBe("     1\ta\n     2\t\n     3\tb\n");
    expect(r.stderr).toBe("");
  });

  it("-b numbers only non-blank lines", async () => {
    const env = new Bash();
    const r = await env.exec('printf "a\\n\\nb\\n" | cat -b');
    expect(r.stdout).toBe("     1\ta\n\n     2\tb\n");
    expect(r.stderr).toBe("");
  });

  it("-b overrides -n when both are given", async () => {
    const env = new Bash();
    const bn = await env.exec('printf "a\\n\\nb\\n" | cat -bn');
    const b = await env.exec('printf "a\\n\\nb\\n" | cat -b');
    expect(bn.stdout).toBe("     1\ta\n\n     2\tb\n");
    expect(bn.stdout).toBe(b.stdout);
  });

  it("--number-nonblank long option works", async () => {
    const env = new Bash();
    const r = await env.exec('printf "a\\n\\nb\\n" | cat --number-nonblank');
    expect(r.stdout).toBe("     1\ta\n\n     2\tb\n");
  });

  it("numbers a final unterminated line with no trailing newline", async () => {
    const env = new Bash();
    const r = await env.exec('printf "a" | cat -n');
    expect(r.stdout).toBe("     1\ta");
    expect(r.stderr).toBe("");
  });
});

describe("cat -s (squeeze blank lines)", () => {
  it("collapses runs of adjacent blank lines to one", async () => {
    const env = new Bash();
    const r = await env.exec('printf "a\\n\\n\\n\\nb\\n" | cat -s');
    expect(r.stdout).toBe("a\n\nb\n");
    expect(r.stderr).toBe("");
  });

  it("collapses leading blank lines", async () => {
    const env = new Bash();
    const r = await env.exec('printf "\\n\\n\\na\\n" | cat -s');
    expect(r.stdout).toBe("\na\n");
  });

  it("squeeze happens before numbering", async () => {
    const env = new Bash();
    const r = await env.exec('printf "a\\n\\n\\nb\\n" | cat -sn');
    expect(r.stdout).toBe("     1\ta\n     2\t\n     3\tb\n");
  });

  it("--squeeze-blank long option works", async () => {
    const env = new Bash();
    const r = await env.exec('printf "a\\n\\n\\nb\\n" | cat --squeeze-blank');
    expect(r.stdout).toBe("a\n\nb\n");
  });
});
