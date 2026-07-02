import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { defineCommand } from "../custom-commands.js";

/**
 * `applyRedirections` processes a command's redirection list sequentially, so a
 * duplication operator must deliver to wherever its source fd points at that
 * moment in the list — not unconditionally to the live stream.
 *
 * The canonical failure this guards against: `cmd > file 2>&1` wrote stdout to
 * the file but leaked stderr onto the caller's stdout, because `2>&1` ignored
 * that fd 1 had already been redirected. Any wrapper protocol that parses the
 * enclosing script's stdout (e.g. a runner emitting a JSON payload after
 * `eval "$CMD" > "$OUT" 2>&1`) sees the leaked stderr corrupt its stream.
 */
describe("fd duplication after redirection (> file 2>&1)", () => {
  it("sends command-not-found stderr to the file, not the caller's stdout", async () => {
    const env = new Bash();
    const result = await env.exec("nosuchcmd > /tmp/f 2>&1");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(127);
    const f = await env.exec("cat /tmp/f");
    expect(f.stdout).toBe("bash: nosuchcmd: command not found\n");
  });

  it("sends a custom command's stderr to the file", async () => {
    const fail403 = defineCommand("vercel", async () => ({
      stdout: "",
      stderr: "Error! Forbidden (403)\n",
      exitCode: 1,
    }));
    const env = new Bash({ customCommands: [fail403] });
    const result = await env.exec("vercel flags > /tmp/f 2>&1");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
    const f = await env.exec("cat /tmp/f");
    expect(f.stdout).toBe("Error! Forbidden (403)\n");
  });

  it("keeps a wrapper script's stdout clean (runner-payload shape)", async () => {
    const fail = defineCommand("failing-tool", async () => ({
      stdout: "",
      stderr: "tool error\n",
      exitCode: 1,
    }));
    const env = new Bash({ customCommands: [fail] });
    const result = await env.exec(
      'CMD="failing-tool"; eval "$CMD" > /tmp/out 2>&1; echo \'{"ok":true}\'',
    );
    expect(result.stdout).toBe('{"ok":true}\n');
    expect(result.stderr).toBe("");
    const f = await env.exec("cat /tmp/out");
    expect(f.stdout).toBe("tool error\n");
  });

  it("interleaves group stdout and stderr into the file", async () => {
    const env = new Bash();
    const result = await env.exec("{ echo o; nosuchcmd; } > /tmp/f 2>&1");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    const f = await env.exec("cat /tmp/f");
    expect(f.stdout).toBe("o\nbash: nosuchcmd: command not found\n");
  });

  it("appends stderr after >> file 2>&1", async () => {
    const env = new Bash({ files: { "/tmp/f": "x\n" } });
    const result = await env.exec("nosuchcmd >> /tmp/f 2>&1");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    const f = await env.exec("cat /tmp/f");
    expect(f.stdout).toBe("x\nbash: nosuchcmd: command not found\n");
  });

  it("routes stdout to fd 2's file for cmd 2> file 1>&2", async () => {
    const env = new Bash();
    const result = await env.exec("echo hi 2> /tmp/e 1>&2");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    const e = await env.exec("cat /tmp/e");
    expect(e.stdout).toBe("hi\n");
  });

  it("discards stderr for > /dev/null 2>&1", async () => {
    const env = new Bash();
    const result = await env.exec("nosuchcmd > /dev/null 2>&1");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(127);
  });

  it("lets a later 2> file reclaim stderr after > all 2>&1", async () => {
    const env = new Bash();
    const result = await env.exec(
      "{ echo out; nosuchcmd; } > /tmp/all 2>&1 2> /tmp/err",
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    const all = await env.exec("cat /tmp/all");
    expect(all.stdout).toBe("out\n");
    const err = await env.exec("cat /tmp/err");
    expect(err.stdout).toBe("bash: nosuchcmd: command not found\n");
  });

  it("keeps stderr on the caller's stdout for 2>&1 > file (dup before redirect)", async () => {
    const env = new Bash();
    const result = await env.exec("nosuchcmd 2>&1 > /tmp/f");
    expect(result.stdout).toBe("bash: nosuchcmd: command not found\n");
    expect(result.stderr).toBe("");
    const f = await env.exec("cat /tmp/f");
    expect(f.stdout).toBe("");
  });

  it("only truncates intermediate redirect targets (1>&2 > leak > /dev/null)", async () => {
    const env = new Bash();
    const result = await env.exec(
      "echo hi 1>&2 > /tmp/leak > /dev/null 2> /dev/null",
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    const leak = await env.exec("cat /tmp/leak");
    expect(leak.stdout).toBe("");
    expect(leak.exitCode).toBe(0); // file exists (was opened), just empty
  });

  it("writes content to the last target for cmd > a > b", async () => {
    const env = new Bash();
    await env.exec("echo hi > /tmp/a > /tmp/b");
    const a = await env.exec("cat /tmp/a");
    expect(a.stdout).toBe("");
    expect(a.exitCode).toBe(0); // truncated but created
    const b = await env.exec("cat /tmp/b");
    expect(b.stdout).toBe("hi\n");
  });

  it("keeps content in the file for > file > /dev/stdout (self-dup no-op)", async () => {
    const env = new Bash();
    const result = await env.exec("echo hi > /tmp/a > /dev/stdout");
    expect(result.stdout).toBe("");
    const a = await env.exec("cat /tmp/a");
    expect(a.stdout).toBe("hi\n");
  });

  it("routes stderr to fd 1's file for 2> /dev/stdout after > file", async () => {
    const env = new Bash();
    const result = await env.exec("nosuchcmd > /tmp/f 2> /dev/stdout");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    const f = await env.exec("cat /tmp/f");
    expect(f.stdout).toBe("bash: nosuchcmd: command not found\n");
  });

  it("treats > f 2> f as independent descriptors, not a shared cursor", async () => {
    const env = new Bash();
    await env.exec("{ echo out; nosuchcmd; } > /tmp/f 2> /tmp/f");
    const f = await env.exec("cat /tmp/f");
    // Each redirect writes from its own start position; the later non-empty
    // write clobbers the earlier one (bash's independent-open behavior).
    expect(f.stdout).toBe("bash: nosuchcmd: command not found\n");
    const env2 = new Bash();
    await env2.exec("echo hi > /tmp/f 2> /tmp/f");
    const f2 = await env2.exec("cat /tmp/f");
    expect(f2.stdout).toBe("hi\n");
  });

  it("keeps the ENOSPC diagnostic visible for 2> /dev/full", async () => {
    const env = new Bash();
    const result = await env.exec("nosuchcmd 2> /dev/full");
    expect(result.stderr).toContain("No space left on device");
    expect(result.exitCode).toBe(1);
  });

  it("still merges to live stdout for a bare 2>&1", async () => {
    const env = new Bash();
    const result = await env.exec("nosuchcmd 2>&1");
    expect(result.stdout).toBe("bash: nosuchcmd: command not found\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(127);
  });

  it("still routes plain 2> file without a dup", async () => {
    const env = new Bash();
    const result = await env.exec("nosuchcmd 2> /tmp/e");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    const e = await env.exec("cat /tmp/e");
    expect(e.stdout).toBe("bash: nosuchcmd: command not found\n");
  });
});
