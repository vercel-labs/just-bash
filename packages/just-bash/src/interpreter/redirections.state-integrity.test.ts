import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("redirection state integrity", () => {
  it("applies noclobber to descriptor-variable output redirects", async () => {
    const env = new Bash({ files: { "/existing": "preserve\n" } });
    const result = await env.exec("set -C; exec {fd}>/existing");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("cannot overwrite");
    expect(await env.readFile("/existing")).toBe("preserve\n");
  });

  it("allows the explicit clobber operator for descriptor variables", async () => {
    const env = new Bash({ files: { "/existing": "old\n" } });
    const result = await env.exec(
      "set -C; exec {fd}>|/existing; echo replacement >&$fd",
    );
    expect(result.exitCode).toBe(0);
    expect(await env.readFile("/existing")).toBe("replacement\n");
  });

  it("rejects a readonly descriptor variable before opening its target", async () => {
    const env = new Bash({ files: { "/existing": "preserve\n" } });
    const result = await env.exec("fd=9; readonly fd; exec {fd}>|/existing");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("readonly variable");
    expect(await env.readFile("/existing")).toBe("preserve\n");
  });

  it("expands a compound-command redirect target exactly once", async () => {
    const env = new Bash();
    const result = await env.exec(
      'i=0; for x in one; do echo body; done > "/out$((i++))"; printf "%s" "$i"',
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("1");
    expect(await env.readFile("/out0")).toBe("body\n");
    await expect(env.readFile("/out1")).rejects.toThrow();
  });

  it("validates every compound redirect before truncating any target", async () => {
    const env = new Bash({ files: { "/first": "preserve\n" } });
    await env.exec("mkdir /directory");
    const result = await env.exec(
      "for x in one; do echo body; done > /first > /directory",
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Is a directory");
    expect(await env.readFile("/first")).toBe("preserve\n");
  });
});
