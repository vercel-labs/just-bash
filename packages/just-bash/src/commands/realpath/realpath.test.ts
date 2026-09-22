import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "../../interpreter/errors.js";

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

  it("resolves dot segments after following a symlink", async () => {
    const env = new Bash({
      cwd: "/work",
      files: {
        "/target/file.txt": "content\n",
        "/target/dir/keep": "",
      },
    });
    await env.fs.symlink("/target/dir", "/work/link");

    const result = await env.exec("realpath link/../file.txt");

    expect(result.stdout).toBe("/target/file.txt\n");
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

    const result = await env.exec("realpath /one /missing/child /two");

    expect(result.stdout).toBe("/one\n/two\n");
    expect(result.stderr).toBe(
      "realpath: '/missing/child': No such file or directory\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it("bounds output while processing multiple operands", async () => {
    const env = new Bash({
      files: { "/file": "content\n" },
      executionLimits: { maxOutputSize: 6 },
    });

    const result = await env.exec("realpath /file /file");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain(
      "realpath: output size limit exceeded (6 bytes)",
    );
  });

  it("yields while processing redundant path components", async () => {
    const fs = new InMemoryFs({ "/target": "content\n" });
    const operand = `${"./".repeat(20_000)}target`;
    let timerRan = false;
    const timer = setTimeout(() => {
      timerRan = true;
    }, 0);

    const result = await fs.realpathFromCwd({ cwd: "/", path: operand });

    clearTimeout(timer);
    expect(result).toBe("/target");
    expect(timerRan).toBe(true);
  });

  it("stops redundant path processing when aborted", async () => {
    const fs = new InMemoryFs({ "/target": "content\n" });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 0);

    await expect(
      fs.realpathFromCwd({
        cwd: "/",
        path: `${"./".repeat(20_000)}target`,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(ExecutionAbortedError);

    clearTimeout(timer);
  });

  it("resolves a dangling final symlink and fails for a circular symlink", async () => {
    const env = new Bash({ files: { "/target": "content\n" } });
    await env.fs.symlink("/missing", "/broken");
    await env.fs.symlink("/loop-two", "/loop-one");
    await env.fs.symlink("/loop-one", "/loop-two");

    const broken = await env.exec("realpath /broken");
    const circular = await env.exec("realpath /loop-one");

    expect(broken.exitCode).toBe(0);
    expect(broken.stdout).toBe("/missing\n");
    expect(broken.stderr).toBe("");
    expect(circular.exitCode).toBe(1);
    expect(circular.stdout).toBe("");
    expect(circular.stderr).toBe(
      "realpath: '/loop-one': Too many levels of symbolic links\n",
    );
  });

  it("handles help, option termination, and unknown options", async () => {
    const env = new Bash({
      files: {
        "/-": "content\n",
        "/-name": "content\n",
        "/--help": "content\n",
      },
    });

    const help = await env.exec("realpath --help");
    const terminated = await env.exec("realpath -- /-name");
    const terminatedHelp = await env.exec("realpath -- --help");
    const dash = await env.exec("realpath -");
    const unknown = await env.exec("realpath -x /-name");
    const missing = await env.exec("realpath");
    const empty = await env.exec("realpath ''");

    expect(help.stdout).toContain("Usage: realpath FILE...");
    expect(help.exitCode).toBe(0);
    expect(terminated.stdout).toBe("/-name\n");
    expect(terminated.exitCode).toBe(0);
    expect(terminatedHelp.stdout).toBe("/--help\n");
    expect(terminatedHelp.exitCode).toBe(0);
    expect(dash.stdout).toBe("/-\n");
    expect(dash.exitCode).toBe(0);
    expect(unknown.stderr).toBe("realpath: invalid option -- 'x'\n");
    expect(unknown.exitCode).toBe(1);
    expect(missing.stderr).toBe("realpath: missing operand\n");
    expect(missing.exitCode).toBe(1);
    expect(empty.stdout).toBe("");
    expect(empty.stderr).toBe("realpath: '': No such file or directory\n");
    expect(empty.exitCode).toBe(1);
  });

  it("reports a non-directory path component", async () => {
    const env = new Bash({ files: { "/file": "content\n" } });

    const result = await env.exec("realpath /file/child");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("realpath: '/file/child': Not a directory\n");
    expect(result.exitCode).toBe(1);
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
