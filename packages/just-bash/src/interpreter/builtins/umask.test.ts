import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { defineCommand } from "../../custom-commands.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";

describe("shell-local umask", () => {
  it("applies to redirection, append, touch, mkdir and explicit modes", async () => {
    const bash = new Bash({ files: { "/existing": "old" } });
    const result = await bash.exec(
      "umask 077; echo new >/file; echo more >>/append; touch /touched; mkdir -p /outer/inner; mkdir -m 755 /explicit; echo changed >/existing; stat -c %a /file /append /touched /outer /outer/inner /explicit /existing",
    );
    expect(result).toMatchObject({
      stdout: "600\n600\n600\n700\n700\n755\n644\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it("allows a less restrictive mask and preserves overwrites", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      "umask 000; touch /file; mkdir /dir; umask 077; echo data >/file; stat -c %a /file /dir",
    );
    expect(result).toMatchObject({
      stdout: "666\n777\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it("inherits in child shells and restores subshell changes", async () => {
    const result = await new Bash().exec(
      "umask 077; (umask 002; umask); umask; v=$(umask 007; umask); echo $v; umask; bash -c 'umask; umask 000'; umask; env -i bash -c 'umask'",
    );
    expect(result).toMatchObject({
      stdout: "0002\n0077\n0007\n0077\n0077\n0077\n0077\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it("isolates top-level execs and applies mask changes in functions and sources", async () => {
    const bash = new Bash({ files: { "/mask.sh": "umask 027" } });
    expect(
      await bash.exec("f() { umask 077; }; f; umask; . /mask.sh; umask"),
    ).toMatchObject({ stdout: "0077\n0027\n", stderr: "", exitCode: 0 });
    expect((await bash.exec("umask")).stdout).toBe("0022\n");
  });
  it("isolates pipeline and process-substitution masks but respects lastpipe", async () => {
    const result = await new Bash().exec(
      "umask 077; umask 002 | cat; umask; cat <(umask 007; umask); umask; echo ignored | umask 027; umask; shopt -s lastpipe; echo ignored | umask 027; umask",
    );
    expect(result).toMatchObject({
      stdout: "0077\n0007\n0077\n0077\n0027\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it("applies to command extensions and preserves one backend identity", async () => {
    const identities: object[] = [];
    const bash = new Bash({
      customCommands: [
        defineCommand("create", async (_, ctx) => {
          if (ctx.fsIdentity) identities.push(ctx.fsIdentity);
          await ctx.fs.mkdir("/custom/nested", { recursive: true });
          await ctx.fs.writeFile("/custom/nested/file", "secret");
          return { stdout: "", stderr: "", exitCode: 0 };
        }),
      ],
    });
    expect(
      await bash.exec(
        "umask 077; create; bash -c create; stat -c %a /custom /custom/nested /custom/nested/file",
      ),
    ).toMatchObject({ stdout: "700\n700\n600\n", stderr: "", exitCode: 0 });
    expect(identities).toHaveLength(2);
    expect(identities[1]).toBe(identities[0]);
  });
  it("resolves a dangling final symlink without changing the link", async () => {
    const bash = new Bash();
    await bash.fs.symlink("/target", "/link");
    expect(
      await bash.exec("umask 077; echo private >/link; stat -c %a /target"),
    ).toMatchObject({ stdout: "600\n", stderr: "", exitCode: 0 });
    expect(await bash.fs.readlink("/link")).toBe("/target");
  });
  it("bounds a dangling link cycle", async () => {
    const bash = new Bash({ executionLimits: { maxTraversalDepth: 2 } });
    await bash.fs.symlink("/b", "/a");
    await bash.fs.symlink("/a", "/b");
    const result = await bash.exec("umask 077; echo private >/a");
    expect(result.exitCode).not.toBe(0);
    expect(await bash.fs.readlink("/a")).toBe("/b");
  });
  it("uses the mask for ordinary copies and preserves explicit metadata", async () => {
    const bash = new Bash({ files: { "/source/file": "x", "/old": "old" } });
    await bash.fs.chmod("/source", 0o750);
    await bash.fs.chmod("/source/file", 0o664);
    await bash.fs.chmod("/old", 0o640);
    const result = await bash.exec(
      "umask 077; cp -r /source /copy; cp -a /source /archive; cp /source/file /old; cp -p /source/file /preserve; stat -c %a /copy /copy/file /archive /archive/file /old /preserve",
    );
    expect(result).toMatchObject({
      stdout: "700\n600\n750\n664\n640\n664\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it("keeps ordinary native-like writes working without atomic mode creation", async () => {
    const fs = new InMemoryFs({ "/existing": "old", "/source": "data" });
    const create = vi
      .spyOn(fs, "createExclusive")
      .mockRejectedValue(new Error("ENOTSUP: native modes unavailable"));
    const bash = new Bash({ fs });
    expect(
      await bash.exec(
        "echo ok >/ordinary; mkdir /ordinary-dir; echo more >>/ordinary; cp /source /copy",
      ),
    ).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(create).not.toHaveBeenCalled();
    expect(
      await bash.exec("umask 077; echo updated >/existing; cat /existing"),
    ).toMatchObject({ stdout: "updated\n", stderr: "", exitCode: 0 });
    for (const command of [
      "echo secret >/private",
      "mkdir /private",
      "cp /source /private",
    ])
      expect((await bash.exec(`umask 077; ${command}`)).exitCode).not.toBe(0);
    expect(await fs.exists("/private")).toBe(false);
  });
  it("does not mask explicit atomic creation requests", async () => {
    const bash = new Bash({
      customCommands: [
        defineCommand("explicit", async (_, ctx) => {
          await ctx.fs.createExclusive?.("/explicit", { mode: 0o640 });
          return { stdout: "", stderr: "", exitCode: 0 };
        }),
      ],
    });
    expect(
      await bash.exec("umask 077; explicit; stat -c %a /explicit"),
    ).toMatchObject({ stdout: "640\n", stderr: "", exitCode: 0 });
  });
  it("checks cancellation between mode-aware creation and content writes", async () => {
    const fs = new InMemoryFs();
    const controller = new AbortController();
    const create = fs.createExclusive.bind(fs);
    vi.spyOn(fs, "createExclusive").mockImplementation(
      async (path, options) => {
        await create(path, options);
        if (path === "/private") controller.abort();
      },
    );
    const result = await new Bash({ fs }).exec(
      "umask 077; echo secret >/private",
      { signal: controller.signal },
    );
    expect(result.exitCode).not.toBe(0);
    expect(await fs.readFile("/private")).toBe("");
    expect((await fs.stat("/private")).mode).toBe(0o600);
  });
});
