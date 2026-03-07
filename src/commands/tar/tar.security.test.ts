import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { createArchive } from "./archive.js";

describe("tar security hardening", () => {
  it("blocks parent-traversal entries on extract by default", async () => {
    const env = new Bash();
    const archive = await createArchive([
      { name: "../escaped.txt", content: "escape-attempt" },
    ]);
    await env.fs.writeFile("/attack.tar", archive);

    const result = await env.exec(
      "mkdir /safe && tar -xf /attack.tar -C /safe",
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("tar: ../escaped.txt: Path contains '..'\n");
    expect(result.exitCode).toBe(2);
    expect(await env.fs.exists("/escaped.txt")).toBe(false);
    expect(await env.fs.exists("/safe/escaped.txt")).toBe(false);
  });

  it("strips leading slash from archive entries by default", async () => {
    const env = new Bash();
    const archive = await createArchive([{ name: "/abs.txt", content: "abs" }]);
    await env.fs.writeFile("/abs.tar", archive);

    const result = await env.exec("mkdir /safe && tar -xf /abs.tar -C /safe");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(await env.fs.exists("/safe/abs.txt")).toBe(true);
    expect(await env.fs.exists("/abs.txt")).toBe(false);
  });

  it("allows absolute archive extraction with -P/--absolute-names", async () => {
    const env = new Bash();
    const archive = await createArchive([{ name: "/abs.txt", content: "abs" }]);
    await env.fs.writeFile("/abs.tar", archive);

    const result = await env.exec("mkdir /safe && tar -xPf /abs.tar -C /safe");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(await env.fs.exists("/abs.txt")).toBe(true);
    expect(await env.fs.exists("/safe/abs.txt")).toBe(false);
  });

  it("blocks unsafe symlink targets by default", async () => {
    const env = new Bash();
    const archive = await createArchive([
      { name: "link.txt", isSymlink: true, linkTarget: "../outside" },
    ]);
    await env.fs.writeFile("/link.tar", archive);

    const result = await env.exec("mkdir /safe && tar -xf /link.tar -C /safe");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("tar: link.txt: unsafe symlink target\n");
    expect(result.exitCode).toBe(2);
    expect(await env.fs.exists("/safe/link.txt")).toBe(false);
  });
});
