import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("realpath", () => {
  it("resolves files, directories, and relative operands", async () => {
    const env = new Bash({
      cwd: "/work",
      files: {
        "/work/file.txt": "content\n",
        "/work/dir/.keep": "",
      },
    });

    const result = await env.exec("realpath file.txt dir ./dir/../file.txt");

    expect(result.stdout).toBe("/work/file.txt\n/work/dir\n/work/file.txt\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("resolves chained relative and absolute symlinks", async () => {
    const env = new Bash({
      cwd: "/work",
      files: { "/work/target/docs/file.txt": "content\n" },
    });

    await env.exec("ln -s target /work/intermediate");
    await env.exec("ln -s /work/intermediate/docs /work/linked-docs");

    const result = await env.exec("realpath linked-docs/file.txt");

    expect(result.stdout).toBe("/work/target/docs/file.txt\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("preserves whitespace and newlines in canonical paths", async () => {
    const env = new Bash({
      cwd: "/work",
      files: {
        "/work/target ": "space\n",
        "/work/target\nfile": "newline\n",
      },
    });
    await env.fs.symlink("target ", "/work/space-link");
    await env.fs.symlink("target\nfile", "/work/newline-link");

    const result = await env.exec("realpath space-link newline-link");

    expect(result.stdout).toBe("/work/target \n/work/target\nfile\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("preserves trailing newlines in canonical paths", async () => {
    const env = new Bash({
      cwd: "/work",
      files: {
        "/work/target\n": "content\n",
        "/outside": "outside content\n",
      },
    });
    await env.fs.symlink("/outside", "/work/target");
    await env.fs.symlink("target\n", "/work/link");

    const result = await env.exec("realpath link");

    expect(result.stdout).toBe("/work/target\n\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("reports each failed operand while continuing", async () => {
    const env = new Bash({ files: { "/one": "1", "/two": "2" } });

    const result = await env.exec("realpath /one /missing /two");

    expect(result.stdout).toBe("/one\n/two\n");
    expect(result.stderr).toBe(
      "realpath: '/missing': No such file or directory\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it("fails for broken and circular symlinks", async () => {
    const env = new Bash({ files: { "/target": "content\n" } });
    await env.fs.symlink("/missing", "/broken");
    await env.fs.symlink("/loop-two", "/loop-one");
    await env.fs.symlink("/loop-one", "/loop-two");

    const broken = await env.exec("realpath /broken");
    const circular = await env.exec("realpath /loop-one");

    expect(broken.exitCode).toBe(1);
    expect(broken.stdout).toBe("");
    expect(broken.stderr).toBe(
      "realpath: '/broken': No such file or directory\n",
    );
    expect(circular.exitCode).toBe(1);
    expect(circular.stdout).toBe("");
    expect(circular.stderr).toBe(
      "realpath: '/loop-one': Too many levels of symbolic links\n",
    );
  });

  it("handles help, option termination, and unknown options", async () => {
    const env = new Bash({ files: { "/-name": "content\n" } });

    const help = await env.exec("realpath --help");
    const terminated = await env.exec("realpath -- /-name");
    const unknown = await env.exec("realpath -x /-name");
    const missing = await env.exec("realpath");

    expect(help.stdout).toContain("Usage: realpath FILE...");
    expect(help.exitCode).toBe(0);
    expect(terminated.stdout).toBe("/-name\n");
    expect(terminated.exitCode).toBe(0);
    expect(unknown.stderr).toBe("realpath: invalid option -- 'x'\n");
    expect(unknown.exitCode).toBe(1);
    expect(missing.stderr).toBe("realpath: missing operand\n");
    expect(missing.exitCode).toBe(1);
  });

  it("is available through command filtering and remains overridable", async () => {
    const filtered = new Bash({
      commands: ["realpath"],
      files: { "/file": "content\n" },
    });
    const filteredResult = await filtered.exec("realpath /file");
    const unavailable = await filtered.exec("echo unavailable");

    expect(filteredResult.stdout).toBe("/file\n");
    expect(filteredResult.exitCode).toBe(0);
    expect(unavailable.exitCode).toBe(127);

    const overridden = new Bash({
      customCommands: [
        {
          name: "realpath",
          execute: async () => ({
            stdout: "custom\n",
            stderr: "",
            exitCode: 0,
          }),
        },
      ],
    });
    const overrideResult = await overridden.exec("realpath /file");

    expect(overrideResult.stdout).toBe("custom\n");
    expect(overrideResult.exitCode).toBe(0);
  });
});
